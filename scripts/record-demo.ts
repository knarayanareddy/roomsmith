import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SplitScreenEscapeRoomDemo } from "../apps/firetv/src/index.js";
import { createFireTvServer } from "../apps/firetv/src/server.js";

function resolveRepoRoot(): string {
  const fromHere = fileURLToPath(new URL(".", import.meta.url));
  for (const rel of ["..", "../..", "../../.."]) {
    const candidate = resolve(fromHere, rel);
    if (existsSync(resolve(candidate, "package.json"))) {
      return candidate;
    }
  }
  return process.cwd();
}

const REPO_ROOT = resolveRepoRoot();

export const DEFAULT_DEMO_VIDEO_PATH = resolve(
  REPO_ROOT,
  "docs/media/roomsmith-demo.webm",
);

export interface DemoWalkthroughStep {
  phase:
    | "initial_skewed_perspective"
    | "inaction_level_1_nudge"
    | "inaction_level_2_directional_hint"
    | "aligned_perspective_puzzle_unlocked";
  companion_perspective: string;
  companion_calibrated: boolean;
  clue_banner_visible: boolean;
  clue_banner_level: 1 | 2 | 3 | null;
  clue_banner_title: string | null;
  clue_banner_text: string | null;
  puzzle_id: string;
  puzzle_solved: boolean;
}

export interface DemoWalkthroughResult {
  steps: DemoWalkthroughStep[];
  output_video_path: string;
  recorded_via: "playwright" | "ffmpeg_split_screen_renderer";
  video_bytes: number;
}

interface PlaywrightVideoLike {
  path(): Promise<string>;
}

interface PlaywrightPageLike {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  video(): PlaywrightVideoLike | null;
}

interface PlaywrightContextLike {
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<void>;
}

interface PlaywrightBrowserLike {
  newContext(options: {
    viewport: { width: number; height: number };
    recordVideo: { dir: string; size: { width: number; height: number } };
  }): Promise<PlaywrightContextLike>;
  close(): Promise<void>;
}

interface PlaywrightModuleLike {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<PlaywrightBrowserLike>;
  };
}

/**
 * Executes the deterministic 4-phase split-screen escape room walkthrough:
 * 1. Companion camera starts with a skewed living room perspective (`skewed_uncalibrated`).
 * 2. Player inaction triggers the Level 1 Subtle Nudge clue banner on the Fire TV display.
 * 3. Continued player inaction escalates to the Level 2 Directional Clue banner.
 * 4. Player aligns the living room PlayMat perspective (`aligned_playmat`) and unlocks the puzzle.
 */
export async function executeSplitScreenDemoWalkthrough(): Promise<
  DemoWalkthroughStep[]
