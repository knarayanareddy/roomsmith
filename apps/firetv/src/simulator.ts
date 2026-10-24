import {
  evaluateMatCalibration,
  validatePhysicalObjectRelation,
  type HandLandmarkPoint,
  type MatCalibrationInput,
  type NormalizedBoundingBox,
} from "../../../packages/perception/src/index.js";
import {
  BoundedDirectorService,
  type BoundedDirectorHintResult,
  type DirectorErrorCode,
} from "../../../services/director/src/index.js";
import {
  PlayerSessionConfigurationService,
  type PlayerRole,
  type SessionAccessibilitySettings,
} from "../../../services/pairing/src/index.js";

export type WireframeScreenId =
  | "lobby"
  | "room"
  | "puzzle"
  | "verification"
  | "completion";

export type SimulatorPuzzleKey = "lighthouse" | "gearbox" | "powergrid";

export type CanonicalPuzzleId =
  | "lighthouse_alignment"
  | "raise_the_shield"
  | "lens_archive_sequence";

export interface SimulatorPuzzleDefinition {
  key: SimulatorPuzzleKey;
  puzzle_id: CanonicalPuzzleId;
  title: string;
  station_name: string;
  clue_title: string;
  clue_text: string;
  instruction: string;
  hold_ms: number;
  fallback_interaction:
    | "remote_single_choice"
    | "remote_hold"
    | "remote_sequence";
  fallback_prompt: string;
  fallback_options: ReadonlyArray<{
    option_id: string;
    label: string;
  }>;
  correct_option_ids: readonly string[];
  authored_hints: readonly string[];
}

export interface UncertainSymbolCandidate {
  candidate_id: string;
  label: string;
  confidence: number;
  note: string;
}

export interface CompletedSimulatorPuzzle {
  key: SimulatorPuzzleKey;
  puzzle_id: CanonicalPuzzleId;
  path: "camera" | "remote";
  committed_sequence: number;
  completed_at_ms: number;
}

export interface SimulatorCaseReport {
  episode_id: string;
  content_version: string;
  completed_puzzles: CompletedSimulatorPuzzle[];
  hints_used: Record<CanonicalPuzzleId, number>;
  elapsed_active_time_ms: number;
  room_media_included: false;
}

export interface SimulatorStateSnapshot {
  session_id: string;
  episode_id: string;
  content_version: string;
  active_screen: WireframeScreenId;
  player_count: number;
  solo_path: boolean;
  roles: PlayerRole[];
  selected_object_kit: string[];
  accessibility: SessionAccessibilitySettings;
  pairing_code: string | null;
  companion_connected: boolean;
  calibration_valid: boolean;
  calibration_guidance: string;
  clues_collected: string[];
  current_puzzle_index: number;
  current_puzzle: SimulatorPuzzleDefinition | null;
  state_sequence: number;
  attempt_counts: Record<CanonicalPuzzleId, number>;
  hints_used: Record<CanonicalPuzzleId, number>;
  last_hint_text: string | null;
  last_guidance: string | null;
  sequence_step: number;
  sequence_started_at_ms: number | null;
  hold_progress_ms: number;
  manual_symbols: string[];
  uncertain_candidates: UncertainSymbolCandidate[];
  selected_candidate_id: string | null;
  completed_puzzles: CompletedSimulatorPuzzle[];
  signal_restored: boolean;
  elapsed_active_time_ms: number;
}

