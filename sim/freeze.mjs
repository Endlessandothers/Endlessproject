#!/usr/bin/env node
// Stamp the checksum of the blind set. Run once, before the first replay.
//
// A set that can be edited after seeing the results is not a blind set, so
// run.mjs and analyse.mjs both refuse to report anything if the file has moved
// since this was written. Same guard as the Phase 0 harness.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(HERE, "personas.json"), "utf8").replace(/\r\n/g, "\n");
const sha = createHash("sha256").update(raw, "utf8").digest("hex");
writeFileSync(join(HERE, "personas.sha256"), `${sha}  personas.json\n`);

// truth.json records which set it was written against, so a label file cannot
// silently be paired with a different set of requests.
const tp = join(HERE, "truth.json");
const truth = JSON.parse(readFileSync(tp, "utf8"));
truth.personas_sha256 = sha;
writeFileSync(tp, `${JSON.stringify(truth, null, 2)}\n`);

console.log(`frozen: ${sha}`);
