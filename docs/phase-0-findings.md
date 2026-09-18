# Phase 0 findings

**Written:** 2026-09-18
**Issue:** #14, the last item in Phase 0
**Corpus:** 19 tools wrapping free public APIs, `tools/catalog.json` v3
**Evaluation:** two sets of 60 queries, both frozen and checksummed
**Raw data:** every run committed under `eval/results/`

---

## The verdict, first

Phase 0 asked one question: **is a logged gap real evidence of an unsolved need, or
just a search failure?**

The answer splits in two, and the split matters more than either half.

**The mechanism works.** The system can distinguish "we have a tool for this" from "we
have nothing for this" at **96.7% detection with 6.7% false positives**, holding across
two independently written query sets. That was the open question, and it is answered.

**The demand signal does not exist.** Every gap ever logged came from the evaluation
harness. Real usage is zero. Nobody outside this project has touched the system, so
no logged gap is evidence that anyone wants anything.

Against the Done-when as originally written — *"you can point at logged gaps that are
genuinely unsolved needs"* — Phase 0 **fails**, and would have failed no matter how
well the software worked, because that criterion needs users. Against the Done-when as
revised — *"the gate clears, or a written finding says why it doesn't"* — this document
is the exit.

The honest summary: **the loop works, the traffic does not exist, and those are
separate problems.** Only the first was in scope.

---

## How it was measured

The order was chosen to prevent the obvious way of fooling yourself.

1. **Queries first.** 60 written from the task side — what an agent needs mid-task —
   with no tool catalogue in view, then frozen and checksummed
   (`6ff8f77c…`). A query is never edited after it fails; editing one because it failed
   turns a harness into a mirror.
2. **Tools second, chosen independently.** 19 free public APIs across 11 domains,
   selected as what a general agent toolkit would plausibly wrap — deliberately *not*
   by reading the queries. Picking tools to match the questions is the same mistake in
   reverse.
3. **Labels third.** Which tool should win was decided only once both sets were fixed.

Because of that order, the answerable split was an **outcome, not a target**: 11 of 60
queries had an answer in the corpus, 49 did not. Nobody designed that ratio.

A second set of 60 was written later and scored **once**, with every parameter frozen.
That set is what caught the central mistake.

**The harness calls the deployed endpoint** rather than reimplementing ranking. A
harness that scores its own copy of the algorithm measures the copy. It also re-checks
the query checksum against the labels on every run and refuses to report numbers if
the set moved after labelling.

---

## Every run

| Run | Ranking | Gap decision | recall@1 | recall@3 | false-gap | detection |
|---|---|---|---|---|---|---|
| Blind, descriptions v1 | cosine | T=0.05 | 90.9% | 100.0% | 0.0% | 0.0% |
| Blind, descriptions v2 | cosine | T=0.05 | 81.8% | 90.9% | 0.0% | 0.0% |
| Blind, descriptions v3 | cosine | T=0.05 | 100.0% | 100.0% | 0.0% | 0.0% |
| Blind | hybrid α=0.8 | T=0.20 | 100.0% | 100.0% | 0.0% | 87.8% |
| Blind | hybrid α=0.8 | adjudicator | 100.0% | 100.0% | 9.1% | 95.9% |
| **Held-out** | hybrid α=0.8 | T=0.20 | 84.2% | 100.0% | **31.6%** | 97.6% |
| **Held-out** | hybrid α=0.8 | adjudicator | 84.2% | 100.0% | **5.3%** | 97.6% |

Combined across both sets — 30 answerable queries, 90 unanswerable:

| Gap decision | false gaps | detection |
|---|---|---|
| Threshold | 6/30 = **20.0%** | 83/90 = 92.2% |
| Adjudicator | 2/30 = **6.7%** | 87/90 = **96.7%** |

> The committed JSON for the two adjudicator runs does not carry a `decided_by` field —
> the harness began recording it immediately afterwards. They are identifiable by their
> metrics differing at identical α and T, and the adjudicator was separately confirmed
> live returning `decided_by=amazon.nova-micro-v1:0` with no errors. Worth stating
> because the adjudicator **fails open**: a broken one produces threshold-shaped numbers
> that would be easy to report as success.

