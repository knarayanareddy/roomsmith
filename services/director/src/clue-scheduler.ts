import {
  BoundedDirectorService,
  type BoundedDirectorHintResult,
} from "./director-service.js";
import type { DirectorErrorCode } from "./fixture-director-service.js";

/**
 * 3 minutes in milliseconds. Players stalling strictly longer than 3 minutes
 * (`> 180_000` ms) receive a progressive hint offer.
 */
export const DEFAULT_STALL_THRESHOLD_MS = 3 * 60 * 1000;

export interface ScheduledClueOffer {
  session_id: string;
  puzzle_id: string;
  hint_level: number;
  stalled_ms: number;
  triggered_at_ms: number;
  trigger_reason: "stall_timeout" | "manual_request";
  director_result: BoundedDirectorHintResult;
}

export interface PuzzleStallTrackerState {
  session_id: string;
  puzzle_id: string;
  episode_version: string;
  started_at_ms: number;
  last_activity_at_ms: number;
  accumulated_stall_ms: number;
  attempt_count: number;
  current_hint_level: number;
  max_hint_level: number;
  last_error: DirectorErrorCode;
  transport: "webrtc" | "cloud_relay";
  accessibility_mode: "standard" | "no_timing" | "reduced_motion";
  paused: boolean;
  completed: boolean;
  offered_clues: ScheduledClueOffer[];
}

export interface StartPuzzleTimerInput {
  session_id: string;
  puzzle_id: string;
  episode_version?: string;
  now_ms: number;
  max_hint_level?: number;
  initial_attempt_count?: number;
  initial_hint_level?: number;
  transport?: "webrtc" | "cloud_relay";
  accessibility_mode?: "standard" | "no_timing" | "reduced_motion";
}

export interface ClueEvaluationResult {
  triggered: boolean;
  reason:
    | "offered_progressive_hint"
    | "below_stall_threshold"
    | "puzzle_paused"
    | "puzzle_completed"
    | "max_hint_level_reached";
  puzzle_id: string;
  stalled_ms: number;
  current_hint_level: number;
  next_hint_in_ms: number | null;
  offer: ScheduledClueOffer | null;
}

export interface AdaptiveClueSchedulerOptions {
  director?: BoundedDirectorService;
  stallThresholdMs?: number;
  onClueOffered?: (offer: ScheduledClueOffer) => void;
}

/**
 * Automated adaptive clue timer & hint orchestrator (`FR-RS-009`, `FR-RS-010`,
 * `INT-RS-004`, `AC-RS-014`).
 *
 * Monitors active puzzle sessions and offers progressive hints via
 * `BoundedDirectorService` when players stall for >3 minutes (`> 180_000` ms).
 */
export class AdaptiveClueScheduler {
  private readonly director: BoundedDirectorService;
  private readonly stallThresholdMs: number;
  private readonly onClueOffered:
    | ((offer: ScheduledClueOffer) => void)
    | undefined;
  private readonly trackers = new Map<string, PuzzleStallTrackerState>();
  private pollIntervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(options: AdaptiveClueSchedulerOptions = {}) {
    this.director = options.director ?? new BoundedDirectorService();
    this.stallThresholdMs =
      options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
    if (
      !Number.isSafeInteger(this.stallThresholdMs) ||
      this.stallThresholdMs < 1_000
    ) {
      throw new Error("invalid_stall_threshold_ms");
    }
    this.onClueOffered = options.onClueOffered;
  }

  startPuzzleTimer(input: StartPuzzleTimerInput): PuzzleStallTrackerState {
    if (!input.session_id.trim() || !input.puzzle_id.trim()) {
      throw new Error("invalid_puzzle_timer_identifiers");
    }
    if (!Number.isSafeInteger(input.now_ms) || input.now_ms < 0) {
      throw new Error("invalid_timer_timestamp");
    }
    const maxHintLevel = input.max_hint_level ?? 2;
    if (!Number.isSafeInteger(maxHintLevel) || maxHintLevel < 1) {
      throw new Error("invalid_max_hint_level");
    }

    const state: PuzzleStallTrackerState = {
      session_id: input.session_id,
      puzzle_id: input.puzzle_id,
      episode_version: input.episode_version ?? "1.0.0",
      started_at_ms: input.now_ms,
      last_activity_at_ms: input.now_ms,
      accumulated_stall_ms: 0,
      attempt_count: Math.max(0, input.initial_attempt_count ?? 0),
      current_hint_level: Math.max(
        0,
        Math.min(maxHintLevel, input.initial_hint_level ?? 0),
      ),
      max_hint_level: maxHintLevel,
      last_error: "none",
      transport: input.transport ?? "webrtc",
      accessibility_mode: input.accessibility_mode ?? "standard",
      paused: false,
      completed: false,
      offered_clues: [],
    };
    this.trackers.set(input.puzzle_id, state);
    return structuredClone(state);
  }