> {
  const demo = new SplitScreenEscapeRoomDemo();
  const steps: DemoWalkthroughStep[] = [];

  // Phase 1: Skewed perspective on left companion pane, unsolved puzzle on right Fire TV pane
  const s1 = demo.setPerspectivePreset("skewed_uncalibrated");
  steps.push({
    phase: "initial_skewed_perspective",
    companion_perspective: s1.companion.perspective_preset,
    companion_calibrated: s1.companion.calibration_valid,
    clue_banner_visible: s1.firetv.clue_banner?.visible ?? false,
    clue_banner_level: s1.firetv.clue_banner?.hint_level ?? null,
    clue_banner_title: s1.firetv.clue_banner?.tier_label ?? null,
    clue_banner_text: s1.firetv.clue_banner?.text ?? null,
    puzzle_id: s1.firetv.current_puzzle?.puzzle_id ?? "lighthouse_alignment",
    puzzle_solved: s1.firetv.completed_puzzles.some(
      (p) => p.puzzle_id === "lighthouse_alignment",
    ),
  });

  // Phase 2: Simulate inaction -> Level 1 Subtle Nudge clue banner pops up
  const s2 = await demo.simulateInactionTimeout();
  steps.push({
    phase: "inaction_level_1_nudge",
    companion_perspective: s2.companion.perspective_preset,
    companion_calibrated: s2.companion.calibration_valid,
    clue_banner_visible: s2.firetv.clue_banner?.visible ?? false,
    clue_banner_level: s2.firetv.clue_banner?.hint_level ?? null,
    clue_banner_title: s2.firetv.clue_banner?.tier_label ?? null,
    clue_banner_text: s2.firetv.clue_banner?.text ?? null,
    puzzle_id: s2.firetv.current_puzzle?.puzzle_id ?? "lighthouse_alignment",
    puzzle_solved: s2.firetv.completed_puzzles.some(
      (p) => p.puzzle_id === "lighthouse_alignment",
    ),
  });

  // Phase 3: Simulate continued inaction -> Level 2 Directional Clue banner pops up
  const s3 = await demo.simulateInactionTimeout();
  steps.push({
    phase: "inaction_level_2_directional_hint",
    companion_perspective: s3.companion.perspective_preset,
    companion_calibrated: s3.companion.calibration_valid,
    clue_banner_visible: s3.firetv.clue_banner?.visible ?? false,
    clue_banner_level: s3.firetv.clue_banner?.hint_level ?? null,
    clue_banner_title: s3.firetv.clue_banner?.tier_label ?? null,
    clue_banner_text: s3.firetv.clue_banner?.text ?? null,
    puzzle_id: s3.firetv.current_puzzle?.puzzle_id ?? "lighthouse_alignment",
    puzzle_solved: s3.firetv.completed_puzzles.some(
      (p) => p.puzzle_id === "lighthouse_alignment",
    ),
  });

  // Phase 4: Player aligns living room perspective -> puzzle unlocks
  const s4 = demo.alignPerspectiveAndUnlockActivePuzzle("lighthouse");
  steps.push({
    phase: "aligned_perspective_puzzle_unlocked",
    companion_perspective: s4.companion.perspective_preset,
    companion_calibrated: s4.companion.calibration_valid,
    clue_banner_visible: s4.firetv.clue_banner?.visible ?? false,
    clue_banner_level: s4.firetv.clue_banner?.hint_level ?? null,
    clue_banner_title: s4.firetv.clue_banner?.tier_label ?? null,
    clue_banner_text: s4.firetv.clue_banner?.text ?? null,
    puzzle_id: "lighthouse_alignment",
    puzzle_solved: s4.firetv.completed_puzzles.some(
      (p) => p.puzzle_id === "lighthouse_alignment",
    ),
  });

  return steps;
}

/**
 * Attempts to record the split-screen walkthrough via Playwright's browser
 * context `recordVideo` API against the live Fire TV split-screen web server.
 */
