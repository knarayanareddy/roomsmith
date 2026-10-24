import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FireTvWebSimulator,
  SIMULATOR_PUZZLES,
} from "../../apps/firetv/src/index.js";
import { SharedModelGateway } from "../../packages/model-gateway/src/index.js";
import { validatePhysicalObjectRelation } from "../../packages/perception/src/index.js";
import {
  BoundedDirectorService,
  type DirectorContext,
} from "../../services/director/src/index.js";
import { PlayerSessionConfigurationService } from "../../services/pairing/src/index.js";

const AUTHORED_HINTS = {
  lighthouse_alignment: [
    "Check the lens label, then compare its position with the book.",
    "Place the red lens cup to the left of the archive book.",
  ],
  raise_the_shield: [
    "Use an open palm held steady in frame or hold the remote gearbox control.",
  ],
  lens_archive_sequence: [
    "Start with the circle lens zone before placing the archive book in the square zone.",
  ],
};

const VALID_CALIBRATION = {
  detected_marker_ids: [0, 1, 2, 3],
  reprojection_error_px: 2.0,
  normalized_mat_area: 0.5,
  glare_score: 0.1,
  blur_score: 0.1,
  selected_object_kit: ["red_cup", "blue_cup", "book"],
  required_objects: ["red_cup", "blue_cup", "book"],
};

describe("FR-RS-002 player session configuration service", () => {
  it("validates player count, allowlisted object kit with non-color labels, accessibility, and adult consent", () => {
    const service = new PlayerSessionConfigurationService();
    const catalog = service.getCatalog();
    expect(catalog.map((item) => item.object_id)).toEqual([
      "red_cup",
      "blue_cup",
      "book",
      "bottle",
      "spoon",
    ]);
    expect(catalog.every((item) => item.accessible_label.length > 0)).toBe(
      true,
    );

    const configured = service.configureSession({
      episode_id: "01000000000000000000000001",
      content_version: "1.0.0",
      player_count: 3,
      selected_object_kit: ["red_cup", "blue_cup", "book", "spoon"],
      accessibility: {
        no_timing_mode: true,
        reduced_motion: true,
        captions: true,
        remote_only: false,
        larger_text: true,
      },
      adult_supervision_confirmed: true,
      privacy_notice_acknowledged: true,
    });
    expect(configured.color_independent_labels).toBe(true);
    expect(configured.roles).toEqual(["navigator", "observer", "keeper"]);
    expect(configured.resolved_kit_objects).toHaveLength(4);

    expect(() =>
      service.configureSession({
        episode_id: "01000000000000000000000001",
        content_version: "1.0.0",
        player_count: 2,
        selected_object_kit: ["red_cup", "blue_cup", "book"],
        accessibility: {
          no_timing_mode: false,
          reduced_motion: false,
          captions: true,
          remote_only: false,
          larger_text: false,
          color_independent_labels: false,
        },
        adult_supervision_confirmed: true,
        privacy_notice_acknowledged: true,
      }),
    ).toThrow("color_independent_labels_required");
  });
});

describe("FR-RS-004 & FR-RS-005 physical puzzle object relation validator", () => {
  it("validates allowlisted object relations gated by PlayMat calibration and rejects unallowlisted inputs", () => {
    const valid = validatePhysicalObjectRelation({
      calibration: VALID_CALIBRATION,
      subject: "red_cup",
      predicate: "left_of",
      target: "book",
      subject_confidence: 0.9,
      target_confidence: 0.88,
      min_confidence: 0.7,
      subject_color: "red",
      subject_box: { x: 0.15, y: 0.4, width: 0.12, height: 0.15 },
      target_box: { x: 0.55, y: 0.35, width: 0.2, height: 0.25 },
      normalized_margin: 0.05,
    });
    expect(valid.eligible).toBe(true);
    expect(valid.calibration_valid).toBe(true);

    const poorCalibration = validatePhysicalObjectRelation({
      calibration: { ...VALID_CALIBRATION, detected_marker_ids: [0, 1] },
      subject: "red_cup",
      predicate: "left_of",
      target: "book",
      subject_confidence: 0.9,
      min_confidence: 0.7,
    });
    expect(poorCalibration.eligible).toBe(false);
    expect(poorCalibration.reason_code).toBe("missing_markers");

    const unallowlisted = validatePhysicalObjectRelation({
      calibration: VALID_CALIBRATION,
      subject: "laptop",
      predicate: "left_of",
      target: "book",
      subject_confidence: 0.95,
      min_confidence: 0.7,
    });
    expect(unallowlisted.eligible).toBe(false);
    expect(unallowlisted.reason_code).toBe("unallowlisted_subject");

    const unknownColor = validatePhysicalObjectRelation({
      calibration: VALID_CALIBRATION,
      subject: "red_cup",
      predicate: "left_of",
      target: "book",
      subject_confidence: 0.95,
      min_confidence: 0.7,
      subject_color: "unknown",
    });
    expect(unknownColor.eligible).toBe(false);
    expect(unknownColor.reason_code).toBe("color_unknown_or_mismatched");
  });
});