---

## Finding 1 — writing what a tool is *not* makes retrieval worse

Three versions of the same 19 descriptions, measured each time.

| Descriptions | recall@1 | recall@3 | no-answer max |
|---|---|---|---|
| v1, as first written | 90.9% | 100.0% | 0.2721 |
| v2, with "not X" boundary clauses | **81.8%** | **90.9%** | 0.3632 |
| v3, positive and concrete only | **100.0%** | 100.0% | 0.3362 |

v2 was an attempt to fix a real confusion — a currency query ranked a crypto tool
first — by stating each tool's boundaries against its neighbours. It fixed that one
case and damaged five others.

**Embeddings carry no representation of negation.** Writing that `public-ip-lookup`
*"does not look up the owner, registrant or country of some other address"* raised its
score on exactly that query by **+0.1331**. The words are present; the "not" is
invisible.

Qualifier clauses also dilute. `wikipedia-summary` on a history query fell from 0.2994
to **0.0890** and lost to a public-holidays tool.

v3 differentiates by being specific about what a tool **does**, never naming the
neighbouring capability. That took recall@1 to 100%.

**Carry forward:** description guidance for creator onboarding in Phase 1 should say
this explicitly. It is counter-intuitive, and every careful writer's instinct is to
add the disclaimer.

---

## Finding 2 — good ranking is not a good gap decision

Retrieval was never the weak part. **recall@3 was 100% on both sets — 30 of 30
answerable queries** — with 27 at rank 1.

The threshold was the weak part, and the held-out set proved it:

- On the set used to choose T: **0.0%** false gaps.
- On 60 queries it had never seen: **31.6%** — six of nineteen answerable queries
  logged as gaps.

Those six included *"will it rain in Lagos on Friday"* (0.1507) and *"summarise the
life and work of Ada Lovelace"* (0.1570). Obvious answers, sitting in the corpus.

**In all six, the correct tool was already in the top three — four of them ranked
first.** The retriever found it; the cutoff threw it away.

The cause is visible in the distributions:

| | correct-hit min | correct-hit median | no-answer max |
|---|---|---|---|
| Blind set | 0.2061 | 0.3586 | 0.3874 |
| Held-out set | **0.1158** | 0.2857 | 0.2061 |

T=0.20 was fitted where the correct-hit minimum was 0.2061. On new queries that
minimum fell to 0.1158, so the threshold sliced into real hits. **Both distributions
move with how a question is phrased.** An absolute threshold over a similarity score
cannot survive that, and tuning it harder only fits it to whichever set was used last.

---

## Finding 3 — the success criterion itself was wrong

On the held-out run, **both floors passed** — recall@3 100%, gap detection 97.6% —
while **a third of answerable queries were being written into the gap log as unmet
needs.**

The gate asked two questions: did we find the right tool, and did we catch the real
gaps. It never asked whether we *wrongly* called something a gap.

A system can score 100% on gap detection by flagging everything. The test had a hole
the exact size of the product's core claim.

**A false-gap ceiling has to be a floor, not a reported number.** This surfaced only
because the held-out set was scored once with parameters frozen, and nothing was
re-tuned after seeing the result. Re-tuning would have produced a better-looking number
and destroyed the only honest measurement in the phase.

---

## Finding 4 — an adjudicator fixes it, and moves an LLM into Phase 0

Replacing `top_score < T` with a small model shown the top three candidates and asked
whether any genuinely does the job:

| | false gaps | detection | spread across sets |
|---|---|---|---|
| Threshold | 20.0% | 92.2% | 0.0% → 31.6% |
| Adjudicator | **6.7%** | **96.7%** | 9.1% → 5.3% |

The adjudicator is *worse* on the blind set — 9.1% against 0.0%. That is expected and
is the point: the threshold was fitted on that set, so 0% there was never evidence of
anything. **Consistency is the property worth having**, because production queries are
always the other set.

