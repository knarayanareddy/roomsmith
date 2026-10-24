import { describe, expect, it } from "vitest";
import {
  classifyCupColor,
  CompanionPerceptionPipeline,
  evaluateInsideZone,
  evaluateLeftOf,
  evaluateMatCalibration,
  evaluateOpenPalmGesture,
  type HandLandmarkPoint,
  type MatCalibrationInput,
} from "../../packages/perception/src/index.js";
import { ObservationIngress } from "../../packages/session-contracts/src/index.js";

function healthyCalibration(
  overrides: Partial<MatCalibrationInput> = {},
): MatCalibrationInput {
  return {
    detected_marker_ids: [0, 1, 2, 3],
    reprojection_error_px: 2.4,
    normalized_mat_area: 0.55,
    glare_score: 0.15,
    blur_score: 0.12,
    selected_object_kit: ["red_cup", "blue_cup", "book"],
    required_objects: ["red_cup", "blue_cup", "book"],
    ...overrides,
  };
}

function makeOpenPalmLandmarks(extended = true): HandLandmarkPoint[] {
  const pts: HandLandmarkPoint[] = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.8,
  }));
  // Wrist at (0.5, 0.8)
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
    pts[tip] = { x, y: extended ? 0.2 : 0.72 };
  }
  return pts;
}

