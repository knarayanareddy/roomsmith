import { describe, expect, it } from "vitest";
import {
  MAX_OBSERVATION_MESSAGE_BYTES,
  ObservationIngress,
} from "../../packages/session-contracts/src/index.js";

const context = {
  sessionId: "session-fixture",
  puzzleId: "align_lighthouse",
  calibrationVersion: "mat-v1",
  objectKitVersion: "kit-v1",
  authorizedDeviceIds: ["companion-fixture"],
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    puzzle_id: context.puzzleId,
    calibration_version: context.calibrationVersion,
    object_kit_version: context.objectKitVersion,
    observation_id: "observation-fixture",
    subject: "red_cup",
    predicate: "left_of",
    target: "book",
    confidence: 0.9,
    normalized_margin: 0.2,
    overlap: null,
    observed_at_ms: 0,
    sequence: 1,
    calibration_valid: true,
    needs_review: false,
    occluded: false,
    candidate_present: true,
    ...overrides,
  };
}

function message(
  type: string,
  sequenceNumber: number,
  body: Record<string, unknown>,
  id = `message-${sequenceNumber}`,
  envelopeOverrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schema_version: 1,
    message_id: id,
    session_id: context.sessionId,
    device_id: "companion-fixture",
    sequence: sequenceNumber,
    sent_at: "2026-10-23T12:00:00.000Z",
    type,
    payload: body,
    ...envelopeOverrides,
  });
}

function observation(
  type: "observation.candidate" | "observation.stable",
  sequenceNumber: number,
  overrides: Record<string, unknown> = {},
  id?: string,
): string {
  return message(
    type,
    sequenceNumber,
    payload({
      sequence: sequenceNumber,
      observed_at_ms: sequenceNumber * 500,
      ...overrides,
    }),
    id,
  );
}

