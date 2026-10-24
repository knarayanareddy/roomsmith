export const REQUIRED_ARUCO_MARKER_IDS = [0, 1, 2, 3] as const;
export const MAX_REPROJECTION_ERROR_PX = 8.0;
export const MIN_NORMALIZED_MAT_AREA = 0.25;
export const MAX_GLARE_SCORE = 0.65;
export const MAX_BLUR_SCORE = 0.65;
export const MAX_PERCEPTION_LOSS_RECOVERY_MS = 2000;

export type AllowlistedDetectorClass = "cup" | "book" | "bottle" | "spoon";
export type CupColorClassification = "red" | "blue" | "unknown";

export interface NormalizedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HsvColorSample {
  h: number;
  s: number;
  v: number;
  white_balanced: boolean;
}

export interface HandLandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export interface MatCalibrationInput {
  detected_marker_ids: readonly number[];
  reprojection_error_px: number;
  normalized_mat_area: number;
  glare_score: number;
  blur_score: number;
  selected_object_kit: readonly string[];
  required_objects: readonly string[];
}

export interface MatCalibrationAssessment {
  calibration_valid: boolean;
  needs_review: boolean;
  occluded: boolean;
  reason_codes: string[];
  tv_guidance: string;
  fallback_available: boolean;
}

export interface SpatialRelationEvaluation {
  satisfied: boolean;
  normalized_margin: number | null;
  overlap: number | null;
  reason_code: string | null;
}

export interface PhysicalRelationValidationInput {
  calibration: MatCalibrationInput;
  subject: string;
  predicate: string;
  target: string | null;
  subject_confidence: number;
  target_confidence?: number;
  min_confidence: number;
  subject_color?: CupColorClassification | "neutral";
  subject_box?: NormalizedBoundingBox;
  target_box?: NormalizedBoundingBox;
  normalized_margin?: number;
  minimum_overlap?: number;
  hand_landmarks?: readonly HandLandmarkPoint[];
}

export interface PhysicalRelationValidationResult {
  eligible: boolean;
  reason_code: string | null;
  confidence: number;
  normalized_margin: number | null;
  overlap: number | null;
  calibration_valid: boolean;
  tv_guidance: string;
}

export interface OpenPalmEvaluation {
  gesture: "open_palm" | "none";
  confidence: number;
  extended_fingers: number;
  face_detector_initialized: false;
  landmarks_retained: false;
}

export interface DetectedObjectCandidate {
  detector_class: string;
  confidence: number;
  bounding_box: NormalizedBoundingBox;
  hsv_sample?: HsvColorSample;
}

export interface PerceptionFrameSummary {
  frame_sequence: number;
  observed_at_ms: number;
  calibration: MatCalibrationInput;
  detections?: readonly DetectedObjectCandidate[];
  hand_landmarks?: readonly HandLandmarkPoint[];
  occluded?: boolean;
  camera_lost?: boolean;
  biometric_flags?: Readonly<Record<string, unknown>>;
}

export interface PerceptionPipelineConfig {
  session_id: string;
  device_id: string;
  puzzle_id: string;
  calibration_version: string;
  object_kit_version: string;
  hold_ms: number;
  min_confidence: number;
  subject: string;
  predicate: "left_of" | "right_of" | "inside_zone" | "present" | "open_palm";
  target: string | null;
  normalized_margin?: number;
  minimum_overlap?: number;
  zone_boxes?: Readonly<Record<string, NormalizedBoundingBox>>;
  enable_face_detection?: boolean;
  enable_emotion_inference?: boolean;
  enable_identity_inference?: boolean;
  enable_age_inference?: boolean;
}

export interface EmittedCompanionEnvelope {
  raw_json: string;
  type:
    | "calibration.state"
    | "observation.candidate"
    | "observation.stable"
    | "observation.invalid";
  sequence: number;
  tv_guidance: string;
  fallback_available: boolean;
  recovery_latency_ms: number;
  raw_frame_emitted: false;
  landmarks_emitted: false;
}

