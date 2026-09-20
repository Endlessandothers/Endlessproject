// The review gate — Phase 1.
//
// One property, tested from every angle it could fail: unreviewed code does not
// run. Everything else about the gate is plumbing; this is the guarantee.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mayExecute, refusalReason } from "../lambda/exec/gate.mjs";

test("only an explicit approval permits execution", () => {
  assert.equal(mayExecute({ decision: "approved" }), true);
});

// The important one. A tool nobody has looked at must not run, and neither must
// one whose approval record failed to write, or whose table name was wrong, or
// which was published thirty seconds ago.
test("absence of an approval is a refusal", () => {
  for (const nothing of [null, undefined, {}, { decision: null }, { decision: "" }]) {
    assert.equal(mayExecute(nothing), false, `${JSON.stringify(nothing)} must not execute`);
  }
});

test("a rejected or revoked version does not run", () => {
  assert.equal(mayExecute({ decision: "rejected" }), false);
  assert.equal(mayExecute({ decision: "revoked" }), false);
});

// An approval object is still an object. A truthiness check here would let
// every rejection through, which is the exact failure this gate exists to
// prevent, so it is pinned rather than assumed.
test("the check is on the decision, not on the record existing", () => {
  assert.equal(mayExecute({ decision: "pending", reviewer: "someone" }), false);
  assert.equal(mayExecute({ reviewer: "someone", reviewed_at: "2026-09-20" }), false);
});

test("near-misses on the word do not count", () => {
  for (const near of ["Approved", "APPROVED", "approve", "approved ", " approved", "approved_by_default"]) {
    assert.equal(mayExecute({ decision: near }), false, `"${near}" must not execute`);
  }
});

test("the refusal says which state the caller is in", () => {
  assert.equal(refusalReason(null), "never reviewed");
  assert.equal(refusalReason({}), "never reviewed");
  assert.equal(refusalReason({ decision: "rejected" }), "rejected");
  assert.equal(refusalReason({ decision: "revoked" }), "revoked");
});
