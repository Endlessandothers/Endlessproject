// tool-runtime — runs a creator's transform, and nothing else.
//
// WHERE THE ISOLATION ACTUALLY COMES FROM
//
// Not from this file. This function runs in a VPC with no internet gateway and
// no NAT, behind a security group with no egress rules, under a role that grants
// nothing but its own log stream. Those are the boundary.
//
// That distinction matters because Node's `vm` module is NOT a security
// boundary — it is trivially escaped and was never meant to contain hostile
// code. Anything here that resembles containment is defence in depth and is
// assumed to be defeatable. The question a reviewer should ask is "what does the
// attacker reach after escaping", and the answer is: an empty network, no
// credentials, a read-only filesystem.
//
// Input:  { tool_id, version, source, input, responses }
// Output: { ok, result } or { ok:false, error }

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const TIMEOUT_MS = Number(process.env.TRANSFORM_TIMEOUT_MS || 5000);

// Deny the obvious ways a handler could try to reach outward. None of these
// would work anyway — there is no route and no credential — but failing fast
// and loudly turns a silent hang into a recorded, attributable refusal.
const FORBIDDEN = [
  [/\bimport\s*[({]|\bimport\s+[\w*{]/, "import"],
  [/\brequire\s*\(/, "require()"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\bprocess\b/, "process"],
  [/\bglobalThis\b/, "globalThis"],
  [/\beval\s*\(|new\s+Function/, "eval or Function constructor"],
  [/\bXMLHttpRequest\b|\bWebSocket\b/, "network client"],
];

function screen(source) {
  for (const [re, name] of FORBIDDEN) {
    if (re.test(source)) return `handler uses ${name}, which is not permitted in a tool`;
  }
  return null;
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`transform exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (event) => {
  const { tool_id, version, source, input, responses } = event ?? {};

  if (typeof source !== "string" || !source.length) {
    return { ok: false, error: "no handler source supplied" };
  }
  if (source.length > MAX_SOURCE_BYTES) {
    return { ok: false, error: `handler source exceeds ${MAX_SOURCE_BYTES} bytes` };
  }

  const refused = screen(source);
  if (refused) {
    console.log(JSON.stringify({ metric: "runtime_refused", tool_id, version, reason: refused }));
    return { ok: false, error: refused };
  }

  const started = Date.now();
  try {
    // Loaded as a data: module so the handler gets ES module semantics without
    // ever touching the filesystem. It inherits no scope from this file.
    const encoded = Buffer.from(source, "utf8").toString("base64");
    const mod = await import(`data:text/javascript;base64,${encoded}`);

    if (typeof mod.transform !== "function") {
      return { ok: false, error: "handler does not export a transform function" };
    }

    // Frozen inputs: a handler that mutates what it was given cannot corrupt
    // what the caller records about the call.
    const result = await withTimeout(
      Promise.resolve(mod.transform({
        input: Object.freeze({ ...(input ?? {}) }),
        responses: Object.freeze({ ...(responses ?? {}) }),
      })),
      TIMEOUT_MS,
    );

    const serialised = JSON.stringify(result ?? null);
    if (serialised === undefined) {
      return { ok: false, error: "transform returned something that is not serialisable" };
    }
    if (serialised.length > MAX_RESULT_BYTES) {
      return { ok: false, error: `result exceeds ${MAX_RESULT_BYTES} bytes` };
    }

    console.log(JSON.stringify({
      metric: "transform_ok", tool_id, version, ms: Date.now() - started,
      bytes: serialised.length,
    }));
    return { ok: true, result: JSON.parse(serialised), ms: Date.now() - started };
  } catch (err) {
    // A thrown transform is a failed call, recorded as such. It is never turned
    // into an empty success — that would enter the event log as a working call
    // and corrupt the scoring that is recomputed from it.
    console.log(JSON.stringify({
      metric: "transform_failed", tool_id, version,
      ms: Date.now() - started, message: String(err?.message).slice(0, 200),
    }));
    return { ok: false, error: String(err?.message ?? err).slice(0, 300), ms: Date.now() - started };
  }
};