export const SIMULATOR_PUZZLES: ReadonlyArray<SimulatorPuzzleDefinition> = [
  {
    key: "lighthouse",
    puzzle_id: "lighthouse_alignment",
    title: "Lighthouse Beam Alignment",
    station_name: "Lighthouse Lantern Lens",
    clue_title: "Keeper's Log · 17 October",
    clue_text:
      "Begin with the mark that points home. Align the red lens to the left of the archive book and hold it steady—or enter the three lighthouse signal symbols.",
    instruction:
      "Place the cup labeled red lens to the left of the archive book and hold still for 1,000 ms.",
    hold_ms: 1000,
    fallback_interaction: "remote_single_choice",
    fallback_prompt:
      "Which arrangement places the red lens to the left of the archive book?",
    fallback_options: [
      {
        option_id: "option_red_left",
        label: "Red lens on the left, archive book on the right",
      },
      {
        option_id: "option_red_right",
        label: "Archive book on the left, red lens on the right",
      },
    ],
    correct_option_ids: ["option_red_left"],
    authored_hints: [
      "Check the lens label, then compare its position with the book.",
      "Place the red lens cup on the left side of the archive book or pick the left-hand remote option.",
    ],
  },
  {
    key: "gearbox",
    puzzle_id: "raise_the_shield",
    title: "Gearbox & Storm Shield Signal",
    station_name: "Brass Gearbox & Storm Shutter",
    clue_title: "Navigator's Brass Compass",
    clue_text:
      "When the gale strikes the lantern housing, engage the brass gearbox by holding an open-palm signal for 750 ms—or hold the remote gearbox lever.",
    instruction:
      "Raise an open palm comfortably in frame for 750 ms, or hold the remote gearbox shield control.",
    hold_ms: 750,
    fallback_interaction: "remote_hold",
    fallback_prompt:
      "Hold the gearbox shield control for 750 ms, or select it once in no-timing mode.",
    fallback_options: [
      {
        option_id: "option_shield",
        label: "Engage brass gearbox & raise storm shield",
      },
    ],
    correct_option_ids: ["option_shield"],
    authored_hints: [
      "Use an open palm held steady in frame or hold the remote gearbox control.",
      "Hold the gearbox shield button for 750 ms, or enable no-timing mode for a single press.",
    ],
  },
  {
    key: "powergrid",
    puzzle_id: "lens_archive_sequence",
    title: "PowerGrid & Archive Conduit Sequence",
    station_name: "Auxiliary PowerGrid & Archive Table",
    clue_title: "Engineer's PowerGrid Schematic",
    clue_text:
      "Route auxiliary power in strict order: energize the circle lens conduit with the blue lens first, then ground the archive book in the square zone within 30 seconds.",
    instruction:
      "Place the blue lens in the circle zone (500 ms), then place the archive book in the square zone (500 ms) within 30 seconds.",
    hold_ms: 500,
    fallback_interaction: "remote_sequence",
    fallback_prompt:
      "Which conduit action order restores the final PowerGrid beam?",
    fallback_options: [
      {
        option_id: "option_lens_then_archive",
        label:
          "1. Blue lens in Circle Zone → 2. Archive book in Square Archived Zone",
      },
      {
        option_id: "option_archive_then_lens",
        label: "1. Archive book in Square Zone → 2. Blue lens in Circle Zone",
      },
    ],
    correct_option_ids: ["option_lens_then_archive"],
    authored_hints: [
      "Start with the circle lens zone before placing the archive book in the square zone.",
      "Place the blue lens in zone_lens first, then place the book in zone_archive to complete the PowerGrid circuit.",
    ],
  },
];

const DEFAULT_UNCERTAIN_CANDIDATES: ReadonlyArray<UncertainSymbolCandidate> = [
  {
    candidate_id: "north_star",
    label: "North star",
    confidence: 0.61,
    note: "Candidate 1 · below automatic-accept threshold (0.70)",
  },
  {
    candidate_id: "compass_rose",
    label: "Compass rose",
    confidence: 0.42,
    note: "Candidate 2 · different silhouette",
  },
];

const AUTHORED_HINT_MAP: Readonly<Record<string, readonly string[]>> = {
  lighthouse_alignment: SIMULATOR_PUZZLES[0]!.authored_hints,
  raise_the_shield: SIMULATOR_PUZZLES[1]!.authored_hints,
  lens_archive_sequence: SIMULATOR_PUZZLES[2]!.authored_hints,
};

function makeValidOpenPalmLandmarks(): HandLandmarkPoint[] {
  const pts: HandLandmarkPoint[] = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.8,
  }));
  pts[0] = { x: 0.5, y: 0.8 };
  const pairs: ReadonlyArray<[number, number, number]> = [
    [4, 2, 0.25],
    [8, 6, 0.38],
    [12, 10, 0.5],
    [16, 14, 0.62],
    [20, 18, 0.74],
  ];
  for (const [tip, pip, x] of pairs) {
    pts[pip] = { x, y: 0.55 };
    pts[tip] = { x, y: 0.2 };
  }
  return pts;
}