describe("INT-RS-004 bounded LLM director service and shared model gateway", () => {
  const sampleContext: DirectorContext = {
    episode_version: "1.0.0",
    puzzle_id: "lighthouse_alignment",
    attempt_count: 1,
    hint_level: 1,
    last_error: "color_unknown",
    transport: "webrtc",
    accessibility_mode: "standard",
  };

  it("accepts allowlisted hint variants and blocks state mutation or tool calls at the shared gateway", async () => {
    const variant =
      "Compare the printed red lens tag with the archive book placement.";
    const director = new BoundedDirectorService(AUTHORED_HINTS, {
      allowlistedVariants: {
        lighthouse_alignment: { 1: [variant] },
      },
      provider: () => ({
        text: variant,
        hint_level: 1,
        target_role: "observer",
        uses_fallback: false,
      }),
    });

    const okResult = await director.requestHint(sampleContext);
    expect(okResult.source).toBe("model");
    expect(okResult.hint.text).toBe(variant);
    expect(okResult.passed_model_gateway).toBe(true);
    expect(okResult.state_mutation_blocked).toBe(true);
    expect(okResult.state_mutated).toBe(false);

    // Attempted state mutation / tool call is blocked by SharedModelGateway
    const mutatingGateway = new SharedModelGateway<DirectorContext>({
      provider: () => ({
        text: variant,
        hint_level: 1,
        target_role: "observer",
        uses_fallback: false,
        mutate_state: { puzzle_id: "lighthouse_alignment", completed: true },
      }),
    });
    const guardedDirector = new BoundedDirectorService(AUTHORED_HINTS, {
      gateway: mutatingGateway,
      allowlistedVariants: {
        lighthouse_alignment: { 1: [variant] },
      },
    });
    const blockedResult = await guardedDirector.requestHint(sampleContext);
    expect(blockedResult.source).toBe("authored_fallback");
    expect(blockedResult.fallback_reason).toBe(
      "model_state_mutation_or_biometric_blocked",
    );
    expect(blockedResult.hint.text).toBe(
      AUTHORED_HINTS.lighthouse_alignment[0],
    );
    expect(blockedResult.state_mutated).toBe(false);

    // Deterministic dialogue variant selection
    const d1 = director.selectDialogueVariant(
      "node_intro",
      ["dialogue_intro_a", "dialogue_intro_b"],
      "seed-42",
    );
    const d2 = director.selectDialogueVariant(
      "node_intro",
      ["dialogue_intro_a", "dialogue_intro_b"],
      "seed-42",
    );
    expect(d1).toEqual(d2);
    expect(d1.state_mutated).toBe(false);
  });
});

