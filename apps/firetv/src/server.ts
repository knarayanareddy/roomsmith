import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { FireTvWebSimulator } from "./simulator.js";

const simulator = new FireTvWebSimulator();

function resolvePath(relativePath: string): string {
  return fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));
}

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://roomsmith.local");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = readFileSync(resolvePath("apps/firetv/index.html"), "utf8");
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

  if (url.pathname === "/specs/ui/wireframes.css") {
    const css = readFileSync(resolvePath("specs/ui/wireframes.css"), "utf8");
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    res.end(css);
    return;
  }

  if (url.pathname === "/apps/firetv/src/styles.css") {
    const css = readFileSync(resolvePath("apps/firetv/src/styles.css"), "utf8");
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    res.end(css);
    return;
  }

  if (
    url.pathname === "/companion" ||
    url.pathname === "/apps/companion/index.html"
  ) {
    const html = readFileSync(resolvePath("apps/companion/index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(simulator.getState()));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, HOST, () => {
  console.log(
    `RoomSmith Fire TV Web Simulator listening on http://${HOST}:${PORT}`,
  );
});
