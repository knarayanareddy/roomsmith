import {
  VALID_COMPANION_DATACHANNEL_SDP,
  DEFAULT_COMPANION_DATA_CHANNELS,
} from "../../companion/src/camera-client.js";
import type { MatCalibrationInput } from "../../../packages/perception/src/index.js";
import { DEFAULT_STALL_THRESHOLD_MS } from "../../../services/director/src/index.js";
import type {
  DataChannelContractSpec,
  WebSocketSignalingEnvelope,
} from "../../../services/signaling/src/index.js";
import {
  FireTvWebSimulator,
  type SimulatorPuzzleKey,
  type SimulatorStateSnapshot,
} from "./simulator.js";

export type CompanionPerspectivePreset =
  | "skewed_uncalibrated"
  | "high_glare"
  | "occluded_corner"
  | "aligned_playmat";

export type SplitScreenViewMode = "video" | "simulator";

export const SPLIT_SCREEN_MODE_TOGGLE_TEXT =
  "Mode: [🎥 Watch Full Escape Walkthrough] [🧩 Play Split-Screen Simulator]";

export const WATCH_WALKTHROUGH_BUTTON_TEXT =
  "[🎥 Watch Full Escape Walkthrough]";

export const PLAY_SIMULATOR_BUTTON_TEXT = "[🧩 Play Split-Screen Simulator]";

export const WALKTHROUGH_VIDEO_ASSET_PATH = "/media/roomsmith-demo.webm";

export const WALKTHROUGH_VIDEO_SIZE_KB = 126;

export interface WalkthroughVideoViewState {
  active: boolean;
  src: string;
  size_kb: number;
  toggle_bar_text: string;
  description: string;
}

export interface InMemoryWebRtcTelemetry {
  connected: boolean;
  data_channel_state: "open" | "closed";
  channels: DataChannelContractSpec[];
  local_offer_sdp: string;
  remote_answer_sdp: string;
  ice_candidates_exchanged: number;
  media_tracks_present: false;
  messages_transmitted: number;
  last_envelope: WebSocketSignalingEnvelope | null;
}

export interface SplitScreenDemoState {
  mode: SplitScreenViewMode;
  mode_toggle_text: string;
  walkthrough_video: WalkthroughVideoViewState;
  companion: {
    device_id: string;
    perspective_preset: CompanionPerspectivePreset;
    calibration_input: MatCalibrationInput;
    calibration_valid: boolean;
    active_placement_label: string;
  };
  webrtc: InMemoryWebRtcTelemetry;
  firetv: SimulatorStateSnapshot;
}

/**
 * In-memory WebRTC DataChannel loopback transport allowing the split-screen
 * Companion perspective view (left pane) and Fire TV display (right pane) to
 * negotiate DataChannel-only SDP/ICE and exchange structured observations in
 * any desktop or mobile browser without a backend server.
 */
export class InMemoryWebRtcMockTransport {
  private connected = false;
  private messagesTransmitted = 0;
  private lastEnvelope: WebSocketSignalingEnvelope | null = null;
  private readonly tvListeners = new Set<
    (envelope: WebSocketSignalingEnvelope) => void
  >();

  negotiateLoopback(): InMemoryWebRtcTelemetry {
    this.connected = true;
    return this.getTelemetry();
  }

  onTvReceive(
    listener: (envelope: WebSocketSignalingEnvelope) => void,
  ): () => void {
    this.tvListeners.add(listener);
    return () => {
      this.tvListeners.delete(listener);
    };
  }

  sendFromCompanionToTv(envelope: WebSocketSignalingEnvelope): void {
    if (!this.connected) {
      this.negotiateLoopback();
    }
    this.messagesTransmitted += 1;
    this.lastEnvelope = structuredClone(envelope);
    for (const listener of this.tvListeners) {
      listener(structuredClone(envelope));
    }
  }

  disconnect(): void {
    this.connected = false;
  }

  getTelemetry(): InMemoryWebRtcTelemetry {
    return {
      connected: this.connected,
      data_channel_state: this.connected ? "open" : "closed",
      channels: structuredClone(
        DEFAULT_COMPANION_DATA_CHANNELS as DataChannelContractSpec[],
      ),
      local_offer_sdp: VALID_COMPANION_DATACHANNEL_SDP,
      remote_answer_sdp: VALID_COMPANION_DATACHANNEL_SDP,
      ice_candidates_exchanged: this.connected ? 2 : 0,
      media_tracks_present: false,
      messages_transmitted: this.messagesTransmitted,
      last_envelope: this.lastEnvelope
        ? structuredClone(this.lastEnvelope)
        : null,
    };
  }
}

