// Moons — Phase 2, issue #1.
//
// A dependency graph is a place where small mistakes become unbounded ones: a
// cycle runs until something else stops it, and depth multiplies cost. These
// test the rules that make that impossible rather than unlikely.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateUses, resolveInputs, checkChain, MAX_DEPTH, MAX_USES,
} from "../lambda/exec/deps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// exec-fn enforces these at call time and registry-fn at publication. Two
// copies means two rulesets unless something says otherwise.
test("exec and registry ship the same dependency rules", () => {
  const a = readFileSync(join(HERE, "../lambda/exec/deps.mjs"));
  const b = readFileSync(join(HERE, "../lambda/registry/deps.mjs"));
  assert.ok(a.equals(b), "registry/deps.mjs has diverged from exec/deps.mjs");
});

// ---------------------------------------------------------------- cycles
test("a tool cannot appear twice in its own chain", () => {
  const v = checkChain(["a", "b"], "a");
  assert.equal(v.ok, false);
  assert.match(v.reason, /cycle: a -> b -> a/);
});

test("the immediate self-cycle is caught at publication, not at call time", () => {
  const errors = validateUses([{ id: "me", tool_id: "myself" }], "myself");
  assert.ok(errors.some((e) => /cannot depend on itself/.test(e)));
});

// A diamond is not a cycle. Two tools may both legitimately depend on a third,
// and a graph-wide check would have to tell those apart — a chain cannot be
// confused this way, which is why the check is on the chain.
test("two branches depending on the same tool is allowed", () => {
  assert.equal(checkChain(["root", "left"], "shared").ok, true);
  assert.equal(checkChain(["root", "right"], "shared").ok, true);
});

test("depth is capped, and the cap is reported with the chain that hit it", () => {
  const chain = Array.from({ length: MAX_DEPTH }, (_, i) => `t${i}`);
  const v = checkChain(chain, "one-too-deep");
  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(`deeper than ${MAX_DEPTH}`));
  assert.match(v.reason, /one-too-deep/);
});

test("a chain one below the cap still runs", () => {
  assert.equal(checkChain(Array.from({ length: MAX_DEPTH - 1 }, (_, i) => `t${i}`), "ok").ok, true);
});

// ---------------------------------------------------------------- breadth
test("breadth is capped", () => {
  const many = Array.from({ length: MAX_USES + 1 }, (_, i) => ({ id: `d${i}`, tool_id: `t${i}` }));
  assert.ok(validateUses(many, "self").some((e) => /limit is/.test(e)));
});

test("duplicate dependency ids are refused", () => {
  const errors = validateUses([
    { id: "geo", tool_id: "a" }, { id: "geo", tool_id: "b" },
  ], "self");
  assert.ok(errors.some((e) => /duplicate dependency id: geo/.test(e)));
});

test("declaring no dependencies is not an error", () => {
  assert.deepEqual(validateUses(undefined, "self"), []);
  assert.deepEqual(validateUses(null, "self"), []);
  assert.deepEqual(validateUses([], "self"), []);
});

test("malformed declarations are refused rather than half-accepted", () => {
  assert.deepEqual(validateUses("geocode", "self"), ["uses must be an array"]);
  assert.ok(validateUses([{ tool_id: "a" }], "self").some((e) => /needs an id/.test(e)));
  assert.ok(validateUses([{ id: "a" }], "self").some((e) => /tool_id is required/.test(e)));
  assert.ok(validateUses([{ id: "a", tool_id: "b", input: [] }], "self").some((e) => /input must be an object/.test(e)));
});

// ---------------------------------------------------------------- inputs
//
// Types matter: the callee's schema is enforced, and a number arriving as a
// string fails validation in a way whose cause is invisible from the handler
// that caused it.
test("a whole-value placeholder preserves the type", () => {
  const { input, missing } = resolveInputs({ lat: "{latitude}" }, { latitude: 51.5 });
  assert.equal(input.lat, 51.5);
  assert.equal(typeof input.lat, "number");
  assert.deepEqual(missing, []);
});

test("a placeholder inside text interpolates to a string", () => {
  const { input } = resolveInputs({ place: "{city}, {country}" }, { city: "Lisbon", country: "PT" });
  assert.equal(input.place, "Lisbon, PT");
});

test("a literal passes through untouched", () => {
  const { input } = resolveInputs({ units: "metric", limit: 5, flag: true }, {});
  assert.deepEqual(input, { units: "metric", limit: 5, flag: true });
});

test("a missing parent value is reported, not silently emptied", () => {
  const { input, missing } = resolveInputs({ lat: "{latitude}" }, {});
  assert.equal("lat" in input, false);
  assert.deepEqual(missing, ["lat needs {latitude}"]);
});

test("a partially resolvable template is dropped rather than half-filled", () => {
  // "Lisbon, undefined" would reach the dependency as a plausible-looking
  // string and fail somewhere far from the cause.
  const { input, missing } = resolveInputs({ place: "{city}, {country}" }, { city: "Lisbon" });
  assert.equal("place" in input, false);
  assert.equal(missing.length, 1);
});

test("a falsy parent value is passed, not treated as missing", () => {
  const { input, missing } = resolveInputs({ lat: "{latitude}", on: "{flag}" }, { latitude: 0, flag: false });
  assert.equal(input.lat, 0);
  assert.equal(input.on, false);
  assert.deepEqual(missing, []);
});

test("an empty template resolves to an empty input", () => {
  assert.deepEqual(resolveInputs(undefined, { a: 1 }), { input: {}, missing: [] });
});
