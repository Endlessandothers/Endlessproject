#!/usr/bin/env node
// mint-caller — create a caller and print its API key once.
//
//   node cli/mint-caller.mjs <caller_id> --owner <owner> [--credits 100]
//                             [--label "..."] [--simulated] [--builder]
//
// Runs from an operator's own AWS credentials, deliberately. No Lambda has
// PutItem on the callers table, so no function — however badly it is
// compromised — can issue itself an identity or top up a balance. Minting is an
// out-of-band act by someone with the account.
//
// The key is shown ONCE. Only its SHA-256 is stored, so a dump of the callers
// table yields no working keys and a lost key is replaced, never recovered.
//
// WHAT THIS DOES NOT DECIDE: who is allowed to become a caller. Right now that
// is "whoever the operator runs this for". Making caller creation costly —
// verified email or domain, a payment method, rate-limited issuance — is the
// open Phase 1 decision that distinct-caller gap counting ultimately rests on.
// See docs/phase-1-gap-clustering.md.

import { execFileSync } from "node:child_process";
import { mintKey } from "../infra/lambda/exec/auth.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";

const args = process.argv.slice(2);
const callerId = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

if (!callerId) {
  console.error('usage: node cli/mint-caller.mjs <caller_id> --owner <owner> [--credits 100] [--label "..."]');
  process.exit(1);
}

const owner = flag("owner");
if (!owner) {
  // Not defaulted. Ownership decides bounty eligibility, self-call exclusion and
  // takedown authority; a caller with a guessed owner is worse than none.
  console.error("--owner is required: it is who is accountable for this caller");
  process.exit(1);
}

const credits = Number(flag("credits", "100"));
const label = flag("label", callerId);

// Simulated callers exercise every real code path — that is the point of
// testing a product rather than a mock — but their demand is invented. The flag
// travels onto every gap and event row they produce (see auth.mjs
// provenanceOf), and the nightly job keeps them off the public board.
//
// Set here, at minting, by whoever has the account. A caller cannot declare
// itself real or simulated, because then the flag would be worth nothing.
const simulated = args.includes("--simulated");

// A builder caller publishes tools nobody wrote. Everything it registers is
// marked provisional by the platform, and held to the tighter generated
// envelope. Set here, at minting, because a caller declaring its own role would
// let a person publish as a builder or a builder publish as a person.
const role = args.includes("--builder") ? "builder" : "caller";

let minted;
try {
  minted = mintKey(callerId);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const item = {
  caller_id: { S: minted.caller_id },
  key_hash: { S: minted.key_hash },
  owner: { S: owner },
  status: { S: "active" },
  credits: { N: String(credits) },
  publications: { N: "0" },
  label: { S: label },
  simulated: { BOOL: simulated },
  role: { S: role },
  created_at: { S: new Date().toISOString() },
};

try {
  execFileSync("aws", [
    "dynamodb", "put-item",
    "--region", REGION,
    "--table-name", `${PREFIX}-callers`,
    "--item", JSON.stringify(item),
    // Minting never overwrites. Re-running this for an existing caller would
    // otherwise silently invalidate their live key and reset their balance.
    "--condition-expression", "attribute_not_exists(caller_id)",
  ], { stdio: ["ignore", "pipe", "pipe"] });
} catch (err) {
  const msg = (err.stderr?.toString() || err.message).trim().split("\n").pop();
  if (/ConditionalCheckFailed/.test(msg)) {
    console.error(`caller "${callerId}" already exists — pick another id, or rotate its key deliberately`);
  } else {
    console.error(`aws put-item failed: ${msg}`);
  }
  process.exit(1);
}

console.log(`
  caller    ${minted.caller_id}${simulated ? "   [33m(simulated)[0m" : ""}${role === "builder" ? "   [36m(builder — publishes provisional)[0m" : ""}
  owner     ${owner}
  credits   ${credits}

  \x1b[1mAPI key — shown once, not recoverable:\x1b[0m

    ${minted.key}

  Use it as a bearer token:

    export ENDLESS_API_KEY=${minted.key}
`);