describe("apps/firetv browser-based escape room simulator (Lighthouse, Gearbox, PowerGrid)", () => {
  it("completes all 3 puzzles (Lighthouse, Gearbox, PowerGrid) across physical and remote paths", async () => {
    expect(SIMULATOR_PUZZLES.map((p) => p.key)).toEqual([
      "lighthouse",
      "gearbox",
      "powergrid",
    ]);

    const sim = new FireTvWebSimulator();
    sim.configureLobby({
      player_count: 2,
      selected_object_kit: ["red_cup", "blue_cup", "book"],
      accessibility: {
        no_timing_mode: false,
        reduced_motion: false,
        captions: true,
        remote_only: false,
        larger_text: false,
      },
      adult_supervision_confirmed: true,
      privacy_notice_acknowledged: true,
    });

    sim.navigateTo("room");
    sim.inspectObject("Brass compass");
    expect(sim.getState().clues_collected).toContain("Brass compass");

    // Puzzle 1: Lighthouse (`lighthouse_alignment`) via physical PlayMat hold (1000 ms)
    sim.navigateTo("puzzle");
    sim.submitPhysicalObservation({
      puzzle_key: "lighthouse",
      duration_ms: 500,
    });
    expect(sim.getState().completed_puzzles).toHaveLength(0);
    sim.submitPhysicalObservation({
      puzzle_key: "lighthouse",
      duration_ms: 500,
    });
    expect(sim.getState().completed_puzzles).toHaveLength(1);
    expect(sim.getState().completed_puzzles[0]?.key).toBe("lighthouse");

    // Puzzle 2: Gearbox (`raise_the_shield`) hint request + remote hold (750 ms)
    const hintRes = await sim.requestDirectorHint("no_observation");
    expect(hintRes.hint_result.state_mutated).toBe(false);
    expect(sim.getState().current_puzzle?.key).toBe("gearbox");

    sim.submitRemoteFallback({
      option_id: "option_shield",
      hold_duration_ms: 400,
    });
    expect(sim.getState().completed_puzzles).toHaveLength(1);
    sim.submitRemoteFallback({
      option_id: "option_shield",
      hold_duration_ms: 400,
    });
    expect(sim.getState().completed_puzzles).toHaveLength(2);
    expect(sim.getState().completed_puzzles[1]?.key).toBe("gearbox");

    // Puzzle 3: PowerGrid (`lens_archive_sequence`) wrong-order reset guidance + ordered physical completion
    sim.submitPhysicalObservation({
      puzzle_key: "powergrid",
      step: 2,
      duration_ms: 500,
    });
    expect(sim.getState().completed_puzzles).toHaveLength(2);
    expect(sim.getState().last_guidance).toContain("Start with step 1");

    sim.submitPhysicalObservation({
      puzzle_key: "powergrid",
      step: 1,
      duration_ms: 500,
    });
    expect(sim.getState().sequence_step).toBe(1);
    sim.submitPhysicalObservation({
      puzzle_key: "powergrid",
      step: 2,
      duration_ms: 500,
    });
    expect(sim.getState().completed_puzzles).toHaveLength(3);
    expect(sim.getState().signal_restored).toBe(true);
    expect(sim.getState().active_screen).toBe("completion");

    const report = sim.caseReport();
    expect(report.completed_puzzles).toHaveLength(3);
    expect(report.room_media_included).toBe(false);
  });

  it("supports companion evidence review, manual 3-symbol sequence, and ships a complete HTML simulator", () => {
    const sim = new FireTvWebSimulator();
    sim.navigateTo("verification");
    const retryState = sim.reviewCompanionCandidate({ decision: "retry" });
    expect(retryState.attempt_counts.lighthouse_alignment).toBe(0);

    sim.reviewCompanionCandidate({
      decision: "accept",
      candidate_id: "north_star",
    });
    expect(sim.getState().manual_symbols).toEqual(["north_star"]);
    sim.chooseSymbol("open_sea");
    sim.chooseSymbol("safe_harbor");
    const solvedSymbol = sim.submitSymbolSequence(1500);
    expect(solvedSymbol.completed_puzzles).toHaveLength(1);

    const htmlPath = fileURLToPath(
      new URL("../../apps/firetv/index.html", import.meta.url),
    );
    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain("Lighthouse Beam Alignment");
    expect(html).toContain("Gearbox &amp; Storm Shield");
    expect(html).toContain("PowerGrid &amp; Archive Sequence");
    expect(html).toContain("screen-lobby");
    expect(html).toContain("screen-verification");
    expect(html).toContain("screen-completion");
  });
});