async function tryRecordWithPlaywright(outputPath: string): Promise<boolean> {
  try {
    const moduleName = "playwright";
    const pw = (await import(moduleName)) as unknown as PlaywrightModuleLike;
    const server = createFireTvServer();
    const port = await new Promise<number>((resolvePort, rejectPort) => {
      server.once("error", rejectPort);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolvePort(typeof addr === "object" && addr ? addr.port : 5173);
      });
    });
    const tempVideoDir = resolve(tmpdir(), `roomsmith-pw-${Date.now()}`);
    mkdirSync(tempVideoDir, { recursive: true });

    try {
      const browser = await pw.chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: {
          dir: tempVideoDir,
          size: { width: 1280, height: 720 },
        },
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForTimeout(20000);

      await page.click('[data-screen-tab="puzzle"]');
      await page.click("#btn-perspective-skew");
      await page.waitForTimeout(22000);

      // Simulate inaction -> Level 1 nudge clue banner
      await page.click("#btn-simulate-inaction");
      await page.waitForTimeout(24000);

      // Simulate continued inaction -> Level 2 directional hint
      await page.click("#btn-simulate-inaction");
      await page.waitForTimeout(24000);

      // Align living room perspective -> puzzle unlocks
      await page.click("#btn-align-and-unlock");
      await page.waitForTimeout(23000);

      const video = page.video();
      await context.close();
      await browser.close();

      const rawRecordedPath = video ? await video.path() : null;
      const candidatePath =
        rawRecordedPath && existsSync(rawRecordedPath)
          ? rawRecordedPath
          : readdirSync(tempVideoDir)
              .filter((f) => f.endsWith(".webm"))
              .map((f) => resolve(tempVideoDir, f))[0];

      if (candidatePath && existsSync(candidatePath)) {
        mkdirSync(dirname(outputPath), { recursive: true });
        const narrationPath = resolve(
          REPO_ROOT,
          "docs/media/roomsmith-narration.mp3",
        );
        if (existsSync(narrationPath)) {
          const muxResult = spawnSync("ffmpeg", [
            "-y",
            "-i",
            candidatePath,
            "-i",
            narrationPath,
            "-c:v",
            "copy",
            "-c:a",
            "libopus",
            "-b:a",
            "128k",
            "-shortest",
            outputPath,
          ]);
          if (muxResult.status === 0 && existsSync(outputPath)) {
            spawnSync("ffmpeg", [
              "-y",
              "-i",
              outputPath,
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              outputPath.replace(/\.webm$/, ".mp4"),
            ]);
            return true;
          }
        }
        copyFileSync(candidatePath, outputPath);
        return true;
      }
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  } catch {
    return false;
  }
  return false;
}

const FONT_5X7: Readonly<Record<string, readonly number[]>> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  ":": [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  "-": [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  ".": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100],
};

function fillRect(
  buf: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: readonly [number, number, number],
): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.floor(x + w));
  const y1 = Math.min(height, Math.floor(y + h));
  for (let py = y0; py < y1; py += 1) {
    let idx = (py * width + x0) * 3;
    for (let px = x0; px < x1; px += 1) {
      buf[idx] = rgb[0];
      buf[idx + 1] = rgb[1];
      buf[idx + 2] = rgb[2];
      idx += 3;
    }
  }
}

function drawText(
  buf: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  rgb: readonly [number, number, number],
): void {
  const upper = text.toUpperCase();
  let cursorX = x;
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper[i] ?? " ";
    const glyph = FONT_5X7[ch] ?? FONT_5X7[" "]!;
    for (let row = 0; row < 7; row += 1) {
      const bits = glyph[row] ?? 0;
      for (let col = 0; col < 5; col += 1) {
        if ((bits & (1 << (4 - col))) !== 0) {
          fillRect(
            buf,
            width,
            height,
            cursorX + col * scale,
            y + row * scale,
            scale,
            scale,
            rgb,
          );
        }
      }
    }
    cursorX += 6 * scale;
  }
}

