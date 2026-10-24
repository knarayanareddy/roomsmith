import { createHash, randomBytes } from "node:crypto";

export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const COMPANION_CREDENTIAL_TTL_MS = 30 * 60 * 1000;
export const SESSION_RETENTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PAIRING_EXCHANGE_FAILURES = 5;

export type PlayerRole = "navigator" | "keeper" | "observer";

export interface SessionAccessibilitySettings {
  no_timing_mode: boolean;
  reduced_motion: boolean;
  captions: boolean;
  remote_only: boolean;
  larger_text: boolean;
}

export interface PrePlaySetupInput {
  session_id?: string;
  episode_id: string;
  content_version: string;
  player_count: number;
  selected_object_kit: string[];
  accessibility: SessionAccessibilitySettings;
  adult_supervision_confirmed: boolean;
  privacy_notice_acknowledged: boolean;
  now_ms?: number;
  idempotency_key?: string;
}

export interface PairingMaterial {
  pairing_code: string;
  pairing_nonce: string;
  issued_at_ms: number;
  expires_at_ms: number;
  consumed: boolean;
  epoch: number;
}

export interface CompanionCredential {
  credential_id: string;
  session_id: string;
  device_id: string;
  access_token: string;
  epoch: number;
  issued_at_ms: number;
  expires_at_ms: number;
  scopes: ReadonlyArray<
    "observations:write" | "control:read_write" | "webrtc:signal"
  >;
}

export interface SessionConfigurationRecord {
  session_id: string;
  episode_id: string;
  content_version: string;
  player_count: number;
  solo_path: boolean;
  assigned_roles: PlayerRole[];
  selected_object_kit: string[];
  accessibility: SessionAccessibilitySettings;
  adult_supervision_confirmed: true;
  privacy_notice_acknowledged: true;
  created_at_ms: number;
  retention_expires_at_ms: number;
  pairing: PairingMaterial | null;
  active_device_id: string | null;
  credential_epoch: number;
  provenance: "fixture" | "live";
}

export interface PairingExchangeInput {
  session_id: string;
  pairing_code: string;
  pairing_nonce: string;
  device_id: string;
  now_ms?: number;
  idempotency_key?: string;
}

export interface PairingExchangeResult {
  disposition: "issued" | "rejected";
  reason_code: string | null;
  credential: CompanionCredential | null;
}

export interface RoleClueRequest {
  session_id: string;
  node_id: string;
  role_id: PlayerRole;
  clue_text: string;
  asset_id: string;
  solo_reveal_after_seconds: number;
  elapsed_node_seconds: number;
  device_id?: string;
  access_token?: string;
  now_ms?: number;
}

export interface RoleClueResult {
  disposition: "delivered" | "awaiting_solo_reveal" | "denied";
  delivery_channel: "companion_private" | "solo_shared_screen" | null;
  reason_code: string | null;
  role_id: PlayerRole;
  clue_text: string | null;
  asset_id: string | null;
}

export interface RevocationResult {
  revoked: boolean;
  session_id: string;
  revoked_device_id: string | null;
  new_credential_epoch: number;
  revoke_envelope: {
    schema_version: 1;
    message_id: string;
    session_id: string;
    device_id: string;
    sequence: number;
    sent_at: string;
    type: "session.revoke";
    payload: {
      reason: "adult_or_tv_revoked";
      credential_epoch: number;
    };
  };
}

export interface SessionDeletionResult {
  deleted: boolean;
  session_id: string;
  reason: "user_request" | "retention_expired";
  snapshots_deleted: number;
  director_contexts_deleted: number;
  credentials_revoked: number;
}

export interface RedactedPairingAuditEntry {
  event: string;
  session_id: string;
  device_id: string | null;
  at_ms: number;
  access_token: "[REDACTED_TOKEN]";
  pairing_secret: "[REDACTED_PAIRING]";
  reason_code: string | null;
}

export interface SessionCredentialVerifier {
  verifyDeviceAccess(input: {
    session_id: string;
    device_id: string;
    access_token: string;
    now_ms?: number;
  }): { valid: boolean; reason_code: string | null; epoch: number | null };
}

