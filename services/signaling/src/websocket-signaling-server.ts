import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import type { ObservationIngress } from "../../../packages/session-contracts/src/index.js";
import type { PairingService } from "../../pairing/src/pairing-service.js";
import {
  MAX_SDP_BYTES,
  SignalingService,
  type DataChannelContractSpec,
} from "./signaling-service.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_WS_FRAME_BYTES = 16_384;

export type SignalingPeerRole = "tv" | "companion";

export interface WebSocketSignalingEnvelope {
  schema_version: 1;
  message_id: string;
  session_id: string;
  device_id: string;
  sequence: number;
  sent_at: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface SignalingPeerConnection {
  send(message: Record<string, unknown>): void;
  close(code?: number, reason?: string): void;
}

interface BoundPeerState {
  peerId: string;
  sessionId: string;
  deviceId: string;
  role: SignalingPeerConnectionRole;
  accessToken: string | null;
  connection: SignalingPeerConnection;
}

type SignalingPeerConnectionRole = SignalingPeerRole;

const DEFAULT_DATA_CHANNELS: DataChannelContractSpec[] = [
  { label: "observations", ordered: false, maxRetransmits: 0 },
  { label: "control", ordered: true, maxRetransmits: null },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.byteLength;
  if (len < 126) {
    const header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(len, 2);
  return Buffer.concat([header, payload]);
}

function encodeWsCloseFrame(code = 1000, reason = "normal"): Buffer {
  const reasonBytes = Buffer.from(reason.slice(0, 64), "utf8");
  const payload = Buffer.alloc(2 + reasonBytes.byteLength);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  const header = Buffer.alloc(2);
  header[0] = 0x88; // FIN + close
  header[1] = payload.byteLength;
  return Buffer.concat([header, payload]);
}

function encodeWsPongFrame(payload: Buffer): Buffer {
  const clipped = payload.subarray(0, 125);
  const header = Buffer.alloc(2);
  header[0] = 0x8a; // FIN + pong
  header[1] = clipped.byteLength;
  return Buffer.concat([header, clipped]);
}

interface ParsedWsFrame {
  opcode: number;
  payload: Buffer;
  bytesConsumed: number;
}

function tryParseWsFrame(buffer: Buffer): ParsedWsFrame | null {
  if (buffer.byteLength < 2) return null;
  const firstByte = buffer[0]!;
  const secondByte = buffer[1]!;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.byteLength < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.byteLength < 10) return null;
    const bigLen = buffer.readBigUInt64BE(2);
    if (bigLen > BigInt(MAX_WS_FRAME_BYTES)) {
      throw new Error("ws_frame_too_large");
    }
    payloadLen = Number(bigLen);
    offset = 10;
  }

  if (payloadLen > MAX_WS_FRAME_BYTES) {
    throw new Error("ws_frame_too_large");
  }

  const maskBytes = masked ? 4 : 0;
  if (buffer.byteLength < offset + maskBytes + payloadLen) {
    return null;
  }

  const maskKey = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskBytes;
  const rawPayload = Buffer.from(buffer.subarray(offset, offset + payloadLen));
  if (maskKey) {
    for (let i = 0; i < rawPayload.byteLength; i += 1) {
      rawPayload[i] = rawPayload[i]! ^ maskKey[i % 4]!;
    }
  }

  return {
    opcode,
    payload: rawPayload,
    bytesConsumed: offset + payloadLen,
  };
}

/**
 * Full WebSocket-based WebRTC DataChannel signaling and explicit cloud-relay
 * fallback server for pairing the Android companion camera with the Fire TV app
 * (FR-RS-003, INT-RS-003, SEC-RS-001, SEC-RS-002, SEC-RS-007, SEC-RS-008, AC-RS-003, AC-RS-004, AC-RS-020).
 */
export class WebSocketSignalingServer {
  private readonly signalingService: SignalingService;
  private readonly peersById = new Map<string, BoundPeerState>();
  private readonly sessionPeers = new Map<
    string,
    { tv?: BoundPeerState; companion?: BoundPeerState }
  >();
  private readonly sessionIngresses = new Map<string, ObservationIngress>();
  private httpServer: Server | null = null;
  private readonly openSockets = new Set<Socket>();
  private peerCounter = 0;
  private serverSequence = 0;

