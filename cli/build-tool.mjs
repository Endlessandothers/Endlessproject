#!/usr/bin/env node
// build-tool — write a tool for a need nobody met. Phase 3.
//
//   node cli/build-tool.mjs                    which needs are open
//   node cli/build-tool.mjs <cluster_id>       check, generate, save for review
//   node cli/build-tool.mjs <cluster_id> --publish
//   node cli/build-tool.mjs --simulated        build against sim/ instead
//
// THE SEQUENCE IS THE POINT, and it is PROJECT.md's, not mine:
//
//   1. search the registry first — generating a near-duplicate is the most
//      likely failure, and it inflates the world without adding to it
//   2. build against the CLUSTER, never a single query
//   3. publish as provisional, visibly auto-generated
//   4. run a closure test, because a gap does not close by something being
//      published — it closes because the need is met
//   5. decay applies in full, so a rushed fix fades
//
// WHAT THIS DOES NOT DO: approve anything. A generated tool cannot execute
// until a person reads it and approves it, exactly like anyone else's. The
// builder is the platform, and a platform that approves its own output has a
// review gate protecting against everybody except itself. See
// infra/lambda/registry/builder.mjs for the full argument.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { duplicateCheck, brief, validateGenerated, novelHosts } from "../infra/lambda/registry/builder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";
const MODEL = process.env.ENDLESS_BUILDER_MODEL || "amazon.nova-pro-v1:0";
const OUT_DIR = join(HERE, "../tools/generated");

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const KEY = process.env.ENDLESS_BUILDER_KEY || process.env.ENDLESS_API_KEY;