describe("RoomSmith structured observation ingress", () => {
  it("accepts candidates and stable proposals without committing a puzzle", () => {
    const ingress = new ObservationIngress(context);
    const candidate = ingress.accept(observation("observation.candidate", 1));
    expect(candidate.disposition).toBe("accepted_candidate");
    expect(candidate.observation).toMatchObject({
      session_id: context.sessionId,
      puzzle_id: context.puzzleId,
      sequence: 1,
      candidate_present: true,
    });
    expect(candidate.puzzle_commit).toBe(false);
    const stable = ingress.accept(observation("observation.stable", 2));
    expect(stable.disposition).toBe("accepted_stable_proposal");
    expect(stable.hold_verification_required).toBe(true);
    expect(stable.puzzle_commit).toBe(false);
    expect(stable.raw_media_accepted).toBe(false);
  });

  it("deduplicates exact messages, rejects stale sequences, and detects replay conflicts", () => {
    const ingress = new ObservationIngress(context);
    const raw = observation("observation.stable", 1);
    expect(ingress.accept(raw).disposition).toBe("accepted_stable_proposal");
    const duplicate = ingress.accept(raw);
    expect(duplicate.disposition).toBe("duplicate");
    expect(duplicate.observation?.observation_id).toBe("observation-fixture");
    expect(
      ingress.accept(observation("observation.candidate", 1, {}, "new-id"))
        .disposition,
    ).toBe("stale");
    const conflict = ingress.accept(
      observation("observation.candidate", 2, { confidence: 0.1 }, "message-1"),
    );
    expect(conflict.disposition).toBe("rejected");
    expect(conflict.reason_code).toBe("message_replay_conflict");
    expect(conflict.security_event?.raw_payload_included).toBe(false);
  });

  it("cancels verification on invalidation and requires calibration recovery", () => {
    const ingress = new ObservationIngress(context);
    expect(
      ingress.accept(observation("observation.candidate", 1)).disposition,
    ).toBe("accepted_candidate");
    const invalid = ingress.accept(
      message("observation.invalid", 2, {
        puzzle_id: context.puzzleId,
        calibration_version: context.calibrationVersion,
        object_kit_version: context.objectKitVersion,
        calibration_valid: false,
        reason_codes: ["occluded"],
      }),
    );
    expect(invalid.disposition).toBe("invalid_observation");
    expect(invalid.candidate_verification_cancelled).toBe(true);
    expect(invalid.fallback_available).toBe(true);
    expect(
      ingress.accept(observation("observation.candidate", 3)).disposition,
    ).toBe("invalid_observation");
    const calibrated = ingress.accept(
      message("calibration.state", 4, {
        puzzle_id: context.puzzleId,
        calibration_version: context.calibrationVersion,
        object_kit_version: context.objectKitVersion,
        calibration_valid: true,
        needs_review: false,
        occluded: false,
        reason_codes: [],
      }),
    );
    expect(calibrated.disposition).toBe("accepted_calibration");
    expect(
      ingress.accept(observation("observation.candidate", 5)).disposition,
    ).toBe("accepted_candidate");
  });

  it("rejects forged completion, media, oversized JSON, and malformed input without raw echoes", () => {
    const ingress = new ObservationIngress(context);
    const forged = ingress.accept(
      message("puzzle.complete", 1, { secret: "do-not-echo" }),
    );
    expect(forged.disposition).toBe("rejected");
    expect(forged.reason_code).toBe("companion_commit_rejected");
    expect(forged.security_event).toMatchObject({
      code: "companion_commit_rejected",
      raw_payload_included: false,
    });
    expect(JSON.stringify(forged)).not.toContain("do-not-echo");
    const media = ingress.accept(
      observation("observation.candidate", 2, {
        image: "data:image/png;base64,secret",
      }),
    );
    expect(media.reason_code).toBe("media_payload_forbidden");
    expect(media.security_event?.raw_payload_included).toBe(false);
    const camelCaseMedia = ingress.accept(
      observation("observation.candidate", 3, { frameBuffer: "secret" }),
    );
    expect(camelCaseMedia.reason_code).toBe("media_payload_forbidden");
    expect(ingress.accept("not json").reason_code).toBe("malformed_json");
    expect(
      ingress.accept("x".repeat(MAX_OBSERVATION_MESSAGE_BYTES + 1)).reason_code,
    ).toBe("message_too_large");
  });

  it("binds session, device, puzzle, and calibration versions and revokes access", () => {
    const ingress = new ObservationIngress(context);
    expect(
      ingress.accept(
        observation("observation.candidate", 1, {}, "wrong-session").replace(
          context.sessionId,
          "other-session",
        ),
      ).reason_code,
    ).toBe("session_binding_failed");
    expect(
      ingress.accept(
        message("observation.candidate", 1, payload(), "wrong-device", {
          device_id: "unauthorized-device",
        }),
      ).reason_code,
    ).toBe("device_not_authorized");
    expect(
      ingress.accept(
        observation("observation.candidate", 1, {
          calibration_version: "mat-old",
        }),
      ).disposition,
    ).toBe("invalid_observation");
    ingress.revokeDevice("companion-fixture");
    expect(
      ingress.accept(observation("observation.candidate", 2)).reason_code,
    ).toBe("device_not_authorized");
  });

  it("forwards a missing candidate only as a candidate and rejects unstable review flags", () => {
    const ingress = new ObservationIngress(context);
    const missing = ingress.accept(
      observation("observation.candidate", 1, { candidate_present: false }),
    );
    expect(missing.disposition).toBe("accepted_candidate");
    expect(missing.observation?.candidate_present).toBe(false);
    const stableMissing = ingress.accept(
      observation("observation.stable", 2, { candidate_present: false }),
    );
    expect(stableMissing.disposition).toBe("invalid_observation");
    const review = ingress.accept(
      observation("observation.candidate", 3, { needs_review: true }),
    );
    expect(review.disposition).toBe("invalid_observation");
    expect(review.fallback_available).toBe(true);
  });
});