  constructor(
    private readonly pairingService: PairingService,
    signalingService?: SignalingService,
    private readonly clock: () => number = Date.now,
  ) {
    this.signalingService =
      signalingService ?? new SignalingService(pairingService);
    this.pairingService.onSessionRevoked((sessionId) => {
      this.revokeSession(sessionId, this.clock());
    });
  }

  getSignalingService(): SignalingService {
    return this.signalingService;
  }

  registerObservationIngress(
    sessionId: string,
    ingress: ObservationIngress,
  ): void {
    this.sessionIngresses.set(sessionId, ingress);
  }

  private nextServerSequence(): number {
    this.serverSequence += 1;
    return this.serverSequence;
  }

  private sendError(
    connection: SignalingPeerConnection,
    sessionId: string,
    deviceId: string,
    reasonCode: string,
    nowMs = this.clock(),
  ): void {
    connection.send({
      schema_version: 1,
      message_id: `err-${this.nextServerSequence()}`,
      session_id: sessionId || "unauthenticated",
      device_id: deviceId || "server",
      sequence: this.serverSequence,
      sent_at: new Date(nowMs).toISOString(),
      type: "session.error",
      payload: {
        reason_code: reasonCode,
        recoverable: reasonCode !== "companion_revoked",
      },
    });
  }

  /**
   * Registers a virtual or real WebSocket peer connection and returns its peer ID.
   */
  connectPeer(connection: SignalingPeerConnection): string {
    this.peerCounter += 1;
    const peerId = `peer-${this.peerCounter}`;
    this.peersById.set(peerId, {
      peerId,
      sessionId: "",
      deviceId: "",
      role: "companion",
      accessToken: null,
      connection,
    });
    return peerId;
  }

  disconnectPeer(peerId: string): void {
    const peer = this.peersById.get(peerId);
    if (!peer) return;
    this.peersById.delete(peerId);
    if (peer.sessionId) {
      const group = this.sessionPeers.get(peer.sessionId);
      if (group) {
        if (group.tv?.peerId === peerId) delete group.tv;
        if (group.companion?.peerId === peerId) delete group.companion;
      }
    }
  }

  revokeSession(sessionId: string, nowMs = this.clock()): void {
    this.signalingService.revokeSessionSignaling(sessionId);
    const group = this.sessionPeers.get(sessionId);
    if (!group) return;

    const revokeMsg = {
      schema_version: 1,
      message_id: `revoke-${sessionId}-${this.nextServerSequence()}`,
      session_id: sessionId,
      device_id: "tv-authority",
      sequence: this.serverSequence,
      sent_at: new Date(nowMs).toISOString(),
      type: "session.revoke",
      payload: {
        reason: "adult_or_tv_revoked",
      },
    };

    if (group.companion) {
      const compId = group.companion.deviceId;
      const ingress = this.sessionIngresses.get(sessionId);
      if (ingress && compId) {
        ingress.revokeDevice(compId);
      }
      group.companion.connection.send(revokeMsg);
      group.companion.connection.close(4003, "companion_revoked");
      this.peersById.delete(group.companion.peerId);
      delete group.companion;
    }
    if (group.tv) {
      group.tv.connection.send(revokeMsg);
    }
  }

  /**
   * Processes a raw WebSocket text message from a connected peer (`tv` or `companion`).
   */
  handlePeerMessage(
    peerId: string,
    rawMessage: string,
    nowMs = this.clock(),
  ): void {
    const peer = this.peersById.get(peerId);
    if (!peer) return;

    if (Buffer.byteLength(rawMessage, "utf8") > MAX_WS_FRAME_BYTES) {
      this.sendError(
        peer.connection,
        peer.sessionId,
        peer.deviceId,
        "message_too_large",
        nowMs,
      );
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawMessage);
    } catch {
      this.sendError(
        peer.connection,
        peer.sessionId,
        peer.deviceId,
        "malformed_json",
        nowMs,
      );
      return;
    }

