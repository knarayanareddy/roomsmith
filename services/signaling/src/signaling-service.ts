import { randomBytes } from "node:crypto";
import type {
  IngressResult,
  ObservationIngress,
} from "../../../packages/session-contracts/src/index.js";
import type { SessionCredentialVerifier } from "../../pairing/src/pairing-service.js";

export const MAX_SDP_BYTES = 8192;
export const MAX_ICE_CANDIDATE_BYTES = 2048;
export const TURN_CREDENTIAL_TTL_MS = 5 * 60 * 1000;
export const SIGNALING_RATE_WINDOW_MS = 60 * 1000;
export const MAX_SIGNALING_REQUESTS_PER_WINDOW = 25;

export interface DataChannelContractSpec {
  label: "observations" | "control";
  ordered: boolean;
  maxRetransmits: number | null;
}

export interface WebRtcSdpRequest {
  session_id: string;
  device_id: string;
  access_token: string;
  sdp: string;
  data_channels: DataChannelContractSpec[];
  now_ms?: number;
}

export interface WebRtcIceRequest {
  session_id: string;
  device_id: string;
  access_token: string;
  candidate: string;
  sdp_mid: string;
  sdp_m_line_index: number;
  now_ms?: number;
}

export interface SignalingResult {
  disposition: "accepted" | "rejected";
  reason_code: string | null;
  transport: "webrtc" | "cloud_relay";
  media_tracks_present: false;
  dtls_encrypted: boolean;
}

export interface TurnCredentialRecord {
  session_id: string;
  device_id: string;
  username: string;
  credential: string;
  uris: string[];
  issued_at_ms: number;
  expires_at_ms: number;
  structured_data_only: true;
  media_relay_allowed: false;
}

export interface TurnCredentialResult {
  disposition: "issued" | "rejected";
  reason_code: string | null;
  turn: TurnCredentialRecord | null;
}

export interface CloudRelayFallbackResult {
  disposition: "activated" | "rejected";
  reason_code: string | null;
  transport: "cloud_relay" | "webrtc";
  cloud_relay_labeled: boolean;
  user_banner: string | null;
}

export interface CloudRelayForwardResult {
  disposition: "relayed" | "rejected";
  reason_code: string | null;
  transport: "cloud_relay";
  cloud_relay_labeled: true;
  ingress_result: IngressResult | null;
}

export interface RedactedSignalingLogEntry {
  event: string;
  session_id: string;
  device_id: string;
  at_ms: number;
  sdp: "[REDACTED_SDP]";
  ice_candidate: "[REDACTED_ICE]";
  access_token: "[REDACTED_TOKEN]";
  turn_credential: "[REDACTED_TURN]";
  reason_code: string | null;
}

interface SessionSignalingState {
  offerSubmitted: boolean;
  answerSubmitted: boolean;
  connected: boolean;
  transport: "webrtc" | "cloud_relay";
  cloudRelayLabeled: boolean;
  iceCandidateCount: number;
  turnCredentials: Map<string, TurnCredentialRecord>;
}

interface RateBucket {
  windowStartMs: number;
  count: number;
}

function validateDataChannels(
  channels: readonly DataChannelContractSpec[],
): boolean {
  if (!Array.isArray(channels) || channels.length !== 2) return false;
  const obs = channels.find((item) => item.label === "observations");
  const ctrl = channels.find((item) => item.label === "control");
  if (!obs || !ctrl) return false;
  return (
    obs.ordered === false &&
    obs.maxRetransmits === 0 &&
    ctrl.ordered === true &&
    ctrl.maxRetransmits === null
  );
}

function validateDataChannelOnlySdp(sdp: string): {
  valid: boolean;
  reasonCode: string | null;
} {
  if (
    typeof sdp !== "string" ||
    sdp.trim().length === 0 ||
    Buffer.byteLength(sdp, "utf8") > MAX_SDP_BYTES
  ) {
    return { valid: false, reasonCode: "sdp_payload_invalid_or_oversized" };
  }
  if (
    /(?:^|\r?\n)m=(?:audio|video)\b/i.test(sdp) ||
    /a=rtpmap:/i.test(sdp) ||
    /getUserMedia/i.test(sdp)
  ) {
    return { valid: false, reasonCode: "media_track_forbidden" };
  }
  if (!/(?:^|\r?\n)v=0(?:\r?\n|$)/.test(sdp)) {
    return { valid: false, reasonCode: "invalid_sdp_schema" };
  }
  if (
    !/(?:^|\r?\n)a=fingerprint:sha-256\s+[0-9A-F:]{95}(?:\r?\n|$)/i.test(sdp)
  ) {
    return { valid: false, reasonCode: "dtls_fingerprint_required" };
  }
  if (
    !/(?:^|\r?\n)m=application\s+\d+\s+UDP\/DTLS\/SCTP\s+webrtc-datachannel(?:\r?\n|$)/i.test(
      sdp,
    )
  ) {
    return { valid: false, reasonCode: "sctp_datachannel_required" };
  }
  return { valid: true, reasonCode: null };
}