describe("RoomSmith local PlayMat calibration and perception pipeline", () => {
  it("validates PlayMat ArUco markers, reprojection error, and area before physical puzzles (FR-RS-004, AC-RS-005)", () => {
    expect(evaluateMatCalibration(healthyCalibration())).toMatchObject({
      calibration_valid: true,
      needs_review: false,
      occluded: false,
      reason_codes: [],
      fallback_available: false,
    });

    const missingMarker = evaluateMatCalibration(
      healthyCalibration({ detected_marker_ids: [0, 1, 2] }),
    );
    expect(missingMarker.calibration_valid).toBe(false);
    expect(missingMarker.reason_codes).toContain("missing_markers");
    expect(missingMarker.tv_guidance).toBe(
      "Move the phone to show all four markers",
    );
    expect(missingMarker.fallback_available).toBe(true);

    const highReproj = evaluateMatCalibration(
      healthyCalibration({ reprojection_error_px: 9.2 }),
    );
    expect(highReproj.calibration_valid).toBe(false);
    expect(highReproj.reason_codes).toContain("reprojection_error_exceeded");
  });

  it("classifies cup colors into red, blue, or unknown only and never coerces unknown to valid (FR-RS-005)", () => {
    expect(
      classifyCupColor({ h: 8, s: 0.82, v: 0.75, white_balanced: true }),
    ).toBe("red");
    expect(
      classifyCupColor({ h: 215, s: 0.78, v: 0.72, white_balanced: true }),
    ).toBe("blue");
    expect(
      classifyCupColor({ h: 120, s: 0.8, v: 0.7, white_balanced: true }),
    ).toBe("unknown");
    expect(
      classifyCupColor({ h: 8, s: 0.82, v: 0.75, white_balanced: false }),
    ).toBe("unknown");
    expect(
      classifyCupColor({ h: 8, s: 0.1, v: 0.75, white_balanced: true }),
    ).toBe("unknown");
  });

  it("evaluates mat-normalized spatial relations and 21-landmark open palm without face detection (FR-RS-005, SEC-RS-006)", () => {
    const redCupBox = { x: 0.15, y: 0.4, width: 0.12, height: 0.15 };
    const bookBox = { x: 0.55, y: 0.35, width: 0.2, height: 0.25 };
    expect(evaluateLeftOf(redCupBox, bookBox, 0.05)).toMatchObject({
      satisfied: true,
    });
    expect(evaluateLeftOf(bookBox, redCupBox, 0.05).satisfied).toBe(false);

    const zoneLens = { x: 0.1, y: 0.1, width: 0.3, height: 0.3 };
    const blueCupInside = { x: 0.12, y: 0.12, width: 0.15, height: 0.15 };
    expect(evaluateInsideZone(blueCupInside, zoneLens, 0.6)).toMatchObject({
      satisfied: true,
      overlap: 1,
    });

    const palm = evaluateOpenPalmGesture(makeOpenPalmLandmarks(true), [0.9]);
    expect(palm.gesture).toBe("open_palm");
    expect(palm.confidence).toBeGreaterThanOrEqual(0.75);
    expect(palm.face_detector_initialized).toBe(false);
    expect(palm.landmarks_retained).toBe(false);

    const closed = evaluateOpenPalmGesture(makeOpenPalmLandmarks(false));
    expect(closed.gesture).toBe("none");
  });

  it("emits candidate, stable, and invalid structured observations and prevents stable emission on poor calibration (FR-RS-006, AC-RS-005, AC-RS-014, NFR-RS-005)", () => {
    const pipeline = new CompanionPerceptionPipeline({
      session_id: "session-perception-1",
      device_id: "companion-1",
      puzzle_id: "lighthouse_alignment",
      calibration_version: "mat-v1",
      object_kit_version: "kit-v1",
      hold_ms: 1000,
      min_confidence: 0.7,
      subject: "red_cup",
      predicate: "left_of",
      target: "book",
      normalized_margin: 0.05,
    });
    const ingress = new ObservationIngress({
      sessionId: "session-perception-1",
      puzzleId: "lighthouse_alignment",
      calibrationVersion: "mat-v1",
      objectKitVersion: "kit-v1",
      authorizedDeviceIds: ["companion-1"],
    });

    const validDetections = [
      {
        detector_class: "cup",
        confidence: 0.91,
        bounding_box: { x: 0.15, y: 0.4, width: 0.12, height: 0.15 },
        hsv_sample: { h: 10, s: 0.85, v: 0.8, white_balanced: true },
      },
      {
        detector_class: "book",
        confidence: 0.88,
        bounding_box: { x: 0.55, y: 0.35, width: 0.2, height: 0.25 },
      },
      {
        detector_class: "person_unallowlisted",
        confidence: 0.99,
        bounding_box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      },
    ];

    // Frame 1 at t=0 -> candidate
    const first = pipeline.processFrameSummary({
      frame_sequence: 1,
      observed_at_ms: 0,
      calibration: healthyCalibration(),
      detections: validDetections,
    });
    expect(first.type).toBe("observation.candidate");
    expect(first.raw_frame_emitted).toBe(false);
    expect(ingress.accept(first.raw_json).disposition).toBe(
      "accepted_candidate",
    );

    // Frame 2 at t=1000 -> stable proposal
    const second = pipeline.processFrameSummary({
      frame_sequence: 2,
      observed_at_ms: 1000,
      calibration: healthyCalibration(),
      detections: validDetections,
    });
    expect(second.type).toBe("observation.stable");
    const acceptedStable = ingress.accept(second.raw_json);
    expect(acceptedStable.disposition).toBe("accepted_stable_proposal");
    expect(acceptedStable.hold_verification_required).toBe(true);

    // Frame 3: missing mat markers -> observation.invalid, cancels verification, fallback available within 2s (AC-RS-005, AC-RS-014, NFR-RS-005)
    const lost = pipeline.processFrameSummary({
      frame_sequence: 3,
      observed_at_ms: 1200,
      calibration: healthyCalibration({ detected_marker_ids: [0, 1] }),
      detections: validDetections,
    });
    expect(lost.type).toBe("observation.invalid");
    expect(lost.fallback_available).toBe(true);
    expect(lost.recovery_latency_ms).toBeLessThanOrEqual(2000);
    const invalidIngress = ingress.accept(lost.raw_json);
    expect(invalidIngress.disposition).toBe("invalid_observation");
    expect(invalidIngress.candidate_verification_cancelled).toBe(true);
    expect(invalidIngress.fallback_available).toBe(true);
  });

  it("rejects face/emotion/identity/age inference and marks unknown cup color as needing review (SEC-RS-006, AC-RS-008)", () => {
    expect(
      () =>
        new CompanionPerceptionPipeline({
          session_id: "session-1",
          device_id: "companion-1",
          puzzle_id: "raise_the_shield",
          calibration_version: "mat-v1",
          object_kit_version: "kit-v1",
          hold_ms: 750,
          min_confidence: 0.75,
          subject: "hand",
          predicate: "open_palm",
          target: null,
          enable_face_detection: true,
        }),
    ).toThrow("biometric_or_face_inference_forbidden");

    const pipeline = new CompanionPerceptionPipeline({
      session_id: "session-1",
      device_id: "companion-1",
      puzzle_id: "lighthouse_alignment",
      calibration_version: "mat-v1",
      object_kit_version: "kit-v1",
      hold_ms: 1000,
      min_confidence: 0.7,
      subject: "red_cup",
      predicate: "left_of",
      target: "book",
    });

    expect(() =>
      pipeline.processFrameSummary({
        frame_sequence: 1,
        observed_at_ms: 0,
        calibration: healthyCalibration(),
        biometric_flags: { emotion: "happy" },
      }),
    ).toThrow("biometric_or_face_inference_forbidden");

    const unclearCup = pipeline.processFrameSummary({
      frame_sequence: 2,
      observed_at_ms: 200,
      calibration: healthyCalibration(),
      detections: [
        {
          detector_class: "cup",
          confidence: 0.92,
          bounding_box: { x: 0.15, y: 0.4, width: 0.12, height: 0.15 },
          hsv_sample: { h: 120, s: 0.1, v: 0.5, white_balanced: true },
        },
        {
          detector_class: "book",
          confidence: 0.9,
          bounding_box: { x: 0.55, y: 0.35, width: 0.2, height: 0.25 },
        },
      ],
    });
    expect(unclearCup.type).toBe("observation.candidate");
    expect(unclearCup.tv_guidance).toBe(
      "Cup color unclear—use the labeled cup or remote path",
    );
    expect(unclearCup.fallback_available).toBe(true);
  });
});