const PERSPECTIVE_PRESET_MAP: Readonly<
  Record<CompanionPerspectivePreset, MatCalibrationInput>
> = {
  skewed_uncalibrated: {
    detected_marker_ids: [0, 1, 2],
    reprojection_error_px: 5.8,
    normalized_mat_area: 0.24,
    glare_score: 0.35,
    blur_score: 0.28,
    selected_object_kit: ["red_cup", "blue_cup", "book"],
    required_objects: ["red_cup", "blue_cup", "book"],
  },
  high_glare: {
    detected_marker_ids: [0, 1, 2, 3],
    reprojection_error_px: 2.3,
    normalized_mat_area: 0.5,
    glare_score: 0.74,
    blur_score: 0.12,
    selected_object_kit: ["red_cup", "blue_cup", "book"],
    required_objects: ["red_cup", "blue_cup", "book"],
  },
  occluded_corner: {
    detected_marker_ids: [0, 1, 2],
    reprojection_error_px: 2.1,
    normalized_mat_area: 0.48,
    glare_score: 0.14,
    blur_score: 0.1,
    selected_object_kit: ["red_cup", "blue_cup", "book"],
    required_objects: ["red_cup", "blue_cup", "book"],
  },
  aligned_playmat: {
    detected_marker_ids: [0, 1, 2, 3],
    reprojection_error_px: 1.7,
    normalized_mat_area: 0.55,
    glare_score: 0.09,
    blur_score: 0.07,
    selected_object_kit: ["red_cup", "blue_cup", "book"],
    required_objects: ["red_cup", "blue_cup", "book"],
  },
};

/**
 * Unified Split-Screen Escape Room Demo controller pairing the Companion
 * living-room perspective view (left side) and Fire TV 1080p puzzle display
 * (right side) over `InMemoryWebRtcMockTransport`, with a quick-switch toggle
 * between the interactive simulator and the recorded `roomsmith-demo.webm`
 * walkthrough video.
 */
export class SplitScreenEscapeRoomDemo {
  private readonly simulator: FireTvWebSimulator;
  private readonly transport: InMemoryWebRtcMockTransport;
  private mode: SplitScreenViewMode = "simulator";
  private perspectivePreset: CompanionPerspectivePreset = "skewed_uncalibrated";
  private activePlacementLabel = "Awaiting living room PlayMat alignment";
  private sequence = 0;
  private clockMs = 1_000;

  constructor(
    simulator?: FireTvWebSimulator,
    transport?: InMemoryWebRtcMockTransport,
  ) {
    this.simulator = simulator ?? new FireTvWebSimulator();
    this.transport = transport ?? new InMemoryWebRtcMockTransport();
    this.transport.negotiateLoopback();
    this.simulator.navigateTo("puzzle");
    this.setPerspectivePreset("skewed_uncalibrated");
  }

  getSimulator(): FireTvWebSimulator {
    return this.simulator;
  }

  getTransport(): InMemoryWebRtcMockTransport {
    return this.transport;
  }

  getMode(): SplitScreenViewMode {
    return this.mode;
  }

  /**
   * Switches between `"video"` (`[🎥 Watch Full Escape Walkthrough]`) and
   * `"simulator"` (`[🧩 Play Split-Screen Simulator]`).
   */
  setMode(mode: SplitScreenViewMode): SplitScreenDemoState {
    this.mode = mode;
    return this.getState();
  }

  toggleMode(): SplitScreenDemoState {
    this.mode = this.mode === "simulator" ? "video" : "simulator";
    return this.getState();
  }