  getTrackerState(puzzleId: string): PuzzleStallTrackerState | null {
    const tracker = this.trackers.get(puzzleId);
    return tracker ? structuredClone(tracker) : null;
  }

  recordPlayerActivity(input: {
    puzzle_id: string;
    at_ms: number;
    attempt_failed?: boolean;
    last_error?: DirectorErrorCode;
    reset_stall_clock?: boolean;
  }): PuzzleStallTrackerState {
    const tracker = this.requireTracker(input.puzzle_id);
    if (!Number.isSafeInteger(input.at_ms) || input.at_ms < 0) {
      throw new Error("invalid_timer_timestamp");
    }

    if (input.attempt_failed) {
      tracker.attempt_count += 1;
    }
    if (input.last_error) {
      tracker.last_error = input.last_error;
    }

    if (input.reset_stall_clock) {
      tracker.accumulated_stall_ms = 0;
      tracker.last_activity_at_ms = input.at_ms;
    } else if (!tracker.paused && input.at_ms > tracker.last_activity_at_ms) {
      tracker.accumulated_stall_ms += input.at_ms - tracker.last_activity_at_ms;
      tracker.last_activity_at_ms = input.at_ms;
    }

    return structuredClone(tracker);
  }

  pauseTimer(puzzleId: string, atMs: number): PuzzleStallTrackerState {
    const tracker = this.requireTracker(puzzleId);
    if (!Number.isSafeInteger(atMs) || atMs < 0) {
      throw new Error("invalid_timer_timestamp");
    }
    if (!tracker.paused) {
      if (atMs > tracker.last_activity_at_ms) {
        tracker.accumulated_stall_ms += atMs - tracker.last_activity_at_ms;
      }
      tracker.last_activity_at_ms = atMs;
      tracker.paused = true;
    }
    return structuredClone(tracker);
  }

  resumeTimer(puzzleId: string, atMs: number): PuzzleStallTrackerState {
    const tracker = this.requireTracker(puzzleId);
    if (!Number.isSafeInteger(atMs) || atMs < 0) {
      throw new Error("invalid_timer_timestamp");
    }
    if (tracker.paused) {
      tracker.last_activity_at_ms = atMs;
      tracker.paused = false;
    }
    return structuredClone(tracker);
  }

  markPuzzleCompleted(
    puzzleId: string,
    atMs?: number,
  ): PuzzleStallTrackerState {
    const tracker = this.requireTracker(puzzleId);
    if (
      atMs !== undefined &&
      !tracker.paused &&
      atMs > tracker.last_activity_at_ms
    ) {
      tracker.accumulated_stall_ms += atMs - tracker.last_activity_at_ms;
      tracker.last_activity_at_ms = atMs;
    }
    tracker.completed = true;
    tracker.paused = true;
    return structuredClone(tracker);
  }

  /**
   * Evaluates whether the player has stalled for >3 minutes (`> stallThresholdMs`)
   * on the given puzzle and, if so, offers the next progressive hint level.
   */
  async evaluateStall(input: {
    puzzle_id: string;
    now_ms: number;
  }): Promise<ClueEvaluationResult> {
    const tracker = this.requireTracker(input.puzzle_id);
    if (!Number.isSafeInteger(input.now_ms) || input.now_ms < 0) {
      throw new Error("invalid_timer_timestamp");
    }

    const activeDelta = tracker.paused
      ? 0
      : Math.max(0, input.now_ms - tracker.last_activity_at_ms);
    const stalledMs = tracker.accumulated_stall_ms + activeDelta;

    if (tracker.completed) {
      return {
        triggered: false,
        reason: "puzzle_completed",
        puzzle_id: tracker.puzzle_id,
        stalled_ms: stalledMs,
        current_hint_level: tracker.current_hint_level,
        next_hint_in_ms: null,
        offer: null,
      };
    }

    if (tracker.paused) {
      return {
        triggered: false,
        reason: "puzzle_paused",
        puzzle_id: tracker.puzzle_id,
        stalled_ms: stalledMs,
        current_hint_level: tracker.current_hint_level,
        next_hint_in_ms: null,
        offer: null,
      };
    }

    if (tracker.current_hint_level >= tracker.max_hint_level) {
      return {
        triggered: false,
        reason: "max_hint_level_reached",
        puzzle_id: tracker.puzzle_id,
        stalled_ms: stalledMs,
        current_hint_level: tracker.current_hint_level,
        next_hint_in_ms: null,
        offer: null,
      };
    }

    // Must stall strictly longer than 3 minutes (> 180_000 ms)
    if (stalledMs <= this.stallThresholdMs) {
      return {
        triggered: false,
        reason: "below_stall_threshold",
        puzzle_id: tracker.puzzle_id,
        stalled_ms: stalledMs,
        current_hint_level: tracker.current_hint_level,
        next_hint_in_ms: this.stallThresholdMs - stalledMs + 1,
        offer: null,
      };
    }

    const nextHintLevel = Math.min(
      tracker.max_hint_level,
      tracker.current_hint_level + 1,
    );
    const directorResult = await this.director.requestHint({
      episode_version: tracker.episode_version,
      puzzle_id: tracker.puzzle_id,
      attempt_count: tracker.attempt_count,
      hint_level: nextHintLevel,
      last_error: tracker.last_error,
      transport: tracker.transport,
      accessibility_mode: tracker.accessibility_mode,
    });

    tracker.current_hint_level = nextHintLevel;
    tracker.accumulated_stall_ms = 0;
    tracker.last_activity_at_ms = input.now_ms;

    const offer: ScheduledClueOffer = {
      session_id: tracker.session_id,
      puzzle_id: tracker.puzzle_id,
      hint_level: nextHintLevel,
      stalled_ms: stalledMs,
      triggered_at_ms: input.now_ms,
      trigger_reason: "stall_timeout",
      director_result: directorResult,
    };
    tracker.offered_clues.push(offer);
    this.onClueOffered?.(structuredClone(offer));

    return {
      triggered: true,
      reason: "offered_progressive_hint",
      puzzle_id: tracker.puzzle_id,
      stalled_ms: stalledMs,
      current_hint_level: tracker.current_hint_level,
      next_hint_in_ms:
        tracker.current_hint_level < tracker.max_hint_level
          ? this.stallThresholdMs + 1
          : null,
      offer: structuredClone(offer),
    };
  }