const ALLOWLISTED_KIT_OBJECTS = new Set([
  "red_cup",
  "blue_cup",
  "book",
  "bottle",
  "spoon",
]);
const REQUIRED_KIT_OBJECTS = ["red_cup", "blue_cup", "book"] as const;
const ROLES_ORDER: readonly PlayerRole[] = ["navigator", "observer", "keeper"];
const FORBIDDEN_MEDIA_KEYS = new Set([
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown, maxLength = 160): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function containsMedia(value: unknown): boolean {
  if (typeof value === "string") {
    return /^data:(?:image|video|audio)\//i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsMedia(item));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    const normalized = key.toLowerCase().replace(/[-_]/g, "");
    return FORBIDDEN_MEDIA_KEYS.has(normalized) || containsMedia(item);
  });
}

function generatePairingCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length] ?? "A";
  }
  return code;
}

interface InternalSessionState {
  record: SessionConfigurationRecord;
  credentials: Map<string, CompanionCredential>;
  revokedDevices: Set<string>;
  failedPairingAttempts: number;
  pairingLocked: boolean;
  snapshots: Array<Record<string, unknown>>;
  directorContexts: Array<Record<string, unknown>>;
  revokeSequence: number;
}

interface IdempotencyRecord<T> {
  requestHash: string;
  response: T;
}

/**
 * Pairing, pre-play setup, role clue / solo-path, companion revocation, and
 * session artifact retention/deletion service (FR-RS-002, FR-RS-003, FR-RS-009,
 * FR-RS-015, SEC-RS-002, SEC-RS-005, SEC-RS-007, SEC-RS-008, AC-RS-002, AC-RS-020).
 */
export class PairingService implements SessionCredentialVerifier {
  private readonly sessions = new Map<string, InternalSessionState>();
  private readonly createIdempotency = new Map<
    string,
    IdempotencyRecord<SessionConfigurationRecord>
  >();
  private readonly exchangeIdempotency = new Map<
    string,
    IdempotencyRecord<PairingExchangeResult>
  >();
  private readonly auditLog: RedactedPairingAuditEntry[] = [];
  private readonly onRevokeCallbacks: Array<(sessionId: string) => void> = [];
  private sessionCounter = 0;

  onSessionRevoked(callback: (sessionId: string) => void): void {
    this.onRevokeCallbacks.push(callback);
  }

  private logAudit(
    event: string,
    sessionId: string,
    deviceId: string | null,
    atMs: number,
    reasonCode: string | null = null,
  ): void {
    this.auditLog.push({
      event,
      session_id: sessionId,
      device_id: deviceId,
      at_ms: atMs,
      access_token: "[REDACTED_TOKEN]",
      pairing_secret: "[REDACTED_PAIRING]",
      reason_code: reasonCode,
    });
  }

  getAuditLog(): RedactedPairingAuditEntry[] {
    return structuredClone(this.auditLog);
  }

  createSession(input: PrePlaySetupInput): SessionConfigurationRecord {
    if (!isRecord(input) || containsMedia(input)) {
      throw new Error("invalid_preplay_setup");
    }
    const nowMs = input.now_ms ?? 0;
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("invalid_session_timestamp");
    }

    if (input.idempotency_key !== undefined) {
      if (!nonEmptyText(input.idempotency_key, 128)) {
        throw new Error("invalid_idempotency_key");
      }
      const reqHash = hashPayload({
        episode_id: input.episode_id,
        content_version: input.content_version,
        player_count: input.player_count,
        selected_object_kit: input.selected_object_kit,
        accessibility: input.accessibility,
        adult_supervision_confirmed: input.adult_supervision_confirmed,
        privacy_notice_acknowledged: input.privacy_notice_acknowledged,
      });
      const existing = this.createIdempotency.get(input.idempotency_key);
      if (existing) {
        if (existing.requestHash !== reqHash) {
          throw new Error("idempotency_key_reused");
        }
        return structuredClone(existing.response);
      }
    }

