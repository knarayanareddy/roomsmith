import { describe, expect, it } from "vitest";
import { ObservationIngress } from "../../packages/session-contracts/src/index.js";
import {
  PAIRING_CODE_TTL_MS,
  PairingService,
  SESSION_RETENTION_TTL_MS,
  type PrePlaySetupInput,
} from "../../services/pairing/src/pairing-service.js";
import {
  MAX_SIGNALING_REQUESTS_PER_WINDOW,
  SignalingService,
  type DataChannelContractSpec,
} from "../../services/signaling/src/signaling-service.js";

const VALID_CHANNELS: DataChannelContractSpec[] = [
  { label: "observations", ordered: false, maxRetransmits: 0 },
  { label: "control", ordered: true, maxRetransmits: null },
];

const VALID_SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=sctp-port:5000",
].join("\r\n");

const VALID_ICE =
  "candidate:842163049 1 udp 1677729535 192.0.2.10 54400 typ srflx";

function setupInput(
  overrides: Partial<PrePlaySetupInput> = {},
): PrePlaySetupInput {
  return {
    session_id: "01JROOMSMITHSESSION0000001",
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
    ...overrides,
  };
}

describe("RoomSmith pre-play setup, pairing, signaling, revocation, and deletion", () => {
  it("validates pre-play setup, idempotency keys, and solo/multiplayer role assignment (FR-RS-002, FR-RS-009)", () => {
    const pairing = new PairingService();
    expect(() =>
      pairing.createSession(setupInput({ adult_supervision_confirmed: false })),
    ).toThrow("adult_supervision_required");
    expect(() =>
      pairing.createSession(setupInput({ privacy_notice_acknowledged: false })),
    ).toThrow("privacy_acknowledgement_required");
    expect(() =>
      pairing.createSession(setupInput({ player_count: 5 })),
    ).toThrow("invalid_player_count");
    expect(() =>
      pairing.createSession(
        setupInput({ selected_object_kit: ["red_cup", "book"] }),
      ),
    ).toThrow("missing_required_kit_object:blue_cup");

    const created = pairing.createSession(
      setupInput({ idempotency_key: "idem-setup-1" }),
    );
    const replayed = pairing.createSession(
      setupInput({
        session_id: "different-ignored-on-replay",
        idempotency_key: "idem-setup-1",
      }),
    );
    expect(replayed.session_id).toBe(created.session_id);
    expect(() =>
      pairing.createSession(
        setupInput({ player_count: 3, idempotency_key: "idem-setup-1" }),
      ),
    ).toThrow("idempotency_key_reused");

    const solo = pairing.createSession(
      setupInput({
        session_id: "01JROOMSMITHSESSION0000002",
        player_count: 1,
      }),
    );
    expect(solo.solo_path).toBe(true);
    expect(solo.assigned_roles).toEqual(["navigator", "observer", "keeper"]);
  });

  it("issues single-use device-bound credentials and rejects consumed, expired, or brute-forced codes (AC-RS-002, SEC-RS-002)", () => {
    const pairing = new PairingService();
    const session = pairing.createSession(setupInput());
    const mat = session.pairing!;

    const exchanged = pairing.exchangePairing({
      session_id: session.session_id,
      pairing_code: mat.pairing_code,
      pairing_nonce: mat.pairing_nonce,
      device_id: "companion-1",
      now_ms: 2_000,
    });
    expect(exchanged.disposition).toBe("issued");
    expect(exchanged.credential?.device_id).toBe("companion-1");

    // Consumed code cannot issue a second credential (AC-RS-002)
    const consumedAttempt = pairing.exchangePairing({
      session_id: session.session_id,
      pairing_code: mat.pairing_code,
      pairing_nonce: mat.pairing_nonce,
      device_id: "companion-2",
      now_ms: 2_500,
    });
    expect(consumedAttempt.disposition).toBe("rejected");
    expect(consumedAttempt.reason_code).toBe("pairing_already_consumed");
    expect(consumedAttempt.credential).toBeNull();

    // Expired pairing material rejected (AC-RS-002)
    const expiringSession = pairing.createSession(
      setupInput({ session_id: "01JROOMSMITHSESSION0000003", now_ms: 1_000 }),
    );
    const expiredResult = pairing.exchangePairing({
      session_id: expiringSession.session_id,
      pairing_code: expiringSession.pairing!.pairing_code,
      pairing_nonce: expiringSession.pairing!.pairing_nonce,
      device_id: "companion-exp",
      now_ms: 1_000 + PAIRING_CODE_TTL_MS + 1,
    });
    expect(expiredResult.disposition).toBe("rejected");
    expect(expiredResult.reason_code).toBe("pairing_expired");

    // Brute-force lockout after 5 wrong attempts
    const bruteSession = pairing.createSession(
      setupInput({ session_id: "01JROOMSMITHSESSION0000004", now_ms: 1_000 }),
    );
    for (let i = 0; i < 5; i += 1) {
      pairing.exchangePairing({
        session_id: bruteSession.session_id,
        pairing_code: "WRONG1",
        pairing_nonce: "wrong-nonce",
        device_id: "companion-brute",
        now_ms: 1_500 + i,
      });
    }
    const lockedAttempt = pairing.exchangePairing({
      session_id: bruteSession.session_id,
      pairing_code: bruteSession.pairing!.pairing_code,
      pairing_nonce: bruteSession.pairing!.pairing_nonce,
      device_id: "companion-brute",
      now_ms: 2_000,
    });
    expect(lockedAttempt.reason_code).toBe("pairing_locked_brute_force");
  });

  it("delivers role clues, supports the solo reveal path, and blocks revoked companions until new adult approval (FR-RS-009, SEC-RS-008, AC-RS-020)", () => {
    const pairing = new PairingService();
    const signaling = new SignalingService(pairing);
    pairing.onSessionRevoked((id) => signaling.revokeSessionSignaling(id));

    const session = pairing.createSession(setupInput({ player_count: 2 }));
    const cred = pairing.exchangePairing({
      session_id: session.session_id,
      pairing_code: session.pairing!.pairing_code,
      pairing_nonce: session.pairing!.pairing_nonce,
      device_id: "companion-1",
      now_ms: 2_000,
    }).credential!;

    const privateClue = pairing.requestRoleClue({
      session_id: session.session_id,
      node_id: "node_shield_scene",
      role_id: "navigator",
      clue_text: "Raise the shield when the beacon flashes twice.",
      asset_id: "asset_shield_scene",
      solo_reveal_after_seconds: 15,
      elapsed_node_seconds: 2,
      device_id: "companion-1",
      access_token: cred.access_token,
      now_ms: 3_000,
    });
    expect(privateClue.disposition).toBe("delivered");
    expect(privateClue.delivery_channel).toBe("companion_private");

    // Revoke companion (SEC-RS-008, AC-RS-020)
    const revoked = pairing.revokeCompanion(session.session_id, 4_000);
    expect(revoked.revoked).toBe(true);
    expect(revoked.revoke_envelope.type).toBe("session.revoke");

    const deniedClue = pairing.requestRoleClue({
      session_id: session.session_id,
      node_id: "node_shield_scene",
      role_id: "navigator",
      clue_text: "Raise the shield when the beacon flashes twice.",
      asset_id: "asset_shield_scene",
      solo_reveal_after_seconds: 15,
      elapsed_node_seconds: 5,
      device_id: "companion-1",
      access_token: cred.access_token,
      now_ms: 4_500,
    });
    expect(deniedClue.disposition).toBe("denied");
    expect(deniedClue.reason_code).toBe("companion_revoked");
    expect(deniedClue.clue_text).toBeNull();

    // Shared solo timer reveal works without any companion after solo_reveal_after_seconds
    const pendingSolo = pairing.requestRoleClue({
      session_id: session.session_id,
      node_id: "node_shield_scene",
      role_id: "navigator",
      clue_text: "Raise the shield when the beacon flashes twice.",
      asset_id: "asset_shield_scene",
      solo_reveal_after_seconds: 15,
      elapsed_node_seconds: 10,
      now_ms: 5_000,
    });
    expect(pendingSolo.disposition).toBe("awaiting_solo_reveal");

    const revealedSolo = pairing.requestRoleClue({
      session_id: session.session_id,
      node_id: "node_shield_scene",
      role_id: "navigator",
      clue_text: "Raise the shield when the beacon flashes twice.",
      asset_id: "asset_shield_scene",
      solo_reveal_after_seconds: 15,
      elapsed_node_seconds: 15,
      now_ms: 5_500,
    });
    expect(revealedSolo.disposition).toBe("delivered");
    expect(revealedSolo.delivery_channel).toBe("solo_shared_screen");

    // Adult re-approval allows companion re-pairing
    const newPairing = pairing.approveNewCompanionPairing(session.session_id, {
      adult_supervision_confirmed: true,
      allow_device_id: "companion-1",
      now_ms: 6_000,
    });
    const reIssued = pairing.exchangePairing({
      session_id: session.session_id,
      pairing_code: newPairing.pairing_code,
      pairing_nonce: newPairing.pairing_nonce,
      device_id: "companion-1",
      now_ms: 6_500,
    });
    expect(reIssued.disposition).toBe("issued");
    expect(reIssued.credential?.epoch).toBe(2);
  });

  it("negotiates DataChannel-only WebRTC, rejects media tracks, redacts logs, and activates labeled cloud relay (AC-RS-003, AC-RS-004, SEC-RS-007)", () => {
    const pairing = new PairingService();
    const signaling = new SignalingService(pairing);
    const session = pairing.createSession(setupInput());
    const cred = pairing.exchangePairing({
      session_id: session.session_id,
      pairing_code: session.pairing!.pairing_code,
      pairing_nonce: session.pairing!.pairing_nonce,
      device_id: "companion-1",
      now_ms: 2_000,
    }).credential!;

    // Reject SDP containing audio or video tracks (AC-RS-003, SEC-RS-001)
    const videoOffer = signaling.submitOffer({
      session_id: session.session_id,
      device_id: "companion-1",
      access_token: cred.access_token,
      sdp: `${VALID_SDP}\r\nm=video 9 UDP/TLS/RTP/SAVPF 96`,
      data_channels: VALID_CHANNELS,
      now_ms: 2_100,
    });
    expect(videoOffer.disposition).toBe("rejected");
    expect(videoOffer.reason_code).toBe("media_track_forbidden");

    // Valid DataChannel offer/answer/ICE and TURN credentials
    expect(
      signaling.submitOffer({
        session_id: session.session_id,
        device_id: "companion-1",
        access_token: cred.access_token,
        sdp: VALID_SDP,
        data_channels: VALID_CHANNELS,
        now_ms: 2_200,
      }).disposition,
    ).toBe("accepted");
    expect(
      signaling.submitAnswer({
        session_id: session.session_id,
        device_id: "companion-1",
        access_token: cred.access_token,
        sdp: VALID_SDP,
        data_channels: VALID_CHANNELS,
        now_ms: 2_300,
      }).disposition,
    ).toBe("accepted");
    expect(
      signaling.submitIceCandidate({
        session_id: session.session_id,
        device_id: "companion-1",
        access_token: cred.access_token,
        candidate: VALID_ICE,
        sdp_mid: "0",
        sdp_m_line_index: 0,
        now_ms: 2_400,
      }).disposition,
    ).toBe("accepted");

    const turn = signaling.issueTurnCredentials({
      session_id: session.session_id,
      device_id: "companion-1",
      access_token: cred.access_token,
      now_ms: 2_500,
    });
    expect(turn.disposition).toBe("issued");
    expect(turn.turn?.structured_data_only).toBe(true);
    expect(turn.turn?.media_relay_allowed).toBe(false);

    // Direct WebRTC failure activates explicit cloud relay fallback (AC-RS-004)
    const fallback = signaling.activateCloudRelayFallback({
      session_id: session.session_id,
      device_id: "companion-1",
      access_token: cred.access_token,
      failure_reason: "ice_failed",
      now_ms: 2_600,
    });
    expect(fallback.disposition).toBe("activated");
    expect(fallback.transport).toBe("cloud_relay");
    expect(fallback.cloud_relay_labeled).toBe(true);

    const ingress = new ObservationIngress({
      sessionId: session.session_id,
      puzzleId: "lighthouse_alignment",
      calibrationVersion: "mat-v1",
      objectKitVersion: "kit-v1",
      authorizedDeviceIds: ["companion-1"],
    });
    const relayed = signaling.relayStructuredMessage({
      session_id: session.session_id,
      device_id: "companion-1",
      access_token: cred.access_token,
      ingress,
      now_ms: 2_700,
      raw_envelope: JSON.stringify({
        schema_version: 1,
        message_id: "relay-msg-1",
        session_id: session.session_id,
        device_id: "companion-1",
        sequence: 1,
        sent_at: "2026-10-23T12:00:00.000Z",
        type: "observation.candidate",
        payload: {
          puzzle_id: "lighthouse_alignment",
          calibration_version: "mat-v1",
          object_kit_version: "kit-v1",
          observation_id: "obs-relay-1",
          subject: "red_cup",
          predicate: "left_of",
          target: "book",
          confidence: 0.91,
          normalized_margin: 0.12,
          overlap: null,
          observed_at_ms: 2_700,
          sequence: 1,
          calibration_valid: true,
          needs_review: false,
          occluded: false,
          candidate_present: true,
        },
      }),
    });
    expect(relayed.disposition).toBe("relayed");
    expect(relayed.transport).toBe("cloud_relay");
    expect(relayed.cloud_relay_labeled).toBe(true);
    expect(relayed.ingress_result?.disposition).toBe("accepted_candidate");

    // Verify SDP/ICE/access_token are redacted from logs (SEC-RS-007)
    const serializedLogs = JSON.stringify({
      pairing: pairing.getAuditLog(),
      signaling: signaling.getRedactedLogs(),
    });
    expect(serializedLogs).not.toContain(cred.access_token);
    expect(serializedLogs).not.toContain("192.0.2.10");
    expect(serializedLogs).not.toContain("webrtc-datachannel");
    expect(serializedLogs).toContain("[REDACTED_SDP]");
    expect(serializedLogs).toContain("[REDACTED_ICE]");
    expect(serializedLogs).toContain("[REDACTED_TOKEN]");
  });

  it("enforces signaling rate limits and deletes session artifacts on request and 7-day retention (FR-RS-015, SEC-RS-005, SEC-RS-007)", () => {
    const pairing = new PairingService();
    const signaling = new SignalingService(pairing);
    const session = pairing.createSession(setupInput({ now_ms: 1_000 }));
    const cred = pairing.exchangePairing({
      session_id: session.session_id,
      pairing_code: session.pairing!.pairing_code,
      pairing_nonce: session.pairing!.pairing_nonce,
      device_id: "companion-1",
      now_ms: 1_500,
    }).credential!;

    for (let i = 0; i < MAX_SIGNALING_REQUESTS_PER_WINDOW; i += 1) {
      signaling.submitIceCandidate({
        session_id: session.session_id,
        device_id: "companion-1",
        access_token: cred.access_token,
        candidate: VALID_ICE,
        sdp_mid: "0",
        sdp_m_line_index: 0,
        now_ms: 2_000 + i,
      });
    }
    const rateLimited = signaling.submitIceCandidate({
      session_id: session.session_id,
      device_id: "companion-1",
      access_token: cred.access_token,
      candidate: VALID_ICE,
      sdp_mid: "0",
      sdp_m_line_index: 0,
      now_ms: 2_500,
    });
    expect(rateLimited.disposition).toBe("rejected");
    expect(rateLimited.reason_code).toBe("rate_limit_exceeded");

    pairing.recordSnapshotArtifact(
      session.session_id,
      { state_sequence: 1, completed_puzzles: ["lighthouse_alignment"] },
      3_000,
    );
    pairing.recordDirectorContextArtifact(
      session.session_id,
      { puzzle_id: "raise_the_shield", hint_level: 1 },
      3_100,
    );
    expect(() =>
      pairing.recordSnapshotArtifact(
        session.session_id,
        { frame: "forbidden" },
        3_200,
      ),
    ).toThrow("media_payload_forbidden");

    // 7-day retention purge
    const secondSession = pairing.createSession(
      setupInput({ session_id: "01JROOMSMITHSESSION0000009", now_ms: 1_000 }),
    );
    pairing.recordSnapshotArtifact(
      secondSession.session_id,
      { state_sequence: 2 },
      2_000,
    );

    const deletedNow = pairing.deleteSessionArtifacts(
      session.session_id,
      "user_request",
      4_000,
    );
    expect(deletedNow).toMatchObject({
      deleted: true,
      reason: "user_request",
      snapshots_deleted: 1,
      director_contexts_deleted: 1,
      credentials_revoked: 1,
    });
    expect(() => pairing.getSession(session.session_id, 4_000)).toThrow(
      "session_not_found",
    );

    const purged = pairing.purgeExpiredSessions(
      1_000 + SESSION_RETENTION_TTL_MS,
    );
    expect(purged).toHaveLength(1);
    expect(purged[0]).toMatchObject({
      deleted: true,
      session_id: secondSession.session_id,
      reason: "retention_expired",
      snapshots_deleted: 1,
    });
  });
});