/**
 * Browser-compatible Fire TV Escape Room simulator coordinating the 5 wireframe
 * screens (`#lobby`, `#room`, `#puzzle`, `#verification`, `#completion`) and
 * the 3 deterministic puzzles (`lighthouse`, `gearbox`, `powergrid`).
 */
export class FireTvWebSimulator {
  private readonly configService = new PlayerSessionConfigurationService();
  private readonly director: BoundedDirectorService;

  private sessionId = "RS-DEMO-24";
  private readonly episodeId = "01000000000000000000000001";
  private readonly contentVersion = "1.0.0";
  private activeScreen: WireframeScreenId = "lobby";
  private playerCount = 2;
  private soloPath = false;
  private roles: PlayerRole[] = ["navigator", "observer"];
  private selectedObjectKit: string[] = ["red_cup", "blue_cup", "book"];
  private accessibility: SessionAccessibilitySettings = {
    no_timing_mode: false,
    reduced_motion: false,
    captions: true,
    remote_only: false,
    larger_text: false,
  };
  private pairingCode: string | null = "B7R2K9";
  private companionConnected = true;
  private calibrationInput: MatCalibrationInput = {
    detected_marker_ids: [0, 1, 2, 3],
    reprojection_error_px: 2.1,
    normalized_mat_area: 0.52,
    glare_score: 0.12,
    blur_score: 0.1,
    selected_object_kit: ["red_cup", "blue_cup", "book"],
    required_objects: ["red_cup", "blue_cup", "book"],
  };
  private cluesCollected = new Set<string>(["Keeper's logbook"]);
  private stateSequence = 0;
  private attemptCounts: Record<CanonicalPuzzleId, number> = {
    lighthouse_alignment: 0,
    raise_the_shield: 0,
    lens_archive_sequence: 0,
  };
  private hintsUsed: Record<CanonicalPuzzleId, number> = {
    lighthouse_alignment: 0,
    raise_the_shield: 0,
    lens_archive_sequence: 0,
  };
  private lastHintText: string | null = null;
  private lastGuidance: string | null = null;
  private sequenceStep = 0;
  private sequenceStartedAtMs: number | null = null;
  private holdStartedAtMs: number | null = null;
  private holdProgressMs = 0;
  private manualSymbols: string[] = [];
  private selectedCandidateId: string | null = "north_star";
  private completedPuzzles: CompletedSimulatorPuzzle[] = [];
  private elapsedActiveTimeMs = 0;

  constructor(director?: BoundedDirectorService) {
    this.director = director ?? new BoundedDirectorService(AUTHORED_HINT_MAP);
  }

  configureLobby(input: {
    player_count: number;
    selected_object_kit: string[];
    accessibility: SessionAccessibilitySettings;
    adult_supervision_confirmed: boolean;
    privacy_notice_acknowledged: boolean;
  }): SimulatorStateSnapshot {
    const validated = this.configService.configureSession({
      episode_id: this.episodeId,
      content_version: this.contentVersion,
      player_count: input.player_count,
      selected_object_kit: input.selected_object_kit,
      accessibility: input.accessibility,
      adult_supervision_confirmed: input.adult_supervision_confirmed,
      privacy_notice_acknowledged: input.privacy_notice_acknowledged,
    });

    this.sessionId = validated.session.session_id;
    this.playerCount = validated.session.player_count;
    this.soloPath = validated.solo_path;
    this.roles = validated.roles;
    this.selectedObjectKit = [...validated.session.selected_object_kit];
    this.accessibility = structuredClone(validated.session.accessibility);
    this.pairingCode = validated.session.pairing?.pairing_code ?? null;
    this.companionConnected = !this.accessibility.remote_only;
    this.calibrationInput = {
      ...this.calibrationInput,
      selected_object_kit: [...this.selectedObjectKit],
    };
    return this.getState();
  }

  regeneratePairingCode(): SimulatorStateSnapshot {
    if (this.accessibility.remote_only) {
      this.pairingCode = null;
      return this.getState();
    }
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let next = "";
    for (let i = 0; i < 6; i += 1) {
      next += chars[(this.stateSequence + i * 7 + Date.now()) % chars.length];
    }
    this.pairingCode = next;
    this.lastGuidance =
      "New pairing code issued. Already connected players remain in the session.";
    return this.getState();
  }

