import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeGraphSha256,
  type PuzzleDocument,
} from "../../packages/content-compiler/src/index.js";
import {
  CompanionPerceptionPipeline,
  MAX_PERCEPTION_LOSS_RECOVERY_MS,
} from "../../packages/perception/src/index.js";
import {
  MAX_OBSERVATION_MESSAGE_BYTES,
  ObservationIngress,
} from "../../packages/session-contracts/src/index.js";
import {
  buildAndSignEpisodeBundle,
  createContentSigningKeyPair,
  FireOsBundleStore,
  SignedContentDistributionService,
} from "../../services/content/src/signed-content-service.js";
import { PairingService } from "../../services/pairing/src/pairing-service.js";
import { SignalingService } from "../../services/signaling/src/signaling-service.js";

const schema = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../schemas/puzzle-graph.schema.json", import.meta.url),
    ),
    "utf8",
  ),
) as object;

const draftExample = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../examples/puzzle-graph.example.json", import.meta.url),
    ),
    "utf8",
  ),
) as PuzzleDocument;

const AUTHORED_HINTS = {
  lighthouse_alignment: [
    "Check the printed red lens label and compare its position with the book.",
    "Place the red lens cup to the left of the archive book and hold still.",
  ],
  raise_the_shield: [
    "Raise one open palm comfortably in frame or choose the remote shield option.",
    "Hold the open palm steady or use the remote shield button to raise the barrier.",
  ],
  lens_archive_sequence: [
    "Start with the circle lens zone before moving the archive book into place.",
    "Place the blue lens in the circle zone first, then the book in the square zone.",
  ],
};

