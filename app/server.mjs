// endless-app — a window onto the network, for people rather than agents.
//
// Everything built so far is reachable by an agent over MCP or by an operator
// with a terminal. This is the third door: a page you can open, paste a key
// into, and use.
//
// IT USED TO HOLD NO KEY. NOW IT HOLDS ONE, AND THAT IS A REAL TRADE.
//
// The original rule was that a visitor brings their own credential, because
// every count this system rests on — distinct callers behind a gap, distinct
// owners behind a cluster, who is competing with whom — is a count of separate
// people. One shared key collapses all of them to one. The registry becomes
// unable to tell a hundred people from one person a hundred times.
//
// That cost is only worth paying while there IS one person, which today there
// is. ENDLESS_API_KEY is the operator's own key, injected by ECS at task start,
// used when a request arrives without one. So the counts stay honest — they
// really are all one caller — and there is nothing to paste.
//
// TWO THINGS MUST BE TRUE FOR THIS TO STAY SAFE, and neither is enforced here:
//
//   1. The security group admits one address. A page on an open port that
//      carries a working key is an open relay to this account's credits, and
//      every search behind it is an Opus 5 call billed to it. See
//      app_allowed_cidr in infra/variables.tf.
//   2. Before anyone else uses this, the key goes away again. Unset
//      app_key_param, reopen the CIDR, and the app is back to forwarding what
//      a visitor brings. The page still has the key box for exactly that
//      reason; a pasted key always wins over the built-in one.
//
// A visitor's own key still takes precedence, so this is a fallback rather
// than a replacement — the multi-user path is not deleted, only unused.
//
// The container still holds no AWS credentials and has no task role. ECS reads
// the parameter before the container starts; the app never calls AWS at all.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const MCP_URL = process.env.MCP_URL;
const BOARD_URL = process.env.BOARD_URL;

// Trimmed because it arrives from a parameter store, and a stray newline in a
// credential produces a 401 that says nothing about why. Empty string when the
// app is back to holding nothing, which is falsy and therefore the same code
// path as before.
const OWN_KEY = (process.env.ENDLESS_API_KEY || "").trim();

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

    // Two pages, one server. The world is the same data as the plain page —
    // same board files, same MCP calls — drawn as somewhere you travel rather
    // than a list you scroll. Neither is the "real" one.
    const PAGES = { "/": "index.html", "/index.html": "index.html", "/world": "world.html" };
    if (PAGES[url.pathname]) {
      const html = await readFile(join(HERE, "public", PAGES[url.pathname]), "utf8");
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

    // What the page needs to know before it decides whether to ask for a key.
    // Deliberately separate from /health, which ECS reads and which should not
    // change shape for our convenience.
    if (url.pathname === "/api/config") return json(res, 200, { holds_key: Boolean(OWN_KEY) });

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
      // The visitor's key first, the built-in one only as a fallback. That
      // order is what keeps the multi-user path alive: someone who pastes a key
      // is still counted as themselves, even while OWN_KEY is set.
      const auth = req.headers.authorization || (OWN_KEY ? `Bearer ${OWN_KEY}` : null);
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
    // Whether, never which. The key itself is never logged, and this line is
    // the one place somebody looks when wondering why the page stopped asking
    // for one.
    holds_key: Boolean(OWN_KEY),
  }));
});
