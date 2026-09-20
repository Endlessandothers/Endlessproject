// endless-app — a window onto the network, for people rather than agents.
//
// Everything built so far is reachable by an agent over MCP or by an operator
// with a terminal. This is the third door: a page you can open, paste a key
// into, and use.
//
// THE ONE RULE THIS APP LIVES BY: IT HOLDS NO KEY.
//
// It would be easier if it did. One key in an environment variable and nobody
// has to paste anything. But then every visitor would arrive as the SAME
// caller, and every count this system rests on — distinct callers behind a gap,
// distinct owners behind a cluster, who is competing with whom — would silently
// collapse to one. The registry would be unable to tell a hundred people from
// one person a hundred times.
//
// So a visitor brings their own key. The app forwards it and keeps nothing:
// no session, no store, no log of it. Same arrangement as mcp-fn, which
// forwards a caller's credential rather than acting on its own behalf, and for
// the same reason.
//
// It also means this container needs no AWS credentials at all. Its task role
// grants nothing, because there is nothing for it to be granted.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const MCP_URL = process.env.MCP_URL;
const BOARD_URL = process.env.BOARD_URL;

if (!MCP_URL || !BOARD_URL) {
  console.error("MCP_URL and BOARD_URL are required");
  process.exit(1);
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (c) => {
    data += c;
    // A body this size is not a search query. Refuse rather than buffer.
    if (data.length > 64 * 1024) { reject(new Error("body too large")); req.destroy(); }
  });
  req.on("end", () => resolve(data));
  req.on("error", reject);
});

// Only the three MCP tools this page uses. Not a general proxy: an open relay
// to the MCP endpoint would let anyone use this container as an anonymising
// hop, and the endpoint's own rate limiting counts this task's address rather
// than theirs.
const ALLOWED = new Set(["endless_search", "endless_call", "endless_gaps"]);

async function callMcp(auth, name, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The visitor's key, forwarded verbatim and never stored.
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: args ?? {} },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  return res.json();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    // ECS health check. Deliberately says nothing about whether the registry is
    // reachable: this reports whether the container is alive, and conflating
    // the two would have ECS restart the task every time Bedrock was slow.
    if (url.pathname === "/health") return json(res, 200, { ok: true });

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(join(HERE, "public", "index.html"), "utf8");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
        // The page loads nothing from anywhere else and talks only to itself.
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      return res.end(html);
    }

    // The public board. No key needed and none forwarded — it is the same
    // object anyone can fetch from CloudFront.
    if (url.pathname === "/api/board") {
      const which = url.searchParams.get("file") === "tools" ? "tools.json" : "gaps.json";
      const out = await fetch(`${BOARD_URL}${which}`, { signal: AbortSignal.timeout(15_000) });
      if (!out.ok) return json(res, 502, { error: `board returned ${out.status}` });
      return json(res, 200, await out.json());
    }

    if (url.pathname === "/api/mcp" && req.method === "POST") {
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch { return json(res, 400, { error: "body is not valid json" }); }

      if (!ALLOWED.has(body?.name)) {
        return json(res, 400, { error: `this app only calls: ${[...ALLOWED].join(", ")}` });
      }
      // No key, no call. Refused here so an unauthenticated click costs nothing
      // downstream.
      const auth = req.headers.authorization;
      if (!auth) return json(res, 401, { error: "paste your Endless API key first" });

      return json(res, 200, await callMcp(auth, body.name, body.arguments));
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(String(err?.message ?? err));
    return json(res, 500, { error: "something went wrong" });
  }
});

server.listen(PORT, () => {
  // The key is never logged, because it is never held. Worth saying out loud in
  // the one place somebody reads when they are wondering where it went.
  console.log(JSON.stringify({
    msg: "endless-app listening", port: PORT, mcp: MCP_URL, board: BOARD_URL,
    holds_key: false,
  }));
});
