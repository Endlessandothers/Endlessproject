# Deferred corrections

Problems found in `PROJECT.md` that are **real but not yet actionable**, because the
thing they affect has not been built. Each is filed against the phase that first makes
it bite.

Not a backlog of ideas. Each item is a known defect in the current plan, with the
evidence that found it. The failure mode this file exists to prevent is the ordinary
one: noticing a flaw while working on something else, carrying it in your head, and
discovering it again the hard way two phases later.

**Working rule:** when a phase starts, read its section here first. When an item is
resolved, tick it and record what was decided — including "we looked and it was not a
problem", which is a legitimate outcome and worth more than silence.

One correction has already been applied rather than deferred: the claim that Phases
0–2 need no LLM. That was false the moment gap adjudication was measured, so it was
fixed in `PROJECT.md` directly rather than filed here.

---

## Phase 3 — Agents building tools

### [ ] Define closure without reference to a threshold

**Where:** `PROJECT.md`, "Agents building tools", step 4 of the sequence.

**What it says now:** a gap closes when *"the queries in the originating cluster now
resolve to this tool above threshold"*.

**The problem:** the same document's open questions ask whether a single global
threshold is viable at all. The closure test is therefore defined in terms of a
mechanism the plan already doubts — and Phase 0 measured why that doubt is justified.
A threshold fitted on one set of queries produced 0% false gaps on that set and 31.6%
on a held-out one, because the score scale shifts with phrasing.

If closure is decided by a moving number, a generated tool can be marked as closing a
gap on Monday and not on Wednesday, with nothing about the tool having changed.

**What to do instead:** define closure by whatever mechanism is actually deciding gaps
at that point — currently the adjudicator. "Closed when the adjudicator, shown the new
tool among the candidates, says it does the job for the originating queries."

That keeps the closure test and the gap decision on the same footing. If they can
disagree, the system can report a gap and its closure simultaneously.

**Watch for:** the adjudicator judging a tool the builder just generated is still the
system marking its own homework, only one level up. The independence that matters is
between the *builder* and the *judge*, not between the judge and a number. Worth
confirming the adjudicator is not given the fact that the candidate was auto-generated.

---

## Phase 4 — Applications joining

### [ ] Expedited review buys ranking, slowly

**Where:** `PROJECT.md`, monetization table — "Expedited review · faster onboarding for
a joining application · No — speed only, never status".

**The problem:** mass accumulates over time. A tool that enters the registry two weeks
earlier has two extra weeks of usage banked before anyone else starts. Nobody bought a
higher score; they bought an earlier start, and in a time-integrated metric an earlier
start becomes a higher score on its own.

This does not breach the letter of the invariant — money never touches the ranking
computation. It does erode the reason the invariant exists, which is that an agent can
trust rank to reflect merit rather than spend.

**Three options, in ascending order of cost:**

1. **Name it.** Say in the monetization table that expedited review confers a
   time-to-market advantage that indirectly affects accumulated mass, and accept it.
   Honest, cheap, and leaves the trust claim slightly weaker than it reads today.
2. **Normalise mass by age.** Score on usage per unit time since publication rather
   than raw accumulated usage. Removes the advantage cleanly. Changes the meaning of
   mass, so it interacts with Phase 2 decay curves and cannot be bolted on late.
3. **Cap the queue.** Make review fast for everyone, so there is nothing to skip.
   Removes the product rather than the leak.

**Decide before expedited review is sold**, not after. Option 2 is a scoring change,
and scoring changes are far cheaper before there is a market with an interest in them.

---

## Standing commitment — grow the eval set with the corpus

### [ ] The instrument has to scale, not just repeat

**Where:** `PROJECT.md`, standing commitments — *"re-run the eval harness at every
tenfold increase in corpus size"*.

**The problem:** re-running the same 60 queries against ten times the tools measures
ten times less per tool. At 19 tools, 11 of 60 queries had an answer in the corpus, so
recall was computed over 11 observations — already thin. At 200 tools most tools would
never appear in any expected answer at all, and at 2,000 the recall figure would be
noise dressed as a measurement.

The Density risk in `PROJECT.md` is right that a small corpus flatters its numbers. The
cure is not only re-measuring — it is re-measuring with an instrument that grew.

**What to do:** at each tenfold step, extend the set so that

- every tool is the expected answer for at least one query,
- the proportion of deliberately unanswerable queries stays roughly constant,
- the new queries are written **before** the new tools are seeded, as in Phase 0, and
- previous versions stay frozen and are still reported, so the trend is comparable.

**Watch for:** reporting only the newest set's numbers. The trend in distribution
overlap is the signal; a single reading tells you almost nothing.

---

## Resolved

_Nothing yet. Tick items above and move them here with the date and what was decided._