function validateIceCandidateLine(candidate: string): {
  valid: boolean;
  reasonCode: string | null;
} {
  if (
    typeof candidate !== "string" ||
    candidate.trim().length === 0 ||
    Buffer.byteLength(candidate, "utf8") > MAX_ICE_CANDIDATE_BYTES
  ) {
    return { valid: false, reasonCode: "ice_candidate_invalid_or_oversized" };
  }
  if (
    /[\r\n<>]/.test(candidate) ||
    /data:(?:image|video|audio)\//i.test(candidate)
  ) {
    return { valid: false, reasonCode: "ice_candidate_injection_rejected" };
  }
  if (
    !/^candidate:[A-Za-z0-9+/=._-]+\s+\d+\s+(?:udp|tcp)\s+\d+\s+[A-Za-z0-9:._-]+\s+\d+\s+typ\s+(?:host|srflx|prflx|relay)\b/i.test(
      candidate,
    )
  ) {
    return { valid: false, reasonCode: "invalid_ice_candidate_schema" };
  }
  return { valid: true, reasonCode: null };
}

/**
 * Authenticated WebRTC DataChannel signaling, structured-data TURN issuer, and
 * explicit cloud-relay fallback adapter (FR-RS-003, INT-RS-003, SEC-RS-001,
 * SEC-RS-002, SEC-RS-007, SEC-RS-008, AC-RS-003, AC-RS-004, AC-RS-020).
 */
export class SignalingService {
  private readonly states = new Map<string, SessionSignalingState>();
  private readonly rateBuckets = new Map<string, RateBucket>();
  private readonly logs: RedactedSignalingLogEntry[] = [];

  constructor(private readonly credentialVerifier: SessionCredentialVerifier) {}

  private logRedacted(
    event: string,
    sessionId: string,
    deviceId: string,
    atMs: number,
    reasonCode: string | null = null,
  ): void {
    this.logs.push({
      event,
      session_id: sessionId,
      device_id: deviceId,
      at_ms: atMs,
      sdp: "[REDACTED_SDP]",
      ice_candidate: "[REDACTED_ICE]",
      access_token: "[REDACTED_TOKEN]",
      turn_credential: "[REDACTED_TURN]",
      reason_code: reasonCode,
    });
  }

  getRedactedLogs(): RedactedSignalingLogEntry[] {
    return structuredClone(this.logs);
  }

  private checkRateLimit(
    sessionId: string,
    deviceId: string,
    nowMs: number,
  ): boolean {
    const key = `${sessionId}:${deviceId}`;
    const existing = this.rateBuckets.get(key);
    if (
      !existing ||
      nowMs < existing.windowStartMs ||
      nowMs - existing.windowStartMs >= SIGNALING_RATE_WINDOW_MS
    ) {
      this.rateBuckets.set(key, { windowStartMs: nowMs, count: 1 });
      return true;
    }
    existing.count += 1;
    return existing.count <= MAX_SIGNALING_REQUESTS_PER_WINDOW;
  }

  private ensureState(sessionId: string): SessionSignalingState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        offerSubmitted: false,
        answerSubmitted: false,
        connected: false,
        transport: "webrtc",
        cloudRelayLabeled: false,
        iceCandidateCount: 0,
        turnCredentials: new Map(),
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  revokeSessionSignaling(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (state) {
      state.turnCredentials.clear();
      state.connected = false;
      state.offerSubmitted = false;
      state.answerSubmitted = false;
    }
    this.states.delete(sessionId);
  }