describe("cross-module content, pairing, signaling, perception, and ingress contracts", () => {
  it("verifies signed bundle publication to Fire OS store contract and rollback on tamper (FR-RS-001, FR-RS-014, SEC-RS-004, AC-RS-001)", () => {
    const key = createContentSigningKeyPair("contract-key-1");
    const doc = structuredClone(draftExample);
    doc.content_version = "1.0.0";
    doc.assets = doc.assets.map((asset, idx) => ({
      ...asset,
      sha256: `${idx + 1}f0e1d2c`.repeat(8),
    }));
    doc.review = {
      status: "approved",
      game_design_reviewer: "Reviewer A",
      safety_reviewer: "Reviewer B",
      accessibility_reviewer: "Reviewer C",
      reviewed_at: "2026-10-23T12:00:00.000Z",
      graph_sha256: "",
    };
    doc.review.graph_sha256 = computeGraphSha256(doc);

    const bundle = buildAndSignEpisodeBundle({
      document: doc,
      authoredHints: AUTHORED_HINTS,
      signingKey: key,
      schema,
    });

    const cdnService = new SignedContentDistributionService(
      { [key.keyId]: key.publicKeyPem },
      schema,
    );
    expect(cdnService.publishBundle(bundle).valid).toBe(true);

    const fireOsStore = new FireOsBundleStore(
      { [key.keyId]: key.publicKeyPem },
      schema,
    );
    const downloaded = cdnService.getBundle(bundle.manifest.episode_id);
    expect(fireOsStore.launch(downloaded).status).toBe("launched");

    // Mutate predicate min_confidence after signing -> rejected and active bundle retained
    const ForgedBundle = structuredClone(downloaded);
    ForgedBundle.document.nodes[1]!.requirements![0]!.min_confidence = 0.5;
    const launchForged = fireOsStore.launch(ForgedBundle);
    expect(launchForged.status).toBe("rolled_back");
    expect(launchForged.reason_code).toBe("bundle_digest_mismatch");
    expect(
      launchForged.active_bundle?.document.nodes[1]?.requirements?.[0]
        ?.min_confidence,
    ).toBe(0.7);
  });

  it("verifies end-to-end pairing, signaling, cloud-relay fallback, perception emission, and ingress revocation contract (FR-RS-003..006, AC-RS-002..005, AC-RS-020)", () => {
    const pairing = new PairingService();
    const signaling = new SignalingService(pairing);
    const session = pairing.createSession({
      session_id: "01JCONTRACT000000000000001",
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
      },
      adult_supervision_confirmed: true,
      privacy_notice_acknowledged: true,
      now_ms: 1_000,
    });

    const exchange = pairing.exchangePairing({
      session_id: session.session_id,
      pairing_code: session.pairing!.pairing_code,
      pairing_nonce: session.pairing!.pairing_nonce,
      device_id: "companion-contract-1",
      now_ms: 1_200,
    });
    expect(exchange.disposition).toBe("issued");
    const token = exchange.credential!.access_token;

    const ingress = new ObservationIngress({
      sessionId: session.session_id,
      puzzleId: "lighthouse_alignment",
      calibrationVersion: "mat-v1",
      objectKitVersion: "kit-v1",
      authorizedDeviceIds: ["companion-contract-1"],
    });
    pairing.onSessionRevoked((revokedSessionId) => {
      if (revokedSessionId === session.session_id) {
        signaling.revokeSessionSignaling(revokedSessionId);
        ingress.revokeDevice("companion-contract-1");
      }
    });

    // Activate labeled cloud relay fallback after simulated ICE failure
    const relayState = signaling.activateCloudRelayFallback({
      session_id: session.session_id,
      device_id: "companion-contract-1",
      access_token: token,
      failure_reason: "nat_traversal_blocked",
      now_ms: 1_500,
    });
    expect(relayState).toMatchObject({
      disposition: "activated",
      transport: "cloud_relay",
      cloud_relay_labeled: true,
    });

    const perception = new CompanionPerceptionPipeline({
      session_id: session.session_id,
      device_id: "companion-contract-1",
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

    const validCalibration = {
      detected_marker_ids: [0, 1, 2, 3],
      reprojection_error_px: 1.9,
      normalized_mat_area: 0.5,
      glare_score: 0.1,
      blur_score: 0.1,
      selected_object_kit: ["red_cup", "blue_cup", "book"],
      required_objects: ["red_cup", "blue_cup", "book"],
    };
    const validDetections = [
      {
        detector_class: "cup",
        confidence: 0.93,
        bounding_box: { x: 0.12, y: 0.4, width: 0.12, height: 0.15 },
        hsv_sample: { h: 12, s: 0.88, v: 0.82, white_balanced: true },
      },
      {
        detector_class: "book",
        confidence: 0.9,
        bounding_box: { x: 0.52, y: 0.35, width: 0.2, height: 0.25 },
      },
    ];

    const emittedCandidate = perception.processFrameSummary({
      frame_sequence: 1,
      observed_at_ms: 2_000,
      calibration: validCalibration,
      detections: validDetections,
    });
    expect(
      Buffer.byteLength(emittedCandidate.raw_json, "utf8"),
    ).toBeLessThanOrEqual(MAX_OBSERVATION_MESSAGE_BYTES);

    const relayedCandidate = signaling.relayStructuredMessage({
      session_id: session.session_id,
      device_id: "companion-contract-1",
      access_token: token,
      raw_envelope: emittedCandidate.raw_json,
      ingress,
      now_ms: 2_010,
    });
    expect(relayedCandidate.disposition).toBe("relayed");
    expect(relayedCandidate.ingress_result?.disposition).toBe(
      "accepted_candidate",
    );

    const emittedStable = perception.processFrameSummary({
      frame_sequence: 2,
      observed_at_ms: 3_000,
      calibration: validCalibration,
      detections: validDetections,
    });
    const relayedStable = signaling.relayStructuredMessage({
      session_id: session.session_id,
      device_id: "companion-contract-1",
      access_token: token,
      raw_envelope: emittedStable.raw_json,
      ingress,
      now_ms: 3_010,
    });
    expect(relayedStable.ingress_result?.disposition).toBe(
      "accepted_stable_proposal",
    );
    expect(relayedStable.ingress_result?.hold_verification_required).toBe(true);
    expect(relayedStable.ingress_result?.puzzle_commit).toBe(false);

    // Camera loss / missing markers cancels verification within 2s budget
    const emittedLoss = perception.processFrameSummary({
      frame_sequence: 3,
      observed_at_ms: 3_200,
      calibration: { ...validCalibration, detected_marker_ids: [0] },
      detections: validDetections,
    });
    expect(emittedLoss.recovery_latency_ms).toBeLessThanOrEqual(
      MAX_PERCEPTION_LOSS_RECOVERY_MS,
    );
    const relayedLoss = signaling.relayStructuredMessage({
      session_id: session.session_id,
      device_id: "companion-contract-1",
      access_token: token,
      raw_envelope: emittedLoss.raw_json,
      ingress,
      now_ms: 3_210,
    });
    expect(relayedLoss.ingress_result?.disposition).toBe("invalid_observation");
    expect(relayedLoss.ingress_result?.candidate_verification_cancelled).toBe(
      true,
    );
    expect(relayedLoss.ingress_result?.fallback_available).toBe(true);

    // Revoke companion -> blocks both signaling relay and direct ObservationIngress
    pairing.revokeCompanion(session.session_id, 4_000);
    const postRevokeFrame = perception.processFrameSummary({
      frame_sequence: 4,
      observed_at_ms: 4_100,
      calibration: validCalibration,
      detections: validDetections,
    });
    const relayedAfterRevoke = signaling.relayStructuredMessage({
      session_id: session.session_id,
      device_id: "companion-contract-1",
      access_token: token,
      raw_envelope: postRevokeFrame.raw_json,
      ingress,
      now_ms: 4_110,
    });
    expect(relayedAfterRevoke.disposition).toBe("rejected");
    expect(relayedAfterRevoke.reason_code).toBe("companion_revoked");
    expect(ingress.accept(postRevokeFrame.raw_json).reason_code).toBe(
      "device_not_authorized",
    );
  });
});
