# Phase 1 findings

**Written:** 2026-09-19
**Covers:** issues #1–#10 and #12. #11 (creator submission and review gate) was
taken out of scope by decision, on the grounds that the operator publishing a
tool exercises the same path.

Phase 0 ended with a finding rather than a pass, and this follows that shape.
The machinery works and was measured; three things it claimed about itself were
wrong and are corrected here; two numbers it depends on are still guesses and
say so.

---

## What Phase 1's Done-when asked for

> *A creator publishes a tool, an agent finds and calls it, and repeated gaps
> surface automatically.*

| | Status |
|---|---|
| A tool is published | **Yes** — authenticated, charged, owned by the verified publisher |
| An agent finds it | **Yes** — over MCP, with an API key, no AWS credentials needed |
| An agent calls it | **Yes** — sandboxed, live upstream data returned |
| Repeated gaps surface automatically | **Yes** — nightly, on a public board |
| A creator who is not you | **No** |

The last row is the honest one. Every other part of the loop closes, and it
closes with real traffic rather than a test double: an MCP client with a bearer
token searched the registry, got ranked candidates, called `air-quality`, and
received live measurements from a sandbox with no network route of its own.

The loop has never been closed by a person who is not the operator. That was
true at the end of Phase 0 as well, and nothing in Phase 1 changed it, because
nothing in Phase 1 was recruitment.

---

## Cost per call — measured, as committed

The Phase 1 deck said *"the honest number is unknown until #6 … measure it and
publish it with the findings."* Measured from CloudWatch over real invocations.

Units first, because they are the durable part; the dollar figures below them
are derived from published AWS rates and go stale.

| | Measured |
|---|---|
| search-fn | 452 ms mean, 1024 MB → **0.452 GB-s** |
| Titan embedding | **13.6 tokens** mean per query (range 8–15) |
| Nova Micro adjudicator | **207 in, 8 out** mean per query |
| exec-fn | 233 ms p50, 512 MB |
| fetcher-fn | 219 ms p50, 512 MB |
| runtime-fn | **4 ms p50**, 512 MB |

### What that costs

| Per search | | | Per tool call | |
|---|---|---|---|---|
| Nova Micro | $0.0000084 | 56% | exec-fn | 43% |
| search-fn | $0.0000060 | 41% | fetcher-fn | 40% |
| Titan | $0.0000003 | 2% | requests | 17% |
| request | $0.0000002 | 1% | runtime-fn | 0.7% |
| **total** | **$0.0000149** | | **total** | **$0.0000036** |

**$14.87 per million searches. $3.64 per million tool calls.**

Three things fall out of this that were not obvious beforehand:

**A search costs 4.1× what running a tool costs.** The intuition was the
opposite — executing untrusted code sounds expensive and looking something up
sounds cheap. It is backwards because search pays for two model calls and
execution pays for none.

**The adjudicator is the single largest line item at 58% of a search**, more
than the Lambda it runs in. That is the cost of the Phase 0 finding: replacing
the score threshold with a small model fixed false gaps and made search the
expensive half of the system. It is worth it and it should be watched, because
it is the line that grows with traffic.

**The sandbox is free.** `runtime-fn` at 4 ms p50 is 0.7% of a tool call.
Whatever the argument for Fargate turns out to be, cost is not it — the thing
that was supposed to be expensive is rounding error, and the platform fetcher
waiting on somebody else's API is 40%.

*Rates used: Lambda arm64 $0.0000133334/GB-s and $0.20/M requests; Titan Text
Embeddings V2 $0.00002/1k tokens; Nova Micro $0.000035/1k in, $0.00014/1k out.
Re-derive from current pricing before quoting these.*

---

## Corrections — things this project claimed that were not true

### The runtime policy overstated the sandbox

`docs/phase-1-runtime-policy.md` promised *"no network, no IAM role, no writable
disk."* Two thirds of that was wrong, and the live escape tests found it.