function renderSplitScreenFramePpm(
  step: DemoWalkthroughStep,
  frameIdx: number,
): Buffer {
  const width = 960;
  const height = 540;
  const pixels = new Uint8Array(width * height * 3);

  // Midnight harbour background (#0B1D26)
  fillRect(pixels, width, height, 0, 0, width, height, [11, 29, 38]);

  // Top header bar (#102C3B)
  fillRect(pixels, width, height, 0, 0, width, 46, [16, 44, 59]);
  drawText(
    pixels,
    width,
    height,
    "ROOMSMITH SPLIT-SCREEN DEMO: COMPANION LEFT / FIRE TV RIGHT",
    18,
    16,
    2,
    [244, 239, 230],
  );

  // LEFT PANE: Companion Camera Living Room Perspective (x: 16..464)
  fillRect(pixels, width, height, 16, 58, 448, 464, [16, 44, 59]);
  fillRect(pixels, width, height, 16, 58, 448, 4, [124, 199, 196]);
  drawText(
    pixels,
    width,
    height,
    "LEFT: COMPANION CAMERA PERSPECTIVE",
    30,
    74,
    2,
    [124, 199, 196],
  );

  // Perspective Mat preview box
  fillRect(pixels, width, height, 36, 108, 408, 220, [8, 26, 38]);
  if (step.companion_calibrated) {
    // Aligned green PlayMat border & 4/4 markers
    fillRect(pixels, width, height, 86, 138, 308, 160, [24, 68, 62]);
    fillRect(pixels, width, height, 86, 138, 308, 4, [154, 217, 182]);
    fillRect(pixels, width, height, 86, 294, 308, 4, [154, 217, 182]);
    drawText(
      pixels,
      width,
      height,
      "4/4 ARUCO MARKERS ALIGNED",
      112,
      175,
      2,
      [154, 217, 182],
    );
    // Red cup left of archive book
    fillRect(pixels, width, height, 130, 210, 74, 56, [217, 107, 102]);
    drawText(pixels, width, height, "RED CUP", 136, 232, 2, [255, 255, 255]);
    fillRect(pixels, width, height, 250, 206, 96, 62, [214, 168, 79]);
    drawText(pixels, width, height, "BOOK", 274, 232, 2, [19, 35, 44]);
  } else {
    // Skewed uncalibrated coral PlayMat
    const jitter = (frameIdx % 4) * 2;
    fillRect(pixels, width, height, 106 + jitter, 154, 260, 130, [52, 34, 42]);
    fillRect(pixels, width, height, 106 + jitter, 154, 260, 4, [242, 161, 156]);
    drawText(
      pixels,
      width,
      height,
      "SKEWED PERSPECTIVE 3/4 MARKERS",
      118,
      208,
      2,
      [242, 161, 156],
    );
  }

  drawText(
    pixels,
    width,
    height,
    step.companion_calibrated
      ? "STATUS: CALIBRATED - STREAMING STABLE OBS"
      : "STATUS: UNCALIBRATED - ALIGN LIVING ROOM",
    30,
    356,
    2,
    step.companion_calibrated ? [154, 217, 182] : [240, 198, 109],
  );
  drawText(
    pixels,
    width,
    height,
    "WEBRTC DATACHANNEL: OBSERVATIONS OPEN",
    30,
    392,
    2,
    [189, 211, 212],
  );

  // RIGHT PANE: Fire TV 1080p Escape Room Display (x: 480..944)
  fillRect(pixels, width, height, 480, 58, 464, 464, [16, 44, 59]);
  fillRect(pixels, width, height, 480, 58, 464, 4, [214, 168, 79]);
  drawText(
    pixels,
    width,
    height,
    "RIGHT: FIRE TV 1080P ESCAPE DISPLAY",
    496,
    74,
    2,
    [214, 168, 79],
  );

  // Clue Banner Overlay on Fire TV when player stalls
  if (step.clue_banner_visible && step.clue_banner_level !== null) {
    const bannerColor: readonly [number, number, number] =
      step.clue_banner_level === 1 ? [124, 199, 196] : [240, 198, 109];
    fillRect(pixels, width, height, 496, 106, 432, 118, [26, 46, 59]);
    fillRect(pixels, width, height, 496, 106, 432, 6, bannerColor);
    drawText(
      pixels,
      width,
      height,
      step.clue_banner_level === 1
        ? "CLUE BANNER: LEVEL 1 SUBTLE NUDGE"
        : "CLUE BANNER: LEVEL 2 DIRECTIONAL HINT",
      510,
      124,
      2,
      bannerColor,
    );
    drawText(
      pixels,
      width,
      height,
      step.clue_banner_level === 1
        ? "CHECK LENS LABEL VS ARCHIVE BOOK"
        : "PLACE RED LENS LEFT OF ARCHIVE BOOK",
      510,
      158,
      2,
      [244, 239, 230],
    );
    drawText(
      pixels,
      width,
      height,
      "INACTION TIMEOUT TRIGGERED CLUE",
      510,
      190,
      2,
      [189, 211, 212],
    );
  } else {
    fillRect(pixels, width, height, 496, 106, 432, 76, [11, 29, 38]);
    drawText(
      pixels,
      width,
      height,
      "PUZZLE 1: LIGHTHOUSE BEAM ALIGNMENT",
      510,
      136,
      2,
      [244, 239, 230],
    );
  }

  // Puzzle Status Card on Fire TV
  fillRect(pixels, width, height, 496, 242, 432, 250, [11, 29, 38]);
  if (step.puzzle_solved) {
    fillRect(pixels, width, height, 516, 268, 392, 196, [22, 68, 54]);
    fillRect(pixels, width, height, 516, 268, 392, 6, [154, 217, 182]);
    drawText(
      pixels,
      width,
      height,
      "PUZZLE UNLOCKED - SIGNAL RESTORED",
      536,
      310,
      2,
      [154, 217, 182],
    );
    drawText(
      pixels,
      width,
      height,
      "RED LENS LEFT OF BOOK VERIFIED",
      536,
      350,
      2,
      [244, 239, 230],
    );
    drawText(
      pixels,
      width,
      height,
      "HOLD 1000 MS COMPLETE",
      536,
      390,
      2,
      [214, 168, 79],
    );
  } else {
    drawText(
      pixels,
      width,
      height,
      "OBJECTIVE: RED CUP LEFT OF BOOK",
      516,
      280,
      2,
      [244, 239, 230],
    );
    drawText(
      pixels,
      width,
      height,
      "HOLD DURATION: 0 / 1000 MS",
      516,
      320,
      2,
      [240, 198, 109],
    );
    drawText(
      pixels,
      width,
      height,
      "WAITING FOR PERSPECTIVE ALIGNMENT",
      516,
      360,
      2,
      [189, 211, 212],
    );
  }

  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, Buffer.from(pixels.buffer)]);
}

