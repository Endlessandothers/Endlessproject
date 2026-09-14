// Executes a catalog entry against its real upstream API.
//
// These are genuine callable wrappers, not metadata. Phase 0 never executes a
// registered tool, so nothing here runs in the search path — but writing them
// is what forced each description to be written from a real response rather
// than from a guess about one. Description quality is the ceiling on every
// number this phase produces.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadCatalog() {
  return JSON.parse(readFileSync(join(HERE, "catalog.json"), "utf8"));
}

export function buildUrl(tool, input) {
  return tool.url.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in input)) throw new Error(`${tool.tool_id}: missing input "${key}"`);
    return encodeURIComponent(input[key]);
  });
}

// Resolve a probe path like "results[0].elevation", "[1][0].value" or
// "places[0].place name". Keys may contain spaces, so segments split on "." and
// bracket indices are peeled off each segment.
export function resolve(obj, path) {
  let cur = obj;
  for (const segment of path.split(".")) {
    const name = segment.replace(/\[\d+\]/g, "");
    if (name) {
      if (cur == null || !(name in cur)) return undefined;
      cur = cur[name];
    }
    for (const m of segment.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(m[1])];
    }
  }
  return cur;
}

const UA = "Endless-Phase0/0.1 (+https://github.com/Endlessandothers/Endlessproject)";

export async function callTool(tool, input = tool.sample, { timeoutMs = 15000 } = {}) {
  const url = buildUrl(tool, input);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json,*/*" },
      signal: ac.signal,
    });
    const ms = Date.now() - started;
    const type = res.headers.get("content-type") || "";

    if (!type.includes("json")) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, ms, url, binary: true, type, bytes: buf.length };
    }

    const body = await res.json();

    // A 200 is not proof of success. restcountries returns HTTP 200 with
    // {success:false, errors:[...]} and was dropped from the catalog for it,
    // so the shape is checked rather than the status code alone.
    const softFail =
      body && typeof body === "object" && !Array.isArray(body) && body.success === false;

    return { ok: res.ok && !softFail, status: res.status, ms, url, body, softFail: !!softFail };
  } finally {
    clearTimeout(timer);
  }
}

// CLI: node tools/call.mjs <tool_id> ['{"json":"input"}']
if (process.argv[1] && process.argv[1].endsWith("call.mjs")) {
  const [, , id, raw] = process.argv;
  const catalog = loadCatalog();
  const tool = catalog.tools.find((t) => t.tool_id === id);
  if (!tool) {
    console.error(`unknown tool: ${id}`);
    console.error("available: " + catalog.tools.map((t) => t.tool_id).join(", "));
    process.exit(1);
  }
  const input = raw ? JSON.parse(raw) : tool.sample;
  const out = await callTool(tool, input);
  console.log(JSON.stringify(out.binary ? out : { ...out, body: out.body }, null, 2).slice(0, 4000));
}
