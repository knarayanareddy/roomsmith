import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FireTvWebSimulator } from "./simulator.js";

function resolvePath(relativePath: string): string {
  const fromHere = fileURLToPath(new URL(".", import.meta.url));
  for (const rel of ["../../..", "../../../.."]) {
    const candidate = resolve(fromHere, rel);
    if (existsSync(resolve(candidate, "package.json"))) {
      return resolve(candidate, relativePath);
    }
  }
  return resolve(process.cwd(), relativePath);
}

export function createFireTvServer(
  simulator = new FireTvWebSimulator(),
): Server {
  return createServer((req, res) => {
    const rawUrl = new URL(req.url ?? "/", "http://roomsmith.local");
    const pathname = rawUrl.pathname.replace(/^\/roomsmith(?=\/|$)/, "") || "/";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === "/" || pathname === "/index.html") {
      const html = readFileSync(resolvePath("apps/firetv/index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (pathname === "/ui/theme.css" || pathname === "/theme.css") {
      const css = readFileSync(resolvePath("ui/theme.css"), "utf8");
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(css);
      return;
    }

    if (
      pathname === "/specs/ui/wireframes.css" ||
      pathname === "/wireframes.css"
    ) {
      const css = readFileSync(resolvePath("specs/ui/wireframes.css"), "utf8");
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(css);
      return;
    }

    if (
      pathname === "/apps/firetv/src/styles.css" ||
      pathname === "/styles.css"
    ) {
      const css = readFileSync(
        resolvePath("apps/firetv/src/styles.css"),
        "utf8",
      );
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(css);
      return;
    }

    if (
      pathname === "/media/roomsmith-demo.webm" ||
      pathname === "/docs/media/roomsmith-demo.webm"
    ) {
      const video = readFileSync(resolvePath("docs/media/roomsmith-demo.webm"));
      res.writeHead(200, {
        "Content-Type": "video/webm",
        "Content-Length": String(video.byteLength),
      });
      res.end(video);
      return;
    }

    if (
      pathname === "/companion" ||
      pathname === "/apps/companion/index.html"
    ) {
      const html = readFileSync(
        resolvePath("apps/companion/index.html"),
        "utf8",
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (pathname === "/api/state" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(simulator.getState()));
      return;
    }

    if (pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", app: "firetv" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

const isMain =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("apps/firetv/src/server.ts");

if (isMain) {
  const port = Number(process.env.PORT ?? 5173);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createFireTvServer();
  server.listen(port, host, () => {
    console.log(
      `RoomSmith Fire TV Web Simulator listening on http://${host}:${port}`,
    );
  });
}
