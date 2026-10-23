export type DirectorErrorCode =
  | "none"
  | "color_unknown"
  | "wrong_order"
  | "calibration_lost"
  | "no_observation"
  | "timeout";
export type DirectorTransport = "webrtc" | "cloud_relay";
export type AccessibilityMode = "standard" | "reduced_motion" | "no_timing";
export type DirectorRole = "observer" | "navigator" | "either";

export interface DirectorContext {
  episode_version: string;
  puzzle_id: string;
  attempt_count: number;
  hint_level: number;
  last_error: DirectorErrorCode;
  transport: DirectorTransport;
  accessibility_mode: AccessibilityMode;
}

export interface DirectorHint {
  text: string;
  hint_level: number;
  target_role: DirectorRole;
  uses_fallback: boolean;
}

export interface DirectorHintResult {
  hint: DirectorHint;
  source: "model" | "authored_fallback";
  fallback_reason: string | null;
  state_mutated: false;
  raw_media_accepted: false;
}

export type FixtureDirectorGateway = (
  context: DirectorContext,
) => unknown | Promise<unknown>;

export interface FixtureDirectorOptions {
  gateway?: FixtureDirectorGateway;
  timeoutMs?: number;
}

const CONTEXT_FIELDS = new Set([
  "episode_version",
  "puzzle_id",
  "attempt_count",
  "hint_level",
  "last_error",
  "transport",
  "accessibility_mode",
]);
const OUTPUT_FIELDS = new Set([
  "text",
  "hint_level",
  "target_role",
  "uses_fallback",
]);
const ERROR_CODES = new Set<DirectorErrorCode>([
  "none",
  "color_unknown",
  "wrong_order",
  "calibration_lost",
  "no_observation",
  "timeout",
]);
const TRANSPORTS = new Set<DirectorTransport>(["webrtc", "cloud_relay"]);
const ACCESSIBILITY_MODES = new Set<AccessibilityMode>([
  "standard",
  "reduced_motion",
  "no_timing",
]);
const ROLES = new Set<DirectorRole>(["observer", "navigator", "either"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** A bounded director client. The gateway is injected; no Bedrock client is created. */
export class FixtureDirectorService {
  private readonly authoredHints: Readonly<Record<string, readonly string[]>>;
  private readonly gateway: FixtureDirectorGateway | undefined;
  private readonly timeoutMs: number;

  constructor(
    authoredHints: Readonly<Record<string, readonly string[]>>,
    options: FixtureDirectorOptions = {},
  ) {
    const entries = Object.entries(authoredHints);
    if (entries.length === 0) throw new Error("authored_hint_ladder_required");
    for (const [puzzleId, hints] of entries) {
      if (
        !puzzleId.trim() ||
        hints.length === 0 ||
        hints.some((hint) => wordCount(hint) < 5 || wordCount(hint) > 45)
      ) {
        throw new Error("invalid_authored_hint_ladder");
      }
    }
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > 2000)
    ) {
      throw new Error("invalid_director_timeout");
    }
    this.authoredHints = clone(authoredHints);
    this.gateway = options.gateway;
    this.timeoutMs = options.timeoutMs ?? 150;
  }

  private context(input: unknown): DirectorContext {
    if (
      !isRecord(input) ||
      Object.keys(input).some((key) => !CONTEXT_FIELDS.has(key))
    ) {
      throw new Error("director_context_field_rejected");
    }
    const puzzleId = input.puzzle_id;
    const hints =
      typeof puzzleId === "string" ? this.authoredHints[puzzleId] : undefined;
    if (
      typeof input.episode_version !== "string" ||
      !input.episode_version.trim() ||
      input.episode_version.length > 64 ||
      typeof puzzleId !== "string" ||
      !hints ||
      !Number.isSafeInteger(input.attempt_count) ||
      (input.attempt_count as number) < 0 ||
      (input.attempt_count as number) > 10000 ||
      !Number.isSafeInteger(input.hint_level) ||
      (input.hint_level as number) < 1 ||
      (input.hint_level as number) > hints.length ||
      typeof input.last_error !== "string" ||
      !ERROR_CODES.has(input.last_error as DirectorErrorCode) ||
      typeof input.transport !== "string" ||
      !TRANSPORTS.has(input.transport as DirectorTransport) ||
      typeof input.accessibility_mode !== "string" ||
      !ACCESSIBILITY_MODES.has(input.accessibility_mode as AccessibilityMode)
    ) {
      throw new Error("invalid_director_context");
    }
    return {
      episode_version: input.episode_version,
      puzzle_id: puzzleId,
      attempt_count: input.attempt_count as number,
      hint_level: input.hint_level as number,
      last_error: input.last_error as DirectorErrorCode,
      transport: input.transport as DirectorTransport,
      accessibility_mode: input.accessibility_mode as AccessibilityMode,
    };
  }

  private fallback(
    context: DirectorContext,
    reason: string,
  ): DirectorHintResult {
    const text =
      this.authoredHints[context.puzzle_id]?.[context.hint_level - 1];
    if (!text) throw new Error("authored_hint_not_found");
    return {
      hint: {
        text,
        hint_level: context.hint_level,
        target_role: "either",
        uses_fallback: true,
      },
      source: "authored_fallback",
      fallback_reason: reason,
      state_mutated: false,
      raw_media_accepted: false,
    };
  }

  private validateModelOutput(
    value: unknown,
    context: DirectorContext,
  ): DirectorHint {
    if (
      !isRecord(value) ||
      Object.keys(value).some((key) => !OUTPUT_FIELDS.has(key))
    ) {
      throw new Error("invalid_director_output");
    }
    if (
      typeof value.text !== "string" ||
      wordCount(value.text) < 5 ||
      wordCount(value.text) > 45 ||
      value.hint_level !== context.hint_level ||
      typeof value.target_role !== "string" ||
      !ROLES.has(value.target_role as DirectorRole) ||
      typeof value.uses_fallback !== "boolean"
    ) {
      throw new Error("invalid_director_output");
    }
    if (value.uses_fallback) throw new Error("gateway_requested_fallback");
    // The fixture accepts only an authored variant at the requested level. This
    // conservatively enforces relevance and prevents a model from revealing more
    // than the authored ladder or introducing new objects/actions.
    const authored =
      this.authoredHints[context.puzzle_id]?.[context.hint_level - 1];
    if (value.text !== authored)
      throw new Error("director_output_not_allowlisted");
    return {
      text: value.text,
      hint_level: context.hint_level,
      target_role: value.target_role as DirectorRole,
      uses_fallback: false,
    };
  }

  private async invoke(context: DirectorContext): Promise<unknown> {
    if (!this.gateway) throw new Error("gateway_disabled");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = Promise.resolve().then(() =>
      this.gateway!(clone(context)),
    );
    // Attach a handler even if the timeout wins and the injected gateway rejects later.
    void operation.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("director_timeout")),
        this.timeoutMs,
      );
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async requestHint(input: unknown): Promise<DirectorHintResult> {
    const context = this.context(input);
    if (!this.gateway) return this.fallback(context, "gateway_disabled");
    try {
      const output = await this.invoke(context);
      return {
        hint: this.validateModelOutput(output, context),
        source: "model",
        fallback_reason: null,
        state_mutated: false,
        raw_media_accepted: false,
      };
    } catch (error) {
      const reason =
        error instanceof Error && error.message === "director_timeout"
          ? "timeout"
          : error instanceof Error &&
              error.message === "gateway_requested_fallback"
            ? "gateway_requested_fallback"
            : "invalid_or_unavailable_gateway_output";
      return this.fallback(context, reason);
    }
  }
}
