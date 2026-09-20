// Moons — one tool depending on another. Phase 2, issue #1.
//
// Pure: no AWS imports, so the rules that stop a dependency graph eating itself
// are testable without credentials.
//
// HOW A TOOL CALLS A TOOL, GIVEN THE SANDBOX.
//
// It does not. The runtime has no network and no credentials, so a handler
// cannot reach the registry any more than it can reach the internet — and that
// is not a limitation to work around, it is the whole guarantee.
//
// So the platform mediates, exactly as it does for HTTP. A tool DECLARES its
// dependencies in its manifest; exec-fn resolves and runs them first, and passes
// the results in beside the fetched responses:
//
//   transform({ input, responses, tools })
//
// The handler sees finished values. It never learns that another tool exists,
// cannot choose one at runtime, and cannot pass anything to one that was not
// written down at publication and read at review. A dependency is part of what
// gets approved, like an allowlisted host.

// How deep a chain may go before it is refused.
//
// Three, because the cost is multiplicative and every level is a real execution:
// a tool with three dependencies that each have three is thirteen runs of the
// sandbox for one call. Depth is capped here and breadth by MAX_USES below;
// together they bound one call at a number you can hold in your head.
export const MAX_DEPTH = 3;

// How many tools one tool may depend on directly.
export const MAX_USES = 4;

// A dependency declaration, as it appears in a manifest:
//
//   uses: [
//     { id: "where", tool_id: "geocode-place",  input: { place: "{place}" } },
//     { id: "air",   tool_id: "air-quality",    input: { lat: "{where.lat}",
//                                                        lon: "{where.lon}" } },
//   ]
//
// A dependency may feed the next one. "{place}" reads the calling tool's input;
// "{where.lat}" reads a field from a dependency that has already run. Chaining
// is most of the point — geocoding a name and then using the coordinates is the
// shape almost every composition takes.
//
// A reference may only name an EARLIER entry, which is checked at publication.
// That single rule makes ordering explicit, makes sibling cycles impossible to
// express, and means resolution never has to search for a valid order.
//
// version is optional and pinning it is the safer choice: an unpinned dependency
// means the reviewed behaviour of THIS tool can change because somebody else
// published, without anyone reviewing anything.
export function validateUses(uses, selfToolId) {
  const errors = [];
  if (uses === undefined || uses === null) return errors;
  if (!Array.isArray(uses)) return ["uses must be an array"];
  if (uses.length > MAX_USES) {
    errors.push(`uses declares ${uses.length} dependencies, the limit is ${MAX_USES}`);
  }

  const seen = new Set();
  for (const u of uses) {
    if (!u || typeof u !== "object") { errors.push("each entry in uses must be an object"); continue; }
    if (!u.id || typeof u.id !== "string") { errors.push("each dependency needs an id"); continue; }
    if (seen.has(u.id)) errors.push(`duplicate dependency id: ${u.id}`);

    // References are resolved against what has already run, so a dependency may
    // only read from one declared before it. Checked here rather than at call
    // time: a composition that cannot work should fail to publish, not fail for
    // the first caller who tries it.
    for (const ref of referencesIn(u.input)) {
      if (!ref.includes(".")) continue;
      const [dep] = ref.split(".");
      if (dep === u.id) {
        errors.push(`dependency ${u.id}: cannot read from itself`);
      } else if (!seen.has(dep)) {
        errors.push(`dependency ${u.id}: reads {${ref}} but ${dep} is not declared before it`);
      }
    }
    seen.add(u.id);

    if (!u.tool_id || typeof u.tool_id !== "string") {
      errors.push(`dependency ${u.id}: tool_id is required`);
    }
    // The shortest possible cycle, caught at publication rather than at call
    // time. A tool that depends on itself is never what anyone meant.
    if (u.tool_id === selfToolId) {
      errors.push(`dependency ${u.id}: a tool cannot depend on itself`);
    }
    if (u.input !== undefined && (typeof u.input !== "object" || Array.isArray(u.input))) {
      errors.push(`dependency ${u.id}: input must be an object`);
    }
  }
  return errors;
}