  /**
   * Handles an explicit player hint request and resets the stall window.
   */
  async requestManualHint(input: {
    puzzle_id: string;
    now_ms: number;
    last_error?: DirectorErrorCode;
  }): Promise<ClueEvaluationResult> {
    const tracker = this.requireTracker(input.puzzle_id);
    if (tracker.completed) {
      return {
        triggered: false,
        reason: "puzzle_completed",
        puzzle_id: tracker.puzzle_id,
        stalled_ms: tracker.accumulated_stall_ms,
        current_hint_level: tracker.current_hint_level,
        next_hint_in_ms: null,
        offer: null,
      };
    }

    if (input.last_error) {
      tracker.last_error = input.last_error;
    }

    const activeDelta = tracker.paused
      ? 0
      : Math.max(0, input.now_ms - tracker.last_activity_at_ms);
    const stalledMs = tracker.accumulated_stall_ms + activeDelta;
    const nextHintLevel = Math.min(
      tracker.max_hint_level,
      tracker.current_hint_level + 1,
    );

    const directorResult = await this.director.requestHint({
      episode_version: tracker.episode_version,
      puzzle_id: tracker.puzzle_id,
      attempt_count: tracker.attempt_count,
      hint_level: nextHintLevel,
      last_error: tracker.last_error,
      transport: tracker.transport,
      accessibility_mode: tracker.accessibility_mode,
    });

    tracker.current_hint_level = nextHintLevel;
    tracker.accumulated_stall_ms = 0;
    tracker.last_activity_at_ms = input.now_ms;

    const offer: ScheduledClueOffer = {
      session_id: tracker.session_id,
      puzzle_id: tracker.puzzle_id,
      hint_level: nextHintLevel,
      stalled_ms: stalledMs,
      triggered_at_ms: input.now_ms,
      trigger_reason: "manual_request",
      director_result: directorResult,
    };
    tracker.offered_clues.push(offer);
    this.onClueOffered?.(structuredClone(offer));

    return {
      triggered: true,
      reason: "offered_progressive_hint",
      puzzle_id: tracker.puzzle_id,
      stalled_ms: stalledMs,
      current_hint_level: tracker.current_hint_level,
      next_hint_in_ms:
        tracker.current_hint_level < tracker.max_hint_level
          ? this.stallThresholdMs + 1
          : null,
      offer: structuredClone(offer),
    };
  }

  /**
   * Evaluates all tracked active puzzles at `nowMs`.
   */
  async tickAll(nowMs = Date.now()): Promise<ClueEvaluationResult[]> {
    const results: ClueEvaluationResult[] = [];
    for (const puzzleId of this.trackers.keys()) {
      results.push(
        await this.evaluateStall({ puzzle_id: puzzleId, now_ms: nowMs }),
      );
    }
    return results;
  }

  startAutoPolling(intervalMs = 5_000, clock: () => number = Date.now): void {
    this.stopAutoPolling();
    this.pollIntervalHandle = setInterval(() => {
      void this.tickAll(clock());
    }, intervalMs);
  }

  stopAutoPolling(): void {
    if (this.pollIntervalHandle !== null) {
      clearInterval(this.pollIntervalHandle);
      this.pollIntervalHandle = null;
    }
  }

  private requireTracker(puzzleId: string): PuzzleStallTrackerState {
    const tracker = this.trackers.get(puzzleId);
    if (!tracker) {
      throw new Error(`puzzle_timer_not_started:${puzzleId}`);
    }
    return tracker;
  }
}

export { AdaptiveClueScheduler as ClueTimerOrchestrator };
