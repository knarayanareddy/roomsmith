import { ObservationIngress } from "../../../packages/session-contracts/src/index.js";
import { PairingService } from "../../pairing/src/index.js";
import { WebSocketSignalingServer } from "./websocket-signaling-server.js";

export async function startStandaloneSignalingServer(
  port = Number(process.env.PORT ?? 8080),
  host = process.env.HOST ?? "0.0.0.0",
): Promise<{
  server: WebSocketSignalingServer;
  port: number;
  url: string;
  defaultSessionId: string;
  defaultPairingCode: string;
}> {
  const pairingService = new PairingService();
  const demoSession = pairingService.createSession({
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
    now_ms: Date.now(),
  });

  const signalingServer = new WebSocketSignalingServer(pairingService);
  const ingress = new ObservationIngress({
    sessionId: demoSession.session_id,
    puzzleId: "lighthouse_alignment",
    calibrationVersion: "cal_v1",
    objectKitVersion: "kit_v1",
    authorizedDeviceIds: [
      "companion-camera-test-client",
      "companion-pixel-8",
      "companion-browser",
    ],
  });
  signalingServer.registerObservationIngress(demoSession.session_id, ingress);

  const bound = await signalingServer.listen(port, host);
  return {
    server: signalingServer,
    port: bound.port,
    url: bound.url,
    defaultSessionId: demoSession.session_id,
    defaultPairingCode: demoSession.pairing?.pairing_code ?? "B7R2K9",
  };
}

const isMain =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("services/signaling/src/server.ts");

if (isMain) {
  void startStandaloneSignalingServer().then((info) => {
    console.log(
      `RoomSmith WebSocket Signaling Server listening on ${info.url} (session=${info.defaultSessionId}, code=${info.defaultPairingCode})`,
    );
  });
}
