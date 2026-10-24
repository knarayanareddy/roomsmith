import { createHash } from "node:crypto";

export const MAX_OBSERVATION_MESSAGE_BYTES = 8192;

export type CompanionMessageType =
  | "calibration.state"
  | "observation.candidate"
  | "observation.stable"
  | "observation.invalid";

export interface EngineObservation {
  puzzle_id: string;
  session_id: string;
  calibration_version: string;
  object_kit_version: string;
  subject: string;
  predicate: string;
  target: string | null;
  confidence: number;
  normalized_margin: number | null;
  overlap: number | null;
  observed_at_ms: number;
  sequence: number;
  calibration_valid: boolean;
  needs_review: boolean;
  occluded: boolean;
  candidate_present: boolean;
  observation_id: string;
}

export interface IngressSecurityEvent {
  code: string;
  session_id: string;
  device_id: string;
  message_type: string;
  raw_payload_included: false;
}

export interface IngressResult {
  disposition:
    | "accepted_calibration"
    | "accepted_candidate"
    | "accepted_stable_proposal"
    | "invalid_observation"
    | "duplicate"
    | "stale"
    | "rejected";
  reason_code: string | null;
  observation: EngineObservation | null;
  candidate_verification_cancelled: boolean;
  fallback_available: boolean;
  hold_verification_required: boolean;
  puzzle_commit: false;
  raw_media_accepted: false;
  security_event: IngressSecurityEvent | null;
}

export interface ObservationIngressContext {
  sessionId: string;
  puzzleId: string;
  calibrationVersion: string;
  objectKitVersion: string;
  authorizedDeviceIds: string[];
}

interface Envelope {
  schema_version: number;
  message_id: string;
  session_id: string;
  device_id: string;
  sequence: number;
  sent_at: string;
  type: string;
  payload: Record<string, unknown>;
}

interface SeenMessage {
  fingerprint: string;
  result: IngressResult;
}

const companionTypes = new Set<CompanionMessageType>([
  "calibration.state",
  "observation.candidate",
  "observation.stable",
  "observation.invalid",
]);
const forbiddenMediaKeys = new Set([
  "audio",
  "audiobuffer",
  "base64",
  "blob",
  "dataurl",
  "frame",
  "frames",
  "framebuffer",
  "handlandmarks",
  "image",
  "imagedata",
  "images",
  "landmarkbuffer",
  "landmarks",
  "media",
  "rawframe",
  "rawmedia",
  "rtp",
  "sdp",
  "video",
  "videotrack",
]);
const subjects = new Set([
  "cup",
  "book",
  "bottle",
  "spoon",
  "red_cup",
  "blue_cup",
  "hand",
]);
const predicates = new Set([
  "left_of",
  "right_of",
  "inside_zone",
  "present",
  "open_palm",
]);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 160
  );
}

function boolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function containsMedia(value: unknown): boolean {
  if (typeof value === "string")
    return /^data:(?:image|video|audio)\//i.test(value);
  if (Array.isArray(value)) return value.some((item) => containsMedia(item));
  if (!object(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    return forbiddenMediaKeys.has(normalizedKey) || containsMedia(item);
  });
}

/** Fixture ingress for structured companion proposals. It never calls the puzzle engine itself. */
export class ObservationIngress {
  private readonly authorizedDevices: Set<string>;
  private readonly revokedDevices = new Set<string>();
  private readonly lastSequences = new Map<string, number>();
  private readonly seenMessages = new Map<string, SeenMessage>();
  private calibrationHealthy = true;
  private candidateVerificationCancelled = false;
  private fallbackAvailable = false;

  constructor(private readonly context: ObservationIngressContext) {
    if (
      !text(context.sessionId) ||
      !text(context.puzzleId) ||
      !text(context.calibrationVersion) ||
      !text(context.objectKitVersion) ||
      context.authorizedDeviceIds.length === 0 ||
      context.authorizedDeviceIds.some((device) => !text(device))
    ) {
      throw new Error("invalid_observation_ingress_context");
    }
    this.authorizedDevices = new Set(context.authorizedDeviceIds);
  }

  revokeDevice(deviceId: string): void {
    this.revokedDevices.add(deviceId);
  }

