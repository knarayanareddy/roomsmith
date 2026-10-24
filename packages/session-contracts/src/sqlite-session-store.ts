import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const SESSION_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionRuntimeStatus =
  | "setup"
  | "playing"
  | "awaiting_observation"
  | "verifying"
  | "fallback"
  | "completed";

export interface CompletedPuzzleRecord {
  puzzle_id: string;
  path: "camera" | "remote";
  committed_sequence: number;
  observation_sequence: number | null;
  completed_at_ms: number;
}

export interface PersistedPuzzleSessionSnapshot {
  session_id: string;
  episode_id: string;
  content_version: string;
  graph_sha256: string;
  node_id: string;
  state_sequence: number;
  player_count: number;
  roles: Array<"navigator" | "keeper" | "observer">;
  accessibility_settings: {
    no_timing_mode: boolean;
    reduced_motion: boolean;
    captions: boolean;
    remote_only: boolean;
    larger_text: boolean;
  };
  object_kit: string[];
  play_mat_version: string;
  puzzle_id: string | null;
  attempt_count: number;
  hint_level: number;
  puzzle_started_at_ms: number;
  stable_observation_ids: string[];
  last_observation_sequences: Record<string, number>;
  sequence_step: number;
  sequence_started_at_ms: number | null;
  completed_puzzles: CompletedPuzzleRecord[];
  hints_used: Record<string, number>;
  elapsed_active_time_ms: number;
  status: SessionRuntimeStatus;
  saved_at_ms?: number;
  expires_at_ms?: number;
}

export interface StoredSnapshotEnvelope {
  snapshot: PersistedPuzzleSessionSnapshot;
  sha256_checksum: string;
  saved_at_ms: number;
  expires_at_ms: number;
}

export interface PuzzleSessionSnapshotStore {
  saveSnapshot(
    snapshot: PersistedPuzzleSessionSnapshot,
    nowMs?: number,
  ): StoredSnapshotEnvelope;
  loadSnapshot(
    sessionId: string,
    nowMs?: number,
  ): PersistedPuzzleSessionSnapshot | null;
  deleteSnapshot(sessionId: string): boolean;
  purgeExpiredSnapshots(nowMs: number): number;
}

export interface RedisKeyValueClient {
  get(key: string): string | null;
  set(key: string, value: string, ttlMs?: number): void;
  del(key: string): boolean;
  keys(prefix?: string): string[];
}