// Build a dependency's input from the calling tool's input.
//
// A value of exactly "{name}" passes the parent's value THROUGH, with its type:
// a latitude stays a number rather than becoming the string "51.5". Anything
// else is treated as a template and interpolated into a string, which is what
// you want for "{city}, {country}".
//
// Types matter here because the callee's schema is enforced, and a number
// arriving as a string fails validation in a way whose cause is invisible from
// the handler that caused it.
const WHOLE = /^\{([\w.]+)\}$/;
const ANY = /\{([\w.]+)\}/g;

// Every placeholder a declaration reads, so publication can check them.
export function referencesIn(template = {}) {
  const found = [];
  for (const spec of Object.values(template ?? {})) {
    if (typeof spec !== "string") continue;
    for (const m of spec.matchAll(ANY)) found.push(m[1]);
  }
  return found;
}

// Resolve one reference against the calling tool's input and whatever
// dependencies have already run.
//
// A bare name reads the input. A dotted name reads into a prior result, and the
// walk stops at the first missing step rather than throwing — a caller wants to
// be told which reference failed, not that something was undefined.
function lookup(ref, parentInput, prior) {
  if (!ref.includes(".")) {
    return ref in parentInput ? { ok: true, value: parentInput[ref] } : { ok: false };
  }
  const [head, ...rest] = ref.split(".");
  let cur = prior?.[head];
  if (cur === undefined) return { ok: false };
  for (const step of rest) {
    if (cur === null || typeof cur !== "object" || !(step in cur)) return { ok: false };
    cur = cur[step];
  }
  return { ok: true, value: cur };
}

export function resolveInputs(template = {}, parentInput = {}, prior = {}) {
  const out = {};
  const missing = [];

  for (const [key, spec] of Object.entries(template ?? {})) {
    if (typeof spec !== "string") { out[key] = spec; continue; }

    // A whole-value placeholder passes the value THROUGH with its type: a
    // latitude stays a number rather than becoming the string "51.5". Types
    // matter because the callee's schema is enforced, and a number arriving as
    // a string fails validation somewhere far from the cause.
    const whole = spec.match(WHOLE);
    if (whole) {
      const hit = lookup(whole[1], parentInput, prior);
      if (!hit.ok) { missing.push(`${key} needs {${whole[1]}}`); continue; }
      out[key] = hit.value;
      continue;
    }

    let failed = false;
    out[key] = spec.replace(ANY, (_, ref) => {
      const hit = lookup(ref, parentInput, prior);
      if (!hit.ok) { missing.push(`${key} needs {${ref}}`); failed = true; return ""; }
      return String(hit.value);
    });
    // Dropped rather than half-filled: "Lisbon, undefined" would reach the
    // dependency as a plausible string and fail far from what caused it.
    if (failed) delete out[key];
  }

  return { input: out, missing };
}

// Cycle detection.
//
// The chain is every tool already executing above this one in the current call.
// A tool appearing twice in its own chain would recurse until something else
// stopped it — a timeout, or the account's concurrency, or the bill.
//
// Checked on the CHAIN rather than on a global graph, deliberately. Two tools
// may legitimately both depend on a third; that is a diamond, not a cycle, and
// a graph-wide check would have to tell them apart. A chain cannot.
export function checkChain(chain, toolId) {
  if (chain.includes(toolId)) {
    return { ok: false, reason: `dependency cycle: ${[...chain, toolId].join(" -> ")}` };
  }
  if (chain.length >= MAX_DEPTH) {
    return { ok: false, reason: `dependency chain deeper than ${MAX_DEPTH}: ${[...chain, toolId].join(" -> ")}` };
  }
  return { ok: true };
}
