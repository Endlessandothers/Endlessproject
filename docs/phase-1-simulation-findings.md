# Simulating strangers

**Run:** 2026-09-20
**Set:** `sim/personas.json`, sha256 `eea1a54ff73e3aa7…`, frozen before the first replay
**Purpose:** get the product working against stranger-shaped input before strangers see it, and replace the two numbers the Phase 1 findings flagged as guesses.

Twelve invented people with twelve owners, 35 requests written the way people
actually type — abbreviated, colloquial, one misspelling of "receipt" left in on
purpose. Eight underlying needs plus eleven one-offs, labelled in `sim/truth.json`
**before** anything ran.

Every request went through the **public MCP endpoint with a bearer key**, exactly
as an agent would send it. No direct invokes, no mocks. The thing being tested is
the product a stranger would meet.

---

## The quarantine, first

Simulated demand on a board that claims to show real demand is the precise thing
the counting rules exist to prevent, and being the one who does it because it was
convenient is not an exception.

So simulated callers are minted with `--simulated`, the flag is written onto
every row **by the platform from the caller row** — never from the request — and
the nightly job sorts the two populations apart before anything is published.

Verified after the run:

```
public board      gaps_total 1     simulated_excluded 24
```

The 24 invented gaps never reached it.

---

## What the run showed

### The gap decision held completely

| | |
|---|---|
| Requests with a tool that could serve them | 11 |
| …that matched a tool | **11** |
| Requests with nothing in the registry | 24 |
| …logged as gaps | **24** |

**Zero false gaps, 100% gap detection.**

What makes this interesting is *how* it held. Retrieval's top result was often
nonsense — "is my site down or is it just me" ranked `crossref-paper-search`
first; "translate srt subtitles" ranked `currency-convert`. The adjudicator
caught every one of them.

That is the Phase 0 finding paying for itself. An absolute score threshold would
have had to separate those from genuine matches on score alone, and Phase 0
already measured that it cannot.

**Contamination note:** the eleven answerable requests were chosen by someone who
has read the catalog, so this is **not** a blind recall measurement and no recall
number is claimed from it. What it does test blind is the *gap decision* on 24
requests whose subject matter nothing in the corpus covers.

### There is no clean similarity threshold — and that is the finding

| | n | min | p05 | p50 | p95 | max |
|---|---|---|---|---|---|---|
| within a need | 30 | 0.1712 | 0.1914 | 0.5251 | 0.7511 | 0.8335 |
| across needs | 246 | −0.0506 | 0.0100 | 0.0779 | 0.2376 | 0.3367 |

The distributions **overlap**: within-p05 (0.191) sits *below* across-p95 (0.238).
No single number separates them. The question is therefore not where the line is
but **which error to prefer.**

Swept against the labels:

| T | wrongly merged | wrongly split | precision | recall | F1 |
|---|---|---|---|---|---|
| 0.300 | 5 | 4 | 0.839 | 0.867 | 0.852 |
| 0.325 | 3 | 4 | 0.897 | 0.867 | 0.881 |
| **0.350** | **0** | **5** | **1.000** | **0.833** | **0.909** |
| 0.500 (old default) | 0 | 10 | 1.000 | 0.667 | 0.800 |

**`cluster_similarity` 0.5 → 0.35.**

0.35 is the lowest value that makes **zero wrong merges**, and that is the
direction to err. A split need is under-counted and may fall below the bar; a
merged need invents one large demand out of two smaller ones and sends a builder
at the wrong problem. Under-reporting is recoverable. Reporting demand that does
not exist is the failure this whole subsystem was built to avoid.

The old 0.5 was not merely arbitrary — it was **wrong in the expensive direction**,
splitting a third of same-need pairs.

### The pairs designed to trap it stayed apart

| | closest pair | vs T=0.35 |
|---|---|---|
| ocr / receipt-to-row | 0.3367 | apart, by 0.013 |
| pdf-dates / transcript-actions | 0.3258 | apart |
| site-up / domain-whois | 0.2517 | apart |
| pdf-dates / ocr | 0.1979 | apart |

