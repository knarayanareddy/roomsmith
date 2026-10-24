export interface ModelGatewayRequest<TContext = Record<string, unknown>> {
  operation: "director_hint.v1";
  prompt_version: string;
  model_id: string;
  context: TContext;
}

export interface ModelGatewayResult {
  status: "ok" | "rejected" | "timeout" | "provider_error";
  reason_code: string | null;
  output: unknown;
  latency_ms: number;
  state_mutation_attempted: boolean;
  state_mutation_blocked: true;
  media_egress_blocked: true;
}

export type ModelProviderAdapter<TContext = Record<string, unknown>> = (
  request: ModelGatewayRequest<TContext>,
) => unknown | Promise<unknown>;

export interface SharedModelGatewayOptions<TContext = Record<string, unknown>> {
  provider?: ModelProviderAdapter<TContext>;
  modelId?: string;
  promptVersion?: string;
  timeoutMs?: number;
}

const FORBIDDEN_MUTATION_KEYS = new Set([
  "advance_node",
  "commit_puzzle",
  "complete_puzzle",
  " execute_command",
  "function_call",
  "graph_mutation",
  "mutate_state",
  "override_predicate",
  "puzzle.complete",
  " puzzle_complete",
  "set_state",
  "state_mutation",
  "tool_calls",
  "tool_use",
]);

const FORBIDDEN_INPUT_KEYS = new Set([
  "audio",
  "audiobuffer",
  "base64",
  "emotion",
  "face",
  "frame",
  "framebuffer",
  "handlandmarks",
  "identity",
  "image",
  "imagedata",
  "landmarks",
  "media",
  "player_name",
  "rawframe",
  "room_image",
  "sdp",
  "video",
]);

const FORBIDDEN_BIOMETRIC_OR_MUTATION_TEXT = [
  /\bpuzzle\.complete\b/i,
  /\bmutate_state\b/i,
  /\boverride_predicate\b/i,
  /\byou\s+look\s+(?:sad|angry|happy|tired|young|old)\b/i,
  /\bfacial\s+expression\b/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsForbiddenKey(
  value: unknown,
  forbiddenSet: ReadonlySet<string>,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenKey(item, forbiddenSet));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    const normalized = key.toLowerCase().trim();
    const compact = normalized.replace(/[-_]/g, "");
    return (
      forbiddenSet.has(normalized) ||
      forbiddenSet.has(compact) ||
      containsForbiddenKey(item, forbiddenSet)
    );
  });
}

function containsForbiddenText(value: unknown): boolean {
  if (typeof value === "string") {
    return FORBIDDEN_BIOMETRIC_OR_MUTATION_TEXT.some((pattern) =>
      pattern.test(value),
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenText(item));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).some((item) => containsForbiddenText(item));
}

/**
 * Shared model gateway enforcing INT-RS-004:
 * validates coarse-only inputs, enforces bounded latency timeouts, and strips/rejects
 * any model output attempting tool calls, game state mutations, or biometric commentary.
 */
export class SharedModelGateway<TContext = Record<string, unknown>> {
  private readonly provider: ModelProviderAdapter<TContext> | undefined;
  private readonly modelId: string;
  private readonly promptVersion: string;
  private readonly timeoutMs: number;

  constructor(options: SharedModelGatewayOptions<TContext> = {}) {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > 2000)
    ) {
      throw new Error("invalid_gateway_timeout");
    }
    this.provider = options.provider;
    this.modelId = options.modelId ?? "anthropic.claude-3-haiku-fixture";
    this.promptVersion = options.promptVersion ?? "director_v1";
    this.timeoutMs = options.timeoutMs ?? 150;
  }

  async invokeDirectorHint(context: TContext): Promise<ModelGatewayResult> {
    if (containsForbiddenKey(context, FORBIDDEN_INPUT_KEYS)) {
      throw new Error("gateway_forbidden_input_field");
    }
    if (!this.provider) {
      return {
        status: "provider_error",
        reason_code: "gateway_disabled",
        output: null,
        latency_ms: 0,
        state_mutation_attempted: false,
        state_mutation_blocked: true,
        media_egress_blocked: true,
      };
    }

    const request: ModelGatewayRequest<TContext> = {
      operation: "director_hint.v1",
      prompt_version: this.promptVersion,
      model_id: this.modelId,
      context: structuredClone(context),
    };

    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = Promise.resolve().then(() => this.provider!(request));
    void operation.catch(() => undefined);

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("gateway_timeout")),
        this.timeoutMs,
      );
    });

    try {
      const output = await Promise.race([operation, timeout]);
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const mutationAttempted =
        containsForbiddenKey(output, FORBIDDEN_MUTATION_KEYS) ||
        containsForbiddenText(output);

      if (mutationAttempted) {
        return {
          status: "rejected",
          reason_code: "model_state_mutation_or_biometric_blocked",
          output: null,
          latency_ms: latencyMs,
          state_mutation_attempted: true,
          state_mutation_blocked: true,
          media_egress_blocked: true,
        };
      }

      return {
        status: "ok",
        reason_code: null,
        output,
        latency_ms: latencyMs,
        state_mutation_attempted: false,
        state_mutation_blocked: true,
        media_egress_blocked: true,
      };
    } catch (error) {
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const isTimeout =
        error instanceof Error && error.message === "gateway_timeout";
      return {
        status: isTimeout ? "timeout" : "provider_error",
        reason_code: isTimeout ? "timeout" : "provider_error",
        output: null,
        latency_ms: latencyMs,
        state_mutation_attempted: false,
        state_mutation_blocked: true,
        media_egress_blocked: true,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