function aws(args, { json = true } = {}) {
  const out = execFileSync("aws", [...args, "--region", REGION],
    { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString();
  return json ? JSON.parse(out || "{}") : out;
}

// fetcher and runtime are invoked directly and return their result, not an HTTP
// envelope. Using the envelope reader on them yielded a useless "{}" as the
// reason a tool was discarded.
function invokeRaw(fn, event) {
  const p = join(tmpdir(), `br-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(event));
  execFileSync("aws", ["lambda", "invoke", "--region", REGION, "--function-name", `${PREFIX}-${fn}`,
    "--cli-binary-format", "raw-in-base64-out", "--payload", `file://${p}`, `${p}.out`], { stdio: "pipe" });
  return JSON.parse(readFileSync(`${p}.out`, "utf8"));
}

function invokeLambda(fn, event) {
  const p = join(tmpdir(), `bt-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(event));
  execFileSync("aws", ["lambda", "invoke", "--region", REGION, "--function-name", `${PREFIX}-${fn}`,
    "--cli-binary-format", "raw-in-base64-out", "--payload", `file://${p}`, `${p}.out`], { stdio: "pipe" });
  const r = JSON.parse(readFileSync(`${p}.out`, "utf8"));
  return { status: r.statusCode, body: JSON.parse(r.body || "{}") };
}

// Step 1. Ask the same adjudicator that decided the gap whether anything now
// fits. It is the only honest duplicate check: a similarity score would be a
// second opinion from the same embedding that produced the gap.
function askRegistry(query) {
  const { body } = invokeLambda("search", {
    version: "2.0", rawPath: "/search", isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
    headers: { authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query, k: 5, actor: { agent_id: "builder", session_id: "duplicate-check" } }),
  });
  // The adjudicator's verdict, read directly. It used to be inferred from
  // whether a gap got logged, which stopped being true the moment a builder's
  // searches stopped logging gaps — and the check then reported that
  // recent-earthquakes answers "what type is pikachu".
  return { query, tool_id: body.fits ?? null };
}

function bedrock(prompt) {
  const p = join(tmpdir(), `br-${Date.now()}.json`);
  writeFileSync(p, JSON.stringify({
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { temperature: 0.2, maxTokens: 3000 },
  }));
  const out = join(tmpdir(), `br-${Date.now()}.out`);
  execFileSync("aws", ["bedrock-runtime", "invoke-model", "--region", REGION,
    "--model-id", MODEL, "--content-type", "application/json",
    "--cli-binary-format", "raw-in-base64-out", "--body", `file://${p}`, out], { stdio: "pipe" });
  const res = JSON.parse(readFileSync(out, "utf8"));
  return res.output?.message?.content?.[0]?.text ?? "";
}

const PROMPT = (b) => `You are writing a small tool for a registry of tools that AI agents search.

People asked for this and nothing in the registry could do it:

${b.queries.map((q) => `  - ${q}`).join("\n")}

${b.distinct_callers} separate callers asked, over ${b.spread_days} days.

Write ONE tool that answers all of those requests.

HARD CONSTRAINTS. A tool that breaks any of these is discarded unread:

- The handler is a PURE TRANSFORM. It has no network access, no filesystem, no
  credentials, and no imports of any kind. Any use of import, require, fetch,
  process, globalThis, eval or the Function constructor is rejected by the
  runtime before it runs.
- The platform fetches for you. Declare the HTTPS endpoints you need in
  "requests"; the parsed response bodies arrive as responses.<id>.body.
- Use a real, free, public API that needs no API key. If you cannot name one you
  are certain exists, return {"refuse": "why"} instead of inventing an endpoint.
- At most 2 requests. Runtime is always "lambda-vpc".
- The handler exports exactly: export function transform({ input, responses })

Reply with ONLY a JSON object, no prose and no code fences:

{
  "tool_id": "kebab-case-id",
  "name": "Short Human Name",
  "description": "What it does and what it returns, in plain language. Describe what it DOES, never what it does not do.",
  "category": "one word",
  "input": { "field": { "type": "string|number", "required": true, "description": "..." } },
  "allowlist": ["api.example.com"],
  "requests": [{ "id": "a", "method": "GET", "url": "https://api.example.com/x?q={field}" }],
  "handler_source": "export function transform({ input, responses }) { ... }",
  "sample": { "field": "value" }
}`;

// ---------------------------------------------------------------- open needs
// --simulated reads the simulation's own snapshot instead of the public board.
//
// The builder is the hardest thing in this project to test, because it needs a
// confirmed need and confirmed needs are rare by design. sim/ exists to produce
// them. The two snapshots are separate files for exactly this reason: invented
// demand can drive a test end to end without ever having been on the board.
function openClusters() {
  const bucket = `${PREFIX}-board-${aws(["sts", "get-caller-identity"]).Account}`;
  const key = process.argv.includes("--simulated") ? "sim-gaps.json" : "gaps.json";
  const out = join(tmpdir(), `gaps-${Date.now()}.json`);
  try {
    execFileSync("aws", ["s3", "cp", `s3://${bucket}/${key}`, out, "--region", REGION], { stdio: "pipe" });
  } catch {
    console.error(C.red(`  no ${key} yet`));
    process.exit(1);
  }
  return JSON.parse(readFileSync(out, "utf8")).clusters ?? [];
}

const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const clusterId = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

if (!clusterId && !args.includes("--need")) {
  const clusters = openClusters();
  const confirmed = clusters.filter((c) => c.confirmed);
  console.log(`\n  ${C.bold(`${confirmed.length} confirmed`)} of ${clusters.length} needs on the board\n`);
  for (const c of clusters) {
    const mark = c.confirmed ? C.green("open  ") : C.dim("withheld");
    console.log(`  ${mark} ${c.id}  ${C.bold(c.label.slice(0, 54))}`);
    console.log(`         ${C.dim(`${c.distinct_callers} callers · ${c.distinct_owners} owners · ${c.occurrences} requests · ${c.spread_days}d`)}`);
  }
  console.log(`\n  ${C.dim("node cli/build-tool.mjs <cluster_id>")}\n`);
  process.exit(0);
}

if (!KEY) {
  console.error(C.red("  set ENDLESS_BUILDER_KEY — the builder needs its own caller, with role=builder"));
  process.exit(1);
}

// --need / --queries builds against a brief given on the command line instead
// of a cluster from the board.
//
// A TEST PATH, and marked as one. It exists because the builder is the hardest
// thing here to exercise: it needs a confirmed need, confirmed needs are rare
// by design, and every one currently on the simulated board happens to require
// an API that does not exist for free. Without this there is no way to see the
// path where generation succeeds.
//
// It cannot publish. A brief typed by a person is not evidence of demand, and
// the whole argument for building a tool is that the demand was recorded.
const needFlag = value("need");
const cluster = needFlag
  ? {
      id: "adhoc", label: needFlag, confirmed: true,
      queries: (value("queries") ?? needFlag).split("|").map((q) => q.trim()),
      distinct_callers: 0, spread_days: 0, adhoc: true,
    }
  : openClusters().find((c) => c.id === clusterId);
if (!cluster) { console.error(C.red(`  no cluster ${clusterId} on the board`)); process.exit(1); }

const b = brief(cluster);
// An ad-hoc brief has no recorded demand behind it, so it is sufficient to
// generate against and never sufficient to publish.
if (cluster.adhoc) b.sufficient = b.queries.length > 0;
console.log(`\n  ${C.bold(b.need)}`);
console.log(`  ${C.dim(`${b.queries.length} phrasings · ${b.distinct_callers} callers · ${b.spread_days} days`)}\n`);

if (!b.sufficient) {
  console.error(C.red("  this cluster has no evidence behind it"));
  process.exit(1);
}
if (!cluster.confirmed) {
  // Building against an unconfirmed need is building against one person's
  // opinion. The board already says why it was withheld.
  console.error(C.red("  this need is not confirmed:"));
  for (const r of cluster.withheld_because ?? []) console.error(C.red(`    ${r}`));
  process.exit(1);
}

// ---------------------------------------------------------------- step 1
console.log(C.bold("  1. searching the registry first\n"));
const verdicts = b.queries.map((q) => {
  const v = askRegistry(q);
  console.log(`     ${v.tool_id ? C.yellow(v.tool_id.padEnd(22)) : C.dim("nothing fits".padEnd(22))} ${C.dim(q.slice(0, 48))}`);
  return v;
});

const dup = duplicateCheck(verdicts);
if (!dup.generate) {
  console.log(`\n  ${C.red("refusing to generate")}`);
  console.log(`  ${dup.reason}\n`);
  process.exit(2);
}
console.log(`\n     ${C.green("no existing tool covers this")} ${C.dim(`(${dup.partial_matches ?? 0} partial matches)`)}\n`);

// ---------------------------------------------------------------- step 2
console.log(C.bold(`  2. generating against the cluster  ${C.dim(MODEL)}\n`));
let pkg;
try {
  const raw = bedrock(PROMPT(b)).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  pkg = JSON.parse(raw);
} catch (err) {
  console.error(C.red(`  the model did not return usable JSON: ${err.message}`));
  process.exit(1);
}

if (pkg.refuse) {
  // A builder that declines because it cannot name a real endpoint is behaving
  // correctly. Inventing one would produce a tool that fails on first call.
  console.log(`  ${C.yellow("the builder declined:")} ${pkg.refuse}\n`);
  process.exit(3);
}

pkg.runtime = "lambda-vpc";
const errors = validateGenerated({ ...pkg, handler_source: pkg.handler_source });
if (errors.length) {
  console.error(C.red("  generated package fails the envelope:"));
  for (const e of errors) console.error(C.red(`    ${e}`));
  process.exit(1);
}

// ---------------------------------------------------------------- step 3
//
// RUN IT ONCE BEFORE ANYONE READS IT.
//
// Added after the first real generation. The builder produced
// website-status-checker, which passed the duplicate check, passed the whole
// safety envelope, and did not work: it declared https://httpstatus.io/?url=...
// — the HTML homepage of a web app, not an API, whose actual path 404s — and
// its handler string-matched for "Response Time" in scraped markup.
//
// Nothing automated caught it. The novel-host flag fired, which is why a person
// looked, and a person checking the endpoint is what found it.
//
// So the generated package is now executed once, against its own sample input,
// through the real fetcher and the real sandbox, before it is offered to anyone.
// A tool whose upstream 404s fails here in seconds instead of consuming a
// review and then failing on its first real call.
console.log(C.bold("  3. running it once, against its own sample\n"));
const smoke = (() => {
  const requests = pkg.requests ?? [];
  let responses = {};
  if (requests.length) {
    const fetched = invokeRaw("fetcher", {
      tool_id: pkg.tool_id, requests, input: pkg.sample ?? {},
      allowlist: pkg.allowlist ?? [],
    });
    if (!fetched.ok) return { ok: false, stage: "fetch", error: fetched.error ?? JSON.stringify(fetched).slice(0, 160) };
    responses = fetched.responses;
    for (const [id, r] of Object.entries(responses)) {
      if (r.ok === false) return { ok: false, stage: "fetch", error: `${id}: ${r.error ?? `HTTP ${r.status}`}` };
    }
  }
  const ran = invokeRaw("runtime", {
    tool_id: pkg.tool_id, version: "draft", source: pkg.handler_source,
    input: pkg.sample ?? {}, responses, tools: {},
  });
  if (!ran.ok) return { ok: false, stage: "transform", error: ran.error };

  // RUNNING IS NOT WORKING. Second iteration of the same finding: the first
  // smoke test passed a tool that returned {} — it declared httpstatus.xyz/json,
  // which answered, and transformed the answer into nothing at all.
  //
  // A tool that produces an empty result has produced nothing, and a reviewer
  // reading its source would have to run it to discover that. An empty sample
  // result is occasionally legitimate; it is never worth a reviewer's time
  // before the generator has been asked to try again.
  const r = ran.result;
  const empty = r === null || r === undefined
    || (typeof r === "object" && Object.keys(r).length === 0)
    || (Array.isArray(r) && r.length === 0);
  if (empty) {
    return { ok: false, stage: "transform", error: "produced an empty result from its own sample input" };
  }
  return { ok: true, result: r };
})();

if (!smoke.ok) {
  console.log(`  ${C.red(`it does not work: ${smoke.stage} — ${smoke.error}`)}`);
  console.log(`  ${C.dim("discarded. Nothing was written and no reviewer was asked to read it.")}
`);
  process.exit(4);
}
console.log(`  ${C.green("it runs")} ${C.dim(JSON.stringify(smoke.result).slice(0, 96))}
`);

// ---------------------------------------------------------------- step 4
const approved = aws(["dynamodb", "scan", "--table-name", `${PREFIX}-tools`,
  "--projection-expression", "allowlist"]).Items ?? [];
const known = new Set(approved.flatMap((i) => (i.allowlist?.L ?? []).map((x) => x.S)));
const novel = novelHosts(pkg, known);

mkdirSync(OUT_DIR, { recursive: true });
const dir = join(OUT_DIR, pkg.tool_id);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "manifest.json"), JSON.stringify({
  ...pkg, handler_source: undefined,
  generated: { model: MODEL, cluster_id: clusterId, need: b.need, at: new Date().toISOString() },
}, null, 2));
writeFileSync(join(dir, "handler.mjs"), pkg.handler_source);

console.log(`  ${C.green("generated")} ${C.bold(pkg.tool_id)}  ${C.dim(`${pkg.handler_source.length} bytes`)}`);
console.log(`  ${C.dim(pkg.description.slice(0, 96))}`);
console.log(`  ${C.dim(`hosts: ${(pkg.allowlist ?? []).join(", ") || "none"}`)}`);
if (novel.length) {
  console.log(`  ${C.yellow(`NEW UPSTREAM, never approved before: ${novel.join(", ")}`)}`);
  console.log(`  ${C.dim("this is the one claim in the package nothing else can check")}`);
}
console.log(`  ${C.dim(`written to tools/generated/${pkg.tool_id}/`)}\n`);

if (!args.includes("--publish")) {
  console.log(`  ${C.bold("nothing has been published and nothing can run.")}`);
  console.log(`  ${C.dim("--publish registers it as provisional; it still needs review before it executes.")}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- step 5
//
// An ad-hoc brief is sufficient to GENERATE against and never sufficient to
// publish. A need typed on a command line is not recorded demand, and the whole
// argument for a tool existing is that the demand was recorded.
if (cluster.adhoc) {
  console.error(C.red("  --publish needs a cluster from the board, not a brief typed on the command line"));
  process.exit(1);
}

const pub = invokeLambda("registry", {
  version: "2.0", rawPath: "/tools", isBase64Encoded: false,
  requestContext: { http: { method: "POST" } },
  headers: { authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    tool_id: pkg.tool_id, name: pkg.name, description: pkg.description,
    category: pkg.category ?? "generated",
    package: {
      handler_source: pkg.handler_source, requests: pkg.requests ?? [],
      allowlist: pkg.allowlist ?? [], input: pkg.input ?? {}, runtime: "lambda-vpc",
      uses: [],
    },
  }),
});

if (pub.status !== 201) {
  console.error(C.red(`  publish failed (${pub.status}): ${pub.body.error}`));
  process.exit(1);
}

console.log(`  ${C.green("published")} ${C.bold(pub.body.ref)} ${C.yellow("provisional")}`);
console.log(`  ${C.dim(`owner ${pub.body.owner} · charged ${pub.body.charged} · ${pub.body.credits_remaining} credits left`)}`);
console.log(`\n  ${C.bold("it still cannot run.")} ${C.dim(`node cli/review.mjs ${pkg.tool_id} ${pub.body.version}`)}`);
console.log(`  ${C.dim(`then: node cli/closure.mjs ${clusterId} ${pkg.tool_id} --simulated`)}\n`);