    if (
      !isRecord(decoded) ||
      decoded.schema_version !== 1 ||
      typeof decoded.message_id !== "string" ||
      typeof decoded.session_id !== "string" ||
      typeof decoded.device_id !== "string" ||
      typeof decoded.sequence !== "number" ||
      typeof decoded.sent_at !== "string" ||
      typeof decoded.type !== "string" ||
      !isRecord(decoded.payload)
    ) {
      this.sendError(
        peer.connection,
        peer.sessionId,
        peer.deviceId,
        "invalid_message_envelope",
        nowMs,
      );
      return;
    }

    const envelope = decoded as unknown as WebSocketSignalingEnvelope;
    const payload = envelope.payload;

    // 1. Companion never allowed to send puzzle.complete (AC-RS-016, SEC-RS-003)
    if (envelope.type === "puzzle.complete" && peer.role === "companion") {
      this.sendError(
        peer.connection,
        envelope.session_id,
        envelope.device_id,
        "companion_commit_rejected",
        nowMs,
      );
      return;
    }

    // 2. Authenticate or pair on `session.hello`
    if (envelope.type === "session.hello") {
      const requestedRole =
        payload.role === "tv" ? "tv" : ("companion" as SignalingPeerRole);

      if (requestedRole === "tv") {
        try {
          this.pairingService.getSession(envelope.session_id, nowMs);
        } catch {
          this.sendError(
            peer.connection,
            envelope.session_id,
            envelope.device_id,
            "session_not_found",
            nowMs,
          );
          return;
        }
        peer.sessionId = envelope.session_id;
        peer.deviceId = envelope.device_id;
        peer.role = "tv";
        const group = this.sessionPeers.get(envelope.session_id) ?? {};
        group.tv = peer;
        this.sessionPeers.set(envelope.session_id, group);

        peer.connection.send({
          schema_version: 1,
          message_id: `ack-${envelope.message_id}`,
          session_id: envelope.session_id,
          device_id: "signaling-server",
          sequence: this.nextServerSequence(),
          sent_at: new Date(nowMs).toISOString(),
          type: "session.hello.ack",
          payload: {
            role: "tv",
            authenticated: true,
            transport: "webrtc",
          },
        });
        return;
      }

      // Companion authentication: either existing access_token or one-time pairing_code + pairing_nonce
      let accessToken =
        typeof payload.access_token === "string" ? payload.access_token : null;
      if (
        !accessToken &&
        typeof payload.pairing_code === "string" &&
        typeof payload.pairing_nonce === "string"
      ) {
        const exchange = this.pairingService.exchangePairing({
          session_id: envelope.session_id,
          pairing_code: payload.pairing_code,
          pairing_nonce: payload.pairing_nonce,
          device_id: envelope.device_id,
          now_ms: nowMs,
        });
        if (exchange.disposition !== "issued" || !exchange.credential) {
          this.sendError(
            peer.connection,
            envelope.session_id,
            envelope.device_id,
            exchange.reason_code ?? "pairing_exchange_failed",
            nowMs,
          );
          return;
        }
        accessToken = exchange.credential.access_token;
      }

      if (!accessToken) {
        this.sendError(
          peer.connection,
          envelope.session_id,
          envelope.device_id,
          "invalid_device_credential",
          nowMs,
        );
        return;
      }

      const accessCheck = this.pairingService.verifyDeviceAccess({
        session_id: envelope.session_id,
        device_id: envelope.device_id,
        access_token: accessToken,
        now_ms: nowMs,
      });
      if (!accessCheck.valid) {
        this.sendError(
          peer.connection,
          envelope.session_id,
          envelope.device_id,
          accessCheck.reason_code ?? "invalid_device_credential",
          nowMs,
        );
        return;
      }

      peer.sessionId = envelope.session_id;
      peer.deviceId = envelope.device_id;
      peer.role = "companion";
      peer.accessToken = accessToken;

      const group = this.sessionPeers.get(envelope.session_id) ?? {};
      group.companion = peer;
      this.sessionPeers.set(envelope.session_id, group);

      peer.connection.send({
        schema_version: 1,
        message_id: `ack-${envelope.message_id}`,
        session_id: envelope.session_id,
        device_id: "signaling-server",
        sequence: this.nextServerSequence(),
        sent_at: new Date(nowMs).toISOString(),
        type: "session.hello.ack",
        payload: {
          role: "companion",
          authenticated: true,
          access_token: accessToken,
          transport: "webrtc",
        },
      });
      return;
    }

