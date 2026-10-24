import { createHash } from "node:crypto";
import {
  SharedModelGateway,
  type ModelProviderAdapter,
} from "../../../packages/model-gateway/src/index.js";
import type {
  AccessibilityMode,
  DirectorContext,
  DirectorErrorCode,
  DirectorHint,
  DirectorHintResult,
  DirectorRole,
  DirectorTransport,
} from "./fixture-director-service.js";

export interface BoundedDirectorOptions {
  gateway?: SharedModelGateway<DirectorContext>;
  provider?: ModelProviderAdapter<DirectorContext>;
  allowlistedVariants?: Readonly<
    Record<string, Readonly<Record<number, readonly string[]>>>
  >;
  timeoutMs?: number;
  maxWordsPerHint?: number;
}

export interface BoundedDirectorHintResult extends DirectorHintResult {
  passed_model_gateway: true;
  state_mutation_blocked: true;
  latency_ms: number;
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

export const DEFAULT_AUTHORED_HINT_MAP: Readonly<
  Record<string, readonly string[]>
> = {
  lighthouse_alignment: [
    "Check the lens label, then compare its position with the book.",
    "Place the red lens cup on the left side of the archive book or pick the left-hand remote option.",
  ],
  raise_the_shield: [
    "Use an open palm held steady in frame or hold the remote gearbox control.",
    "Hold the gearbox shield button for 750 ms, or enable no-timing mode for a single press.",
  ],
  lens_archive_sequence: [
    "Start with the circle lens zone before placing the archive book in the square zone.",
    "Place the blue lens in zone_lens first, then place the book in zone_archive to complete the PowerGrid circuit.",
  ],
};

/**
 * Bounded LLM director service passing all model calls through `SharedModelGateway`
 * with coarse-only context, allowlisted hint variants, latency timeouts, and
 * deterministic pre-authored fallback (FR-RS-011, INT-RS-004, AC-RS-019).
 */
export class BoundedDirectorService {
  private readonly authoredHints: Readonly<Record<string, readonly string[]>>;
  private readonly allowlistedByPuzzleAndLevel = new Map<string, Set<string>>();
  private readonly modelGateway: SharedModelGateway<DirectorContext>;
  private readonly maxWords: number;

  constructor(
    authoredHints: Readonly<
      Record<string, readonly string[]>
    > = DEFAULT_AUTHORED_HINT_MAP,
    options: BoundedDirectorOptions = {},
  ) {
    const entries = Object.entries(authoredHints);
    if (entries.length === 0) {
      throw new Error("authored_hint_ladder_required");
    }
    this.maxWords = options.maxWordsPerHint ?? 45;
    if (
      !Number.isSafeInteger(this.maxWords) ||
      this.maxWords < 5 ||
      this.maxWords > 60
    ) {
      throw new Error("invalid_max_words_per_hint");
    }

    for (const [puzzleId, ladder] of entries) {
      if (
        !puzzleId.trim() ||
        ladder.length === 0 ||
        ladder.some(
          (hint) => wordCount(hint) < 5 || wordCount(hint) > this.maxWords,
        )
      ) {
        throw new Error("invalid_authored_hint_ladder");
      }
      ladder.forEach((hint, index) => {
        const key = `${puzzleId}:${index + 1}`;
        const set = new Set<string>([hint]);
        const extraVariants =
          options.allowlistedVariants?.[puzzleId]?.[index + 1] ?? [];
        for (const variant of extraVariants) {
          if (wordCount(variant) < 5 || wordCount(variant) > this.maxWords) {
            throw new Error("invalid_allowlisted_hint_variant");
          }
          set.add(variant);
        }
        this.allowlistedByPuzzleAndLevel.set(key, set);
      });
    }

    this.authoredHints = structuredClone(authoredHints);
    this.modelGateway =
      options.gateway ??
      new SharedModelGateway<DirectorContext>({
        ...(options.provider !== undefined
          ? { provider: options.provider }
          : {}),
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      });
  }

  private validateContext(input: unknown): DirectorContext {
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

  private fallbackResult(
    context: DirectorContext,
    reason: string,
    latencyMs = 0,
  ): BoundedDirectorHintResult {
    const text =
      this.authoredHints[context.puzzle_id]?.[context.hint_level - 1];
    if (!text) {
      throw new Error("authored_hint_not_found");
    }
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
      passed_model_gateway: true,
      state_mutation_blocked: true,
      latency_ms: latencyMs,
    };
  }

  private validateModelHint(
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
      wordCount(value.text) > this.maxWords ||
      value.hint_level !== context.hint_level ||
      typeof value.target_role !== "string" ||
      !ROLES.has(value.target_role as DirectorRole) ||
      typeof value.uses_fallback !== "boolean"
    ) {
      throw new Error("invalid_director_output");
    }
    if (value.uses_fallback) {
      throw new Error("gateway_requested_fallback");
    }
    const allowlisted = this.allowlistedByPuzzleAndLevel.get(
      `${context.puzzle_id}:${context.hint_level}`,
    );
    if (!allowlisted || !allowlisted.has(value.text)) {
      throw new Error("director_output_not_allowlisted");
    }
    return {
      text: value.text,
      hint_level: context.hint_level,
      target_role: value.target_role as DirectorRole,
      uses_fallback: false,
    };
  }

  async requestHint(input: unknown): Promise<BoundedDirectorHintResult> {
    const context = this.validateContext(input);
    const gatewayResult = await this.modelGateway.invokeDirectorHint(context);

    if (gatewayResult.status !== "ok") {
      return this.fallbackResult(
        context,
        gatewayResult.reason_code ?? "gateway_unavailable",
        gatewayResult.latency_ms,
      );
    }

    try {
      const validatedHint = this.validateModelHint(
        gatewayResult.output,
        context,
      );
      return {
        hint: validatedHint,
        source: "model",
        fallback_reason: null,
        state_mutated: false,
        raw_media_accepted: false,
        passed_model_gateway: true,
        state_mutation_blocked: true,
        latency_ms: gatewayResult.latency_ms,
      };
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "invalid_or_unavailable_gateway_output";
      return this.fallbackResult(context, reason, gatewayResult.latency_ms);
    }
  }

  /**
   * Deterministically selects a pre-authored dialogue variant using a seed and coarse context.
   * Never mutates puzzle graph nodes or timing predicates (SPEC.md Section 9.2).
   */
  selectDialogueVariant(
    nodeId: string,
    variants: readonly string[],
    seed: string,
  ): {
    node_id: string;
    selected_variant: string;
    variant_index: number;
    state_mutated: false;
  } {
    if (
      !nodeId.trim() ||
      !Array.isArray(variants) ||
      variants.length === 0 ||
      variants.some((v) => typeof v !== "string" || !v.trim()) ||
      !seed.trim()
    ) {
      throw new Error("invalid_dialogue_variant_selection");
    }
    const digest = createHash("sha256")
      .update(`${nodeId}:${seed}`, "utf8")
      .digest();
    const index = digest.readUInt32BE(0) % variants.length;
    return {
      node_id: nodeId,
      selected_variant: variants[index]!,
      variant_index: index,
      state_mutated: false,
    };
  }
}