const ALLOWLISTED_DETECTOR_CLASSES = new Set<AllowlistedDetectorClass>([
  "cup",
  "book",
  "bottle",
  "spoon",
]);
const FORBIDDEN_BIOMETRIC_KEYS = new Set([
  "face",
  "facedetection",
  "faceid",
  "emotion",
  "identity",
  "age",
  "gender",
  "gaze",
  "expression",
  "biometric",
]);

function isFiniteInRange(value: number, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export function isValidNormalizedBox(box: NormalizedBoundingBox): boolean {
  return (
    isFiniteInRange(box.x, 0, 1) &&
    isFiniteInRange(box.y, 0, 1) &&
    isFiniteInRange(box.width, 0.001, 1) &&
    isFiniteInRange(box.height, 0.001, 1) &&
    box.x + box.width <= 1.000001 &&
    box.y + box.height <= 1.000001
  );
}

/**
 * Evaluates OpenCV ArUco PlayMat calibration (FR-RS-004, AC-RS-005, SPEC.md Section 8.1).
 */
export function evaluateMatCalibration(
  input: MatCalibrationInput,
): MatCalibrationAssessment {
  const reasons: string[] = [];
  const markerSet = new Set(input.detected_marker_ids);
  const allMarkersPresent = REQUIRED_ARUCO_MARKER_IDS.every((id) =>
    markerSet.has(id),
  );
  if (!allMarkersPresent) {
    reasons.push("missing_markers");
  }
  if (
    !Number.isFinite(input.reprojection_error_px) ||
    input.reprojection_error_px < 0 ||
    input.reprojection_error_px > MAX_REPROJECTION_ERROR_PX
  ) {
    reasons.push("reprojection_error_exceeded");
  }
  if (
    !Number.isFinite(input.normalized_mat_area) ||
    input.normalized_mat_area < MIN_NORMALIZED_MAT_AREA ||
    input.normalized_mat_area > 1
  ) {
    reasons.push("mat_area_too_small");
  }
  if (
    !Number.isFinite(input.glare_score) ||
    input.glare_score < 0 ||
    input.glare_score > MAX_GLARE_SCORE
  ) {
    reasons.push("glare_detected");
  }
  if (
    !Number.isFinite(input.blur_score) ||
    input.blur_score < 0 ||
    input.blur_score > MAX_BLUR_SCORE
  ) {
    reasons.push("blur_detected");
  }
  const selectedSet = new Set(input.selected_object_kit);
  if (input.required_objects.some((reqId) => !selectedSet.has(reqId))) {
    reasons.push("missing_required_kit_object");
  }

  const calibrationValid = reasons.length === 0;
  const needsReview =
    reasons.includes("glare_detected") || reasons.includes("blur_detected");
  const occluded = !allMarkersPresent;

  const tvGuidance = !allMarkersPresent
    ? "Move the phone to show all four markers"
    : !calibrationValid
      ? "Camera unavailable—continue with remote"
      : "PlayMat calibrated and ready";

  return {
    calibration_valid: calibrationValid,
    needs_review: needsReview,
    occluded,
    reason_codes: reasons,
    tv_guidance: tvGuidance,
    fallback_available: !calibrationValid,
  };
}

/**
 * Classifies cup color from white-balanced HSV pixels inside the central detection
 * region. Returns only `red`, `blue`, or `unknown` (FR-RS-005, SPEC.md Section 8.1).
 */
export function classifyCupColor(
  sample: HsvColorSample | undefined,
): CupColorClassification {
  if (!sample || !sample.white_balanced) {
    return "unknown";
  }
  if (
    !isFiniteInRange(sample.h, 0, 360) ||
    !isFiniteInRange(sample.s, 0, 1) ||
    !isFiniteInRange(sample.v, 0, 1)
  ) {
    return "unknown";
  }
  if (sample.s < 0.25 || sample.v < 0.2 || sample.v > 0.98) {
    return "unknown";
  }
  if (sample.h <= 25 || sample.h >= 335) {
    return "red";
  }
  if (sample.h >= 195 && sample.h <= 255) {
    return "blue";
  }
  return "unknown";
}

export function evaluateLeftOf(
  subjectBox: NormalizedBoundingBox,
  targetBox: NormalizedBoundingBox,
  requiredMargin = 0.05,
): SpatialRelationEvaluation {
  if (
    !isValidNormalizedBox(subjectBox) ||
    !isValidNormalizedBox(targetBox) ||
    !isFiniteInRange(requiredMargin, 0, 0.5)
  ) {
    return {
      satisfied: false,
      normalized_margin: null,
      overlap: null,
      reason_code: "invalid_bounding_box",
    };
  }
  const subjectCenterX = subjectBox.x + subjectBox.width / 2;
  const targetCenterX = targetBox.x + targetBox.width / 2;
  const margin = Number((targetCenterX - subjectCenterX).toFixed(6));
  const satisfied = margin >= requiredMargin;
  return {
    satisfied,
    normalized_margin: margin,
    overlap: null,
    reason_code: satisfied ? null : "insufficient_left_margin",
  };
}

export function evaluateInsideZone(
  subjectBox: NormalizedBoundingBox,
  zoneBox: NormalizedBoundingBox,
  minimumOverlap = 0.6,
): SpatialRelationEvaluation {
  if (
    !isValidNormalizedBox(subjectBox) ||
    !isValidNormalizedBox(zoneBox) ||
    !isFiniteInRange(minimumOverlap, 0.01, 1)
  ) {
    return {
      satisfied: false,
      normalized_margin: null,
      overlap: null,
      reason_code: "invalid_bounding_box",
    };
  }
  const xOverlap = Math.max(
    0,
    Math.min(subjectBox.x + subjectBox.width, zoneBox.x + zoneBox.width) -
      Math.max(subjectBox.x, zoneBox.x),
  );
  const yOverlap = Math.max(
    0,
    Math.min(subjectBox.y + subjectBox.height, zoneBox.y + zoneBox.height) -
      Math.max(subjectBox.y, zoneBox.y),
  );
  const intersectionArea = xOverlap * yOverlap;
  const subjectArea = subjectBox.width * subjectBox.height;
  const overlap = Number(
    Math.min(1, intersectionArea / subjectArea).toFixed(6),
  );
  const satisfied = overlap >= minimumOverlap;
  return {
    satisfied,
    normalized_margin: null,
    overlap,
    reason_code: satisfied ? null : "insufficient_zone_overlap",
  };
}

const ALLOWLISTED_SUBJECT_IDS = new Set([
  "red_cup",
  "blue_cup",
  "book",
  "bottle",
  "spoon",
  "hand",
]);
const ALLOWLISTED_PREDICATE_IDS = new Set([
  "left_of",
  "right_of",
  "above",
  "below",
  "inside_zone",
  "present",
  "open_palm",
]);
const ALLOWLISTED_ZONE_IDS = new Set([
  "zone_lens",
  "zone_archive",
  "zone_beacon",
]);

/**
 * Validates an allowlisted physical puzzle object relation or hand gesture
 * gated by PlayMat ArUco calibration (FR-RS-004, FR-RS-005, AC-RS-005, AC-RS-008).
 */
export function validatePhysicalObjectRelation(
  input: PhysicalRelationValidationInput,
): PhysicalRelationValidationResult {
  const cal = evaluateMatCalibration(input.calibration);
  if (!cal.calibration_valid) {
    return {
      eligible: false,
      reason_code: cal.reason_codes[0] ?? "calibration_invalid",
      confidence: 0,
      normalized_margin: null,
      overlap: null,
      calibration_valid: false,
      tv_guidance: cal.tv_guidance,
    };
  }

  if (!ALLOWLISTED_SUBJECT_IDS.has(input.subject)) {
    return {
      eligible: false,
      reason_code: "unallowlisted_subject",
      confidence: 0,
      normalized_margin: null,
      overlap: null,
      calibration_valid: true,
      tv_guidance: "Use an allowlisted kit object.",
    };
  }

  if (!ALLOWLISTED_PREDICATE_IDS.has(input.predicate)) {
    return {
      eligible: false,
      reason_code: "unallowlisted_predicate",
      confidence: 0,
      normalized_margin: null,
      overlap: null,
      calibration_valid: true,
      tv_guidance: "Unsupported puzzle relation.",
    };
  }

  if (
    (input.subject === "red_cup" && input.subject_color === "unknown") ||
    (input.subject === "blue_cup" && input.subject_color === "unknown") ||
    (input.subject === "red_cup" && input.subject_color === "blue") ||
    (input.subject === "blue_cup" && input.subject_color === "red")
  ) {
    return {
      eligible: false,
      reason_code: "color_unknown_or_mismatched",
      confidence: 0,
      normalized_margin: null,
      overlap: null,
      calibration_valid: true,
      tv_guidance: "Cup color unclear—use the labeled cup or remote path",
    };
  }

  if (input.predicate === "open_palm") {
    if (input.subject !== "hand") {
      return {
        eligible: false,
        reason_code: "invalid_gesture_subject",
        confidence: 0,
        normalized_margin: null,
        overlap: null,
        calibration_valid: true,
        tv_guidance: "Raise an open palm comfortably in frame.",
      };
    }
    const palm = evaluateOpenPalmGesture(input.hand_landmarks ?? []);
    const eligible =
      palm.gesture === "open_palm" && palm.confidence >= input.min_confidence;
    return {
      eligible,
      reason_code: eligible ? null : "open_palm_below_threshold",
      confidence: palm.confidence,
      normalized_margin: null,
      overlap: null,
      calibration_valid: true,
      tv_guidance: eligible
        ? "Hold still… open palm detected."
        : "Raise an open palm comfortably in frame, or use the remote shield control.",
    };
  }

  if (
    !isFiniteInRange(input.subject_confidence, 0, 1) ||
    input.subject_confidence < input.min_confidence
  ) {
    return {
      eligible: false,
      reason_code: "confidence_below_threshold",
      confidence: Number.isFinite(input.subject_confidence)
        ? input.subject_confidence
        : 0,
      normalized_margin: null,
      overlap: null,
      calibration_valid: true,
      tv_guidance: "Move the object clearly into the PlayMat frame.",
    };
  }

  if (input.predicate === "inside_zone") {
    if (
      !input.target ||
      !ALLOWLISTED_ZONE_IDS.has(input.target) ||
      !input.subject_box ||
      !input.target_box
    ) {
      return {
        eligible: false,
        reason_code: "invalid_zone_target",
        confidence: input.subject_confidence,
        normalized_margin: null,
        overlap: null,
        calibration_valid: true,
        tv_guidance: "Place the object inside the marked PlayMat zone.",
      };
    }
    const zoneEval = evaluateInsideZone(
      input.subject_box,
      input.target_box,
      input.minimum_overlap ?? 0.6,
    );
    return {
      eligible: zoneEval.satisfied,
      reason_code: zoneEval.reason_code,
      confidence: input.subject_confidence,
      normalized_margin: null,
      overlap: zoneEval.overlap,
      calibration_valid: true,
      tv_guidance: zoneEval.satisfied
        ? "Hold still… zone placement verified."
        : "Place the object inside the marked zone.",
    };
  }

  if (input.predicate === "left_of" || input.predicate === "right_of") {
    if (
      !input.target ||
      !ALLOWLISTED_SUBJECT_IDS.has(input.target) ||
      input.target === "hand" ||
      input.target === input.subject ||
      !input.subject_box ||
      !input.target_box
    ) {
      return {
        eligible: false,
        reason_code: "invalid_spatial_target",
        confidence: input.subject_confidence,
        normalized_margin: null,
        overlap: null,
        calibration_valid: true,
        tv_guidance: "Place both objects inside the calibrated PlayMat view.",
      };
    }
    const targetConf = input.target_confidence ?? 1;
    const combinedConfidence = Number(
      Math.min(input.subject_confidence, targetConf).toFixed(4),
    );
    if (combinedConfidence < input.min_confidence) {
      return {
        eligible: false,
        reason_code: "confidence_below_threshold",
        confidence: combinedConfidence,
        normalized_margin: null,
        overlap: null,
        calibration_valid: true,
        tv_guidance: "Ensure both objects are clearly visible on the PlayMat.",
      };
    }
    const spatial =
      input.predicate === "left_of"
        ? evaluateLeftOf(
            input.subject_box,
            input.target_box,
            input.normalized_margin ?? 0.05,
          )
        : evaluateLeftOf(
            input.target_box,
            input.subject_box,
            input.normalized_margin ?? 0.05,
          );
    return {
      eligible: spatial.satisfied,
      reason_code: spatial.reason_code,
      confidence: combinedConfidence,
      normalized_margin: spatial.normalized_margin,
      overlap: null,
      calibration_valid: true,
      tv_guidance: spatial.satisfied
        ? "Hold still… alignment found."
        : "Adjust object placement on the PlayMat.",
    };
  }

  return {
    eligible: true,
    reason_code: null,
    confidence: input.subject_confidence,
    normalized_margin: null,
    overlap: null,
    calibration_valid: true,
    tv_guidance: "Object detected.",
  };
}

function distance2D(a: HandLandmarkPoint, b: HandLandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Evaluates 21 MediaPipe hand landmarks locally using a deterministic finger-extension
 * rule and temporal smoothing. Never initializes face detection or retains landmarks
 * (FR-RS-005, SEC-RS-001, SEC-RS-006, AC-RS-009, AC-RS-010).
 */
export function evaluateOpenPalmGesture(
  landmarks: readonly HandLandmarkPoint[],
  previousConfidences: readonly number[] = [],
): OpenPalmEvaluation {
  if (
    !Array.isArray(landmarks) ||
    landmarks.length !== 21 ||
    landmarks.some(
      (pt) => !isFiniteInRange(pt.x, 0, 1) || !isFiniteInRange(pt.y, 0, 1),
    )
  ) {
    return {
      gesture: "none",
      confidence: 0,
      extended_fingers: 0,
      face_detector_initialized: false,
      landmarks_retained: false,
    };
  }

  // Copy into a transient local array and wipe before returning to model buffer reuse.
  const local = landmarks.map((pt) => ({ x: pt.x, y: pt.y }));
  const wrist = local[0]!;
  const fingerPairs: ReadonlyArray<[number, number]> = [
    [4, 2],
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ];

  let extendedFingers = 0;
  for (const [tipIndex, pipIndex] of fingerPairs) {
    const tip = local[tipIndex]!;
    const pip = local[pipIndex]!;
    if (distance2D(wrist, tip) > distance2D(wrist, pip) * 1.12) {
      extendedFingers += 1;
    }
  }

  for (const pt of local) {
    pt.x = 0;
    pt.y = 0;
  }

  const instantConfidence =
    extendedFingers === 5
      ? 0.92
      : extendedFingers === 4
        ? 0.65
        : extendedFingers * 0.12;
  const window = [
    ...previousConfidences
      .filter((val) => isFiniteInRange(val, 0, 1))
      .slice(-2),
    instantConfidence,
  ];
  const smoothed = Number(
    (window.reduce((sum, val) => sum + val, 0) / window.length).toFixed(4),
  );

  return {
    gesture: extendedFingers >= 5 && smoothed >= 0.75 ? "open_palm" : "none",
    confidence: smoothed,
    extended_fingers: extendedFingers,
    face_detector_initialized: false,
    landmarks_retained: false,
  };
}

/**
 * Local companion perception pipeline converting in-memory analyzer summaries into
 * structured `calibration.state`, `observation.candidate`, `observation.stable`,
 * and `observation.invalid` envelopes without raw media or landmark egress
 * (FR-RS-004, FR-RS-005, FR-RS-006, INT-RS-002, NFR-RS-005, SEC-RS-001, SEC-RS-006, AC-RS-005, AC-RS-014).
 */
export class CompanionPerceptionPipeline {
  private sequenceCounter = 0;
  private holdStartedAtMs: number | null = null;
  private missingCandidateFrames = 0;
  private readonly gestureHistory: number[] = [];

  constructor(private readonly config: PerceptionPipelineConfig) {
    if (
      config.enable_face_detection ||
      config.enable_emotion_inference ||
      config.enable_identity_inference ||
      config.enable_age_inference
    ) {
      throw new Error("biometric_or_face_inference_forbidden");
    }
    if (
      !config.session_id.trim() ||
      !config.device_id.trim() ||
      !config.puzzle_id.trim() ||
      !config.calibration_version.trim() ||
      !config.object_kit_version.trim() ||
      !Number.isSafeInteger(config.hold_ms) ||
      config.hold_ms < 0 ||
      !isFiniteInRange(config.min_confidence, 0.5, 1)
    ) {
      throw new Error("invalid_perception_pipeline_config");
    }
  }

  private nextSequence(): number {
    this.sequenceCounter += 1;
    return this.sequenceCounter;
  }

  private buildEnvelope(
    type: EmittedCompanionEnvelope["type"],
    observedAtMs: number,
    payload: Record<string, unknown>,
    tvGuidance: string,
    fallbackAvailable: boolean,
    recoveryLatencyMs = 0,
  ): EmittedCompanionEnvelope {
    const seq = this.nextSequence();
    const fullPayload =
      type === "observation.candidate" || type === "observation.stable"
        ? { ...payload, sequence: seq }
        : payload;
    const envelope = {
      schema_version: 1,
      message_id: `msg-${this.config.session_id}-${seq}`,
      session_id: this.config.session_id,
      device_id: this.config.device_id,
      sequence: seq,
      sent_at: new Date(Math.max(0, observedAtMs)).toISOString(),
      type,
      payload: fullPayload,
    };
    return {
      raw_json: JSON.stringify(envelope),
      type,
      sequence: seq,
      tv_guidance: tvGuidance,
      fallback_available: fallbackAvailable,
      recovery_latency_ms: recoveryLatencyMs,
      raw_frame_emitted: false,
      landmarks_emitted: false,
    };
  }

  processFrameSummary(frame: PerceptionFrameSummary): EmittedCompanionEnvelope {
    if (frame.biometric_flags) {
      for (const key of Object.keys(frame.biometric_flags)) {
        if (
          FORBIDDEN_BIOMETRIC_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""))
        ) {
          throw new Error("biometric_or_face_inference_forbidden");
        }
      }
    }

    const cal = evaluateMatCalibration(frame.calibration);
    if (frame.camera_lost || frame.occluded || !cal.calibration_valid) {
      this.holdStartedAtMs = null;
      this.missingCandidateFrames = 0;
      const reasonCodes = [
        ...cal.reason_codes,
        ...(frame.camera_lost ? ["camera_lost"] : []),
        ...(frame.occluded ? ["occluded"] : []),
      ];
      return this.buildEnvelope(
        "observation.invalid",
        frame.observed_at_ms,
        {
          puzzle_id: this.config.puzzle_id,
          calibration_version: this.config.calibration_version,
          object_kit_version: this.config.object_kit_version,
          calibration_valid: false,
          reason_codes:
            reasonCodes.length > 0 ? reasonCodes : ["calibration_invalid"],
        },
        cal.tv_guidance,
        true,
        Math.min(250, MAX_PERCEPTION_LOSS_RECOVERY_MS),
      );
    }

    // Gesture evaluation path
    if (this.config.predicate === "open_palm") {
      const palm = evaluateOpenPalmGesture(
        frame.hand_landmarks ?? [],
        this.gestureHistory,
      );
      if (palm.confidence > 0) {
        this.gestureHistory.push(palm.confidence);
      }
      const eligible =
        palm.gesture === "open_palm" &&
        palm.confidence >= this.config.min_confidence;
      return this.emitObservationProgress({
        observedAtMs: frame.observed_at_ms,
        confidence: palm.confidence,
        normalizedMargin: null,
        overlap: null,
        candidatePresent: eligible,
        needsReview: false,
        tvGuidance: eligible
          ? "Hold still… open palm detected."
          : "Raise an open palm comfortably in frame, or use the remote shield control.",
      });
    }

    // Allowlisted object filter and color mapping
    const allowlisted = (frame.detections ?? []).filter((det) =>
      ALLOWLISTED_DETECTOR_CLASSES.has(
        det.detector_class as AllowlistedDetectorClass,
      ),
    );

    let unknownColorForRequiredCup = false;
    const resolvedObjects = new Map<
      string,
      { confidence: number; box: NormalizedBoundingBox }
    >();

    for (const det of allowlisted) {
      if (
        !isFiniteInRange(det.confidence, 0, 1) ||
        !isValidNormalizedBox(det.bounding_box)
      ) {
        continue;
      }
      if (det.detector_class === "cup") {
        const cupColor = classifyCupColor(det.hsv_sample);
        if (cupColor === "unknown") {
          if (
            this.config.subject === "red_cup" ||
            this.config.subject === "blue_cup"
          ) {
            unknownColorForRequiredCup = true;
          }
          continue;
        }
        const objectId = cupColor === "red" ? "red_cup" : "blue_cup";
        resolvedObjects.set(objectId, {
          confidence: det.confidence,
          box: det.bounding_box,
        });
      } else {
        resolvedObjects.set(det.detector_class, {
          confidence: det.confidence,
          box: det.bounding_box,
        });
      }
    }

    if (
      unknownColorForRequiredCup &&
      !resolvedObjects.has(this.config.subject)
    ) {
      this.holdStartedAtMs = null;
      this.missingCandidateFrames = 0;
      return this.buildEnvelope(
        "observation.candidate",
        frame.observed_at_ms,
        {
          puzzle_id: this.config.puzzle_id,
          calibration_version: this.config.calibration_version,
          object_kit_version: this.config.object_kit_version,
          observation_id: `obs-${this.config.puzzle_id}-${frame.frame_sequence}`,
          subject: this.config.subject,
          predicate: this.config.predicate,
          target: this.config.target,
          confidence: 0,
          normalized_margin: null,
          overlap: null,
          observed_at_ms: frame.observed_at_ms,
          calibration_valid: true,
          needs_review: true,
          occluded: false,
          candidate_present: false,
        },
        "Cup color unclear—use the labeled cup or remote path",
        true,
      );
    }

    const subjectObj = resolvedObjects.get(this.config.subject);
    if (!subjectObj) {
      return this.emitObservationProgress({
        observedAtMs: frame.observed_at_ms,
        confidence: 0,
        normalizedMargin: null,
        overlap: null,
        candidatePresent: false,
        needsReview: false,
        tvGuidance: "Place the required object on the calibrated PlayMat.",
      });
    }

    if (this.config.predicate === "left_of") {
      const targetObj = this.config.target
        ? resolvedObjects.get(this.config.target)
        : undefined;
      if (!targetObj) {
        return this.emitObservationProgress({
          observedAtMs: frame.observed_at_ms,
          confidence: subjectObj.confidence,
          normalizedMargin: null,
          overlap: null,
          candidatePresent: false,
          needsReview: false,
          tvGuidance: "Place both objects inside the calibrated PlayMat view.",
        });
      }
      const combinedConfidence = Number(
        Math.min(subjectObj.confidence, targetObj.confidence).toFixed(4),
      );
      const spatial = evaluateLeftOf(
        subjectObj.box,
        targetObj.box,
        this.config.normalized_margin ?? 0.05,
      );
      const eligible =
        spatial.satisfied && combinedConfidence >= this.config.min_confidence;
      return this.emitObservationProgress({
        observedAtMs: frame.observed_at_ms,
        confidence: combinedConfidence,
        normalizedMargin: spatial.normalized_margin,
        overlap: null,
        candidatePresent: eligible,
        needsReview: false,
        tvGuidance: eligible
          ? "Hold still… alignment found."
          : "Place the red lens to the left of the archive book.",
      });
    }

    if (this.config.predicate === "inside_zone") {
      const zoneBox = this.config.target
        ? this.config.zone_boxes?.[this.config.target]
        : undefined;
      if (!zoneBox) {
        throw new Error("zone_polygon_not_configured");
      }
      const spatial = evaluateInsideZone(
        subjectObj.box,
        zoneBox,
        this.config.minimum_overlap ?? 0.6,
      );
      const eligible =
        spatial.satisfied &&
        subjectObj.confidence >= this.config.min_confidence;
      return this.emitObservationProgress({
        observedAtMs: frame.observed_at_ms,
        confidence: subjectObj.confidence,
        normalizedMargin: null,
        overlap: spatial.overlap,
        candidatePresent: eligible,
        needsReview: false,
        tvGuidance: eligible
          ? "Hold still… zone placement verified."
          : "Place the object inside the marked zone.",
      });
    }

    const eligible = subjectObj.confidence >= this.config.min_confidence;
    return this.emitObservationProgress({
      observedAtMs: frame.observed_at_ms,
      confidence: subjectObj.confidence,
      normalizedMargin: null,
      overlap: null,
      candidatePresent: eligible,
      needsReview: false,
      tvGuidance: eligible ? "Object detected." : "Awaiting object.",
    });
  }

  private emitObservationProgress(input: {
    observedAtMs: number;
    confidence: number;
    normalizedMargin: number | null;
    overlap: number | null;
    candidatePresent: boolean;
    needsReview: boolean;
    tvGuidance: string;
  }): EmittedCompanionEnvelope {
    if (!input.candidatePresent) {
      if (this.holdStartedAtMs !== null && this.missingCandidateFrames < 1) {
        this.missingCandidateFrames += 1;
      } else {
        this.holdStartedAtMs = null;
        this.missingCandidateFrames = 0;
      }
      return this.buildEnvelope(
        "observation.candidate",
        input.observedAtMs,
        {
          puzzle_id: this.config.puzzle_id,
          calibration_version: this.config.calibration_version,
          object_kit_version: this.config.object_kit_version,
          observation_id: `obs-${this.config.puzzle_id}-${this.sequenceCounter + 1}`,
          subject: this.config.subject,
          predicate: this.config.predicate,
          target: this.config.target,
          confidence: input.confidence,
          normalized_margin: input.normalizedMargin,
          overlap: input.overlap,
          observed_at_ms: input.observedAtMs,
          calibration_valid: true,
          needs_review: input.needsReview,
          occluded: false,
          candidate_present: false,
        },
        input.tvGuidance,
        false,
      );
    }

    this.missingCandidateFrames = 0;
    if (this.holdStartedAtMs === null) {
      this.holdStartedAtMs = input.observedAtMs;
    }
    const heldMs = input.observedAtMs - this.holdStartedAtMs;
    const isStable = heldMs >= this.config.hold_ms;

    return this.buildEnvelope(
      isStable ? "observation.stable" : "observation.candidate",
      input.observedAtMs,
      {
        puzzle_id: this.config.puzzle_id,
        calibration_version: this.config.calibration_version,
        object_kit_version: this.config.object_kit_version,
        observation_id: `obs-${this.config.puzzle_id}-${this.sequenceCounter + 1}`,
        subject: this.config.subject,
        predicate: this.config.predicate,
        target: this.config.target,
        confidence: input.confidence,
        normalized_margin: input.normalizedMargin,
        overlap: input.overlap,
        observed_at_ms: input.observedAtMs,
        calibration_valid: true,
        needs_review: input.needsReview,
        occluded: false,
        candidate_present: true,
      },
      input.tvGuidance,
      false,
    );
  }
}