  /**
   * Renders the quick-switch toggle header and active view markup
   * (`roomsmith-demo.webm` video player when `mode === "video"`, or the
   * interactive split-screen simulator container when `mode === "simulator"`).
   */
  renderQuickSwitchViewHtml(basePath = "/roomsmith/"): string {
    const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
    const videoSrc = `${normalizedBase}media/roomsmith-demo.webm`;
    const isVideo = this.mode === "video";
    return [
      `<section class="demo-mode-bar" data-testid="demo-mode-bar">`,
      `  <span class="demo-mode-bar__text">${SPLIT_SCREEN_MODE_TOGGLE_TEXT}</span>`,
      `  <div class="demo-mode-bar__buttons">`,
      `    <button type="button" data-demo-mode="video" aria-pressed="${String(isVideo)}">${WATCH_WALKTHROUGH_BUTTON_TEXT}</button>`,
      `    <button type="button" data-demo-mode="simulator" aria-pressed="${String(!isVideo)}">${PLAY_SIMULATOR_BUTTON_TEXT}</button>`,
      `  </div>`,
      `</section>`,
      isVideo
        ? [
            `<section class="walkthrough-video-panel" data-testid="walkthrough-video-panel">`,
            `  <p>126 KB roomsmith-demo.webm showcasing the synchronized Fire TV screen and companion camera perspective alignment</p>`,
            `  <video controls autoplay loop muted playsinline src="${videoSrc}" data-video-size-kb="${WALKTHROUGH_VIDEO_SIZE_KB}"></video>`,
            `</section>`,
          ].join("\n")
        : `<section class="split-screen-simulator-active" data-testid="split-screen-simulator-active"></section>`,
    ].join("\n");
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  /**
   * Updates the companion camera living-room perspective preset and streams
   * the resulting `calibration.state` envelope to the Fire TV simulator.
   */
  setPerspectivePreset(
    preset: CompanionPerspectivePreset,
  ): SplitScreenDemoState {
    this.perspectivePreset = preset;
    const calInput = structuredClone(PERSPECTIVE_PRESET_MAP[preset]);
    const tvState = this.simulator.setMatCalibration(calInput);
    const seq = this.nextSequence();
    this.clockMs += 250;

    this.transport.sendFromCompanionToTv({
      schema_version: 1,
      message_id: `split-cal-${seq}`,
      session_id: tvState.session_id,
      device_id: "companion-split-screen",
      sequence: seq,
      sent_at: new Date(this.clockMs).toISOString(),
      type: "calibration.state",
      payload: {
        puzzle_id: tvState.current_puzzle?.puzzle_id ?? "lighthouse_alignment",
        calibration_version: "cal_v1",
        object_kit_version: "kit_v1",
        calibration_valid: tvState.calibration_valid,
        needs_review: preset === "high_glare",
        occluded: preset !== "aligned_playmat" && preset !== "high_glare",
        reason_codes: tvState.calibration_valid
          ? []
          : [preset === "high_glare" ? "glare_detected" : "missing_markers"],
      },
    });

    this.activePlacementLabel =
      preset === "aligned_playmat"
        ? "Living room PlayMat perspective aligned (4/4 ArUco markers)"
        : `Uncalibrated perspective (${preset})`;
    return this.getState();
  }

  /**
   * Simulates player inaction (>3 minutes per step) so the Fire TV display
   * pops up progressive clue banners (Level 1 Subtle Nudge -> Level 2 Directional Hint -> Level 3 Direct Guide).
   */
  async simulateInactionTimeout(): Promise<SplitScreenDemoState> {
    this.clockMs += DEFAULT_STALL_THRESHOLD_MS + 500;
    await this.simulator.evaluateStallTimer(this.clockMs);
    return this.getState();
  }

  /**
   * Aligns the companion living-room perspective and streams the physical
   * puzzle placement over the in-memory WebRTC DataChannel to unlock the active puzzle.
   */
  alignPerspectiveAndUnlockActivePuzzle(
    puzzleKey?: SimulatorPuzzleKey,
  ): SplitScreenDemoState {
    this.setPerspectivePreset("aligned_playmat");
    const active = this.simulator.getState().current_puzzle;
    const targetKey = puzzleKey ?? active?.key ?? "lighthouse";

    if (targetKey === "lighthouse") {
      this.clockMs += 1_000;
      const seq = this.nextSequence();
      this.transport.sendFromCompanionToTv({
        schema_version: 1,
        message_id: `split-obs-${seq}`,
        session_id: this.simulator.getState().session_id,
        device_id: "companion-split-screen",
        sequence: seq,
        sent_at: new Date(this.clockMs).toISOString(),
        type: "observation.stable",
        payload: {
          puzzle_id: "lighthouse_alignment",
          calibration_version: "cal_v1",
          object_kit_version: "kit_v1",
          observation_id: `obs_lighthouse_${seq}`,
          subject: "red_cup",
          predicate: "left_of",
          target: "book",
          confidence: 0.96,
          normalized_margin: 0.19,
          overlap: null,
          observed_at_ms: this.clockMs,
          sequence: seq,
          calibration_valid: true,
          needs_review: false,
          occluded: false,
          candidate_present: true,
        },
      });
      this.simulator.submitPhysicalObservation({
        puzzle_key: "lighthouse",
        subject: "red_cup",
        predicate: "left_of",
        target: "book",
        duration_ms: 1_000,
        at_ms: this.clockMs,
      });
      this.activePlacementLabel =
        "Aligned: Red Lens (`red_cup`) held left of Archive Book (`book`) for 1,000 ms";
      return this.getState();
    }

    if (targetKey === "gearbox") {
      this.clockMs += 750;
      const seq = this.nextSequence();
      this.transport.sendFromCompanionToTv({
        schema_version: 1,
        message_id: `split-obs-${seq}`,
        session_id: this.simulator.getState().session_id,
        device_id: "companion-split-screen",
        sequence: seq,
        sent_at: new Date(this.clockMs).toISOString(),
        type: "observation.stable",
        payload: {
          puzzle_id: "raise_the_shield",
          calibration_version: "cal_v1",
          object_kit_version: "kit_v1",
          observation_id: `obs_gearbox_${seq}`,
          subject: "hand",
          predicate: "open_palm",
          target: null,
          confidence: 0.94,
          normalized_margin: null,
          overlap: null,
          observed_at_ms: this.clockMs,
          sequence: seq,
          calibration_valid: true,
          needs_review: false,
          occluded: false,
          candidate_present: true,
        },
      });
      this.simulator.submitPhysicalObservation({
        puzzle_key: "gearbox",
        subject: "hand",
        predicate: "open_palm",
        target: null,
        duration_ms: 750,
        at_ms: this.clockMs,
      });
      this.activePlacementLabel =
        "Aligned: Open-palm signal held steady for 750 ms";
      return this.getState();
    }

    // PowerGrid (`lens_archive_sequence`)
    this.clockMs += 500;
    this.simulator.submitPhysicalObservation({
      puzzle_key: "powergrid",
      step: 1,
      subject: "blue_cup",
      predicate: "inside_zone",
      target: "zone_lens",
      duration_ms: 500,
      at_ms: this.clockMs,
    });
    this.clockMs += 500;
    const seq = this.nextSequence();
    this.transport.sendFromCompanionToTv({
      schema_version: 1,
      message_id: `split-obs-${seq}`,
      session_id: this.simulator.getState().session_id,
      device_id: "companion-split-screen",
      sequence: seq,
      sent_at: new Date(this.clockMs).toISOString(),
      type: "observation.stable",
      payload: {
        puzzle_id: "lens_archive_sequence",
        calibration_version: "cal_v1",
        object_kit_version: "kit_v1",
        observation_id: `obs_powergrid_${seq}`,
        subject: "book",
        predicate: "inside_zone",
        target: "zone_archive",
        confidence: 0.95,
        normalized_margin: null,
        overlap: 0.85,
        observed_at_ms: this.clockMs,
        sequence: seq,
        calibration_valid: true,
        needs_review: false,
        occluded: false,
        candidate_present: true,
      },
    });
    this.simulator.submitPhysicalObservation({
      puzzle_key: "powergrid",
      step: 2,
      subject: "book",
      predicate: "inside_zone",
      target: "zone_archive",
      duration_ms: 500,
      at_ms: this.clockMs,
    });
    this.activePlacementLabel =
      "Aligned: Blue Lens in Circle Zone -> Archive Book in Square Zone";
    return this.getState();
  }

  getState(): SplitScreenDemoState {
    const tvState = this.simulator.getState();
    return {
      mode: this.mode,
      mode_toggle_text: SPLIT_SCREEN_MODE_TOGGLE_TEXT,
      walkthrough_video: {
        active: this.mode === "video",
        src: WALKTHROUGH_VIDEO_ASSET_PATH,
        size_kb: WALKTHROUGH_VIDEO_SIZE_KB,
        toggle_bar_text: SPLIT_SCREEN_MODE_TOGGLE_TEXT,
        description:
          "126 KB roomsmith-demo.webm showcasing the synchronized Fire TV screen and companion camera perspective alignment",
      },
      companion: {
        device_id: "companion-split-screen",
        perspective_preset: this.perspectivePreset,
        calibration_input: structuredClone(
          PERSPECTIVE_PRESET_MAP[this.perspectivePreset],
        ),
        calibration_valid: tvState.calibration_valid,
        active_placement_label: this.activePlacementLabel,
      },
      webrtc: this.transport.getTelemetry(),
      firetv: tvState,
    };
  }
}
