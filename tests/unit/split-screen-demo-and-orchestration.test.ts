import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createCompanionServer } from "../../apps/companion/src/index.js";
import {
  InMemoryWebRtcMockTransport,
  SPLIT_SCREEN_MODE_TOGGLE_TEXT,
  SplitScreenEscapeRoomDemo,
  WALKTHROUGH_VIDEO_ASSET_PATH,
  WALKTHROUGH_VIDEO_SIZE_KB,
  viteConfig,
} from "../../apps/firetv/src/index.js";
import { createFireTvServer } from "../../apps/firetv/src/server.js";
import { buildGitHubPagesBundle } from "../../scripts/build-pages.js";
import {
  DEFAULT_DEMO_VIDEO_PATH,
  executeSplitScreenDemoWalkthrough,
} from "../../scripts/record-demo.js";
import { startStandaloneSignalingServer } from "../../services/signaling/src/index.js";

describe("Single-command orchestration, split-screen demo, and walkthrough recorder", () => {
  it("defines docker-compose.yml with redis (6379), signaling (8080), firetv (5173), and companion (5174)", () => {
    const composePath = resolve(process.cwd(), "docker-compose.yml");
    expect(existsSync(composePath)).toBe(true);
    const content = readFileSync(composePath, "utf8");
    expect(content).toContain("redis:");
    expect(content).toContain("6379:6379");
    expect(content).toContain("signaling:");
    expect(content).toContain("8080:8080");
    expect(content).toContain("firetv:");
    expect(content).toContain("5173:5173");
    expect(content).toContain("companion:");
    expect(content).toContain("5174:5174");
  });

  it("serves standalone signaling, firetv (/roomsmith/ base support), and companion servers", async () => {
    const sig = await startStandaloneSignalingServer(0);
    const firetvServer = createFireTvServer();
    const companionServer = createCompanionServer();

    const tvPort = await new Promise<number>((res) => {
      firetvServer.listen(0, "127.0.0.1", () => {
        const addr = firetvServer.address();
        res(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
    const compPort = await new Promise<number>((res) => {
      companionServer.listen(0, "127.0.0.1", () => {
        const addr = companionServer.address();
        res(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      expect(sig.port).toBeGreaterThan(0);

      const tvRoot = await fetch(`http://127.0.0.1:${tvPort}/roomsmith/`);
      expect(tvRoot.status).toBe(200);
      const tvHtml = await tvRoot.text();
      expect(tvHtml).toContain("split-screen-demo");

      const tvHealth = await fetch(`http://127.0.0.1:${tvPort}/healthz`);
      expect(tvHealth.status).toBe(200);

      const compHealth = await fetch(`http://127.0.0.1:${compPort}/healthz`);
      expect(compHealth.status).toBe(200);

      const compCards = await fetch(`http://127.0.0.1:${compPort}/api/cards`);
      expect(compCards.status).toBe(200);
      const cardsJson = (await compCards.json()) as Record<string, unknown>;
      expect(Object.keys(cardsJson).length).toBeGreaterThanOrEqual(4);
    } finally {
      await sig.server.close();
      await new Promise<void>((res) => firetvServer.close(() => res()));
      await new Promise<void>((res) => companionServer.close(() => res()));
    }
  });

  it("configures apps/firetv/vite.config.ts with base '/roomsmith/' and copies roomsmith-demo.webm to /media/", () => {
    expect(viteConfig.base).toBe("/roomsmith/");
    expect(viteConfig.build.copyAssets).toEqual([
      {
        src: "../../docs/media/roomsmith-demo.webm",
        dest: "media/roomsmith-demo.webm",
      },
      {
        src: "../../docs/media/roomsmith-demo.mp4",
        dest: "media/roomsmith-demo.mp4",
      },
      {
        src: "../../docs/media/roomsmith-narration.mp3",
        dest: "media/roomsmith-narration.mp3",
      },
    ]);
    const pagesWorkflowPath = resolve(
      process.cwd(),
      ".github/workflows/pages.yml",
    );
    expect(existsSync(pagesWorkflowPath)).toBe(true);

    const bundle = buildGitHubPagesBundle();
    expect(bundle.base).toBe("/roomsmith/");
    expect(existsSync(bundle.indexHtmlPath)).toBe(true);
    expect(existsSync(bundle.stylesCssPath)).toBe(true);
    expect(existsSync(bundle.demoVideoPath)).toBe(true);
    expect(statSync(bundle.demoVideoPath).size).toBeGreaterThan(100_000);
    const html = readFileSync(bundle.indexHtmlPath, "utf8");
    expect(html).toContain('href="/roomsmith/src/styles.css"');
    expect(html).toContain('src="/roomsmith/media/roomsmith-demo.webm"');
    expect(html).toContain(SPLIT_SCREEN_MODE_TOGGLE_TEXT);
    expect(html).toContain("split-screen-demo");
  });

  it("switches between video walkthrough mode and split-screen simulator mode and runs across all 3 puzzles", async () => {
    const transport = new InMemoryWebRtcMockTransport();
    const demo = new SplitScreenEscapeRoomDemo(undefined, transport);

    expect(demo.getMode()).toBe("simulator");
    expect(demo.getState().mode_toggle_text).toBe(
      "Mode: [🎥 Watch Full Escape Walkthrough] [🧩 Play Split-Screen Simulator]",
    );
    expect(demo.getState().walkthrough_video.active).toBe(false);
    expect(demo.getState().walkthrough_video.src).toBe(
      WALKTHROUGH_VIDEO_ASSET_PATH,
    );
    expect(demo.getState().walkthrough_video.size_kb).toBe(
      WALKTHROUGH_VIDEO_SIZE_KB,
    );

    // Switch to video walkthrough mode
    const videoModeState = demo.setMode("video");
    expect(videoModeState.mode).toBe("video");
    expect(videoModeState.walkthrough_video.active).toBe(true);
    const videoHtml = demo.renderQuickSwitchViewHtml("/roomsmith/");
    expect(videoHtml).toContain(
      "Mode: [🎥 Watch Full Escape Walkthrough] [🧩 Play Split-Screen Simulator]",
    );
    expect(videoHtml).toContain('src="/roomsmith/media/roomsmith-demo.webm"');
    expect(videoHtml).toContain(
      "126 KB roomsmith-demo.webm showcasing the synchronized Fire TV screen and companion camera perspective alignment",
    );

    // Toggle back to interactive simulator mode
    const simModeState = demo.toggleMode();
    expect(simModeState.mode).toBe("simulator");
    expect(simModeState.walkthrough_video.active).toBe(false);

    expect(demo.getState().companion.perspective_preset).toBe(
      "skewed_uncalibrated",
    );
    expect(demo.getState().companion.calibration_valid).toBe(false);
    expect(demo.getState().webrtc.connected).toBe(true);
    expect(demo.getState().webrtc.media_tracks_present).toBe(false);

    // Simulate player inaction -> Level 1 Subtle Nudge -> Level 2 Directional Hint
    const afterStall1 = await demo.simulateInactionTimeout();
    expect(afterStall1.firetv.clue_banner?.visible).toBe(true);
    expect(afterStall1.firetv.clue_banner?.hint_level).toBe(1);

    const afterStall2 = await demo.simulateInactionTimeout();
    expect(afterStall2.firetv.clue_banner?.visible).toBe(true);
    expect(afterStall2.firetv.clue_banner?.hint_level).toBe(2);

    // Align living room perspective and solve all 3 puzzles over in-memory WebRTC DataChannel
    const solved1 = demo.alignPerspectiveAndUnlockActivePuzzle("lighthouse");
    expect(solved1.companion.calibration_valid).toBe(true);
    expect(
      solved1.firetv.completed_puzzles.some(
        (p) => p.puzzle_id === "lighthouse_alignment",
      ),
    ).toBe(true);

    const solved2 = demo.alignPerspectiveAndUnlockActivePuzzle("gearbox");
    expect(
      solved2.firetv.completed_puzzles.some(
        (p) => p.puzzle_id === "raise_the_shield",
      ),
    ).toBe(true);

    const solved3 = demo.alignPerspectiveAndUnlockActivePuzzle("powergrid");
    expect(
      solved3.firetv.completed_puzzles.some(
        (p) => p.puzzle_id === "lens_archive_sequence",
      ),
    ).toBe(true);
    expect(solved3.firetv.active_screen).toBe("completion");
  });

  it("executes the 4-phase walkthrough and verifies docs/media/roomsmith-demo.webm exists with valid EBML header", async () => {
    const steps = await executeSplitScreenDemoWalkthrough();
    expect(steps).toHaveLength(4);
    expect(steps[0]?.phase).toBe("initial_skewed_perspective");
    expect(steps[0]?.companion_calibrated).toBe(false);
    expect(steps[1]?.phase).toBe("inaction_level_1_nudge");
    expect(steps[1]?.clue_banner_level).toBe(1);
    expect(steps[2]?.phase).toBe("inaction_level_2_directional_hint");
    expect(steps[2]?.clue_banner_level).toBe(2);
    expect(steps[3]?.phase).toBe("aligned_perspective_puzzle_unlocked");
    expect(steps[3]?.companion_calibrated).toBe(true);
    expect(steps[3]?.puzzle_solved).toBe(true);

    expect(existsSync(DEFAULT_DEMO_VIDEO_PATH)).toBe(true);
    const stat = statSync(DEFAULT_DEMO_VIDEO_PATH);
    expect(stat.size).toBeGreaterThan(10_000);

    const header = readFileSync(DEFAULT_DEMO_VIDEO_PATH).subarray(0, 4);
    // WebM / Matroska EBML header bytes: 0x1A 0x45 0xDF 0xA3
    expect(Array.from(header)).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });
});