    // Require prior authentication for all subsequent messages
    if (!peer.sessionId || peer.sessionId !== envelope.session_id) {
      this.sendError(
        peer.connection,
        envelope.session_id,
        envelope.device_id,
        "unauthenticated_peer",
        nowMs,
      );
      return;
    }

    const group = this.sessionPeers.get(peer.sessionId);
    const companionToken =
      peer.role === "companion"
        ? peer.accessToken
        : (group?.companion?.accessToken ??
          (typeof payload.access_token === "string"
            ? payload.access_token
            : null));
    const companionDeviceId =
      peer.role === "companion"
        ? peer.deviceId
        : (group?.companion?.deviceId ?? envelope.device_id);

    // 3. WebRTC Offer Exchange
    if (envelope.type === "webrtc.offer") {
      const sdp = typeof payload.sdp === "string" ? payload.sdp : "";
      if (Buffer.byteLength(sdp, "utf8") > MAX_SDP_BYTES) {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          "sdp_payload_invalid_or_oversized",
          nowMs,
        );
        return;
      }
      const channels = Array.isArray(payload.data_channels)
        ? (payload.data_channels as DataChannelContractSpec[])
        : DEFAULT_DATA_CHANNELS;

      const offerResult = this.signalingService.submitOffer({
        session_id: peer.sessionId,
        device_id: companionDeviceId,
        access_token: companionToken ?? "",
        sdp,
        data_channels: channels,
        now_ms: nowMs,
      });