    if (
      !nonEmptyText(input.episode_id) ||
      !nonEmptyText(input.content_version, 64)
    ) {
      throw new Error("invalid_episode_metadata");
    }
    if (
      !Number.isSafeInteger(input.player_count) ||
      input.player_count < 1 ||
      input.player_count > 4
    ) {
      throw new Error("invalid_player_count");
    }
    if (input.adult_supervision_confirmed !== true) {
      throw new Error("adult_supervision_required");
    }
    if (input.privacy_notice_acknowledged !== true) {
      throw new Error("privacy_acknowledgement_required");
    }
    if (
      !Array.isArray(input.selected_object_kit) ||
      input.selected_object_kit.length === 0 ||
      new Set(input.selected_object_kit).size !==
        input.selected_object_kit.length ||
      input.selected_object_kit.some(
        (id) => typeof id !== "string" || !ALLOWLISTED_KIT_OBJECTS.has(id),
      )
    ) {
      throw new Error("invalid_object_kit_selection");
    }
    for (const requiredId of REQUIRED_KIT_OBJECTS) {
      if (!input.selected_object_kit.includes(requiredId)) {
        throw new Error(`missing_required_kit_object:${requiredId}`);
      }
    }
    const acc = input.accessibility;
    if (
      !isRecord(acc) ||
      typeof acc.no_timing_mode !== "boolean" ||
      typeof acc.reduced_motion !== "boolean" ||
      typeof acc.captions !== "boolean" ||
      typeof acc.remote_only !== "boolean" ||
      typeof acc.larger_text !== "boolean"
    ) {
      throw new Error("invalid_accessibility_settings");
    }

    this.sessionCounter += 1;
    const sessionId =
      input.session_id && nonEmptyText(input.session_id)
        ? input.session_id
        : `01JROOMSMITHSESSION${String(this.sessionCounter).padStart(7, "0")}`;
    if (this.sessions.has(sessionId)) {
      throw new Error("duplicate_session_id");
    }

    const soloPath = input.player_count === 1;
    const assignedRoles: PlayerRole[] = soloPath
      ? ["navigator", "observer", "keeper"]
      : ROLES_ORDER.slice(0, Math.min(input.player_count, ROLES_ORDER.length));

    const pairing: PairingMaterial | null = acc.remote_only
      ? null
      : {
          pairing_code: generatePairingCode(),
          pairing_nonce: randomBytes(16).toString("hex"),
          issued_at_ms: nowMs,
          expires_at_ms: nowMs + PAIRING_CODE_TTL_MS,
          consumed: false,
          epoch: 1,
        };

    const record: SessionConfigurationRecord = {
      session_id: sessionId,
      episode_id: input.episode_id,
      content_version: input.content_version,
      player_count: input.player_count,
      solo_path: soloPath,
      assigned_roles: assignedRoles,
      selected_object_kit: [...input.selected_object_kit],
      accessibility: structuredClone(acc),
      adult_supervision_confirmed: true,
      privacy_notice_acknowledged: true,
      created_at_ms: nowMs,
      retention_expires_at_ms: nowMs + SESSION_RETENTION_TTL_MS,
      pairing,
      active_device_id: null,
      credential_epoch: 1,
      provenance: "fixture",
    };

    this.sessions.set(sessionId, {
      record,
      credentials: new Map(),
      revokedDevices: new Set(),
      failedPairingAttempts: 0,
      pairingLocked: false,
      snapshots: [],
      directorContexts: [],
      revokeSequence: 0,
    });

    if (input.idempotency_key) {
      this.createIdempotency.set(input.idempotency_key, {
        requestHash: hashPayload({
          episode_id: input.episode_id,
          content_version: input.content_version,
          player_count: input.player_count,
          selected_object_kit: input.selected_object_kit,
          accessibility: input.accessibility,
          adult_supervision_confirmed: input.adult_supervision_confirmed,
          privacy_notice_acknowledged: input.privacy_notice_acknowledged,
        }),
        response: structuredClone(record),
      });
    }