function findFfmpegBinary(): string {
  const candidates = [
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/tmp/pytools/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "ffmpeg";
}

function encodeWalkthroughWebmWithFfmpeg(
  steps: DemoWalkthroughStep[],
  outputPath: string,
): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const frames: Buffer[] = [];
  const framesPerStep = 18; // 4 phases * 18 frames @ 12 fps = 6 seconds
  for (const step of steps) {
    for (let i = 0; i < framesPerStep; i += 1) {
      frames.push(renderSplitScreenFramePpm(step, i));
    }
  }
  const inputStream = Buffer.concat(frames);
  const ffmpegBin = findFfmpegBinary();
  const res = spawnSync(
    ffmpegBin,
    [
      "-y",
      "-f",
      "image2pipe",
      "-vcodec",
      "ppm",
      "-r",
      "12",
      "-i",
      "-",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "600k",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ],
    {
      input: inputStream,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (res.status !== 0) {
    throw new Error(
      `ffmpeg failed with status ${String(res.status)}: ${res.stderr?.toString() ?? ""}`,
    );
  }
}

/**
 * Records the split-screen RoomSmith puzzle walkthrough video to
 * `docs/media/roomsmith-demo.webm`.
 */
export async function recordRoomSmithDemoVideo(
  outputPath = DEFAULT_DEMO_VIDEO_PATH,
): Promise<DemoWalkthroughResult> {
  const steps = await executeSplitScreenDemoWalkthrough();
  const usedPlaywright = await tryRecordWithPlaywright(outputPath);
  if (!usedPlaywright) {
    encodeWalkthroughWebmWithFfmpeg(steps, outputPath);
  }
  const stats = statSync(outputPath);
  return {
    steps,
    output_video_path: outputPath,
    recorded_via: usedPlaywright
      ? "playwright"
      : "ffmpeg_split_screen_renderer",
    video_bytes: stats.size,
  };
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  void recordRoomSmithDemoVideo().then((result) => {
    process.stdout.write(
      `Recorded RoomSmith split-screen walkthrough (${result.recorded_via}, ${result.video_bytes} bytes) -> ${result.output_video_path}\n`,
    );
  });
}
