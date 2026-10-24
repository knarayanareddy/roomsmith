import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { viteConfig } from "../apps/firetv/vite.config.js";

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

export interface BuildPagesResult {
  base: "/roomsmith/";
  outDir: string;
  indexHtmlPath: string;
  stylesCssPath: string;
  demoVideoPath: string;
}

/**
 * Builds the standalone GitHub Pages split-screen RoomSmith web demo
 * honoring `apps/firetv/vite.config.ts` (`base: '/roomsmith/'`) and copying
 * `docs/media/roomsmith-demo.webm` to `/media/roomsmith-demo.webm`.
 */
export function buildGitHubPagesBundle(
  outDir = resolve(REPO_ROOT, "dist/pages"),
): BuildPagesResult {
  if (viteConfig.build.emptyOutDir) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(resolve(outDir, "src"), { recursive: true });
  mkdirSync(resolve(outDir, "specs/ui"), { recursive: true });
  mkdirSync(resolve(outDir, "ui"), { recursive: true });
  mkdirSync(resolve(outDir, "media"), { recursive: true });

  const rawHtml = readFileSync(
    resolve(REPO_ROOT, "apps/firetv/index.html"),
    "utf8",
  );
  const rewrittenHtml = rawHtml
    .replace(
      'href="/apps/firetv/src/styles.css"',
      `href="${viteConfig.base}src/styles.css"`,
    )
    .replace(
      'href="/specs/ui/wireframes.css"',
      `href="${viteConfig.base}specs/ui/wireframes.css"`,
    )
    .replace('href="/ui/theme.css"', `href="${viteConfig.base}ui/theme.css"`)
    .replaceAll('src="/media/', `src="${viteConfig.base}media/`)
    .replaceAll(
      'src="/media/roomsmith-demo.webm"',
      `src="${viteConfig.base}media/roomsmith-demo.webm"`,
    );

  const indexHtmlPath = resolve(outDir, "index.html");
  const stylesCssPath = resolve(outDir, "src/styles.css");
  const demoVideoPath = resolve(outDir, "media/roomsmith-demo.webm");

  writeFileSync(indexHtmlPath, rewrittenHtml, "utf8");
  writeFileSync(resolve(outDir, "404.html"), rewrittenHtml, "utf8");
  writeFileSync(resolve(outDir, ".nojekyll"), "", "utf8");
  cpSync(resolve(REPO_ROOT, "apps/firetv/src/styles.css"), stylesCssPath);
  cpSync(
    resolve(REPO_ROOT, "specs/ui/wireframes.css"),
    resolve(outDir, "specs/ui/wireframes.css"),
  );
  cpSync(resolve(REPO_ROOT, "ui/theme.css"), resolve(outDir, "ui/theme.css"));

  const firetvRoot = resolve(REPO_ROOT, "apps/firetv", viteConfig.root);
  for (const asset of viteConfig.build.copyAssets) {
    const srcPath = resolve(firetvRoot, asset.src);
    const destPath = resolve(outDir, asset.dest);
    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(srcPath, destPath);
  }

  return {
    base: viteConfig.base,
    outDir,
    indexHtmlPath,
    stylesCssPath,
    demoVideoPath,
  };
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const result = buildGitHubPagesBundle();
  process.stdout.write(
    `RoomSmith GitHub Pages bundle written to ${result.outDir} (base: ${result.base}, video: ${result.demoVideoPath})\n`,
  );
}