  navigateTo(screen: WireframeScreenId): SimulatorStateSnapshot {
    if (screen === "completion" && this.completedPuzzles.length < 3) {
      throw new Error("completion_requires_all_puzzles_solved");
    }
    this.activeScreen = screen;
    return this.getState();
  }

  inspectObject(objectName: string): SimulatorStateSnapshot {
    if (objectName.trim()) {
      this.cluesCollected.add(objectName.trim());
      this.lastGuidance = `Inspected ${objectName.trim()}: clue added to journal.`;
    }
    return this.getState();
  }

  setMatCalibration(
    partial: Partial<MatCalibrationInput>,
  ): SimulatorStateSnapshot {
    this.calibrationInput = {
      ...this.calibrationInput,
      ...partial,
    };
    const assessment = evaluateMatCalibration(this.calibrationInput);
    if (!assessment.calibration_valid) {
      this.holdStartedAtMs = null;
      this.holdProgressMs = 0;
      this.lastGuidance = assessment.tv_guidance;
    } else {
      this.lastGuidance = assessment.tv_guidance;
    }
    return this.getState();
  }

  private currentPuzzleDef(): SimulatorPuzzleDefinition | null {
    const solvedIds = new Set(this.completedPuzzles.map((p) => p.puzzle_id));
    return (
      SIMULATOR_PUZZLES.find((puzzle) => !solvedIds.has(puzzle.puzzle_id)) ??
      null
    );
  }

  private commitCurrentPuzzle(
    puzzle: SimulatorPuzzleDefinition,
    path: "camera" | "remote",
    atMs: number,
  ): void {
    this.stateSequence += 1;
    this.completedPuzzles.push({
      key: puzzle.key,
      puzzle_id: puzzle.puzzle_id,
      path,
      committed_sequence: this.stateSequence,
      completed_at_ms: atMs,
    });
    this.holdStartedAtMs = null;
    this.holdProgressMs = 0;
    this.sequenceStep = 0;
    this.sequenceStartedAtMs = null;
    this.manualSymbols = [];
    this.lastGuidance = `${puzzle.title} solved via ${path}.`;
    if (this.completedPuzzles.length === SIMULATOR_PUZZLES.length) {
      this.activeScreen = "completion";
    }
  }