  submitOffer(input: WebRtcSdpRequest): SignalingResult {
    const nowMs = input.now_ms ?? 0;
    if (!this.checkRateLimit(input.session_id, input.device_id, nowMs)) {
      this.logRedacted(
        "webrtc.offer_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "rate_limit_exceeded",
      );
      return {
        disposition: "rejected",
        reason_code: "rate_limit_exceeded",
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const auth = this.credentialVerifier.verifyDeviceAccess({
      session_id: input.session_id,
      device_id: input.device_id,
      access_token: input.access_token,
      now_ms: nowMs,
    });
    if (!auth.valid) {
      this.logRedacted(
        "webrtc.offer_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        auth.reason_code,
      );
      return {
        disposition: "rejected",
        reason_code: auth.reason_code,
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    if (!validateDataChannels(input.data_channels)) {
      this.logRedacted(
        "webrtc.offer_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "invalid_datachannel_contract",
      );
      return {
        disposition: "rejected",
        reason_code: "invalid_datachannel_contract",
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const sdpCheck = validateDataChannelOnlySdp(input.sdp);
    if (!sdpCheck.valid) {
      this.logRedacted(
        "webrtc.offer_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        sdpCheck.reasonCode,
      );
      return {
        disposition: "rejected",
        reason_code: sdpCheck.reasonCode,
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const state = this.ensureState(input.session_id);
    state.offerSubmitted = true;
    this.logRedacted(
      "webrtc.offer_accepted",
      input.session_id,
      input.device_id,
      nowMs,
    );
    return {
      disposition: "accepted",
      reason_code: null,
      transport: state.transport,
      media_tracks_present: false,
      dtls_encrypted: true,
    };
  }

  submitAnswer(input: WebRtcSdpRequest): SignalingResult {
    const nowMs = input.now_ms ?? 0;
    if (!this.checkRateLimit(input.session_id, input.device_id, nowMs)) {
      this.logRedacted(
        "webrtc.answer_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "rate_limit_exceeded",
      );
      return {
        disposition: "rejected",
        reason_code: "rate_limit_exceeded",
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const auth = this.credentialVerifier.verifyDeviceAccess({
      session_id: input.session_id,
      device_id: input.device_id,
      access_token: input.access_token,
      now_ms: nowMs,
    });
    if (!auth.valid) {
      this.logRedacted(
        "webrtc.answer_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        auth.reason_code,
      );
      return {
        disposition: "rejected",
        reason_code: auth.reason_code,
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const state = this.states.get(input.session_id);
    if (!state || !state.offerSubmitted) {
      return {
        disposition: "rejected",
        reason_code: "offer_required_before_answer",
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    if (!validateDataChannels(input.data_channels)) {
      return {
        disposition: "rejected",
        reason_code: "invalid_datachannel_contract",
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const sdpCheck = validateDataChannelOnlySdp(input.sdp);
    if (!sdpCheck.valid) {
      this.logRedacted(
        "webrtc.answer_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        sdpCheck.reasonCode,
      );
      return {
        disposition: "rejected",
        reason_code: sdpCheck.reasonCode,
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    state.answerSubmitted = true;
    state.connected = true;
    this.logRedacted(
      "webrtc.answer_accepted",
      input.session_id,
      input.device_id,
      nowMs,
    );
    return {
      disposition: "accepted",
      reason_code: null,
      transport: state.transport,
      media_tracks_present: false,
      dtls_encrypted: true,
    };
  }

  submitIceCandidate(input: WebRtcIceRequest): SignalingResult {
    const nowMs = input.now_ms ?? 0;
    if (!this.checkRateLimit(input.session_id, input.device_id, nowMs)) {
      this.logRedacted(
        "webrtc.ice_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "rate_limit_exceeded",
      );
      return {
        disposition: "rejected",
        reason_code: "rate_limit_exceeded",
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const auth = this.credentialVerifier.verifyDeviceAccess({
      session_id: input.session_id,
      device_id: input.device_id,
      access_token: input.access_token,
      now_ms: nowMs,
    });
    if (!auth.valid) {
      this.logRedacted(
        "webrtc.ice_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        auth.reason_code,
      );
      return {
        disposition: "rejected",
        reason_code: auth.reason_code,
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    if (
      typeof input.sdp_mid !== "string" ||
      !input.sdp_mid.trim() ||
      !Number.isSafeInteger(input.sdp_m_line_index) ||
      input.sdp_m_line_index !== 0
    ) {
      return {
        disposition: "rejected",
        reason_code: "invalid_ice_m_line",
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const iceCheck = validateIceCandidateLine(input.candidate);
    if (!iceCheck.valid) {
      this.logRedacted(
        "webrtc.ice_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        iceCheck.reasonCode,
      );
      return {
        disposition: "rejected",
        reason_code: iceCheck.reasonCode,
        transport: "webrtc",
        media_tracks_present: false,
        dtls_encrypted: false,
      };
    }

    const state = this.ensureState(input.session_id);
    state.iceCandidateCount += 1;
    this.logRedacted(
      "webrtc.ice_accepted",
      input.session_id,
      input.device_id,
      nowMs,
    );
    return {
      disposition: "accepted",
      reason_code: null,
      transport: state.transport,
      media_tracks_present: false,
      dtls_encrypted: state.connected,
    };
  }

  issueTurnCredentials(input: {
    session_id: string;
    device_id: string;
    access_token: string;
    now_ms?: number;
  }): TurnCredentialResult {
    const nowMs = input.now_ms ?? 0;
    const auth = this.credentialVerifier.verifyDeviceAccess({
      session_id: input.session_id,
      device_id: input.device_id,
      access_token: input.access_token,
      now_ms: nowMs,
    });
    if (!auth.valid) {
      this.logRedacted(
        "turn.rejected",
        input.session_id,
        input.device_id,
        nowMs,
        auth.reason_code,
      );
      return {
        disposition: "rejected",
        reason_code: auth.reason_code,
        turn: null,
      };
    }

    const state = this.ensureState(input.session_id);
    const record: TurnCredentialRecord = {
      session_id: input.session_id,
      device_id: input.device_id,
      username: `${Math.floor((nowMs + TURN_CREDENTIAL_TTL_MS) / 1000)}:${input.session_id}:${input.device_id}`,
      credential: randomBytes(18).toString("base64url"),
      uris: ["turns:turn.roomsmith.local:5349?transport=tcp"],
      issued_at_ms: nowMs,
      expires_at_ms: nowMs + TURN_CREDENTIAL_TTL_MS,
      structured_data_only: true,
      media_relay_allowed: false,
    };
    state.turnCredentials.set(input.device_id, record);
    this.logRedacted("turn.issued", input.session_id, input.device_id, nowMs);
    return {
      disposition: "issued",
      reason_code: null,
      turn: structuredClone(record),
    };
  }

  activateCloudRelayFallback(input: {
    session_id: string;
    device_id: string;
    access_token: string;
    failure_reason:
      | "ice_failed"
      | "dtls_handshake_timeout"
      | "nat_traversal_blocked";
    now_ms?: number;
  }): CloudRelayFallbackResult {
    const nowMs = input.now_ms ?? 0;
    const auth = this.credentialVerifier.verifyDeviceAccess({
      session_id: input.session_id,
      device_id: input.device_id,
      access_token: input.access_token,
      now_ms: nowMs,
    });
    if (!auth.valid) {
      this.logRedacted(
        "relay.fallback_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        auth.reason_code,
      );
      return {
        disposition: "rejected",
        reason_code: auth.reason_code,
        transport: "webrtc",
        cloud_relay_labeled: false,
        user_banner: null,
      };
    }

    const state = this.ensureState(input.session_id);
    state.transport = "cloud_relay";
    state.cloudRelayLabeled = true;
    state.connected = true;

    this.logRedacted(
      "relay.fallback_activated",
      input.session_id,
      input.device_id,
      nowMs,
      input.failure_reason,
    );
    return {
      disposition: "activated",
      reason_code: null,
      transport: "cloud_relay",
      cloud_relay_labeled: true,
      user_banner:
        "Cloud Relay Fallback Active — Structured observations only; no video or audio leaves the phone.",
    };
  }

  relayStructuredMessage(input: {
    session_id: string;
    device_id: string;
    access_token: string;
    raw_envelope: string;
    ingress: ObservationIngress;
    now_ms?: number;
  }): CloudRelayForwardResult {
    const nowMs = input.now_ms ?? 0;
    const auth = this.credentialVerifier.verifyDeviceAccess({
      session_id: input.session_id,
      device_id: input.device_id,
      access_token: input.access_token,
      now_ms: nowMs,
    });
    if (!auth.valid) {
      this.logRedacted(
        "relay.message_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        auth.reason_code,
      );
      return {
        disposition: "rejected",
        reason_code: auth.reason_code,
        transport: "cloud_relay",
        cloud_relay_labeled: true,
        ingress_result: null,
      };
    }

    const state = this.states.get(input.session_id);
    if (
      !state ||
      state.transport !== "cloud_relay" ||
      !state.cloudRelayLabeled
    ) {
      return {
        disposition: "rejected",
        reason_code: "cloud_relay_not_active",
        transport: "cloud_relay",
        cloud_relay_labeled: true,
        ingress_result: null,
      };
    }

    const ingressResult = input.ingress.accept(input.raw_envelope);
    if (ingressResult.disposition === "rejected") {
      this.logRedacted(
        "relay.message_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        ingressResult.reason_code,
      );
      return {
        disposition: "rejected",
        reason_code: ingressResult.reason_code,
        transport: "cloud_relay",
        cloud_relay_labeled: true,
        ingress_result: ingressResult,
      };
    }

    this.logRedacted(
      "relay.message_forwarded",
      input.session_id,
      input.device_id,
      nowMs,
    );
    return {
      disposition: "relayed",
      reason_code: null,
      transport: "cloud_relay",
      cloud_relay_labeled: true,
      ingress_result: ingressResult,
    };
  }
}
