// The review gate rule. Phase 1.
//
// Pure and separate from index.mjs so that the one property that matters can be
// pinned by a test without AWS: ABSENCE OF AN APPROVAL IS A REFUSAL.
//
// That is the whole design. A missing record, a failed write, a brand new tool,
// a typo in a table name and a deliberate rejection all fail the same safe way.
// The opposite arrangement — where a tool runs unless something says no — fails
// open on every one of those, and the failures look identical to success.

export function mayExecute(approval) {
  // Exactly the string, from a record that exists. Not truthiness: an approval
  // object with a decision of "rejected" is still an object.
  return approval?.decision === "approved";
}

// What to tell the caller, without leaking whether a version exists that they
// are not allowed to run. "never reviewed" and "rejected" are both safe to say:
// the tool_id was already public in the registry, and a creator waiting on a
// review needs to know which state they are in.
export function refusalReason(approval) {
  return approval?.decision ?? "never reviewed";
}