  /**
   * Evaluates physical PlayMat observations for the active puzzle
   * (`lighthouse`, `gearbox`, or `powergrid`).
   */
  submitPhysicalObservation(input: {
    puzzle_key?: SimulatorPuzzleKey;
    step?: 1 | 2;
    subject?: string;
    predicate?: string;
    target?: string | null;
    confidence?: number;
    subject_color?: "red" | "blue" | "unknown" | "neutral";
    subject_box?: NormalizedBoundingBox;
    target_box?: NormalizedBoundingBox;
    duration_ms: number;
    at_ms?: number;
  }): SimulatorStateSnapshot {
    const current = this.currentPuzzleDef();
    if (!current) return this.getState();
    if (input.puzzle_key && input.puzzle_key !== current.key) {
      throw new Error("puzzle_not_active_step");
    }

    const atMs =
      input.at_ms ?? this.elapsedActiveTimeMs + Math.max(0, input.duration_ms);
    this.elapsedActiveTimeMs = Math.max(this.elapsedActiveTimeMs, atMs);

    if (current.key === "lighthouse") {
      const relation = validatePhysicalObjectRelation({
        calibration: this.calibrationInput,
        subject: input.subject ?? "red_cup",
        predicate: input.predicate ?? "left_of",
        target: input.target !== undefined ? input.target : "book",
        subject_confidence: input.confidence ?? 0.92,
        target_confidence: input.confidence ?? 0.9,
        min_confidence: 0.7,
        subject_color: input.subject_color ?? "red",
        subject_box: input.subject_box ?? {
          x: 0.14,
          y: 0.4,
          width: 0.12,
          height: 0.15,
        },
        target_box: input.target_box ?? {
          x: 0.52,
          y: 0.35,
          width: 0.2,
          height: 0.25,
        },
        normalized_margin: 0.05,
      });

      if (!relation.eligible) {
        this.attemptCounts.lighthouse_alignment += 1;
        this.holdProgressMs = 0;
        this.lastGuidance = relation.tv_guidance;
        return this.getState();
      }

      this.holdProgressMs += Math.max(0, input.duration_ms);
      if (this.holdProgressMs >= current.hold_ms) {
        this.commitCurrentPuzzle(current, "camera", atMs);
      } else {
        this.lastGuidance = `Hold still… alignment verified (${this.holdProgressMs}/${current.hold_ms} ms).`;
      }
      return this.getState();
    }

    if (current.key === "gearbox") {
      const palmConf = input.confidence ?? 0.92;
      const relation = validatePhysicalObjectRelation({
        calibration: this.calibrationInput,
        subject: input.subject ?? "hand",
        predicate: input.predicate ?? "open_palm",
        target: null,
        subject_confidence: palmConf,
        min_confidence: 0.75,
        hand_landmarks: palmConf >= 0.75 ? makeValidOpenPalmLandmarks() : [],
      });

      if (!relation.eligible) {
        this.attemptCounts.raise_the_shield += 1;
        this.holdProgressMs = 0;
        this.lastGuidance = relation.tv_guidance;
        return this.getState();
      }

      this.holdProgressMs += Math.max(0, input.duration_ms);
      if (this.holdProgressMs >= current.hold_ms) {
        this.commitCurrentPuzzle(current, "camera", atMs);
      } else {
        this.lastGuidance = `Hold open palm… gearbox engaging (${this.holdProgressMs}/${current.hold_ms} ms).`;
      }
      return this.getState();
    }

    // PowerGrid (`lens_archive_sequence`)
    const stepRequested = input.step ?? (this.sequenceStep === 0 ? 1 : 2);
    if (this.sequenceStep === 0 && stepRequested === 2) {
      this.attemptCounts.lens_archive_sequence += 1;
      this.holdProgressMs = 0;
      this.lastGuidance =
        "Start with step 1: place the blue lens in the circle lens zone before archiving the book.";
      return this.getState();
    }

    const isStep1 = this.sequenceStep === 0;
    const relation = validatePhysicalObjectRelation({
      calibration: this.calibrationInput,
      subject: input.subject ?? (isStep1 ? "blue_cup" : "book"),
      predicate: input.predicate ?? "inside_zone",
      target:
        input.target !== undefined
          ? input.target
          : isStep1
            ? "zone_lens"
            : "zone_archive",
      subject_confidence: input.confidence ?? 0.9,
      min_confidence: 0.7,
      subject_color: input.subject_color ?? (isStep1 ? "blue" : "neutral"),
      subject_box: input.subject_box ?? {
        x: 0.12,
        y: 0.12,
        width: 0.15,
        height: 0.15,
      },
      target_box: input.target_box ?? {
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.3,
      },
      minimum_overlap: 0.6,
    });

    if (!relation.eligible) {
      this.attemptCounts.lens_archive_sequence += 1;
      this.holdProgressMs = 0;
      this.lastGuidance = relation.tv_guidance;
      return this.getState();
    }

    if (
      !isStep1 &&
      !this.accessibility.no_timing_mode &&
      this.sequenceStartedAtMs !== null &&
      atMs - this.sequenceStartedAtMs > 30_000
    ) {
      this.sequenceStep = 0;
      this.sequenceStartedAtMs = null;
      this.holdProgressMs = 0;
      this.lastGuidance =
        "PowerGrid sequence window (30s) elapsed. Start again with the blue lens in the circle zone, or enable No-Timing Mode.";
      return this.getState();
    }

    this.holdProgressMs += Math.max(0, input.duration_ms);
    if (this.holdProgressMs < current.hold_ms) {
      this.lastGuidance = `Hold step ${isStep1 ? 1 : 2} (${this.holdProgressMs}/${current.hold_ms} ms)…`;
      return this.getState();
    }

    if (isStep1) {
      this.sequenceStep = 1;
      this.sequenceStartedAtMs = atMs;
      this.holdProgressMs = 0;
      this.lastGuidance =
        "Step 1 locked (blue lens in circle zone). Now place the archive book in the square zone.";
      return this.getState();
    }

    this.commitCurrentPuzzle(current, "camera", atMs);
    return this.getState();
  }