- **"No IAM role"** — there is one, and there must be, or Lambda cannot attach
  an ENI. A handler that escapes reads real credentials for it out of the
  environment; the test now asserts that it can. They are useless because the
  role grants nothing and there is no route to present them to. The claim is
  now **no useful credentials**.
- **"No writable disk"** — Lambda always has a writable `/tmp` that survives
  between invocations on a warm container. The handler cannot reach it, because
  after a full escape there is no module loader to be found under ES modules.
  The claim is now **no reachable filesystem**, and it rests on the absence of a
  loader rather than the absence of a disk.
- **"No network"** stood, and it is the whole boundary.

A security claim that is loose is worse than one that is narrow, because the
narrow one tells you what to check.

### My own escape tests passed for the wrong reason

First run, three cases passed with the detail *"handler uses fetch(), which is
not permitted."* The attack strings contained the literal tokens `fetch(` and
`process`, so the source screen caught them and they never reached the network
at all. They were testing the screen and reporting on the boundary.

This is the same failure as the mislabelled Phase 0 test — a green result whose
reason was never read. It is worth naming twice because it did not get caught by
being careful; it got caught by reading the detail line on a passing test.

Fixed by reaching `fetch` and `process` through computed properties. The escaped
handler now genuinely hangs until the transform timeout.

### The wash-trading guard silently did not fire

Found by looking at a mass figure that seemed fine. `air-quality` carries owner
`ericsonasamoah3`; the caller that invoked it carries owner `erics`. Same
person, two strings, so `isSelfCall` compared them, found them different, and
counted the call as demand.

Nothing errored. The mass was just wrong.

Ownership now comes from the verified caller at publication and is flagged
`owner_verified`. It **cannot be repaired** for the 20 tools seeded earlier:
correcting a published version's owner means rewriting an immutable row, and
guessing which free-text owners are the same person is the exact class of guess
that caused the defect. So it is reported instead — `tools.json` carries
`ownership_verified` per tool, and `endless mass` prints the warning.

**The general lesson:** an identity comparison between two independently typed
strings is not a guard, it is a coincidence detector. Anywhere identity decides
something, it has to come from one canonical place.

---

## What was built

| # | | |
|---|---|---|
| 1 | Caller identity | Hashed API keys, verified at the edge. Publishing is charged; searching and calling are free. |
| 2 | Package format | Handler source lives on the immutable version row, not in S3 — the code that runs and the version reviewed are one object. |
| 3 | Sandbox runtime | No-egress VPC, no route, role granting only its own log stream. |
| 4 | Platform fetcher | Per-tool allowlist, exact host match, redirects refused. |
| 5 | **Escape tests (gate)** | 22 attacks against the deployed sandbox. Exits non-zero on any hole. |
| 6 | exec-fn | Resolve, fetch, transform, record — with cost now measured. |
| 7 | MCP endpoint | Three tools. The only way in that does not need AWS credentials. |
| 8 | Gap clustering | Nightly. Groups by meaning, counts distinct verified callers. |
| 9 | Repeated-gap rule | Gate plus corroboration, every component reported. |
| 10 | Mass-only scoring | Recomputed from the log, never accumulated. |
| 11 | Review gate | **Closed 2026-09-20.** Third-party submission waived; the safety half was not. |
| 12 | Public gaps board | Static, behind CloudFront, states its own counting rule. |

### The demonstration that matters

Four unrelated callers asked the same thing four different ways. One caller
asked twelve different ways.

```
pull deadlines and a summary out of a pdf contract
  callers 4  owners 4  occurrences 4   spread 9d    CONFIRMED
turn a photo of a receipt into a spreadsheet row
  callers 1  owners 1  occurrences 12  spread 0d    withheld
```

Twelve rephrasings counted once. That data was deleted afterwards: a board
carrying manufactured demand is the thing these rules exist to prevent, and
leaving it there to look impressive would have been the first violation.

