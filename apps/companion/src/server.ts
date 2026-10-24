import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SYNTHETIC_CALIBRATION_TEST_CARDS } from "./camera-client.js";

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

export function createCompanionServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://roomsmith.local");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (
      url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname === "/companion"
    ) {
      const html = readFileSync(
        resolvePath("apps/companion/index.html"),
        "utf8",
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (url.pathname === "/ui/theme.css") {
      const css = readFileSync(resolvePath("ui/theme.css"), "utf8");
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(css);
      return;
    }

    if (url.pathname === "/api/cards" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(SYNTHETIC_CALIBRATION_TEST_CARDS));
      return;
    }

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", app: "companion" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

const isMain =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("apps/companion/src/server.ts");

if (isMain) {
  const port = Number(process.env.PORT ?? 5174);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createCompanionServer();
  server.listen(port, host, () => {
    console.log(
      `RoomSmith Companion Camera Test Client listening on http://${host}:${port}`,
    );
  });
}