const FORBIDDEN_MEDIA_KEYS = new Set([
  "audio",
  "audiobuffer",
  "base64",
  "blob",
  "candidate_observation_id",
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

const VALID_STATUSES = new Set<SessionRuntimeStatus>([
  "setup",
  "playing",
  "awaiting_observation",
  "verifying",
  "fallback",
  "completed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLen = 160): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLen
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

function computeSnapshotChecksum(
  snapshot: PersistedPuzzleSessionSnapshot,
): string {
  return createHash("sha256")
    .update(canonicalize(snapshot), "utf8")
    .digest("hex");
}

function containsForbiddenMedia(value: unknown): boolean {
  if (typeof value === "string") {
    return /^data:(?:image|video|audio)\//i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenMedia(item));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    const normalized = key.toLowerCase().trim();
    const compact = normalized.replace(/[-_]/g, "");
    return (
      FORBIDDEN_MEDIA_KEYS.has(normalized) ||
      FORBIDDEN_MEDIA_KEYS.has(compact) ||
      containsForbiddenMedia(item)
    );
  });
}

/**
 * Validates and normalizes a puzzle session snapshot before persistence or on restore
 * (FR-RS-012, AC-RS-018, SEC-RS-001, SEC-RS-005).
 */
export function validateAndNormalizeSnapshot(
  input: unknown,
  nowMs = 0,
): PersistedPuzzleSessionSnapshot {
  if (!isRecord(input)) {
    throw new Error("invalid_snapshot_object");
  }
  if (containsForbiddenMedia(input)) {
    throw new Error("media_payload_forbidden");
  }

  const snap = input as unknown as PersistedPuzzleSessionSnapshot;
  if (
    !nonEmptyString(snap.session_id) ||
    !nonEmptyString(snap.episode_id) ||
    !nonEmptyString(snap.content_version, 64) ||
    !nonEmptyString(snap.graph_sha256, 128) ||
    !nonEmptyString(snap.node_id) ||
    !nonEmptyString(snap.play_mat_version, 64) ||
    !Number.isSafeInteger(snap.state_sequence) ||
    snap.state_sequence < 0 ||
    !Number.isSafeInteger(snap.player_count) ||
    snap.player_count < 1 ||
    snap.player_count > 4 ||
    !Number.isSafeInteger(snap.attempt_count) ||
    snap.attempt_count < 0 ||
    !Number.isSafeInteger(snap.hint_level) ||
    snap.hint_level < 0 ||
    !Number.isSafeInteger(snap.puzzle_started_at_ms) ||
    snap.puzzle_started_at_ms < 0 ||
    !Number.isSafeInteger(snap.sequence_step) ||
    snap.sequence_step < 0 ||
    !(
      snap.sequence_started_at_ms === null ||
      (Number.isSafeInteger(snap.sequence_started_at_ms) &&
        snap.sequence_started_at_ms >= 0)
    ) ||
    !Number.isSafeInteger(snap.elapsed_active_time_ms) ||
    snap.elapsed_active_time_ms < 0 ||
    !VALID_STATUSES.has(snap.status)
  ) {
    throw new Error("invalid_snapshot_fields");
  }

  if (
    !Array.isArray(snap.completed_puzzles) ||
    snap.completed_puzzles.length !== snap.state_sequence
  ) {
    throw new Error("snapshot_sequence_mismatch");
  }

  const sortedCompletions = [...snap.completed_puzzles].sort(
    (a, b) => a.committed_sequence - b.committed_sequence,
  );
  const seenPuzzles = new Set<string>();
  sortedCompletions.forEach((comp, index) => {
    if (
      !nonEmptyString(comp.puzzle_id) ||
      seenPuzzles.has(comp.puzzle_id) ||
      (comp.path !== "camera" && comp.path !== "remote") ||
      comp.committed_sequence !== index + 1 ||
      !Number.isSafeInteger(comp.completed_at_ms) ||
      comp.completed_at_ms < 0
    ) {
      throw new Error("invalid_completed_puzzle_record");
    }
    if (comp.path === "remote" && comp.observation_sequence !== null) {
      throw new Error("remote_completion_cannot_have_observation_sequence");
    }
    seenPuzzles.add(comp.puzzle_id);
  });

  // Transient hold progress (`verifying`) never survives backgrounding/restart
  const normalizedStatus: SessionRuntimeStatus =
    snap.status === "verifying" ? "awaiting_observation" : snap.status;

  const savedAtMs =
    snap.saved_at_ms !== undefined && Number.isSafeInteger(snap.saved_at_ms)
      ? snap.saved_at_ms
      : nowMs;
  const expiresAtMs =
    snap.expires_at_ms !== undefined && Number.isSafeInteger(snap.expires_at_ms)
      ? snap.expires_at_ms
      : savedAtMs + SESSION_SNAPSHOT_TTL_MS;

  return {
    session_id: snap.session_id,
    episode_id: snap.episode_id,
    content_version: snap.content_version,
    graph_sha256: snap.graph_sha256,
    node_id: snap.node_id,
    state_sequence: snap.state_sequence,
    player_count: snap.player_count,
    roles: [...snap.roles],
    accessibility_settings: structuredClone(snap.accessibility_settings),
    object_kit: [...snap.object_kit],
    play_mat_version: snap.play_mat_version,
    puzzle_id: snap.puzzle_id,
    attempt_count: snap.attempt_count,
    hint_level: snap.hint_level,
    puzzle_started_at_ms: snap.puzzle_started_at_ms,
    stable_observation_ids: [...snap.stable_observation_ids],
    last_observation_sequences: structuredClone(
      snap.last_observation_sequences,
    ),
    sequence_step: snap.sequence_step,
    sequence_started_at_ms: snap.sequence_started_at_ms,
    completed_puzzles: sortedCompletions.map((c) => structuredClone(c)),
    hints_used: structuredClone(snap.hints_used),
    elapsed_active_time_ms: snap.elapsed_active_time_ms,
    status: normalizedStatus,
    saved_at_ms: savedAtMs,
    expires_at_ms: expiresAtMs,
  };
}

/**
 * SQLite-backed puzzle session state machine store using Node 22 built-in `node:sqlite`.
 * Persists committed puzzle state across app backgrounding and process restarts with
 * SHA-256 integrity verification, monotonic sequence protection, and 7-day TTL purge
 * (FR-RS-012, FR-RS-015, SEC-RS-005, AC-RS-017, AC-RS-018).
 */
export class SqlitePuzzleSessionStore implements PuzzleSessionSnapshotStore {
  private readonly db: DatabaseSync;

  constructor(private readonly filename = ":memory:") {
    this.db = new DatabaseSync(this.filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS puzzle_session_snapshots (
        session_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT NOT NULL,
        state_sequence INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        sha256_checksum TEXT NOT NULL,
        saved_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );
    `);
  }

  saveSnapshot(
    snapshot: PersistedPuzzleSessionSnapshot,
    nowMs = 0,
  ): StoredSnapshotEnvelope {
    const normalized = validateAndNormalizeSnapshot(snapshot, nowMs);

    const existingStmt = this.db.prepare(
      "SELECT state_sequence FROM puzzle_session_snapshots WHERE session_id = ?",
    );
    const existingRow = existingStmt.get(normalized.session_id) as
      | { state_sequence: number }
      | undefined;

    if (
      existingRow &&
      normalized.state_sequence < Number(existingRow.state_sequence)
    ) {
      throw new Error("stale_snapshot_sequence");
    }

    const checksum = computeSnapshotChecksum(normalized);
    const payloadJson = JSON.stringify(normalized);
    const savedAt = normalized.saved_at_ms ?? nowMs;
    const expiresAt =
      normalized.expires_at_ms ?? savedAt + SESSION_SNAPSHOT_TTL_MS;

    const upsert = this.db.prepare(`
      INSERT INTO puzzle_session_snapshots (
        session_id,
        episode_id,
        state_sequence,
        payload_json,
        sha256_checksum,
        saved_at_ms,
        expires_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        episode_id = excluded.episode_id,
        state_sequence = excluded.state_sequence,
        payload_json = excluded.payload_json,
        sha256_checksum = excluded.sha256_checksum,
        saved_at_ms = excluded.saved_at_ms,
        expires_at_ms = excluded.expires_at_ms
    `);
    upsert.run(
      normalized.session_id,
      normalized.episode_id,
      normalized.state_sequence,
      payloadJson,
      checksum,
      savedAt,
      expiresAt,
    );

    return {
      snapshot: structuredClone(normalized),
      sha256_checksum: checksum,
      saved_at_ms: savedAt,
      expires_at_ms: expiresAt,
    };
  }

  loadSnapshot(
    sessionId: string,
    nowMs = 0,
  ): PersistedPuzzleSessionSnapshot | null {
    const stmt = this.db.prepare(`
      SELECT payload_json, sha256_checksum, expires_at_ms
      FROM puzzle_session_snapshots
      WHERE session_id = ?
    `);
    const row = stmt.get(sessionId) as
      | {
          payload_json: string;
          sha256_checksum: string;
          expires_at_ms: number;
        }
      | undefined;

    if (!row) return null;
    if (nowMs >= Number(row.expires_at_ms)) {
      this.deleteSnapshot(sessionId);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json);
    } catch {
      throw new Error("snapshot_corrupted_json");
    }

    const validated = validateAndNormalizeSnapshot(parsed, nowMs);
    const actualChecksum = computeSnapshotChecksum(validated);
    if (actualChecksum !== row.sha256_checksum) {
      throw new Error("snapshot_checksum_mismatch");
    }

    return validated;
  }

  deleteSnapshot(sessionId: string): boolean {
    const stmt = this.db.prepare(
      "DELETE FROM puzzle_session_snapshots WHERE session_id = ?",
    );
    const result = stmt.run(sessionId);
    return Number(result.changes) > 0;
  }

  purgeExpiredSnapshots(nowMs: number): number {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("invalid_purge_timestamp");
    }
    const stmt = this.db.prepare(
      "DELETE FROM puzzle_session_snapshots WHERE expires_at_ms <= ?",
    );
    const result = stmt.run(nowMs);
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * In-memory Redis-compatible key-value client for testing or local fallback.
 */
export class InMemoryRedisClient implements RedisKeyValueClient {
  private readonly store = new Map<
    string,
    { value: string; expiresAtMs: number | null }
  >();

  get(key: string): string | null {
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  set(key: string, value: string, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAtMs: ttlMs !== undefined ? Date.now() + ttlMs : null,
    });
  }

  del(key: string): boolean {
    return this.store.delete(key);
  }

  keys(prefix = ""): string[] {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
}

/**
 * Redis-backed puzzle session snapshot store implementing the same contract and
 * SHA-256 verification as `SqlitePuzzleSessionStore`.
 */
export class RedisPuzzleSessionStore implements PuzzleSessionSnapshotStore {
  private static readonly KEY_PREFIX = "roomsmith:session:snapshot:";

  constructor(
    private readonly client: RedisKeyValueClient = new InMemoryRedisClient(),
  ) {}

  private keyFor(sessionId: string): string {
    return `${RedisPuzzleSessionStore.KEY_PREFIX}${sessionId}`;
  }

  saveSnapshot(
    snapshot: PersistedPuzzleSessionSnapshot,
    nowMs = 0,
  ): StoredSnapshotEnvelope {
    const normalized = validateAndNormalizeSnapshot(snapshot, nowMs);
    const existingRaw = this.client.get(this.keyFor(normalized.session_id));
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as StoredSnapshotEnvelope;
      if (normalized.state_sequence < existing.snapshot.state_sequence) {
        throw new Error("stale_snapshot_sequence");
      }
    }

    const savedAt = normalized.saved_at_ms ?? nowMs;
    const expiresAt =
      normalized.expires_at_ms ?? savedAt + SESSION_SNAPSHOT_TTL_MS;
    const checksum = computeSnapshotChecksum(normalized);
    const envelope: StoredSnapshotEnvelope = {
      snapshot: normalized,
      sha256_checksum: checksum,
      saved_at_ms: savedAt,
      expires_at_ms: expiresAt,
    };
    this.client.set(
      this.keyFor(normalized.session_id),
      JSON.stringify(envelope),
      Math.max(1, expiresAt - savedAt),
    );
    return structuredClone(envelope);
  }

  loadSnapshot(
    sessionId: string,
    nowMs = 0,
  ): PersistedPuzzleSessionSnapshot | null {
    const raw = this.client.get(this.keyFor(sessionId));
    if (!raw) return null;
    let envelope: StoredSnapshotEnvelope;
    try {
      envelope = JSON.parse(raw) as StoredSnapshotEnvelope;
    } catch {
      throw new Error("snapshot_corrupted_json");
    }
    if (nowMs >= envelope.expires_at_ms) {
      this.deleteSnapshot(sessionId);
      return null;
    }
    const validated = validateAndNormalizeSnapshot(envelope.snapshot, nowMs);
    if (computeSnapshotChecksum(validated) !== envelope.sha256_checksum) {
      throw new Error("snapshot_checksum_mismatch");
    }
    return validated;
  }

  deleteSnapshot(sessionId: string): boolean {
    return this.client.del(this.keyFor(sessionId));
  }

  purgeExpiredSnapshots(nowMs: number): number {
    let purged = 0;
    for (const key of this.client.keys(RedisPuzzleSessionStore.KEY_PREFIX)) {
      const raw = this.client.get(key);
      if (!raw) continue;
      try {
        const envelope = JSON.parse(raw) as StoredSnapshotEnvelope;
        if (nowMs >= envelope.expires_at_ms) {
          this.client.del(key);
          purged += 1;
        }
      } catch {
        this.client.del(key);
        purged += 1;
      }
    }
    return purged;
  }
}