---

## Still guesses

Phase 0's lesson was that a threshold fitted to one sample fails on a held-out
one — T produced 0% false gaps on the set that fitted it and 31.6% on the set
that did not. Two numbers here are in exactly that position and have not been
derived from anything.

| | Value | Why it is a guess |
|---|---|---|
| `cluster_similarity` | 0.5 | Query-to-query similarity is a different distribution from the query-to-tool similarity that produced T. It cannot borrow that number and there is not enough gap data to derive its own. |
| `RULE.min_callers` | 3 | Chosen because it is more than two. No data. |
| `publish_cost_credits` | 1 | A placeholder for a price nobody has set. |

**These must be derived before the board is shown to anyone who will act on it.**
A confirmed need is a claim that someone might build against, and right now the
line between confirmed and withheld sits where I put it.

---

## The open decision everything rests on

**Nothing about distinct-caller counting works if callers are free to create.**

Minting is currently an operator action with no cost. That is correct while the
operator is the only caller and wrong the moment anyone can sign up: twenty keys
makes twenty voices, and every rule in `docs/phase-1-gap-clustering.md` is
defeated at once.

Deciding what makes a caller costly — verified email or domain, a payment method
on file, rate-limited issuance, a stake — is a prerequisite for **opening
registration**, not for building anything. Build the counting; do not open the
door.

The related open question is whether publication is a fee or a refundable stake,
and whether it is per tool or per version. It is built as a per-version fee. A
stake is the same debit with a later credit back, so the mechanism does not
change either way.

---

## Closed on 2026-09-20

Two things were complete as features and absent as controls. Both are now shut.

**Unreviewed code executed.** Publishing set a tool runnable immediately;
`air-quality` had been executing since it was seeded without anyone approving
it. Execution now requires an explicit approval in its own table, and **absence
of an approval is a refusal** — a missing record, a failed write, a new tool and
a rejection all fail the same safe way.

The table is separate for a reason worth keeping: `registry-fn` must hold
`PutItem` on the tools table, so an approval stored there would let the function
that *accepts* submissions *approve* them. No Lambda has any write on approvals;
it is an operator action, like minting a key.

`--revoke` is the takedown path and was drilled rather than assumed: approve →
call succeeds → revoke → the very next call is refused.

**The MCP endpoint answered strangers for free.** `initialize`, `ping` and
`tools/list` needed no key, so anyone with the URL could make the account work.
Every method now requires one, shape-checked before anything downstream runs.
Behind it, a CloudWatch alarm trips a function that throttles the endpoint to
zero concurrency and emails; throttled invocations are not billed.

A kill switch rather than a rate limiter, deliberately: a rate limiter needs
per-caller state on the hot path, which is what a flood makes expensive, so the
defence would scale its cost with the attack. This costs nothing until it fires.
It trades availability for everyone until a human restores it — the right trade
for a free tier with one operator, the wrong one as soon as there is a customer.

## Carried into Phase 2

- **DDoS.** Largely handled above. What remains is that the kill switch is a
  blunt instrument: it protects the bill by taking the service down. Replacing
  it with a real per-caller rate limiter is Phase 2 work, and should happen
  before the threshold is ever raised to avoid an outage.
- **Ranking is not wired to mass.** Search still ranks purely on retrieval.
  Feeding mass into ranking changes what the Phase 0 eval measured, so it needs
  a re-run of the harness rather than a code change.
- **The eval set has not grown.** The standing commitment in `PROJECT.md` says
  re-run at every tenfold increase in corpus size. The corpus went from 19 to 20.
  Not yet due, and worth saying so rather than silently not doing it.
- **Owner identity has no canonical form.** The defect above is patched going
  forward by a flag. A real fix is owners as entities with ids, which is a Phase
  2 shape.
- **Nobody else has used any of this.** Named here rather than in the risks
  section, because it is now two phases old.
