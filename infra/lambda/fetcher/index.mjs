// fetcher-fn — the only component in Endless permitted to open a connection.
//
// A tool declares the requests it needs; this makes them, against that tool's
// allowlist, and returns the parsed bodies. The tool never sees a socket.
//
// It runs OUTSIDE the sandbox VPC, because it is the one thing that must reach
// the internet. It holds no AWS permissions beyond its own log stream, so
// compromising it yields the ability to fetch public URLs — which is what it
// already does.

import { prepare, checkMethod } from "./allowlist.mjs";

const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10000);
const MAX_BYTES = Number(process.env.FETCH_MAX_BYTES || 2 * 1024 * 1024);
const MAX_REQUESTS = Number(process.env.FETCH_MAX_REQUESTS || 4);
const UA = "Endless/1.0 (+https://github.com/Endlessandothers/Endlessproject)";

async function one(req) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: { "user-agent": UA, accept: "application/json, text/*;q=0.8, */*;q=0.5" },
      signal: ac.signal,
      // A redirect is how an allowlisted host hands the connection to one that
      // is not. The allowlist would be decorative if redirects were followed.
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      return { id: req.id, ok: false, status: res.status,
               error: `redirect to ${res.headers.get("location") ?? "unknown"} refused` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return { id: req.id, ok: false, status: res.status, error: `response exceeds ${MAX_BYTES} bytes` };
    }

    const type = res.headers.get("content-type") || "";
    let body;
    if (type.includes("json")) {
      try { body = JSON.parse(buf.toString("utf8")); }
      catch { return { id: req.id, ok: false, status: res.status, error: "upstream sent malformed json" }; }
    } else {
      body = { content_type: type, bytes: buf.length, text: buf.toString("utf8").slice(0, 100000) };
    }

    return { id: req.id, ok: res.ok, status: res.status, ms: Date.now() - started, body };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return { id: req.id, ok: false, ms: Date.now() - started,
             error: aborted ? `timed out after ${TIMEOUT_MS}ms` : String(err?.message).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (event) => {
  const { tool_id, requests = [], input = {}, allowlist = [] } = event ?? {};

  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return { ok: false, error: "no allowlist supplied; refusing to fetch anything" };
  }
  if (requests.length === 0) return { ok: true, responses: {} };
  if (requests.length > MAX_REQUESTS) {
    return { ok: false, error: `${requests.length} requests exceeds the limit of ${MAX_REQUESTS}` };
  }

  let planned;
  try {
    planned = requests.map((r) => {
      const p = prepare(r, input, allowlist);
      const m = checkMethod(p.method);
      if (!m.ok) throw new Error(`${r.id}: ${m.reason}`);
      return p;
    });
  } catch (err) {
    // A refusal here is a policy decision and is logged as one, so an attempt to
    // reach an unlisted host is attributable rather than merely absent.
    console.log(JSON.stringify({ metric: "fetch_refused", tool_id, reason: String(err.message).slice(0, 200) }));
    return { ok: false, error: String(err.message) };
  }

  const results = await Promise.all(planned.map(one));
  const responses = Object.fromEntries(results.map((r) => [r.id, r]));
  const failed = results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error ?? `HTTP ${r.status}`}`);

  console.log(JSON.stringify({
    metric: "fetch_done", tool_id, count: results.length,
    failed: failed.length, ms: Math.max(...results.map((r) => r.ms ?? 0)),
  }));

  return failed.length
    ? { ok: false, error: failed.join("; "), responses }
    : { ok: true, responses };
};
