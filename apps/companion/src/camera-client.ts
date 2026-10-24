import {
  evaluateMatCalibration,
  type MatCalibrationAssessment,
  type MatCalibrationInput,
} from "../../../packages/perception/src/index.js";
import type {
  DataChannelContractSpec,
  WebSocketSignalingEnvelope,
} from "../../../services/signaling/src/index.js";

export const VALID_COMPANION_DATACHANNEL_SDP = [
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

export const DEFAULT_COMPANION_DATA_CHANNELS: ReadonlyArray<DataChannelContractSpec> =
  [
    { label: "observations", ordered: false, maxRetransmits: 0 },
    { label: "control", ordered: true, maxRetransmits: null },
  ];

export interface SyntheticCalibrationTestCard {
  card_id:
    | "card_healthy_playmat"
    | "card_glare_warning"
    | "card_missing_corner_marker"
    | "card_lighthouse_red_left_of_book";
  title: string;
  description: string;
  calibration_input: MatCalibrationInput;
  stable_observation?: {
    observation_id: string;
    subject: "red_cup" | "blue_cup" | "book" | "hand";
    predicate: "left_of" | "inside_zone" | "open_palm";
    target: string | null;
    confidence: number;
    normalized_margin: number | null;
    overlap: number | null;
  };
}

export const SYNTHETIC_CALIBRATION_TEST_CARDS: ReadonlyArray<SyntheticCalibrationTestCard> =
  [
    {
      card_id: "card_healthy_playmat",
      title: "Healthy 4-Marker PlayMat",
      description:
        "All 4 ArUco corner markers visible (0, 1, 2, 3), low reprojection error (1.8 px), low glare (0.10).",
      calibration_input: {
        detected_marker_ids: [0, 1, 2, 3],
        reprojection_error_px: 1.8,
        normalized_mat_area: 0.54,
        glare_score: 0.1,
        blur_score: 0.08,
        selected_object_kit: ["red_cup", "blue_cup", "book"],
        required_objects: ["red_cup", "blue_cup", "book"],
      },
    },
    {
      card_id: "card_glare_warning",
      title: "High Glare on PlayMat",
      description:
        "All 4 markers detected, but overhead lamp glare (0.72) exceeds threshold (0.45).",
      calibration_input: {
        detected_marker_ids: [0, 1, 2, 3],
        reprojection_error_px: 2.2,
        normalized_mat_area: 0.5,
        glare_score: 0.72,
        blur_score: 0.12,
        selected_object_kit: ["red_cup", "blue_cup", "book"],
        required_objects: ["red_cup", "blue_cup", "book"],
      },
    },
    {
      card_id: "card_missing_corner_marker",
      title: "Occluded Corner Marker (#3 Missing)",
      description:
        "Only 3 ArUco markers detected (0, 1, 2); bottom-left marker #3 is occluded.",
      calibration_input: {
        detected_marker_ids: [0, 1, 2],
        reprojection_error_px: 2.0,
        normalized_mat_area: 0.48,
        glare_score: 0.12,
        blur_score: 0.1,
        selected_object_kit: ["red_cup", "blue_cup", "book"],
        required_objects: ["red_cup", "blue_cup", "book"],
      },
    },
    {
      card_id: "card_lighthouse_red_left_of_book",
      title: "Lighthouse Alignment · Red Lens Left of Book",
      description:
        "Calibrated PlayMat with red_cup placed stably to the left of book (confidence 0.95).",
      calibration_input: {
        detected_marker_ids: [0, 1, 2, 3],
        reprojection_error_px: 1.7,
        normalized_mat_area: 0.55,
        glare_score: 0.09,
        blur_score: 0.07,
        selected_object_kit: ["red_cup", "blue_cup", "book"],
        required_objects: ["red_cup", "blue_cup", "book"],
      },
      stable_observation: {
        observation_id: "obs_card_lighthouse_1",
        subject: "red_cup",
        predicate: "left_of",
        target: "book",
        confidence: 0.95,
        normalized_margin: 0.18,
        overlap: null,
      },
    },
  ];

export interface WebcamTrackLike {
  kind: string;
  stop(): void;
}

export interface WebcamStreamLike {
  id: string;
  getTracks(): WebcamTrackLike[];
  getVideoTracks(): WebcamTrackLike[];
}

export interface MediaDevicesLike {
  getUserMedia(constraints: {
    video:
      | boolean
      | {
          width?: { ideal: number };
          height?: { ideal: number };
          facingMode?: string;
        };
    audio: false;
  }): Promise<WebcamStreamLike>;
}

export interface WebcamAccessStatus {
  granted: boolean;
  stream_id: string | null;
  video_track_count: number;
  audio_requested: false;
  media_tracks_attached_to_webrtc: false;
}

export interface DataChannelNegotiationResult {
  connected: boolean;
  session_id: string;
  device_id: string;
  access_token: string;
  transport_mode: "webrtc" | "cloud_relay";
  data_channel_state: "open" | "connecting" | "closed";
  channels: DataChannelContractSpec[];
  local_offer_sdp: string;
  remote_answer_sdp: string;
  ice_candidates_sent: number;
  ice_candidates_received: number;
  media_tracks_present: false;
}

export interface StreamedTestCardResult {
  card_id: SyntheticCalibrationTestCard["card_id"];
  assessment: MatCalibrationAssessment;
  calibration_envelope: WebSocketSignalingEnvelope;
  observation_envelope: WebSocketSignalingEnvelope | null;
}

export interface CompanionCameraClientOptions {
  deviceId?: string;
  puzzleId?: string;
  calibrationVersion?: string;
  objectKitVersion?: string;
  mediaDevices?: MediaDevicesLike;
  onDataChannelMessage?: (envelope: WebSocketSignalingEnvelope) => void;
}

function createSyntheticWebcamStream(): WebcamStreamLike {
  const track: WebcamTrackLike = {
    kind: "video",
    stop() {
      // stopped
    },
  };
  return {
    id: "synthetic-companion-webcam-stream",
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
}

/**
 * Companion WebRTC Camera & PlayMat Calibration Test Client (`INT-RS-002`,
 * `INT-RS-003`, `SEC-RS-001`, `FR-RS-003`, `FR-RS-004`).
 *
 * - Requests local browser camera access via `navigator.mediaDevices.getUserMedia`
 *   (strictly video-only, `audio: false`, and never attaches media tracks to WebRTC).
 * - Connects to the WebSocket signaling server (`services/signaling/`), authenticates
 *   with one-time pairing credentials, and exchanges DataChannel-only SDP offers/answers
 *   and ICE candidates with the Fire TV simulator.
 * - Streams synthetic PlayMat calibration test cards and structured observations over
 *   the negotiated DataChannel / signaling channel.
 */
export class CompanionCameraTestClient {
  private readonly deviceId: string;
  private readonly puzzleId: string;
  private readonly calibrationVersion: string;
  private readonly objectKitVersion: string;
  private readonly mediaDevices: MediaDevicesLike | undefined;
  private readonly onDataChannelMessage:
    | ((envelope: WebSocketSignalingEnvelope) => void)
    | undefined;

  private activeStream: WebcamStreamLike | null = null;
  private ws: WebSocket | null = null;
  private sessionId = "";
  private accessToken = "";
  private dataChannelState: "open" | "connecting" | "closed" = "closed";
  private transportMode: "webrtc" | "cloud_relay" = "webrtc";
  private sequence = 0;
  private observationSequence = 0;
  private sentDataChannelEnvelopes: WebSocketSignalingEnvelope[] = [];

  constructor(options: CompanionCameraClientOptions = {}) {
    this.deviceId = options.deviceId ?? "companion-camera-test-client";
    this.puzzleId = options.puzzleId ?? "lighthouse_alignment";
    this.calibrationVersion = options.calibrationVersion ?? "cal_v1";
    this.objectKitVersion = options.objectKitVersion ?? "kit_v1";
    this.mediaDevices = options.mediaDevices;
    this.onDataChannelMessage = options.onDataChannelMessage;
  }

  /**
   * Requests browser webcam access via `navigator.mediaDevices.getUserMedia`
   * for local-only PlayMat calibration. Audio is strictly disabled and no media
   * track is ever added to WebRTC.
   */
  async requestWebcamAccess(): Promise<WebcamAccessStatus> {
    const navMediaDevices =
      this.mediaDevices ??
      (
        globalThis as unknown as {
          navigator?: { mediaDevices?: MediaDevicesLike };
        }
      ).navigator?.mediaDevices;

    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "environment",
      },
      audio: false as const,
    };

    if (navMediaDevices && typeof navMediaDevices.getUserMedia === "function") {
      this.activeStream = await navMediaDevices.getUserMedia(constraints);
    } else {
      this.activeStream = createSyntheticWebcamStream();
    }

    return {
      granted: true,
      stream_id: this.activeStream.id,
      video_track_count: this.activeStream.getVideoTracks().length,
      audio_requested: false,
      media_tracks_attached_to_webrtc: false,
    };
  }

  stopWebcam(): void {
    if (!this.activeStream) return;
    for (const track of this.activeStream.getTracks()) {
      track.stop();
    }
    this.activeStream = null;
  }

  getDataChannelState(): "open" | "connecting" | "closed" {
    return this.dataChannelState;
  }

  getSentDataChannelEnvelopes(): WebSocketSignalingEnvelope[] {
    return structuredClone(this.sentDataChannelEnvelopes);
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private nextObservationSequence(): number {
    this.observationSequence += 1;
    return this.observationSequence;
  }

  /**
   * Connects to the WebSocket signaling server, pairs with the Fire TV session,
   * and exchanges DataChannel-only SDP offers/answers and ICE candidates.
   */
  async connectAndNegotiateDataChannel(input: {
    ws_url: string;
    session_id: string;
    pairing_code?: string;
    pairing_nonce?: string;
    access_token?: string;
    now_ms?: number;
  }): Promise<DataChannelNegotiationResult> {
    this.sessionId = input.session_id;
    this.dataChannelState = "connecting";
    const nowIso = new Date(input.now_ms ?? Date.now()).toISOString();

    const ws = new WebSocket(input.ws_url);
    this.ws = ws;

    const inboundQueue: WebSocketSignalingEnvelope[] = [];
    const waiters: Array<{
      type: string;
      resolve: (msg: WebSocketSignalingEnvelope) => void;
      reject: (err: Error) => void;
    }> = [];

    ws.addEventListener("message", (event) => {
      const parsed = JSON.parse(
        String(event.data),
      ) as WebSocketSignalingEnvelope;
      if (parsed.type === "transport.state") {
        if (parsed.payload.transport === "cloud_relay") {
          this.transportMode = "cloud_relay";
        }
      }
      const waiterIdx = waiters.findIndex(
        (w) => w.type === parsed.type || parsed.type === "session.error",
      );
      if (waiterIdx !== -1) {
        const [waiter] = waiters.splice(waiterIdx, 1);
        if (
          parsed.type === "session.error" &&
          waiter!.type !== "session.error"
        ) {
          waiter!.reject(
            new Error(
              `signaling_error:${String(parsed.payload.reason_code ?? "unknown")}`,
            ),
          );
        } else {
          waiter!.resolve(parsed);
        }
        return;
      }
      inboundQueue.push(parsed);
    });

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () =>
        reject(new Error("companion_websocket_connect_failed")),
      );
    });

    const waitForMessage = (
      type: string,
      timeoutMs = 3_000,
    ): Promise<WebSocketSignalingEnvelope> => {
      const queuedIdx = inboundQueue.findIndex((m) => m.type === type);
      if (queuedIdx !== -1) {
        const [msg] = inboundQueue.splice(queuedIdx, 1);
        return Promise.resolve(msg!);
      }
      const errIdx = inboundQueue.findIndex((m) => m.type === "session.error");
      if (errIdx !== -1 && type !== "session.error") {
        const [errMsg] = inboundQueue.splice(errIdx, 1);
        return Promise.reject(
          new Error(
            `signaling_error:${String(errMsg!.payload.reason_code ?? "unknown")}`,
          ),
        );
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timeout_waiting_for_${type}`));
        }, timeoutMs);
        waiters.push({
          type,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
      });
    };

    // 1. Authenticate companion via `session.hello`
    const helloPayload: Record<string, unknown> = {
      role: "companion",
    };
    if (input.access_token) {
      helloPayload.access_token = input.access_token;
    } else {
      helloPayload.pairing_code = input.pairing_code;
      helloPayload.pairing_nonce = input.pairing_nonce;
    }

    ws.send(
      JSON.stringify({
        schema_version: 1,
        message_id: `comp-hello-${this.nextSequence()}`,
        session_id: this.sessionId,
        device_id: this.deviceId,
        sequence: this.sequence,
        sent_at: nowIso,
        type: "session.hello",
        payload: helloPayload,
      } satisfies WebSocketSignalingEnvelope),
    );

    const helloAck = await waitForMessage("session.hello.ack");
    this.accessToken = String(helloAck.payload.access_token ?? "");

    // 2. Send DataChannel-only SDP Offer (`observations` + `control`)
    const channels = structuredClone(
      DEFAULT_COMPANION_DATA_CHANNELS as DataChannelContractSpec[],
    );
    ws.send(
      JSON.stringify({
        schema_version: 1,
        message_id: `comp-offer-${this.nextSequence()}`,
        session_id: this.sessionId,
        device_id: this.deviceId,
        sequence: this.sequence,
        sent_at: nowIso,
        type: "webrtc.offer",
        payload: {
          sdp: VALID_COMPANION_DATACHANNEL_SDP,
          data_channels: channels,
        },
      } satisfies WebSocketSignalingEnvelope),
    );

    // 3. Wait for `webrtc.answer` from the Fire TV simulator peer
    const answerEnvelope = await waitForMessage("webrtc.answer");
    const remoteAnswerSdp = String(answerEnvelope.payload.sdp ?? "");

    // 4. Send local ICE candidate and await remote ICE candidate (if sent)
    ws.send(
      JSON.stringify({
        schema_version: 1,
        message_id: `comp-ice-${this.nextSequence()}`,
        session_id: this.sessionId,
        device_id: this.deviceId,
        sequence: this.sequence,
        sent_at: nowIso,
        type: "webrtc.ice",
        payload: {
          candidate: "candidate:1 1 UDP 2122252543 192.168.1.25 51234 typ host",
          sdp_mid: "0",
          sdp_m_line_index: 0,
        },
      } satisfies WebSocketSignalingEnvelope),
    );

    let iceReceived = 0;
    const queuedIce = inboundQueue.filter((m) => m.type === "webrtc.ice");
    iceReceived += queuedIce.length;

    this.dataChannelState = "open";

    return {
      connected: true,
      session_id: this.sessionId,
      device_id: this.deviceId,
      access_token: this.accessToken,
      transport_mode: this.transportMode,
      data_channel_state: this.dataChannelState,
      channels,
      local_offer_sdp: VALID_COMPANION_DATACHANNEL_SDP,
      remote_answer_sdp: remoteAnswerSdp,
      ice_candidates_sent: 1,
      ice_candidates_received: iceReceived,
      media_tracks_present: false,
    };
  }

  /**
   * Evaluates a synthetic PlayMat calibration test card locally and streams its
   * structured `calibration.state` (and optional `observation.stable`) envelope
   * over the established DataChannel / signaling connection.
   */
  streamCalibrationTestCard(
    cardId: SyntheticCalibrationTestCard["card_id"],
    options: { now_ms?: number; send_over_ws?: boolean } = {},
  ): StreamedTestCardResult {
    if (this.dataChannelState !== "open") {
      throw new Error("datachannel_not_open");
    }
    const card = SYNTHETIC_CALIBRATION_TEST_CARDS.find(
      (item) => item.card_id === cardId,
    );
    if (!card) {
      throw new Error(`unknown_calibration_test_card:${cardId}`);
    }

    const nowMs = options.now_ms ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const assessment = evaluateMatCalibration(card.calibration_input);
    const calSeq = this.nextObservationSequence();

    const calibrationEnvelope: WebSocketSignalingEnvelope = {
      schema_version: 1,
      message_id: `cal-${card.card_id}-${calSeq}`,
      session_id: this.sessionId,
      device_id: this.deviceId,
      sequence: calSeq,
      sent_at: nowIso,
      type: "calibration.state",
      payload: {
        puzzle_id: this.puzzleId,
        calibration_version: this.calibrationVersion,
        object_kit_version: this.objectKitVersion,
        calibration_valid: assessment.calibration_valid,
        needs_review: assessment.needs_review,
        occluded: assessment.occluded,
        reason_codes: assessment.reason_codes,
      },
    };

    this.dispatchStructuredEnvelope(
      calibrationEnvelope,
      options.send_over_ws ?? false,
    );

    let observationEnvelope: WebSocketSignalingEnvelope | null = null;
    if (card.stable_observation && assessment.calibration_valid) {
      const obsSeq = this.nextObservationSequence();
      observationEnvelope = {
        schema_version: 1,
        message_id: `obs-${card.card_id}-${obsSeq}`,
        session_id: this.sessionId,
        device_id: this.deviceId,
        sequence: obsSeq,
        sent_at: nowIso,
        type: "observation.stable",
        payload: {
          puzzle_id: this.puzzleId,
          calibration_version: this.calibrationVersion,
          object_kit_version: this.objectKitVersion,
          observation_id: card.stable_observation.observation_id,
          subject: card.stable_observation.subject,
          predicate: card.stable_observation.predicate,
          target: card.stable_observation.target,
          confidence: card.stable_observation.confidence,
          normalized_margin: card.stable_observation.normalized_margin,
          overlap: card.stable_observation.overlap,
          observed_at_ms: nowMs,
          sequence: obsSeq,
          calibration_valid: true,
          needs_review: false,
          occluded: false,
          candidate_present: true,
        },
      };
      this.dispatchStructuredEnvelope(
        observationEnvelope,
        options.send_over_ws ?? false,
      );
    }

    return {
      card_id: card.card_id,
      assessment,
      calibration_envelope: calibrationEnvelope,
      observation_envelope: observationEnvelope,
    };
  }

  /**
   * Streams all synthetic calibration test cards in sequence.
   */
  streamAllCalibrationTestCards(
    options: { now_ms?: number; send_over_ws?: boolean } = {},
  ): StreamedTestCardResult[] {
    const baseMs = options.now_ms ?? Date.now();
    return SYNTHETIC_CALIBRATION_TEST_CARDS.map((card, index) =>
      this.streamCalibrationTestCard(card.card_id, {
        now_ms: baseMs + index * 250,
        send_over_ws: options.send_over_ws ?? false,
      }),
    );
  }

  private dispatchStructuredEnvelope(
    envelope: WebSocketSignalingEnvelope,
    sendOverWs: boolean,
  ): void {
    this.sentDataChannelEnvelopes.push(structuredClone(envelope));
    this.onDataChannelMessage?.(structuredClone(envelope));
    if (sendOverWs && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  disconnect(): void {
    this.stopWebcam();
    this.dataChannelState = "closed";
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
