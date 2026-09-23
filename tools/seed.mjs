#!/usr/bin/env node
// seed — put the catalog back into a freshly built registry.
//
//   ENDLESS_API_KEY=elk_... node tools/seed.mjs            the 19 catalog rows
//   ENDLESS_API_KEY=elk_... node tools/seed.mjs --packages  and the executable ones
//
// WHY THIS EXISTS AS A FILE.
//
// The registry has been rebuilt from empty twice, and both times the re-seed was
// done by hand from the shell. The second time the executable packages were
// forgotten entirely, so search returned tools that could not run, and one of
// them was published under the wrong caller — which silently stripped the
// "auto-written" flag, because provisional is derived from the publishing key's
// role rather than from anything in the request.
//
// A rebuild is not an exceptional event here. It deserves a script.
//
// WHAT IT DOES NOT RESTORE. Events and gaps. Those are the record of what
// callers actually did, they are not derivable from any file in this repo, and
// nothing here can bring them back. The catalog is code; the log was history.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";
const KEY = process.env.ENDLESS_API_KEY;
const BUILDER_KEY = process.env.ENDLESS_BUILDER_KEY;

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

if (!KEY) {
  console.error(C.red("  ENDLESS_API_KEY is required — registration debits a credit and records an owner"));
  process.exit(1);
}

function post(body, key) {
  const p = join(tmpdir(), `seed-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({
    version: "2.0", rawPath: "/tools", isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
    headers: { authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }));
  execFileSync("aws", ["lambda", "invoke", "--region", REGION,
    "--function-name", `${PREFIX}-registry`, "--cli-binary-format", "raw-in-base64-out",
    "--payload", `file://${p}`, `${p}.out`], { stdio: "pipe" });
  const r = JSON.parse(readFileSync(`${p}.out`, "utf8"));
  return { status: r.statusCode, body: JSON.parse(r.body || "{}") };
}

// ---------------------------------------------------------------- catalog
//
// Description-only rows. They carry no handler and are deliberately not
// executable: Phase 0 never ran a registered tool, and these exist so search
// has something real to rank. `url` and `input` stay in catalog.json as the
// record of what was verified live — the registry stores neither, because
// storing a URL it will never call would imply it might.
const catalog = JSON.parse(readFileSync(join(HERE, "catalog.json"), "utf8"));
const rows = Array.isArray(catalog) ? catalog : catalog.tools ?? [];

let ok = 0, failed = 0;
console.log(`\n  ${C.bold("catalog")} ${C.dim(`${rows.length} tools`)}\n`);

for (const t of rows) {
  const res = post({
    tool_id: t.tool_id, name: t.name, description: t.description,
    category: t.category ?? "general",
  }, KEY);
  if (res.status === 201) {
    ok++;
    console.log(`  ${C.green("ok")}   ${t.tool_id.padEnd(26)} ${C.dim(res.body.ref)}`);
  } else {
    failed++;
    console.log(`  ${C.red("fail")} ${t.tool_id.padEnd(26)} ${C.dim(`${res.status} ${res.body.error ?? ""}`)}`);
  }
}

// ---------------------------------------------------------------- packages
//
// The ones with code. Order matters: air-by-place composes the other two and
// cannot be published before the tools it is built on exist.
//
// The generated one goes up under the BUILDER key, not the operator's. That is
// not a detail — `provisional` comes from the publishing caller's role, so
// publishing it as a person is what quietly removes the label that marks a tool
// as machine-written. It happened once already.
const PACKAGES = [
  { dir: "packages/geocode-place", key: "operator" },
  { dir: "packages/air-quality", key: "operator" },
  { dir: "packages/air-by-place", key: "operator" },
  { dir: "generated/pokemon-info-lookup", key: "builder" },
];

if (process.argv.includes("--packages")) {
  console.log(`\n  ${C.bold("executable packages")}\n`);
  for (const { dir, key } of PACKAGES) {
    const base = join(HERE, dir);
    if (!existsSync(join(base, "manifest.json"))) {
      console.log(`  ${C.yellow("skip")} ${dir} ${C.dim("(no manifest)")}`);
      continue;
    }
    const m = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
    const useKey = key === "builder" ? BUILDER_KEY : KEY;
    if (!useKey) {
      console.log(`  ${C.yellow("skip")} ${m.tool_id.padEnd(26)} ${C.dim("ENDLESS_BUILDER_KEY not set")}`);
      console.log(`       ${C.dim("publishing it with the operator key would drop the auto-written flag")}`);
      continue;
    }
    const res = post({
      tool_id: m.tool_id, name: m.name, description: m.description,
      category: m.category ?? "generated",
      package: {
        handler_source: readFileSync(join(base, "handler.mjs"), "utf8"),
        requests: m.requests ?? [], allowlist: m.allowlist ?? [],
        input: m.input ?? {}, runtime: m.runtime ?? "lambda-vpc", uses: m.uses ?? [],
      },
    }, useKey);
    if (res.status === 201) {
      ok++;
      console.log(`  ${C.green("ok")}   ${m.tool_id.padEnd(26)} ${C.dim(res.body.ref)}` +
        (key === "builder" ? ` ${C.yellow("provisional")}` : ""));
    } else {
      failed++;
      console.log(`  ${C.red("fail")} ${m.tool_id.padEnd(26)} ${C.dim(`${res.status} ${res.body.error ?? ""}`)}`);
    }
  }

  // PUBLISHED IS NOT RUNNABLE. exec-fn treats a missing approval as a refusal,
  // so every package above is inert until somebody looks at it. Saying so here
  // is the difference between a half-finished restore and one that looks done.
  console.log(`\n  ${C.bold("none of the packages can run yet.")}`);
  console.log(`  ${C.dim("node cli/review.mjs                      what is waiting")}`);
  console.log(`  ${C.dim("node cli/review.mjs <tool_id> <ver> --approve")}`);
}

console.log(`\n  ${ok} registered, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