All four hold, but **ocr / receipt-to-row clears by 0.013**. That is not margin,
it is luck. Both are "read text off an image"; a slightly different phrasing on
either side merges them. Treat 0.35 as a value that works on this set rather than
one with room to spare.

### Owner counts were exact

All eight needs came back with the distinct-owner count written down before the
run. The anti-manufacturing rule counts what it says it counts.

### min_callers stays at 3

| bar | needs shown | shown on enough evidence |
|---|---|---|
| 1 | 7 | 7 |
| 2 | 5 | 5 |
| 3 | 3 | 3 |
| 4 | 1 | 1 |

At no bar was a need shown on less evidence than it had, so the sweep does not
force a value. 3 is kept as the more conservative reading of a small synthetic
set.

### One need clustered imperfectly

`site-up` grouped three of its four requests and all three owners. The orphan is
**"is example.com responding"** — max similarity 0.287 to any sibling, below the
threshold.

It is the most colloquial phrasing in the set, and it names a specific host
instead of describing the task. That is a real limitation, not a bug: embedding
similarity under-groups requests phrased as an instance rather than as a need,
and the board will therefore **under-report** needs whose askers phrase them
concretely. Worth re-measuring once real traffic exists, since real users are
likely to do this more, not less.

---

## Two defects the run found

### sim-gaps.json was served on the open internet

The simulation's own snapshot deliberately keeps caller identities, because the
analysis has to know which caller landed in which cluster. `cluster.tf` claimed
it was *"never served: CloudFront has no behaviour for it and nothing links to
it."*

It returned **HTTP 200** to the first person who asked for it, which was me.

The bucket policy granted CloudFront `s3:GetObject` on `arn:…/*`, and a default
cache behaviour serves whatever it is asked for. **"Nothing links to it" is not
access control.**

Fixed by making the public surface an allowlist of three named objects —
`index.html`, `gaps.json`, `tools.json`. Anything else in that bucket is now
private until someone deliberately names it. Verified: `sim-gaps.json` → 403, the
three published objects → 200.

This is the second time in two days that a claim written confidently in a comment
turned out to be false when checked (the first was "no IAM role, no writable
disk"). The pattern is worth naming: **a comment asserting a security property is
a hypothesis until something tests it.**

### My analysis reported a failure that was not one

The first scoring run said `site-up` had 1 distinct owner against 3 labelled — a
clustering failure. It was not. `analyse.mjs` picked the *first* group containing
any of the need's requests, and the orphan happened to sort first.

Fixed to pick the largest overlapping group and report how many requests were
stranded. All eight owner counts then matched.

**The measurement was wrong in the direction of reporting a defect that did not
exist**, which is the safer direction but still meant a real result was hidden
behind a false one for several minutes. It was caught by looking at the pairwise
similarities to understand *why* it failed, rather than accepting the number.

---

## What this does not establish

- **That real people phrase things this way.** Twelve personas with one author.
  The set cannot tell me where my guesses about stranger phrasing are wrong; only
  strangers can.
- **Retrieval recall.** Contaminated, as above, and deliberately not reported.
- **That 0.35 generalises.** This is exactly the position T was in after Phase 0's
  first fit — a number derived from one set, which then moved on a held-out one.
  The difference is that 0.35 sits at a *plateau edge chosen for the safe error*
  rather than at an optimum, and the failure mode if it drifts is under-reporting.
  **Re-run this sweep against real traffic before trusting the board's counts.**
- **Anything about load.** 35 requests, one at a time.

---

## Where that leaves things

The product works against stranger-shaped input: an agent with a key can search,
be told honestly that nothing exists, have that recorded, and have it grouped
with other people's version of the same problem — without any of it touching the
public board when it should not.

Both numbers the Phase 1 findings flagged as guesses are now derived, one changed
and one confirmed. The open decision is unchanged and unaffected by any of this:
**minting a caller still costs nothing**, and no amount of counting survives
callers being free to create.
