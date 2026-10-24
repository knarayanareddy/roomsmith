import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FireTvWebSimulator } from "../../apps/firetv/src/index.js";
import {
  InMemoryRedisClient,
  ObservationIngress,
  RedisPuzzleSessionStore,
  SESSION_SNAPSHOT_TTL_MS,
  SqlitePuzzleSessionStore,
} from "../../packages/session-contracts/src/index.js";
import {
  AdaptiveClueScheduler,
  BoundedDirectorService,
  DEFAULT_STALL_THRESHOLD_MS,
} from "../../services/director/src/index.js";
import { PairingService } from "../../services/pairing/src/index.js";
import {
  WebSocketSignalingServer,
  type WebSocketSignalingEnvelope,
} from "../../services/signaling/src/index.js";

const VALID_DATACHANNEL_SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:room",
  "a=ice-pwd:roomsmithsecretpassword1234",
  "a=sctp-port:5000",
].join("\r\n");

function connectWsClient(url: string): Promise<{
  ws: WebSocket;
  messages: WebSocketSignalingEnvelope[];
  waitForType: (
    type: string,
    timeoutMs?: number,
  ) => Promise<WebSocketSignalingEnvelope>;
  sendEnvelope: (envelope: WebSocketSignalingEnvelope) => void;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: WebSocketSignalingEnvelope[] = [];
    const waiters: Array<{
      type: string;
      resolve: (msg: WebSocketSignalingEnvelope) => void;
    }> = [];

    ws.addEventListener("message", (event) => {
      const parsed = JSON.parse(
        String(event.data),
      ) as WebSocketSignalingEnvelope;
      const idx = waiters.findIndex((w) => w.type === parsed.type);
      if (idx !== -1) {
        const [waiter] = waiters.splice(idx, 1);
        waiter!.resolve(parsed);
        return;
      }
      messages.push(parsed);
    });

    ws.addEventListener("open", () => {
      resolve({
        ws,
        messages,
        waitForType(type, timeoutMs = 3_000) {
          const existing = messages.find((m) => m.type === type);
          if (existing) {
            messages.splice(messages.indexOf(existing), 1);
            return Promise.resolve(existing);
          }
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(`Timed out waiting for WS message type: ${type}`));
            }, timeoutMs);
            waiters.push({
              type,
              resolve: (msg) => {
                clearTimeout(timer);
                res(msg);
              },
            });
          });
        },
        sendEnvelope(envelope: WebSocketSignalingEnvelope) {
          ws.send(JSON.stringify(envelope));
        },
        close() {
          ws.close();
        },
      });
    });

    ws.addEventListener("error", () => {
      reject(new Error("WebSocket client error"));
    });
  });
}

