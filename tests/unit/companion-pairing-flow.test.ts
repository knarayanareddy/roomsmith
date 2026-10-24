import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CompanionCameraTestClient,
  SYNTHETIC_CALIBRATION_TEST_CARDS,
  VALID_COMPANION_DATACHANNEL_SDP,
  type MediaDevicesLike,
} from "../../apps/companion/src/index.js";
import { FireTvWebSimulator } from "../../apps/firetv/src/index.js";
import { ObservationIngress } from "../../packages/session-contracts/src/index.js";
import { DEFAULT_STALL_THRESHOLD_MS } from "../../services/director/src/index.js";
import { PairingService } from "../../services/pairing/src/index.js";
import {
  WebSocketSignalingServer,
  type WebSocketSignalingEnvelope,
} from "../../services/signaling/src/index.js";

function resolveRepoFile(relativePath: string): string {
  return fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
}

describe("Companion WebRTC Camera Calibration Client & Fire TV Clue Banner Overlays", () => {
  it("requests local webcam access, negotiates WebRTC DataChannel over WebSocket signaling, and streams synthetic calibration test cards", async () => {
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
      () => 2_000,
    );
    const ingress = new ObservationIngress({
      sessionId: session.session_id,
      puzzleId: "lighthouse_alignment",
      calibrationVersion: "cal_v1",
      objectKitVersion: "kit_v1",
      authorizedDeviceIds: ["companion-camera-test-client"],
    });
    server.registerObservationIngress(session.session_id, ingress);

    const { url } = await server.listen(0, "127.0.0.1");

    // Connect simulated Fire TV signaling peer that answers companion SDP offers
    const tvWs = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      tvWs.addEventListener("open", () => resolve());
      tvWs.addEventListener("error", () =>
        reject(new Error("TV WS connect failed")),
      );
    });

    tvWs.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as WebSocketSignalingEnvelope;
      if (msg.type === "webrtc.offer") {
        tvWs.send(
          JSON.stringify({
            schema_version: 1,
            message_id: "tv-answer-1",
            session_id: session.session_id,
            device_id: "firetv-simulator-peer",
            sequence: 2,
            sent_at: "2026-10-24T12:00:02.100Z",
            type: "webrtc.answer",
            payload: {
              sdp: VALID_COMPANION_DATACHANNEL_SDP,
              data_channels: msg.payload.data_channels,
            },
          } satisfies WebSocketSignalingEnvelope),
        );
      }
    });

    tvWs.send(
      JSON.stringify({
        schema_version: 1,
        message_id: "tv-hello-1",
        session_id: session.session_id,
        device_id: "firetv-simulator-peer",
        sequence: 1,
        sent_at: "2026-10-24T12:00:02.000Z",
        type: "session.hello",
        payload: { role: "tv" },
      } satisfies WebSocketSignalingEnvelope),
    );

    let getUserMediaCalledWithAudioFalse = false;
    let trackStopped = false;
    const mockMediaDevices: MediaDevicesLike = {
      async getUserMedia(constraints) {
        expect(constraints.audio).toBe(false);
        getUserMediaCalledWithAudioFalse = true;
        return {
          id: "mock-webcam-stream-01",
          getTracks: () => [
            {
              kind: "video",
              stop() {
                trackStopped = true;
              },
            },
          ],
          getVideoTracks: () => [
            {
              kind: "video",
              stop() {
                trackStopped = true;
              },
            },
          ],
        };
      },
    };

    const dataChannelEnvelopes: WebSocketSignalingEnvelope[] = [];
    const companionClient = new CompanionCameraTestClient({
      deviceId: "companion-camera-test-client",
      mediaDevices: mockMediaDevices,
      onDataChannelMessage: (env) => dataChannelEnvelopes.push(env),
    });

    try {
      // 1. Request webcam access via navigator.mediaDevices.getUserMedia
      const webcamStatus = await companionClient.requestWebcamAccess();
      expect(getUserMediaCalledWithAudioFalse).toBe(true);
      expect(webcamStatus.granted).toBe(true);
      expect(webcamStatus.audio_requested).toBe(false);
      expect(webcamStatus.media_tracks_attached_to_webrtc).toBe(false);

      // 2. Connect to WebSocket signaling server and negotiate WebRTC DataChannel
      const negotiation = await companionClient.connectAndNegotiateDataChannel({
        ws_url: url,
        session_id: session.session_id,
        pairing_code: session.pairing!.pairing_code,
        pairing_nonce: session.pairing!.pairing_nonce,
        now_ms: 2_000,
      });

      expect(negotiation.connected).toBe(true);
      expect(negotiation.data_channel_state).toBe("open");
      expect(negotiation.media_tracks_present).toBe(false);
      expect(negotiation.channels).toHaveLength(2);
      expect(negotiation.local_offer_sdp).toContain("webrtc-datachannel");
      expect(negotiation.remote_answer_sdp).toContain("webrtc-datachannel");

      // 3. Stream all 4 synthetic calibration test cards over the DataChannel
      expect(SYNTHETIC_CALIBRATION_TEST_CARDS).toHaveLength(4);
      const cardResults = companionClient.streamAllCalibrationTestCards({
        now_ms: 3_000,
      });
      expect(cardResults).toHaveLength(4);
      expect(cardResults[0]!.assessment.calibration_valid).toBe(true);
      expect(cardResults[1]!.assessment.reason_codes).toContain(
        "glare_detected",
      );
      expect(cardResults[2]!.assessment.reason_codes).toContain(
        "missing_markers",
      );
      expect(cardResults[3]!.observation_envelope?.type).toBe(
        "observation.stable",
      );

      // Verify structured envelopes pass ObservationIngress in monotonic sequence on the Fire TV side
      for (const item of cardResults.slice(0, 3)) {
        ingress.accept(JSON.stringify(item.calibration_envelope));
      }
      const calIngress = ingress.accept(
        JSON.stringify(cardResults[3]!.calibration_envelope),
      );
      expect(calIngress.disposition).toBe("accepted_calibration");

      const obsIngress = ingress.accept(
        JSON.stringify(cardResults[3]!.observation_envelope),
      );
      expect(obsIngress.disposition).toBe("accepted_stable_proposal");
      expect(dataChannelEnvelopes.length).toBeGreaterThanOrEqual(5);
    } finally {
      companionClient.disconnect();
      expect(trackStopped).toBe(true);
      expect(companionClient.getDataChannelState()).toBe("closed");
      tvWs.close();
      await server.close();
    }
  });

  it("renders progressive 3-level clue banners (subtle nudge -> directional clue -> direct solution guide) on ClueScheduler inactivity timeouts", async () => {
    const sim = new FireTvWebSimulator();
    expect(sim.getState().clue_banner).toBeNull();
    expect(sim.renderClueBannerHtml()).toContain("is-hidden");

    // 1. Inactivity > 3 minutes triggers Level 1: Subtle Nudge
    const t1 = DEFAULT_STALL_THRESHOLD_MS + 100;
    const eval1 = await sim.evaluateStallTimer(t1);
    expect(eval1.evaluation.triggered).toBe(true);
    expect(eval1.state.clue_banner?.visible).toBe(true);
    expect(eval1.state.clue_banner?.hint_level).toBe(1);
    expect(eval1.state.clue_banner?.tier).toBe("subtle_nudge");
    expect(eval1.state.clue_banner?.animation_class).toBe(
      "clue-banner--level-1",
    );
    expect(sim.renderClueBannerHtml()).toContain("Level 1 · Subtle Nudge");

    // 2. Additional > 3 minutes of inactivity triggers Level 2: Directional Clue
    const t2 = t1 + DEFAULT_STALL_THRESHOLD_MS + 100;
    const eval2 = await sim.evaluateStallTimer(t2);
    expect(eval2.evaluation.triggered).toBe(true);
    expect(eval2.state.clue_banner?.hint_level).toBe(2);
    expect(eval2.state.clue_banner?.tier).toBe("directional_clue");
    expect(eval2.state.clue_banner?.animation_class).toBe(
      "clue-banner--level-2",
    );
    expect(sim.renderClueBannerHtml()).toContain("Level 2 · Directional Clue");

    // 3. Third > 3 minutes of inactivity triggers Level 3: Direct Solution Guide
    const t3 = t2 + DEFAULT_STALL_THRESHOLD_MS + 100;
    const eval3 = await sim.evaluateStallTimer(t3);
    expect(eval3.evaluation.triggered).toBe(true);
    expect(eval3.state.clue_banner?.hint_level).toBe(3);
    expect(eval3.state.clue_banner?.tier).toBe("direct_solution_guide");
    expect(eval3.state.clue_banner?.animation_class).toBe(
      "clue-banner--level-3",
    );
    expect(sim.renderClueBannerHtml()).toContain(
      "Level 3 · Direct Solution Guide",
    );
    expect(eval3.state.clue_banner_history).toHaveLength(3);
  });

  it("supports remote D-pad controls to request clues on demand, switch focus, and dismiss clue banners", async () => {
    const sim = new FireTvWebSimulator();

    // Request Level 1 clue on demand with DPAD_UP
    const afterUp = await sim.handleRemoteDpad("DPAD_UP", 1_000);
    expect(afterUp.clue_banner?.visible).toBe(true);
    expect(afterUp.clue_banner?.hint_level).toBe(1);
    expect(afterUp.clue_banner?.trigger_reason).toBe("manual_request");
    expect(afterUp.clue_banner?.focused_action).toBe("request_next");

    // Press DPAD_CENTER while focused on "request_next" -> advances to Level 2
    const afterCenterNext = await sim.handleRemoteDpad("DPAD_CENTER", 1_500);
    expect(afterCenterNext.clue_banner?.hint_level).toBe(2);
    expect(afterCenterNext.clue_banner?.tier).toBe("directional_clue");

    // Move focus to "dismiss" with DPAD_RIGHT, then press DPAD_CENTER to dismiss
    const afterRight = await sim.handleRemoteDpad("DPAD_RIGHT", 1_600);
    expect(afterRight.clue_banner?.focused_action).toBe("dismiss");

    const afterCenterDismiss = await sim.handleRemoteDpad("DPAD_CENTER", 1_700);
    expect(afterCenterDismiss.clue_banner?.visible).toBe(false);

    // Request Level 3 clue with HINT key, then dismiss with DPAD_DOWN
    const afterHintKey = await sim.handleRemoteDpad("HINT", 2_000);
    expect(afterHintKey.clue_banner?.visible).toBe(true);
    expect(afterHintKey.clue_banner?.hint_level).toBe(3);
    expect(afterHintKey.clue_banner?.tier).toBe("direct_solution_guide");

    const afterDown = await sim.handleRemoteDpad("DPAD_DOWN", 2_100);
    expect(afterDown.clue_banner?.visible).toBe(false);

    // Verify companion HTML and Fire TV CSS assets exist and contain required hooks
    const companionHtml = readFileSync(
      resolveRepoFile("apps/companion/index.html"),
      "utf8",
    );
    expect(companionHtml).toContain("navigator.mediaDevices.getUserMedia");
    expect(companionHtml).toContain("card_healthy_playmat");

    const firetvCss = readFileSync(
      resolveRepoFile("apps/firetv/src/styles.css"),
      "utf8",
    );
    expect(firetvCss).toContain(".clue-banner--level-1");
    expect(firetvCss).toContain(".clue-banner--level-2");
    expect(firetvCss).toContain(".clue-banner--level-3");
    expect(firetvCss).toContain("@keyframes clueBannerSlideIn");
  });
});