  /**
   * Accessible remote fallback submission for the active puzzle.
   */
  submitRemoteFallback(input: {
    option_id: string;
    hold_duration_ms?: number;
    at_ms?: number;
  }): SimulatorStateSnapshot {
    const current = this.currentPuzzleDef();
    if (!current) return this.getState();
    const atMs = input.at_ms ?? this.elapsedActiveTimeMs + 250;
    this.elapsedActiveTimeMs = Math.max(this.elapsedActiveTimeMs, atMs);

    const isCorrect = current.correct_option_ids.includes(input.option_id);
    if (!isCorrect) {
      this.attemptCounts[current.puzzle_id] += 1;
      this.holdProgressMs = 0;
      this.lastGuidance =
        "That arrangement did not restore the mechanism. Re-read the clue and try again.";
      return this.getState();
    }

    if (
      current.fallback_interaction === "remote_hold" &&
      !this.accessibility.no_timing_mode
    ) {
      const held = input.hold_duration_ms ?? 0;
      this.holdProgressMs += Math.max(0, held);
      if (this.holdProgressMs < current.hold_ms) {
        this.lastGuidance = `Keep holding the remote shield control (${this.holdProgressMs}/${current.hold_ms} ms)…`;
        return this.getState();
      }
    }

    this.commitCurrentPuzzle(current, "remote", atMs);
    return this.getState();
  }

  /**
   * Symbol sequence pad from `ui/WIREFRAMES.md` Screen 03 (`#puzzle`).
   */
  chooseSymbol(
    symbolId: "north_star" | "open_sea" | "safe_harbor",
  ): SimulatorStateSnapshot {
    if (this.manualSymbols.length < 3) {
      this.manualSymbols.push(symbolId);
    }
    return this.getState();
  }

  resetSymbols(): SimulatorStateSnapshot {
    this.manualSymbols = [];
    this.lastGuidance = "Manual symbol sequence cleared.";
    return this.getState();
  }

  submitSymbolSequence(atMs?: number): SimulatorStateSnapshot {
    const current = this.currentPuzzleDef();
    if (!current) return this.getState();
    if (this.manualSymbols.length < 3) {
      this.lastGuidance = "Choose all three symbols before submitting.";
      return this.getState();
    }
    const targetOrder = ["north_star", "open_sea", "safe_harbor"];
    const matches =
      this.manualSymbols.length === 3 &&
      this.manualSymbols.every((val, idx) => val === targetOrder[idx]);
    if (!matches) {
      this.attemptCounts[current.puzzle_id] += 1;
      this.lastGuidance =
        "Symbol sequence did not match the Keeper's logbook. Reset or inspect the clue.";
      return this.getState();
    }
    this.commitCurrentPuzzle(
      current,
      "remote",
      atMs ?? this.elapsedActiveTimeMs + 300,
    );
    return this.getState();
  }

  /**
   * Companion evidence review from `ui/WIREFRAMES.md` Screen 04 (`#verification`).
   * Accepting a candidate adds it to the TV symbol input without bypassing PuzzleEngine.
   */
  reviewCompanionCandidate(action: {
    decision: "select" | "accept" | "retry" | "type_manual";
    candidate_id?: string;
  }): SimulatorStateSnapshot {
    if (action.decision === "select" && action.candidate_id) {
      this.selectedCandidateId = action.candidate_id;
      return this.getState();
    }
    if (action.decision === "retry") {
      // Rejecting/retrying candidates does NOT count as a failed puzzle attempt
      this.lastGuidance =
        "Retrying companion symbol capture. No puzzle attempt was spent.";
      return this.getState();
    }
    if (action.decision === "type_manual") {
      this.activeScreen = "puzzle";
      this.lastGuidance =
        "Switched to manual symbol / remote input on Fire TV.";
      return this.getState();
    }
    if (action.decision === "accept") {
      const chosen =
        action.candidate_id ?? this.selectedCandidateId ?? "north_star";
      if (chosen === "north_star" && this.manualSymbols.length === 0) {
        this.manualSymbols.push("north_star");
      }
      this.activeScreen = "puzzle";
      this.lastGuidance = `Companion candidate "${chosen}" sent to Fire TV review. PuzzleEngine validation is still required.`;
    }
    return this.getState();
  }