describe("WebRTC DataChannel Signaling Server, Puzzle State Machine Persistence, and Adaptive Clue Timer", () => {
  it("pairs TV and companion over live WebSocket, exchanges DataChannel-only SDP/ICE, rejects media SDP, and relays labeled cloud-relay fallback observations", async () => {
    const pairingService = new PairingService();
    const session = pairingService.createSession({
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

    const server = new WebSocketSignalingServer(
      pairingService,
      undefined,
      () => 1_500,
    );
    const ingress = new ObservationIngress({
      sessionId: session.session_id,
      puzzleId: "lighthouse_alignment",
      calibrationVersion: "cal_v1",
      objectKitVersion: "kit_v1",
      authorizedDeviceIds: ["companion-pixel-8"],
    });
    server.registerObservationIngress(session.session_id, ingress);

    const { url } = await server.listen(0, "127.0.0.1");
    const tvClient = await connectWsClient(url);
    const companionClient = await connectWsClient(url);

    try {
      // 1. TV authenticates
      tvClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-tv-hello",
        session_id: session.session_id,
        device_id: "firetv-living-room",
        sequence: 1,
        sent_at: "2026-10-24T12:00:01.000Z",
        type: "session.hello",
        payload: {
          role: "tv",
        },
      });
      const tvAck = await tvClient.waitForType("session.hello.ack");
      expect(tvAck.payload.role).toBe("tv");
      expect(tvAck.payload.authenticated).toBe(true);

      // 2. Companion authenticates using one-time pairing_code + pairing_nonce
      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-comp-hello",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 1,
        sent_at: "2026-10-24T12:00:01.100Z",
        type: "session.hello",
        payload: {
          role: "companion",
          pairing_code: session.pairing!.pairing_code,
          pairing_nonce: session.pairing!.pairing_nonce,
        },
      });
      const companionAck =
        await companionClient.waitForType("session.hello.ack");
      expect(companionAck.payload.role).toBe("companion");
      expect(companionAck.payload.authenticated).toBe(true);
      expect(typeof companionAck.payload.access_token).toBe("string");

      // 3. Companion requests ephemeral TURN credentials
      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-turn-req",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 2,
        sent_at: "2026-10-24T12:00:01.200Z",
        type: "turn.request",
        payload: {},
      });
      const turnIssued = await companionClient.waitForType("turn.credentials");
      expect(turnIssued.payload.structured_data_only).toBe(true);
      expect(turnIssued.payload.media_relay_allowed).toBe(false);

      // 4. Companion sends DataChannel-only WebRTC offer -> forwarded to TV
      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-sdp-offer",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 3,
        sent_at: "2026-10-24T12:00:01.300Z",
        type: "webrtc.offer",
        payload: {
          sdp: VALID_DATACHANNEL_SDP,
        },
      });
      const offerOnTv = await tvClient.waitForType("webrtc.offer");
      expect(String(offerOnTv.payload.sdp)).toContain("webrtc-datachannel");
      expect(offerOnTv.payload.media_tracks_present).toBe(false);

      // 5. TV sends DataChannel-only WebRTC answer -> forwarded to Companion
      tvClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-sdp-answer",
        session_id: session.session_id,
        device_id: "firetv-living-room",
        sequence: 2,
        sent_at: "2026-10-24T12:00:01.400Z",
        type: "webrtc.answer",
        payload: {
          sdp: VALID_DATACHANNEL_SDP,
        },
      });
      const answerOnCompanion =
        await companionClient.waitForType("webrtc.answer");
      expect(String(answerOnCompanion.payload.sdp)).toContain(
        "webrtc-datachannel",
      );

      // 6. Bidirectional ICE candidates exchanged
      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-ice-1",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 4,
        sent_at: "2026-10-24T12:00:01.500Z",
        type: "webrtc.ice",
        payload: {
          candidate: "candidate:1 1 UDP 2122252543 192.168.1.25 51234 typ host",
          sdp_mid: "0",
          sdp_m_line_index: 0,
        },
      });
      const iceOnTv = await tvClient.waitForType("webrtc.ice");
      expect(String(iceOnTv.payload.candidate)).toContain("typ host");

      // 7. Rejects SDP with video media line (SEC-RS-004, INT-RS-002)
      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-sdp-video",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 5,
        sent_at: "2026-10-24T12:00:01.600Z",
        type: "webrtc.offer",
        payload: {
          sdp: `${VALID_DATACHANNEL_SDP}\r\nm=video 9 UDP/TLS/RTP/SAVPF 96`,
        },
      });
      const mediaRejected = await companionClient.waitForType("session.error");
      expect(mediaRejected.payload.reason_code).toBe("media_track_forbidden");

      // 8. Rejects companion attempt to complete a puzzle directly (SEC-RS-002)
      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-comp-commit",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 6,
        sent_at: "2026-10-24T12:00:01.700Z",
        type: "puzzle.complete",
        payload: {
          puzzle_id: "lighthouse_alignment",
        },
      });
      const commandRejected =
        await companionClient.waitForType("session.error");
      expect(commandRejected.payload.reason_code).toBe(
        "companion_commit_rejected",
      );

      // 9. Switch to labeled cloud-relay fallback and relay structured observation
      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-fallback",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 7,
        sent_at: "2026-10-24T12:00:01.800Z",
        type: "transport.fallback",
        payload: {
          failure_reason: "ice_failed",
        },
      });
      const fallbackOnTv = await tvClient.waitForType("transport.state");
      expect(fallbackOnTv.payload.transport).toBe("cloud_relay");
      expect(fallbackOnTv.payload.cloud_relay_labeled).toBe(true);
      await companionClient.waitForType("transport.state");

      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-cal-state-1",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 1,
        sent_at: "2026-10-24T12:00:01.900Z",
        type: "calibration.state",
        payload: {
          puzzle_id: "lighthouse_alignment",
          calibration_version: "cal_v1",
          object_kit_version: "kit_v1",
          calibration_valid: true,
          needs_review: false,
          occluded: false,
          reason_codes: [],
        },
      });
      await tvClient.waitForType("calibration.state");

      companionClient.sendEnvelope({
        schema_version: 1,
        message_id: "msg-obs-stable-1",
        session_id: session.session_id,
        device_id: "companion-pixel-8",
        sequence: 2,
        sent_at: "2026-10-24T12:00:02.000Z",
        type: "observation.stable",
        payload: {
          puzzle_id: "lighthouse_alignment",
          calibration_version: "cal_v1",
          object_kit_version: "kit_v1",
          observation_id: "obs_stable_1",
          subject: "red_cup",
          predicate: "left_of",
          target: "book",
          confidence: 0.94,
          normalized_margin: 0.18,
          overlap: null,
          observed_at_ms: 2_000,
          sequence: 2,
          calibration_valid: true,
          needs_review: false,
          occluded: false,
          candidate_present: true,
        },
      });
      const relayedOnTv = await tvClient.waitForType("observation.stable");
      expect(relayedOnTv.payload.transport).toBe("cloud_relay");
      expect(relayedOnTv.payload.cloud_relay_labeled).toBe(true);
      expect(relayedOnTv.payload.ingress_disposition).toBe(
        "accepted_stable_proposal",
      );
      expect(relayedOnTv.payload.puzzle_commit).toBe(false);
    } finally {
      tvClient.close();
      companionClient.close();
      await server.close();
    }
  });

  it("persists puzzle state machine snapshots in SQLite and Redis across app backgrounding/restart without replaying completed puzzles or carrying transient hold timers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "roomsmith-sqlite-"));
    const dbPath = join(tmpDir, "sessions.sqlite");

    try {
      const sqliteStore1 = new SqlitePuzzleSessionStore(dbPath);
      const sim1 = new FireTvWebSimulator(undefined, sqliteStore1);

      sim1.configureLobby({
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
      const sessionId = sim1.getState().session_id;

      // Solve Puzzle 1 (`lighthouse_alignment`) via camera
      sim1.submitPhysicalObservation({
        puzzle_key: "lighthouse",
        duration_ms: 1_000,
        at_ms: 1_500,
      });
      expect(sim1.getState().completed_puzzles).toHaveLength(1);

      // Start holding Puzzle 2 (`raise_the_shield`) partway (400 / 750 ms) then background/checkpoint
      sim1.submitPhysicalObservation({
        puzzle_key: "gearbox",
        duration_ms: 400,
        at_ms: 2_200,
      });
      expect(sim1.getState().hold_progress_ms).toBe(400);

      const savedEnvelope = sim1.saveSnapshot(sqliteStore1, 2_500);
      expect(savedEnvelope.snapshot.state_sequence).toBe(1);
      // Transient `verifying` status must normalize to `awaiting_observation`
      expect(savedEnvelope.snapshot.status).toBe("awaiting_observation");
      sqliteStore1.close();

      // Reopen SQLite database in a fresh process / simulator instance
      const sqliteStore2 = new SqlitePuzzleSessionStore(dbPath);
      const sim2 = new FireTvWebSimulator(undefined, sqliteStore2);
      const restoredState = sim2.resumeFromSnapshotStore(
        sessionId,
        sqliteStore2,
        3_000,
      );

      expect(restoredState).not.toBeNull();
      expect(restoredState!.completed_puzzles).toHaveLength(1);
      expect(restoredState!.completed_puzzles[0]!.puzzle_id).toBe(
        "lighthouse_alignment",
      );
      expect(restoredState!.current_puzzle?.puzzle_id).toBe("raise_the_shield");
      // Transient hold progress must reset to 0 after app backgrounding/restart (AC-RS-018)
      expect(restoredState!.hold_progress_ms).toBe(0);

      // Stale state_sequence overwrite is rejected
      expect(() =>
        sqliteStore2.saveSnapshot(
          {
            ...savedEnvelope.snapshot,
            state_sequence: 0,
            completed_puzzles: [],
          },
          3_100,
        ),
      ).toThrowError("stale_snapshot_sequence");

      // Media/landmark fields in snapshot are rejected (SEC-RS-001)
      expect(() =>
        sqliteStore2.saveSnapshot(
          {
            ...savedEnvelope.snapshot,
            rawFrame: "data:image/jpeg;base64,AAAA",
          } as unknown as typeof savedEnvelope.snapshot,
          3_200,
        ),
      ).toThrowError("media_payload_forbidden");

      // Purge after 7-day TTL removes expired snapshots (FR-RS-015, SEC-RS-005)
      const purgedCount = sqliteStore2.purgeExpiredSnapshots(
        2_500 + SESSION_SNAPSHOT_TTL_MS + 1,
      );
      expect(purgedCount).toBe(1);
      expect(sqliteStore2.loadSnapshot(sessionId, 3_000)).toBeNull();
      sqliteStore2.close();

      // Also verify RedisPuzzleSessionStore parity
      const redisStore = new RedisPuzzleSessionStore(new InMemoryRedisClient());
      const redisSaved = redisStore.saveSnapshot(savedEnvelope.snapshot, 5_000);
      expect(redisSaved.sha256_checksum).toHaveLength(64);
      const redisLoaded = redisStore.loadSnapshot(sessionId, 6_000);
      expect(redisLoaded?.state_sequence).toBe(1);
      expect(redisStore.deleteSnapshot(sessionId)).toBe(true);
      expect(redisStore.loadSnapshot(sessionId, 6_000)).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("offers progressive hints via AdaptiveClueScheduler when players stall for >3 minutes and respects pause/resume and completion", async () => {
    const offeredHints: number[] = [];
    const scheduler = new AdaptiveClueScheduler({
      director: new BoundedDirectorService(),
      onClueOffered: (offer) => {
        offeredHints.push(offer.hint_level);
      },
    });

    scheduler.startPuzzleTimer({
      session_id: "RS-STALL-01",
      puzzle_id: "lighthouse_alignment",
      now_ms: 1_000,
      max_hint_level: 2,
    });

    // At exactly 3 minutes (180_000 ms elapsed -> now_ms = 181_000), does NOT trigger yet (must be > 3 minutes)
    const atThreeMin = await scheduler.evaluateStall({
      puzzle_id: "lighthouse_alignment",
      now_ms: 1_000 + DEFAULT_STALL_THRESHOLD_MS,
    });
    expect(atThreeMin.triggered).toBe(false);
    expect(atThreeMin.reason).toBe("below_stall_threshold");
    expect(atThreeMin.next_hint_in_ms).toBe(1);

    // At > 3 minutes (180_001 ms elapsed -> now_ms = 181_001), triggers Hint Level 1 (gentle nudge)
    const afterThreeMin = await scheduler.evaluateStall({
      puzzle_id: "lighthouse_alignment",
      now_ms: 1_000 + DEFAULT_STALL_THRESHOLD_MS + 1,
    });
    expect(afterThreeMin.triggered).toBe(true);
    expect(afterThreeMin.reason).toBe("offered_progressive_hint");
    expect(afterThreeMin.current_hint_level).toBe(1);
    expect(afterThreeMin.offer?.director_result.hint.hint_level).toBe(1);

    // Pause timer at +60s, keep paused for 5 minutes, resume at +360s: paused time does not count as stall
    const baseAfterHint1 = 1_000 + DEFAULT_STALL_THRESHOLD_MS + 1;
    scheduler.pauseTimer("lighthouse_alignment", baseAfterHint1 + 60_000);
    const whilePaused = await scheduler.evaluateStall({
      puzzle_id: "lighthouse_alignment",
      now_ms: baseAfterHint1 + 300_000,
    });
    expect(whilePaused.triggered).toBe(false);
    expect(whilePaused.reason).toBe("puzzle_paused");

    scheduler.resumeTimer("lighthouse_alignment", baseAfterHint1 + 360_000);
    // Only 60s of active stall accrued before pause; after another 120_001 ms of active time (total 180_001 ms > 3m), Level 2 triggers
    const secondHint = await scheduler.evaluateStall({
      puzzle_id: "lighthouse_alignment",
      now_ms: baseAfterHint1 + 360_000 + 120_001,
    });
    expect(secondHint.triggered).toBe(true);
    expect(secondHint.current_hint_level).toBe(2);
    expect(secondHint.offer?.director_result.hint.hint_level).toBe(2);
    expect(offeredHints).toEqual([1, 2]);

    // Once max hint level (2) is reached, further stall returns max_hint_level_reached
    const afterMax = await scheduler.evaluateStall({
      puzzle_id: "lighthouse_alignment",
      now_ms:
        baseAfterHint1 + 360_000 + 120_001 + DEFAULT_STALL_THRESHOLD_MS + 5_000,
    });
    expect(afterMax.triggered).toBe(false);
    expect(afterMax.reason).toBe("max_hint_level_reached");

    // Also verify FireTvWebSimulator.evaluateStallTimer integration
    const sim = new FireTvWebSimulator();
    const stallEval = await sim.evaluateStallTimer(
      DEFAULT_STALL_THRESHOLD_MS + 500,
    );
    expect(stallEval.evaluation.triggered).toBe(true);
    expect(stallEval.state.hints_used.lighthouse_alignment).toBe(1);
    expect(stallEval.state.last_hint_text).toBeTruthy();
  });
});