It works because recall@3 is 100%: the right answer is always in the shortlist when one
exists, so the decision becomes a classification over three candidates rather than a
threshold on a moving scale.

**Model:** `amazon.nova-micro-v1:0`, roughly 200 input and 12 output tokens per call.
Claude Haiku 4.5 answered correctly too but its inference profile is not enabled in
this account.

**The local alternative was tested and is not ready.** Ollama runs on the dev machine,
but `llama3` 8B is CPU-only against 2 GB of integrated graphics: **25–58 seconds** per
decision against a 30-second Lambda timeout, and 2 of 3 on the same cases the hosted
model got 3 of 3. A 1–3B model or a real GPU would change that.

**This is a phasing change, not an architecture change.** `PROJECT.md` always placed
mini-LLMs at the edges. What was wrong was the assumption that Phases 0–2 could defer
them. `PROJECT.md` has been corrected, separating the **adjudicator** (Phase 0 onward,
on the path of every search) from the **router** (Phase 5, still deferred).

---

## What was not established

**That any logged gap represents demand.** The gap table has held up to 180 rows;
every one came from the harness. Pointing at *"find the original source of this
quotation"* as market evidence would be circular — that query was invented to test the
software.

**That any of this holds at scale.** 19 tools is a small corpus, and a small corpus
flatters every recall number it produces. At 2,000 tools, near-misses crowd together
and the distributions overlap far more. `PROJECT.md` now carries this as the Density
risk, and the eval harness is a standing instrument rather than a one-off.

**That 11 answerable queries is enough.** 100% recall over 11 observations is a floor
for proceeding, not a claim of quality.

**That the labels are right.** The one remaining held-out false gap is *"is today a
bank holiday in Germany"*, where the adjudicator declined a tool that returns a year of
holidays. That is a defensible reading, and the label — marked high confidence — is
arguably the weaker half. Labels made by one person are a measurement instrument too.

---

## Cost

Under $5 for the whole phase. Everything sits inside AWS always-free limits except
Bedrock: embeddings at registration and search time, plus the adjudicator on every
search.

The adjudicator changes the cost *shape*, not its size: previously near-zero per
search, now a fraction of a penny per search, and therefore growing with traffic rather
than with corpus size.

Latency went from roughly 0.2s to roughly 2s per search.

---

## What Phase 1 should carry forward

1. **The adjudicator is not optional.** Without it the gap log runs at 20% false
   positives, and the gap log is the product.
2. **Add a false-gap ceiling to every gate.** Recall and detection alone cannot express
   "the log is trustworthy".
3. **Hold something back, always.** The single most valuable thing done in this phase
   was writing a second query set and scoring it once without re-tuning. Everything
   measured only against the data that shaped it looked better than it was.
4. **Description guidance must warn against negation.** Finding 1 is
   counter-intuitive and creators will get it wrong by default.
5. **Real endpoints.** `mcp_url` currently points at `repo:tools/catalog.json#<id>` — a
   provenance pointer, not a reachable MCP server. Fine while nothing executes;
   blocking the moment Phase 1's sandbox needs something to call.
6. **Nothing protects the tables.** `terraform destroy` has taken the registry and the
   logs three times. Harmless while gaps are test data; not harmless once a labelled
   evaluation run or real traffic lives there.
7. **Getting one outside user is work, not an assumption.** Phase 1's Done-when begins
   *"a creator publishes a tool"* — a person who is not you. Phase 0 ended with working
   machinery and no users. Phase 1 will too, unless recruiting the first creator is
   scheduled as a task rather than expected at the end.

---

## Reproducing this

```bash
node tools/verify.mjs                 # all 19 tools answer their live APIs
node eval/harness.mjs                 # the blind set
node eval/harness.mjs --set=holdout   # the held-out set
node cli/endless.mjs gaps             # read the miss log by hand
```

Raw per-query results, including component scores for every tool on every query, are
in `eval/results/`.
