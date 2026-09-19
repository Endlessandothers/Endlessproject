#!/usr/bin/env node
// Live sandbox escape tests — Phase 1, issue #5. THE GATE.
//
//   node infra/tests/escape.live.mjs
//
// The other half of #5. allowlist.test.mjs proves the fetcher's URL rules with
// no AWS; this file attacks the DEPLOYED runtime and fetcher, because the thing
// being tested is not a function's logic — it is whether a VPC with no route and
// a role with no grants actually stop hostile code. That cannot be asserted from
// a unit test, and asserting it by hand once is not a test at all.
//
// Separate from `node --test` on purpose: it needs credentials and invokes real
// functions, so it must never be something CI runs by accident against whatever
// account it happens to hold.
//
// HOW TO READ A FAILURE. Every case below is an attack. A failure here is not a
// broken test, it is a hole in the boundary that runs strangers' code.
//
// What this proves, precisely: that these attacks fail. Not that no attack
// succeeds. The screen in runtime/index.mjs is explicitly assumed defeatable —
// section B defeats it on purpose — and the claim that matters is the narrower,
// stronger one: after a complete escape, there is nowhere to go.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function invoke(fn, payload) {
  const pj = join(tmpdir(), `esc-${Math.random().toString(36).slice(2)}.json`);
  const oj = `${pj}.out`;
  writeFileSync(pj, JSON.stringify(payload));
  execFileSync("aws", [
    "lambda", "invoke", "--region", REGION, "--function-name", `${PREFIX}-${fn}`,
    "--cli-binary-format", "raw-in-base64-out", "--payload", `file://${pj}`, oj,
  ], { stdio: "pipe", maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(readFileSync(oj, "utf8") || "{}");
}

const run = (source, extra = {}) => invoke("runtime", {
  tool_id: "escape-test", version: "0000", source, input: {}, responses: {}, ...extra,
});

// A host that certainly answers, so "nothing came back" can only mean no route.
const REACHABLE = "https://checkip.amazonaws.com/";

// A real upstream that returns real JSON, for the fetcher cases. checkip is not
// usable there: it answers in plain text and the fetcher's first run against it
// reported "upstream sent malformed json", which is the test being wrong rather
// than the allowlist.
const JSON_HOST = "api.open-meteo.com";
const JSON_URL = `https://${JSON_HOST}/v1/forecast?latitude=51.5&longitude=-0.12&current=temperature_2m`;

const results = [];
function check(group, name, fn) {
  let verdict;
  try {
    verdict = fn();
  } catch (err) {
    verdict = { pass: false, detail: `test threw: ${String(err.message).slice(0, 140)}` };
  }
  results.push({ group, name, ...verdict });
  const mark = verdict.pass === null ? C.yellow("? ") : verdict.pass ? C.green("ok") : C.red("FAIL");
  console.log(`  ${mark}  ${name}${verdict.detail ? C.dim(`  — ${verdict.detail}`) : ""}`);
}

// ---------------------------------------------------------------- A. the screen
//
// Cheap, loud refusals. None of these would reach anything even if allowed. The
// point of refusing them is that a tool written this way is a tool worth looking
// at, and a refusal is attributable where a silent hang is not.
console.log(C.bold("\nA. the source screen refuses the obvious routes outward\n"));

const SCREENED = [
  ["import statement", 'import fs from "node:fs";\nexport const transform = () => 1;'],
  ["dynamic import", 'export const transform = async () => (await import("node:fs")).default;'],
  ["require", 'export const transform = () => require("node:fs");'],
  ["direct fetch", `export const transform = async () => (await fetch("${REACHABLE}")).text();`],
  ["process", "export const transform = () => process.env;"],
  ["globalThis", "export const transform = () => globalThis;"],
  ["eval", 'export const transform = () => eval("1+1");'],
  ["Function constructor", 'export const transform = () => new Function("return this")();'],
  ["XMLHttpRequest", "export const transform = () => new XMLHttpRequest();"],
];

for (const [name, source] of SCREENED) {
  check("screen", name, () => {
    const r = run(source);
    return {
      pass: r.ok === false && /not permitted/.test(r.error ?? ""),
      detail: r.ok === false ? r.error : `NOT REFUSED: ${JSON.stringify(r).slice(0, 120)}`,
    };
  });
}

// ---------------------------------------------------------------- B. the boundary
console.log(C.bold("\nB. the network boundary, which is the control that actually matters\n"));

// The screen is defeated here, deliberately.
//
// [].constructor is Array, and Array.constructor is Function. This reaches the
// Function constructor and through it the global object without ever writing the
// tokens "Function", "eval", "globalThis" or "process". The regex does not match
// it, and will not be extended to: chasing each new spelling is a game the screen
// loses, which is precisely why it was never the boundary.
//
// What has to hold is the case after it.
const ESCAPE = '[].constructor.constructor("return this")()';

// Reaching fetch and process by computed property, because writing them plainly
// is caught by the screen — and a test whose attack never got past the screen
// proves the screen, not the boundary. The first run of this file passed three
// cases for exactly that wrong reason.
const GFETCH = 'g["fet" + "ch"]';
const GPROC = 'g["pro" + "cess"]';

check("boundary", "the screen is evadable, and this is the proof", () => {
  const r = run(`export const transform = () => typeof (${ESCAPE}).fetch;`);
  return {
    pass: r.ok === true && r.result === "function",
    detail: r.ok ? `escaped to the global object; fetch is a ${r.result}` : `blocked early: ${r.error}`,
  };
});

check("boundary", "an escaped handler still cannot reach the internet", () => {
  const r = run(`
    export const transform = async () => {
      const g = ${ESCAPE};
      const res = await ${GFETCH}(${JSON.stringify(REACHABLE)});
      return { body: (await res.text()).slice(0, 40) };
    };
  `);
  // Success here means data came back from the internet. Total failure.
  return {
    pass: r.ok === false,
    detail: r.ok === false
      ? `no route: ${String(r.error).slice(0, 80)}`
      : C.red(`DATA CAME BACK: ${JSON.stringify(r.result)}`),
  };
});

check("boundary", "credentials are readable after an escape, and buy nothing", () => {
  // Honest about what an escape yields. Lambda puts real credentials for the
  // execution role into the environment, and an escaped handler reads them. They
  // are worthless twice over: the role grants nothing, and there is no route to
  // an AWS endpoint to present them to. Both halves are asserted rather than
  // assumed, because "no credentials in the sandbox" would be a false claim.
  // The STS call is raced against a timer INSIDE the handler, so the handler
  // returns its findings instead of being killed by the transform timeout with
  // nothing to say. The first version of this case timed out and reported a
  // pass without ever establishing whether credentials were there.
  const r = run(`
    export const transform = async () => {
      const g = ${ESCAPE};
      const env = ${GPROC}.env;
      const hasKey = typeof env.AWS_ACCESS_KEY_ID === "string" && env.AWS_ACCESS_KEY_ID.length > 0;
      const role = env.AWS_LAMBDA_FUNCTION_NAME || null;
      const reached = await Promise.race([
        ${GFETCH}("https://sts." + env.AWS_REGION + ".amazonaws.com/").then(() => true).catch(() => false),
        new Promise((res) => setTimeout(() => res("no-route"), 2500)),
      ]);
      return { hasKey, role, reached };
    };
  `);
  if (r.ok !== true) {
    return { pass: false, detail: `expected findings, got: ${String(r.error).slice(0, 80)}` };
  }
  return {
    // Credentials being present is EXPECTED and fine. Reaching STS would not be.
    pass: r.result.reached !== true,
    detail: `credentials readable: ${r.result.hasKey}; STS: ${r.result.reached}`,
  };
});

// ---------------------------------------------------------------- C. limits
console.log(C.bold("\nC. resource limits hold\n"));

check("limits", "an async hang is cut off at the transform timeout", () => {
  const r = run("export const transform = () => new Promise(() => {});");
  return {
    pass: r.ok === false && /exceeded/.test(r.error ?? ""),
    detail: r.ok === false ? r.error : "a hang returned successfully",
  };
});

// A synchronous loop blocks the event loop, so the Promise.race timeout cannot
// fire. Lambda's own 30s timeout is what stops it. Recorded here because the
// difference between the two is a real operational fact: one costs 5 seconds,
// the other costs 30 and returns no structured error at all.
check("limits", "a synchronous infinite loop is stopped by something", () => {
  let r;
  try {
    r = run("export const transform = () => { while (true) {} };");
  } catch (err) {
    return { pass: true, detail: "killed by the Lambda timeout, not the transform timeout" };
  }
  const stopped = r.ok === false || r.errorType || r.errorMessage;
  return {
    pass: Boolean(stopped),
    detail: stopped
      ? `stopped: ${String(r.error ?? r.errorMessage).slice(0, 70)}`
      : "ran to completion, which should be impossible",
  };
});

check("limits", "an oversized result is refused, not stored", () => {
  const r = run('export const transform = () => "x".repeat(300 * 1024);');
  return {
    pass: r.ok === false && /exceeds/.test(r.error ?? ""),
    detail: r.ok === false ? r.error : "a 300 KB result was accepted",
  };
});

check("limits", "oversized source is refused before it is ever loaded", () => {
  const r = run(`export const transform = () => 1; // ${"p".repeat(260 * 1024)}`);
  return {
    pass: r.ok === false && /exceeds/.test(r.error ?? ""),
    detail: r.ok === false ? r.error : "a 260 KB handler was loaded",
  };
});

check("limits", "a handler cannot corrupt the inputs it was given", () => {
  const r = run(`
    export const transform = ({ input }) => {
      try { input.injected = "yes"; } catch (e) { /* frozen: throws in module strict mode */ }
      return { injected: input.injected ?? null };
    };
  `, { input: { real: 1 } });
  return {
    pass: r.ok === true && r.result.injected === null,
    detail: r.ok ? `injected = ${JSON.stringify(r.result.injected)}` : r.error,
  };
});

// ---------------------------------------------------------------- D. tool isolation
console.log(C.bold("\nD. one tool cannot leave anything behind for the next\n"));

check("isolation", "/tmp does not carry data from one tool to another", () => {
  // Lambda gives every execution environment a writable /tmp, and it SURVIVES
  // between invocations on a warm container. Two different tools landing on the
  // same container is ordinary rather than exotic. If a file written by one is
  // readable by the other, tools are not isolated from each other whatever the
  // network does — and the runtime policy's "no writable disk" is wrong.
  const MARK = `leak-${Date.now()}`;
  const writer = `
    export const transform = () => {
      const g = ${ESCAPE};
      try {
        const mm = ${GPROC}.mainModule;
        const req = mm && mm["requi" + "re"];
        if (!req) return { wrote: false, why: "no module loader reachable from the global" };
        req("node:fs").writeFileSync("/tmp/${MARK}", "${MARK}");
        return { wrote: true };
      } catch (e) { return { wrote: false, why: String(e.message).slice(0, 90) }; }
    };
  `;
  const write = run(writer, { tool_id: "attacker-tool" });

  if (write.ok !== true || write.result?.wrote !== true) {
    return {
      pass: true,
      detail: `could not write to /tmp: ${write.result?.why ?? String(write.error).slice(0, 70)}`,
    };
  }

  const read = run(`
    export const transform = () => {
      const g = ${ESCAPE};
      try {
        const req = ${GPROC}.mainModule["requi" + "re"];
        return { read: req("node:fs").readFileSync("/tmp/${MARK}", "utf8") };
      } catch (e) { return { read: null }; }
    };
  `, { tool_id: "victim-tool" });

  if (read.ok === true && read.result?.read === MARK) {
    return {
      pass: false,
      detail: "a file written by one tool was read back by another on the same container",
    };
  }
  return { pass: true, detail: "wrote to /tmp, but nothing carried over" };
});

// ---------------------------------------------------------------- E. the fetcher
console.log(C.bold("\nE. the fetcher honours the allowlist against the live internet\n"));

// The positive case, so the negatives below mean something. An allowlist that
// refuses everything would pass every refusal test ever written.
check("fetcher", "a declared, allowlisted host is fetched", () => {
  const r = invoke("fetcher", {
    tool_id: "escape-test",
    allowlist: [JSON_HOST],
    requests: [{ id: "w", url: JSON_URL }],
    input: {},
  });
  const got = r.responses?.w?.body?.current;
  return {
    pass: r.ok === true && Boolean(got),
    detail: r.ok === true ? `fetched live json` : String(r.error ?? r.responses?.w?.error).slice(0, 90),
  };
});

check("fetcher", "a host outside the allowlist is refused", () => {
  const r = invoke("fetcher", {
    tool_id: "escape-test",
    allowlist: [JSON_HOST],
    requests: [{ id: "bad", url: "https://example.com/" }],
    input: {},
  });
  return { pass: r.ok === false, detail: r.ok ? C.red("FETCHED AN UNLISTED HOST") : String(r.error).slice(0, 80) };
});

check("fetcher", "an input cannot smuggle a different host into a declared url", () => {
  // The template is rendered with every input encoded and only then checked, so
  // an input carrying "@example.com" must not move the host. Asserted on the
  // BODY rather than on the url, because the fetcher does not return the url it
  // built — if the host had moved, example.com's page would come back, and the
  // only way to know is to look for it.
  const r = invoke("fetcher", {
    tool_id: "escape-test",
    allowlist: [JSON_HOST],
    requests: [{ id: "x", url: `https://${JSON_HOST}/{path}` }],
    input: { path: "../../@example.com/" },
  });
  const text = JSON.stringify(r.responses?.x?.body ?? "");
  const leaked = /Example Domain/i.test(text);
  return {
    pass: !leaked,
    detail: leaked
      ? C.red("the request landed on example.com")
      : (r.ok === false ? `refused: ${String(r.error ?? r.responses?.x?.error).slice(0, 60)}` : "stayed on the declared host"),
  };
});

// A redirect is how an allowlisted host hands the connection to one that is not,
// which would make the whole allowlist decorative. httpbingo answers with a real
// 302 to wherever it is told.
check("fetcher", "a redirect off an allowlisted host is not followed", () => {
  const r = invoke("fetcher", {
    tool_id: "escape-test",
    allowlist: ["httpbingo.org"],
    requests: [{ id: "r", url: "https://httpbingo.org/redirect-to?url=https%3A%2F%2Fexample.com%2F" }],
    input: {},
  });
  const text = JSON.stringify(r.responses?.r?.body ?? "");
  const followed = /Example Domain/i.test(text);
  return {
    pass: !followed,
    detail: followed ? C.red("the redirect was followed off the allowlist")
                     : `not followed: ${String(r.responses?.r?.error ?? r.error).slice(0, 60)}`,
  };
});

// ---------------------------------------------------------------- verdict
const failed = results.filter((r) => r.pass === false);
const unknown = results.filter((r) => r.pass === null);
const passed = results.length - failed.length - unknown.length;

console.log(`\n${C.bold("verdict")}  ${passed} passed, ${failed.length} failed` +
            `${unknown.length ? `, ${unknown.length} inconclusive` : ""}\n`);

if (failed.length) {
  console.log(C.red("  The sandbox has a hole. Nothing third-party runs until this is zero.\n"));
  for (const f of failed) console.log(`    ${C.red("×")} ${f.group}: ${f.name} — ${f.detail}`);
  console.log();
  process.exit(1);
}
console.log(C.green("  Gate clear.\n"));