      if (offerResult.disposition !== "accepted") {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          offerResult.reason_code ?? "offer_rejected",
          nowMs,
        );
        return;
      }

      const targetPeer =
        peer.role === "companion" ? group?.tv : group?.companion;
      targetPeer?.connection.send({
        schema_version: 1,
        message_id: envelope.message_id,
        session_id: peer.sessionId,
        device_id: peer.deviceId,
        sequence: envelope.sequence,
        sent_at: envelope.sent_at,
        type: "webrtc.offer",
        payload: {
          sdp,
          data_channels: channels,
          media_tracks_present: false,
          dtls_encrypted: true,
        },
      });
      return;
    }

    // 4. WebRTC Answer Exchange
    if (envelope.type === "webrtc.answer") {
      const sdp = typeof payload.sdp === "string" ? payload.sdp : "";
      const channels = Array.isArray(payload.data_channels)
        ? (payload.data_channels as DataChannelContractSpec[])
        : DEFAULT_DATA_CHANNELS;

      const answerResult = this.signalingService.submitAnswer({
        session_id: peer.sessionId,
        device_id: companionDeviceId,
        access_token: companionToken ?? "",
        sdp,
        data_channels: channels,
        now_ms: nowMs,
      });

      if (answerResult.disposition !== "accepted") {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          answerResult.reason_code ?? "answer_rejected",
          nowMs,
        );
        return;
      }

      const targetPeer =
        peer.role === "companion" ? group?.tv : group?.companion;
      targetPeer?.connection.send({
        schema_version: 1,
        message_id: envelope.message_id,
        session_id: peer.sessionId,
        device_id: peer.deviceId,
        sequence: envelope.sequence,
        sent_at: envelope.sent_at,
        type: "webrtc.answer",
        payload: {
          sdp,
          data_channels: channels,
          media_tracks_present: false,
          dtls_encrypted: true,
        },
      });
      return;
    }

    // 5. WebRTC ICE Candidate Exchange
    if (envelope.type === "webrtc.ice") {
      const candidate =
        typeof payload.candidate === "string" ? payload.candidate : "";
      const sdpMid =
        typeof payload.sdp_mid === "string" ? payload.sdp_mid : "0";
      const sdpMLineIndex =
        typeof payload.sdp_m_line_index === "number"
          ? payload.sdp_m_line_index
          : 0;

      const iceResult = this.signalingService.submitIceCandidate({
        session_id: peer.sessionId,
        device_id: companionDeviceId,
        access_token: companionToken ?? "",
        candidate,
        sdp_mid: sdpMid,
        sdp_m_line_index: sdpMLineIndex,
        now_ms: nowMs,
      });

      if (iceResult.disposition !== "accepted") {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          iceResult.reason_code ?? "ice_rejected",
          nowMs,
        );
        return;
      }

      const targetPeer =
        peer.role === "companion" ? group?.tv : group?.companion;
      targetPeer?.connection.send({
        schema_version: 1,
        message_id: envelope.message_id,
        session_id: peer.sessionId,
        device_id: peer.deviceId,
        sequence: envelope.sequence,
        sent_at: envelope.sent_at,
        type: "webrtc.ice",
        payload: {
          candidate,
          sdp_mid: sdpMid,
          sdp_m_line_index: sdpMLineIndex,
        },
      });
      return;
    }

    // 6. TURN Credentials Request
    if (envelope.type === "turn.request") {
      const turnResult = this.signalingService.issueTurnCredentials({
        session_id: peer.sessionId,
        device_id: companionDeviceId,
        access_token: companionToken ?? "",
        now_ms: nowMs,
      });
      if (turnResult.disposition !== "issued" || !turnResult.turn) {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          turnResult.reason_code ?? "turn_rejected",
          nowMs,
        );
        return;
      }
      peer.connection.send({
        schema_version: 1,
        message_id: `turn-${envelope.message_id}`,
        session_id: peer.sessionId,
        device_id: "signaling-server",
        sequence: this.nextServerSequence(),
        sent_at: new Date(nowMs).toISOString(),
        type: "turn.credentials",
        payload: {
          ...turnResult.turn,
        },
      });
      return;
    }

    // 7. Explicit Cloud-Relay Fallback Activation (AC-RS-004)
    if (envelope.type === "transport.fallback") {
      const reason =
        payload.failure_reason === "dtls_handshake_timeout" ||
        payload.failure_reason === "nat_traversal_blocked"
          ? payload.failure_reason
          : "ice_failed";
      const fallbackResult = this.signalingService.activateCloudRelayFallback({
        session_id: peer.sessionId,
        device_id: companionDeviceId,
        access_token: companionToken ?? "",
        failure_reason: reason,
        now_ms: nowMs,
      });
      if (fallbackResult.disposition !== "activated") {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          fallbackResult.reason_code ?? "fallback_rejected",
          nowMs,
        );
        return;
      }

      const notice = {
        schema_version: 1,
        message_id: `relay-${envelope.message_id}`,
        session_id: peer.sessionId,
        device_id: "signaling-server",
        sequence: this.nextServerSequence(),
        sent_at: new Date(nowMs).toISOString(),
        type: "transport.state",
        payload: {
          transport: "cloud_relay",
          cloud_relay_labeled: true,
          user_banner: fallbackResult.user_banner,
        },
      };
      group?.tv?.connection.send(notice);
      group?.companion?.connection.send(notice);
      return;
    }

    // 8. Cloud-Relay Structured Observation Transport
    if (
      envelope.type === "calibration.state" ||
      envelope.type === "observation.candidate" ||
      envelope.type === "observation.stable" ||
      envelope.type === "observation.invalid"
    ) {
      const ingress = this.sessionIngresses.get(peer.sessionId);
      if (!ingress) {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          "observation_ingress_not_registered",
          nowMs,
        );
        return;
      }
      const relayResult = this.signalingService.relayStructuredMessage({
        session_id: peer.sessionId,
        device_id: companionDeviceId,
        access_token: companionToken ?? "",
        raw_envelope: rawMessage,
        ingress,
        now_ms: nowMs,
      });

      if (relayResult.disposition !== "relayed") {
        this.sendError(
          peer.connection,
          peer.sessionId,
          peer.deviceId,
          relayResult.reason_code ?? "relay_rejected",
          nowMs,
        );
        return;
      }

      group?.tv?.connection.send({
        ...envelope,
        payload: {
          ...envelope.payload,
          transport: "cloud_relay",
          cloud_relay_labeled: true,
          ingress_disposition: relayResult.ingress_result?.disposition ?? null,
          hold_verification_required:
            relayResult.ingress_result?.hold_verification_required ?? false,
          puzzle_commit: false,
        },
      });
      return;
    }

    this.sendError(
      peer.connection,
      peer.sessionId,
      peer.deviceId,
      "unsupported_signaling_message_type",
      nowMs,
    );
  }

  /**
   * Starts an RFC 6455 WebSocket + HTTP signaling server on the specified port and host.
   */
  async listen(
    port = 0,
    host = "127.0.0.1",
  ): Promise<{ port: number; url: string }> {
    if (this.httpServer) {
      throw new Error("signaling_server_already_listening");
    }

    const server = createServer((req, res) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "ok", transport: "websocket_signaling" }),
        );
        return;
      }
      res.writeHead(426, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upgrade_required" }));
    });

    server.on(
      "upgrade",
      (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const upgradeHeader = req.headers.upgrade?.toLowerCase();
        const keyHeader = req.headers["sec-websocket-key"];
        if (upgradeHeader !== "websocket" || typeof keyHeader !== "string") {
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          socket.destroy();
          return;
        }

        const acceptKey = createHash("sha1")
          .update(keyHeader.trim() + WS_GUID, "utf8")
          .digest("base64");

        socket.write(
          [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${acceptKey}`,
            "\r\n",
          ].join("\r\n"),
        );

        this.openSockets.add(socket);
        let closed = false;
        const peerConnection: SignalingPeerConnection = {
          send: (message) => {
            if (!closed && !socket.destroyed) {
              socket.write(encodeWsTextFrame(JSON.stringify(message)));
            }
          },
          close: (code = 1000, reason = "closed") => {
            if (!closed && !socket.destroyed) {
              closed = true;
              socket.write(encodeWsCloseFrame(code, reason));
              socket.end();
            }
          },
        };

        const peerId = this.connectPeer(peerConnection);
        let buffer: Buffer =
          head && head.byteLength > 0 ? Buffer.from(head) : Buffer.alloc(0);

        const processBuffer = () => {
          while (buffer.byteLength > 0 && !closed) {
            let frame: ParsedWsFrame | null;
            try {
              frame = tryParseWsFrame(buffer);
            } catch {
              this.sendError(peerConnection, "", "", "message_too_large");
              peerConnection.close(1009, "message_too_large");
              return;
            }
            if (!frame) break;
            buffer = Buffer.from(buffer.subarray(frame.bytesConsumed));

            if (frame.opcode === 0x08) {
              // Close frame
              peerConnection.close(1000, "client_closed");
              return;
            }
            if (frame.opcode === 0x09) {
              // Ping frame
              if (!socket.destroyed) {
                socket.write(encodeWsPongFrame(frame.payload));
              }
              continue;
            }
            if (frame.opcode === 0x01) {
              // Text frame
              this.handlePeerMessage(peerId, frame.payload.toString("utf8"));
            }
          }
        };

        if (buffer.byteLength > 0) {
          processBuffer();
        }

        socket.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          processBuffer();
        });

        const cleanup = () => {
          closed = true;
          this.openSockets.delete(socket);
          this.disconnectPeer(peerId);
        };
        socket.on("close", cleanup);
        socket.on("error", cleanup);
      },
    );

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });

    this.httpServer = server;
    const address = server.address();
    const boundPort =
      typeof address === "object" && address !== null ? address.port : port;
    return {
      port: boundPort,
      url: `ws://${host}:${boundPort}`,
    };
  }

  async close(): Promise<void> {
    for (const socket of this.openSockets) {
      socket.destroy();
    }
    this.openSockets.clear();
    this.peersById.clear();
    this.sessionPeers.clear();
    if (!this.httpServer) return;
    const server = this.httpServer;
    this.httpServer = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}