    this.logAudit("session.created", sessionId, null, nowMs);
    return structuredClone(record);
  }

  exchangePairing(input: PairingExchangeInput): PairingExchangeResult {
    const nowMs = input.now_ms ?? 0;
    if (
      !isRecord(input) ||
      !nonEmptyText(input.session_id) ||
      !nonEmptyText(input.pairing_code, 32) ||
      !nonEmptyText(input.pairing_nonce, 128) ||
      !nonEmptyText(input.device_id) ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0
    ) {
      return {
        disposition: "rejected",
        reason_code: "invalid_pairing_exchange_request",
        credential: null,
      };
    }

    if (input.idempotency_key !== undefined) {
      if (!nonEmptyText(input.idempotency_key, 128)) {
        return {
          disposition: "rejected",
          reason_code: "invalid_idempotency_key",
          credential: null,
        };
      }
      const reqHash = hashPayload({
        session_id: input.session_id,
        pairing_code: input.pairing_code,
        pairing_nonce: input.pairing_nonce,
        device_id: input.device_id,
      });
      const existing = this.exchangeIdempotency.get(input.idempotency_key);
      if (existing) {
        if (existing.requestHash !== reqHash) {
          return {
            disposition: "rejected",
            reason_code: "idempotency_key_reused",
            credential: null,
          };
        }
        return structuredClone(existing.response);
      }
    }

    const session = this.sessions.get(input.session_id);
    if (!session || nowMs >= session.record.retention_expires_at_ms) {
      return {
        disposition: "rejected",
        reason_code: "session_not_found",
        credential: null,
      };
    }

    if (session.revokedDevices.has(input.device_id)) {
      this.logAudit(
        "pairing.exchange_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "companion_revoked_adult_approval_required",
      );
      return {
        disposition: "rejected",
        reason_code: "companion_revoked_adult_approval_required",
        credential: null,
      };
    }

    if (session.pairingLocked) {
      this.logAudit(
        "pairing.exchange_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "pairing_locked_brute_force",
      );
      return {
        disposition: "rejected",
        reason_code: "pairing_locked_brute_force",
        credential: null,
      };
    }

    const pairing = session.record.pairing;
    if (!pairing) {
      return {
        disposition: "rejected",
        reason_code: "pairing_disabled_remote_only",
        credential: null,
      };
    }

    if (pairing.consumed) {
      this.logAudit(
        "pairing.exchange_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "pairing_already_consumed",
      );
      return {
        disposition: "rejected",
        reason_code: "pairing_already_consumed",
        credential: null,
      };
    }

    if (nowMs > pairing.expires_at_ms) {
      this.logAudit(
        "pairing.exchange_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        "pairing_expired",
      );
      return {
        disposition: "rejected",
        reason_code: "pairing_expired",
        credential: null,
      };
    }

    if (
      input.pairing_code !== pairing.pairing_code ||
      input.pairing_nonce !== pairing.pairing_nonce
    ) {
      session.failedPairingAttempts += 1;
      if (session.failedPairingAttempts >= MAX_PAIRING_EXCHANGE_FAILURES) {
        session.pairingLocked = true;
      }
      const code = session.pairingLocked
        ? "pairing_locked_brute_force"
        : "invalid_pairing_material";
      this.logAudit(
        "pairing.exchange_rejected",
        input.session_id,
        input.device_id,
        nowMs,
        code,
      );
      return {
        disposition: "rejected",
        reason_code: code,
        credential: null,
      };
    }

    pairing.consumed = true;
    session.failedPairingAttempts = 0;
    session.record.active_device_id = input.device_id;

    const credential: CompanionCredential = {
      credential_id: `cred-${input.session_id}-${session.record.credential_epoch}`,
      session_id: input.session_id,
      device_id: input.device_id,
      access_token: randomBytes(24).toString("base64url"),
      epoch: session.record.credential_epoch,
      issued_at_ms: nowMs,
      expires_at_ms: nowMs + COMPANION_CREDENTIAL_TTL_MS,
      scopes: ["observations:write", "control:read_write", "webrtc:signal"],
    };
    session.credentials.set(input.device_id, credential);

    const result: PairingExchangeResult = {
      disposition: "issued",
      reason_code: null,
      credential: structuredClone(credential),
    };

    if (input.idempotency_key) {
      this.exchangeIdempotency.set(input.idempotency_key, {
        requestHash: hashPayload({
          session_id: input.session_id,
          pairing_code: input.pairing_code,
          pairing_nonce: input.pairing_nonce,
          device_id: input.device_id,
        }),
        response: structuredClone(result),
      });
    }

    this.logAudit(
      "pairing.credential_issued",
      input.session_id,
      input.device_id,
      nowMs,
    );
    return result;
  }

  verifyDeviceAccess(input: {
    session_id: string;
    device_id: string;
    access_token: string;
    now_ms?: number;
  }): { valid: boolean; reason_code: string | null; epoch: number | null } {
    const nowMs = input.now_ms ?? 0;
    const session = this.sessions.get(input.session_id);
    if (!session || nowMs >= session.record.retention_expires_at_ms) {
      return { valid: false, reason_code: "session_not_found", epoch: null };
    }
    if (session.revokedDevices.has(input.device_id)) {
      return { valid: false, reason_code: "companion_revoked", epoch: null };
    }
    const credential = session.credentials.get(input.device_id);
    if (
      !credential ||
      credential.session_id !== input.session_id ||
      credential.device_id !== input.device_id ||
      credential.epoch !== session.record.credential_epoch ||
      credential.access_token !== input.access_token
    ) {
      return {
        valid: false,
        reason_code: "invalid_device_credential",
        epoch: null,
      };
    }
    if (nowMs > credential.expires_at_ms) {
      return {
        valid: false,
        reason_code: "device_credential_expired",
        epoch: null,
      };
    }
    return { valid: true, reason_code: null, epoch: credential.epoch };
  }

  revokeCompanion(sessionId: string, nowMs = 0): RevocationResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    const revokedDeviceId = session.record.active_device_id;
    if (revokedDeviceId) {
      session.revokedDevices.add(revokedDeviceId);
    }
    for (const deviceId of session.credentials.keys()) {
      session.revokedDevices.add(deviceId);
    }
    session.credentials.clear();
    session.record.active_device_id = null;
    if (session.record.pairing) {
      session.record.pairing.consumed = true;
    }
    session.record.credential_epoch += 1;
    session.revokeSequence += 1;

    for (const callback of this.onRevokeCallbacks) {
      callback(sessionId);
    }

    this.logAudit("companion.revoked", sessionId, revokedDeviceId, nowMs);

    return {
      revoked: true,
      session_id: sessionId,
      revoked_device_id: revokedDeviceId,
      new_credential_epoch: session.record.credential_epoch,
      revoke_envelope: {
        schema_version: 1,
        message_id: `revoke-${sessionId}-${session.revokeSequence}`,
        session_id: sessionId,
        device_id: "tv-authority",
        sequence: session.revokeSequence,
        sent_at: new Date(nowMs).toISOString(),
        type: "session.revoke",
        payload: {
          reason: "adult_or_tv_revoked",
          credential_epoch: session.record.credential_epoch,
        },
      },
    };
  }

  approveNewCompanionPairing(
    sessionId: string,
    input: {
      adult_supervision_confirmed: boolean;
      allow_device_id?: string;
      now_ms?: number;
    },
  ): PairingMaterial {
    if (input.adult_supervision_confirmed !== true) {
      throw new Error("adult_approval_required_for_repairing");
    }
    const nowMs = input.now_ms ?? 0;
    const session = this.sessions.get(sessionId);
    if (!session || nowMs >= session.record.retention_expires_at_ms) {
      throw new Error("session_not_found");
    }
    if (session.record.accessibility.remote_only) {
      throw new Error("pairing_disabled_remote_only");
    }
    if (input.allow_device_id) {
      session.revokedDevices.delete(input.allow_device_id);
    } else {
      session.revokedDevices.clear();
    }
    session.failedPairingAttempts = 0;
    session.pairingLocked = false;
    const pairing: PairingMaterial = {
      pairing_code: generatePairingCode(),
      pairing_nonce: randomBytes(16).toString("hex"),
      issued_at_ms: nowMs,
      expires_at_ms: nowMs + PAIRING_CODE_TTL_MS,
      consumed: false,
      epoch: session.record.credential_epoch,
    };
    session.record.pairing = pairing;
    this.logAudit(
      "pairing.reapproved_by_adult",
      sessionId,
      input.allow_device_id ?? null,
      nowMs,
    );
    return structuredClone(pairing);
  }

  requestRoleClue(input: RoleClueRequest): RoleClueResult {
    const nowMs = input.now_ms ?? 0;
    const session = this.sessions.get(input.session_id);
    if (!session || nowMs >= session.record.retention_expires_at_ms) {
      return {
        disposition: "denied",
        delivery_channel: null,
        reason_code: "session_not_found",
        role_id: input.role_id,
        clue_text: null,
        asset_id: null,
      };
    }

    if (
      !nonEmptyText(input.node_id) ||
      !nonEmptyText(input.clue_text, 600) ||
      !nonEmptyText(input.asset_id) ||
      !ROLES_ORDER.includes(input.role_id) ||
      !Number.isSafeInteger(input.solo_reveal_after_seconds) ||
      input.solo_reveal_after_seconds < 0 ||
      input.solo_reveal_after_seconds > 120 ||
      typeof input.elapsed_node_seconds !== "number" ||
      !Number.isFinite(input.elapsed_node_seconds) ||
      input.elapsed_node_seconds < 0
    ) {
      return {
        disposition: "denied",
        delivery_channel: null,
        reason_code: "invalid_role_clue_request",
        role_id: input.role_id,
        clue_text: null,
        asset_id: null,
      };
    }

    if (input.device_id !== undefined || input.access_token !== undefined) {
      if (!input.device_id || !input.access_token) {
        return {
          disposition: "denied",
          delivery_channel: null,
          reason_code: "invalid_device_credential",
          role_id: input.role_id,
          clue_text: null,
          asset_id: null,
        };
      }
      const access = this.verifyDeviceAccess({
        session_id: input.session_id,
        device_id: input.device_id,
        access_token: input.access_token,
        now_ms: nowMs,
      });
      if (!access.valid) {
        this.logAudit(
          "clue.denied",
          input.session_id,
          input.device_id,
          nowMs,
          access.reason_code,
        );
        return {
          disposition: "denied",
          delivery_channel: null,
          reason_code: access.reason_code,
          role_id: input.role_id,
          clue_text: null,
          asset_id: null,
        };
      }
      return {
        disposition: "delivered",
        delivery_channel: "companion_private",
        reason_code: null,
        role_id: input.role_id,
        clue_text: input.clue_text,
        asset_id: input.asset_id,
      };
    }

    if (
      session.record.solo_path ||
      session.record.accessibility.remote_only ||
      session.record.accessibility.no_timing_mode ||
      input.elapsed_node_seconds >= input.solo_reveal_after_seconds
    ) {
      return {
        disposition: "delivered",
        delivery_channel: "solo_shared_screen",
        reason_code: null,
        role_id: input.role_id,
        clue_text: input.clue_text,
        asset_id: input.asset_id,
      };
    }

    return {
      disposition: "awaiting_solo_reveal",
      delivery_channel: null,
      reason_code: "solo_reveal_timer_pending",
      role_id: input.role_id,
      clue_text: null,
      asset_id: null,
    };
  }

  recordSnapshotArtifact(
    sessionId: string,
    snapshot: Record<string, unknown>,
    nowMs = 0,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || nowMs >= session.record.retention_expires_at_ms) {
      throw new Error("session_not_found");
    }
    if (!isRecord(snapshot) || containsMedia(snapshot)) {
      throw new Error("media_payload_forbidden");
    }
    session.snapshots.push(structuredClone(snapshot));
  }

  recordDirectorContextArtifact(
    sessionId: string,
    context: Record<string, unknown>,
    nowMs = 0,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || nowMs >= session.record.retention_expires_at_ms) {
      throw new Error("session_not_found");
    }
    if (!isRecord(context) || containsMedia(context)) {
      throw new Error("media_payload_forbidden");
    }
    session.directorContexts.push(structuredClone(context));
  }

  getSession(
    sessionId: string,
    nowMs = 0,
  ): {
    configuration: SessionConfigurationRecord;
    snapshots: Array<Record<string, unknown>>;
    director_contexts: Array<Record<string, unknown>>;
  } {
    const session = this.sessions.get(sessionId);
    if (!session || nowMs >= session.record.retention_expires_at_ms) {
      throw new Error("session_not_found");
    }
    return {
      configuration: structuredClone(session.record),
      snapshots: structuredClone(session.snapshots),
      director_contexts: structuredClone(session.directorContexts),
    };
  }

  deleteSessionArtifacts(
    sessionId: string,
    reason: "user_request" | "retention_expired" = "user_request",
    nowMs = 0,
  ): SessionDeletionResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        deleted: false,
        session_id: sessionId,
        reason,
        snapshots_deleted: 0,
        director_contexts_deleted: 0,
        credentials_revoked: 0,
      };
    }

    const snapshotsDeleted = session.snapshots.length;
    const directorContextsDeleted = session.directorContexts.length;
    const credentialsRevoked = session.credentials.size;

    session.snapshots.length = 0;
    session.directorContexts.length = 0;
    session.credentials.clear();
    session.record.pairing = null;
    this.sessions.delete(sessionId);

    for (const callback of this.onRevokeCallbacks) {
      callback(sessionId);
    }

    this.logAudit("session.deleted", sessionId, null, nowMs, reason);

    return {
      deleted: true,
      session_id: sessionId,
      reason,
      snapshots_deleted: snapshotsDeleted,
      director_contexts_deleted: directorContextsDeleted,
      credentials_revoked: credentialsRevoked,
    };
  }

  purgeExpiredSessions(nowMs: number): SessionDeletionResult[] {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("invalid_purge_timestamp");
    }
    const results: SessionDeletionResult[] = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      if (nowMs >= session.record.retention_expires_at_ms) {
        results.push(
          this.deleteSessionArtifacts(sessionId, "retention_expired", nowMs),
        );
      }
    }
    return results;
  }
}