  private result(
    disposition: IngressResult["disposition"],
    reasonCode: string | null,
    observation: EngineObservation | null = null,
    securityEvent: IngressSecurityEvent | null = null,
    holdVerificationRequired = false,
  ): IngressResult {
    return {
      disposition,
      reason_code: reasonCode,
      observation: observation ? structuredClone(observation) : null,
      candidate_verification_cancelled: this.candidateVerificationCancelled,
      fallback_available: this.fallbackAvailable,
      hold_verification_required: holdVerificationRequired,
      puzzle_commit: false,
      raw_media_accepted: false,
      security_event: securityEvent ? structuredClone(securityEvent) : null,
    };
  }

  private security(envelope: Envelope, code: string): IngressSecurityEvent {
    return {
      code,
      session_id: envelope.session_id,
      device_id: envelope.device_id,
      message_type: envelope.type,
      raw_payload_included: false,
    };
  }

  private reject(
    envelope: Envelope,
    code: string,
    withSecurityEvent = false,
  ): IngressResult {
    return this.result(
      "rejected",
      code,
      null,
      withSecurityEvent ? this.security(envelope, code) : null,
    );
  }

  accept(raw: string | Uint8Array): IngressResult {
    const bytes =
      typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
    if (bytes > MAX_OBSERVATION_MESSAGE_BYTES) {
      return this.result("rejected", "message_too_large");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"),
      );
    } catch {
      return this.result("rejected", "malformed_json");
    }
    if (!object(decoded))
      return this.result("rejected", "envelope_object_required");
    const envelope = decoded as Partial<Envelope>;
    if (
      envelope.schema_version !== 1 ||
      !text(envelope.message_id) ||
      !text(envelope.session_id) ||
      !text(envelope.device_id) ||
      !sequence(envelope.sequence) ||
      typeof envelope.sent_at !== "string" ||
      !Number.isFinite(Date.parse(envelope.sent_at)) ||
      !text(envelope.type) ||
      !object(envelope.payload)
    ) {
      return this.result("rejected", "invalid_message_envelope");
    }
    const validEnvelope = envelope as Envelope;
    if (containsMedia(validEnvelope.payload)) {
      return this.reject(validEnvelope, "media_payload_forbidden", true);
    }
    if (validEnvelope.type === "puzzle.complete") {
      return this.reject(validEnvelope, "companion_commit_rejected", true);
    }
    if (!companionTypes.has(validEnvelope.type as CompanionMessageType)) {
      return this.reject(
        validEnvelope,
        "companion_message_type_forbidden",
        true,
      );
    }
    if (validEnvelope.session_id !== this.context.sessionId) {
      return this.reject(validEnvelope, "session_binding_failed", true);
    }
    if (
      !this.authorizedDevices.has(validEnvelope.device_id) ||
      this.revokedDevices.has(validEnvelope.device_id)
    ) {
      return this.reject(validEnvelope, "device_not_authorized", true);
    }
    const messageFingerprint = fingerprint(validEnvelope);
    const seen = this.seenMessages.get(validEnvelope.message_id);
    if (seen) {
      if (seen.fingerprint !== messageFingerprint) {
        return this.reject(validEnvelope, "message_replay_conflict", true);
      }
      return { ...structuredClone(seen.result), disposition: "duplicate" };
    }
    const previousSequence = this.lastSequences.get(validEnvelope.device_id);
    if (
      previousSequence !== undefined &&
      validEnvelope.sequence <= previousSequence
    ) {
      return this.result("stale", "stale_device_sequence");
    }
    this.lastSequences.set(validEnvelope.device_id, validEnvelope.sequence);

