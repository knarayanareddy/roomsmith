import { ObservationIngress } from "../packages/session-contracts/src/index.js";
import { FixtureDirectorService } from "../services/director/src/fixture-director-service.js";

const context = {
  sessionId: "session-walking-fixture",
  puzzleId: "align_lighthouse",
  calibrationVersion: "mat-v1",
  objectKitVersion: "kit-v1",
  authorizedDeviceIds: ["companion-walking-fixture"],
};
const ingress = new ObservationIngress(context);

function observation(type: string, sequence: number, id: string): string {
  return JSON.stringify({
    schema_version: 1,
    message_id: id,
    session_id: context.sessionId,
    device_id: "companion-walking-fixture",
    sequence,
    sent_at: "2026-10-23T12:00:00.000Z",
    type,
    payload: {
      puzzle_id: context.puzzleId,
      calibration_version: context.calibrationVersion,
      object_kit_version: context.objectKitVersion,
      observation_id: id,
      subject: "red_cup",
      predicate: "left_of",
      target: "book",
      confidence: 0.9,
      normalized_margin: 0.2,
      overlap: null,
      observed_at_ms: sequence * 500,
      sequence,
      calibration_valid: true,
      needs_review: false,
      occluded: false,
      candidate_present: true,
    },
  });
}

const candidate = ingress.accept(
  observation("observation.candidate", 1, "walking-candidate"),
);
const stableRaw = observation("observation.stable", 2, "walking-stable");
const stable = ingress.accept(stableRaw);
const duplicate = ingress.accept(stableRaw);
const invalid = ingress.accept(
  JSON.stringify({
    schema_version: 1,
    message_id: "walking-invalid",
    session_id: context.sessionId,
    device_id: "companion-walking-fixture",
    sequence: 3,
    sent_at: "2026-10-23T12:00:02.000Z",
    type: "observation.invalid",
    payload: {
      puzzle_id: context.puzzleId,
      calibration_version: context.calibrationVersion,
      object_kit_version: context.objectKitVersion,
      calibration_valid: false,
      reason_codes: ["occluded"],
    },
  }),
);
const forged = ingress.accept(
  JSON.stringify({
    schema_version: 1,
    message_id: "walking-forged-completion",
    session_id: context.sessionId,
    device_id: "companion-walking-fixture",
    sequence: 4,
    sent_at: "2026-10-23T12:00:03.000Z",
    type: "puzzle.complete",
    payload: { puzzle_id: context.puzzleId },
  }),
);
const director = new FixtureDirectorService(
  {
    lighthouse_alignment: [
      "Check the lens label, then compare its position with the book.",
    ],
  },
  {
    gateway: () => ({
      text: "malformed",
      hint_level: 1,
      target_role: "observer",
      uses_fallback: false,
    }),
  },
);
const directed = await director.requestHint({
  episode_version: "1.0.0",
  puzzle_id: "lighthouse_alignment",
  attempt_count: 1,
  hint_level: 1,
  last_error: "color_unknown",
  transport: "webrtc",
  accessibility_mode: "standard",
});
let directorMediaRejected = false;
try {
  await director.requestHint({
    episode_version: "1.0.0",
    puzzle_id: "lighthouse_alignment",
    attempt_count: 1,
    hint_level: 1,
    last_error: "color_unknown",
    transport: "webrtc",
    accessibility_mode: "standard",
    frame: "forbidden-raw-media",
  });
} catch (error) {
  directorMediaRejected =
    error instanceof Error &&
    error.message === "director_context_field_rejected";
}

console.log(
  JSON.stringify(
    {
      mode: "FIXTURE ONLY — structured ingress; no CameraX, WebRTC, Fire TV, or backend",
      candidate_disposition: candidate.disposition,
      stable_disposition: stable.disposition,
      stable_hold_verification_required: stable.hold_verification_required,
      duplicate_disposition: duplicate.disposition,
      invalid_disposition: invalid.disposition,
      invalid_cancels_verification: invalid.candidate_verification_cancelled,
      remote_fallback_available: invalid.fallback_available,
      forged_completion_disposition: forged.disposition,
      forged_security_event: forged.security_event,
      director_hint_source: directed.source,
      director_fallback_reason: directed.fallback_reason,
      director_hint_uses_fallback: directed.hint.uses_fallback,
      director_state_mutated: directed.state_mutated,
      director_media_context_rejected: directorMediaRejected,
      tv_puzzle_committed: false,
      raw_media_accepted: false,
      notice:
        "Synthetic companion messages and an injected fixture director only; the authoritative Kotlin PuzzleEngine must still verify hold and commit any puzzle completion. No Bedrock, Polly, WebRTC, or backend connection is claimed.",
    },
    null,
    2,
  ),
);
