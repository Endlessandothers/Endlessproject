# sim — twelve strangers who do not exist

A blind test set standing in for people who have not arrived yet. Phase 0 proved
retrieval against queries written before the corpus existed; this does the same
for the whole product, against input shaped like a stranger's rather than like
the author's.

**Results:** `docs/phase-1-simulation-findings.md`

## Running it

```bash
node sim/freeze.mjs          # once, after editing the set — stamps the checksum
node sim/run.mjs --mint      # create the simulated callers
node sim/run.mjs             # replay through the live MCP endpoint
node sim/analyse.mjs         # score against truth.json, sweep the thresholds
node sim/run.mjs --purge     # delete every simulated gap, event and caller
```

Costs a few cents in Bedrock calls and takes about two minutes, most of it
waiting on the adjudicator.

## The three rules this follows

**1. Frozen before it runs.** `personas.sha256` is checked by both `run.mjs` and
`analyse.mjs`, and a mismatch refuses to report numbers. A set that can be edited
after seeing the results is not a blind set — it is a way of writing down what
happened and calling it a prediction.

**2. Labels written before the run, not after.** `truth.json` says which requests
are the same need and how many distinct owners each has. Clustering is scored
against that fixed answer rather than against whatever it produced.

**3. Simulated demand never reaches the public board.** Callers are minted with
`--simulated`; the flag is written onto every gap and event row **by the platform,
from the caller row**, never from the request. The nightly job splits the two
populations before publishing and writes the simulation's own snapshot to a
private object.

That third rule is not hygiene. Inventing demand and showing it as real is the
exact attack the counting rules were built to stop, and "it was only a test" is
how it would happen first.

## Why it goes through MCP

Every request is an HTTP POST to the public MCP endpoint with a bearer key —
the same path an agent would use. Invoking Lambda directly would be faster and
would test something that is not the product.

## What it cannot tell you

The personas have one author, who is also the author of the system. It can find
places where the product breaks on input shaped unlike the author's own, and it
cannot find the places where the author's idea of a stranger is simply wrong.
That gap closes when somebody real turns up, and not before.