    let result: IngressResult;
    if (validEnvelope.type === "calibration.state") {
      result = this.calibration(validEnvelope);
    } else if (validEnvelope.type === "observation.invalid") {
      if (!this.versionedPayload(validEnvelope)) {
        result = this.reject(validEnvelope, "observation_binding_failed", true);
      } else {
        this.candidateVerificationCancelled = true;
        this.fallbackAvailable = true;
        if (validEnvelope.payload.calibration_valid === false)
          this.calibrationHealthy = false;
        result = this.result(
          "invalid_observation",
          "companion_invalidated_observation",
        );
      }
    } else {
      result = this.observation(validEnvelope);
    }
    this.seenMessages.set(validEnvelope.message_id, {
      fingerprint: messageFingerprint,
      result: structuredClone(result),
    });
    return result;
  }

  private versionedPayload(envelope: Envelope): boolean {
    return (
      envelope.payload.puzzle_id === this.context.puzzleId &&
      envelope.payload.calibration_version ===
        this.context.calibrationVersion &&
      envelope.payload.object_kit_version === this.context.objectKitVersion
    );
  }

  private calibration(envelope: Envelope): IngressResult {
    if (
      !this.versionedPayload(envelope) ||
      !boolean(envelope.payload.calibration_valid) ||
      !boolean(envelope.payload.needs_review) ||
      !boolean(envelope.payload.occluded) ||
      !Array.isArray(envelope.payload.reason_codes) ||
      envelope.payload.reason_codes.some((code) => !text(code))
    ) {
      this.candidateVerificationCancelled = true;
      this.fallbackAvailable = true;
      return this.result("invalid_observation", "invalid_calibration_state");
    }
    this.calibrationHealthy =
      envelope.payload.calibration_valid &&
      !envelope.payload.needs_review &&
      !envelope.payload.occluded;
    this.candidateVerificationCancelled = !this.calibrationHealthy;
    this.fallbackAvailable = !this.calibrationHealthy;
    return this.calibrationHealthy
      ? this.result("accepted_calibration", null)
      : this.result("invalid_observation", "calibration_not_valid");
  }

  private observation(envelope: Envelope): IngressResult {
    const payload = envelope.payload;
    if (
      !this.versionedPayload(envelope) ||
      !text(payload.observation_id) ||
      !text(payload.subject) ||
      !subjects.has(payload.subject) ||
      !text(payload.predicate) ||
      !predicates.has(payload.predicate) ||
      !(payload.target === null || text(payload.target)) ||
      !number(payload.confidence) ||
      payload.confidence < 0 ||
      payload.confidence > 1 ||
      !(
        payload.normalized_margin === null || number(payload.normalized_margin)
      ) ||
      !(
        payload.overlap === null ||
        (number(payload.overlap) &&
          payload.overlap >= 0 &&
          payload.overlap <= 1)
      ) ||
      !number(payload.observed_at_ms) ||
      payload.observed_at_ms < 0 ||
      !sequence(payload.sequence) ||
      payload.sequence !== envelope.sequence ||
      !boolean(payload.calibration_valid) ||
      !boolean(payload.needs_review) ||
      !boolean(payload.occluded) ||
      !boolean(payload.candidate_present)
    ) {
      this.candidateVerificationCancelled = true;
      this.fallbackAvailable = true;
      return this.result(
        "invalid_observation",
        "invalid_structured_observation",
      );
    }
    const observation: EngineObservation = {
      puzzle_id: this.context.puzzleId,
      session_id: this.context.sessionId,
      calibration_version: this.context.calibrationVersion,
      object_kit_version: this.context.objectKitVersion,
      subject: payload.subject,
      predicate: payload.predicate,
      target: payload.target as string | null,
      confidence: payload.confidence,
      normalized_margin: payload.normalized_margin as number | null,
      overlap: payload.overlap as number | null,
      observed_at_ms: payload.observed_at_ms,
      sequence: payload.sequence,
      calibration_valid: payload.calibration_valid,
      needs_review: payload.needs_review,
      occluded: payload.occluded,
      candidate_present: payload.candidate_present,
      observation_id: payload.observation_id,
    };
    const invalid =
      !this.calibrationHealthy ||
      !observation.calibration_valid ||
      observation.needs_review ||
      observation.occluded ||
      (envelope.type === "observation.stable" &&
        !observation.candidate_present);
    if (invalid) {
      this.candidateVerificationCancelled = true;
      this.fallbackAvailable = true;
      if (!observation.calibration_valid) this.calibrationHealthy = false;
      return this.result(
        "invalid_observation",
        "observation_not_eligible",
        observation,
      );
    }
    this.candidateVerificationCancelled = false;
    return envelope.type === "observation.stable"
      ? this.result("accepted_stable_proposal", null, observation, null, true)
      : this.result("accepted_candidate", null, observation);
  }
}

export * from "./sqlite-session-store.js";