  async requestDirectorHint(lastError: DirectorErrorCode = "none"): Promise<{
    hint_result: BoundedDirectorHintResult;
    state: SimulatorStateSnapshot;
  }> {
    const current = this.currentPuzzleDef();
    if (!current) {
      throw new Error("no_active_puzzle_for_hint");
    }
    const priorLevel = this.hintsUsed[current.puzzle_id];
    const nextLevel = Math.min(priorLevel + 1, current.authored_hints.length);
    const hintResult = await this.director.requestHint({
      episode_version: this.contentVersion,
      puzzle_id: current.puzzle_id,
      attempt_count: this.attemptCounts[current.puzzle_id],
      hint_level: nextLevel,
      last_error: lastError,
      transport: this.companionConnected ? "webrtc" : "cloud_relay",
      accessibility_mode: this.accessibility.no_timing_mode
        ? "no_timing"
        : this.accessibility.reduced_motion
          ? "reduced_motion"
          : "standard",
    });
    this.hintsUsed[current.puzzle_id] = nextLevel;
    this.lastHintText = hintResult.hint.text;
    return {
      hint_result: hintResult,
      state: this.getState(),
    };
  }

  resetEpisode(): SimulatorStateSnapshot {
    this.activeScreen = "lobby";
    this.stateSequence = 0;
    this.attemptCounts = {
      lighthouse_alignment: 0,
      raise_the_shield: 0,
      lens_archive_sequence: 0,
    };
    this.hintsUsed = {
      lighthouse_alignment: 0,
      raise_the_shield: 0,
      lens_archive_sequence: 0,
    };
    this.lastHintText = null;
    this.lastGuidance = "Episode reset to lobby.";
    this.sequenceStep = 0;
    this.sequenceStartedAtMs = null;
    this.holdStartedAtMs = null;
    this.holdProgressMs = 0;
    this.manualSymbols = [];
    this.completedPuzzles = [];
    this.elapsedActiveTimeMs = 0;
    return this.getState();
  }

  caseReport(): SimulatorCaseReport {
    if (this.completedPuzzles.length < SIMULATOR_PUZZLES.length) {
      throw new Error("case_report_requires_all_puzzles_completed");
    }
    return {
      episode_id: this.episodeId,
      content_version: this.contentVersion,
      completed_puzzles: structuredClone(this.completedPuzzles),
      hints_used: structuredClone(this.hintsUsed),
      elapsed_active_time_ms: this.elapsedActiveTimeMs,
      room_media_included: false,
    };
  }

  getState(): SimulatorStateSnapshot {
    const cal = evaluateMatCalibration(this.calibrationInput);
    const current = this.currentPuzzleDef();
    return {
      session_id: this.sessionId,
      episode_id: this.episodeId,
      content_version: this.contentVersion,
      active_screen: this.activeScreen,
      player_count: this.playerCount,
      solo_path: this.soloPath,
      roles: [...this.roles],
      selected_object_kit: [...this.selectedObjectKit],
      accessibility: structuredClone(this.accessibility),
      pairing_code: this.pairingCode,
      companion_connected: this.companionConnected,
      calibration_valid: cal.calibration_valid,
      calibration_guidance: cal.tv_guidance,
      clues_collected: [...this.cluesCollected],
      current_puzzle_index: this.completedPuzzles.length,
      current_puzzle: current ? structuredClone(current) : null,
      state_sequence: this.stateSequence,
      attempt_counts: structuredClone(this.attemptCounts),
      hints_used: structuredClone(this.hintsUsed),
      last_hint_text: this.lastHintText,
      last_guidance: this.lastGuidance,
      sequence_step: this.sequenceStep,
      sequence_started_at_ms: this.sequenceStartedAtMs,
      hold_progress_ms: this.holdProgressMs,
      manual_symbols: [...this.manualSymbols],
      uncertain_candidates: structuredClone(
        DEFAULT_UNCERTAIN_CANDIDATES as UncertainSymbolCandidate[],
      ),
      selected_candidate_id: this.selectedCandidateId,
      completed_puzzles: structuredClone(this.completedPuzzles),
      signal_restored:
        this.completedPuzzles.length === SIMULATOR_PUZZLES.length,
      elapsed_active_time_ms: this.elapsedActiveTimeMs,
    };
  }
}
