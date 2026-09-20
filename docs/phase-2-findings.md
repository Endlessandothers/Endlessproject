# Phase 2 findings

**Written:** 2026-09-20
**Covers:** issues #1–#8 — moons, brightness, dependency weight, decay, stasis, anti-gaming, bounties, and this.

Phase 2's Done-when is *"you'd let a stranger's agent trust the ranking unsupervised."*

**The honest answer is no**, and the reason is not the one I expected going in. The
ranking is defensible in **construction** — every component is derived from the
append-only log, money is provably absent, and every self-dealing edge anyone has
thought of is closed. It is not defensible in **calibration**: four of its six
numbers are guesses, and the whole structure rests on one undecided question.

---

## The one question everything rests on

**Minting a caller still costs nothing.**

Every counting rule in Phase 2 — distinct callers for competition edges, distinct
owners for dependency weight, beneficiary exclusion for bounties — assumes one
party cannot cheaply become several. That assumption is currently false.

It is now pinned as a test rather than a worry:

```
beneficiary exclusion does not survive a claimant with several identities
  → only the claiming identity is removed
  → and the three sock puppets still read as three separate people
```

This is the same open decision from Phase 1, arriving where the money is. It
should be settled **before a bounty is ever paid**, not before the code is
written.

---

## Parameters: what was derived, what was guessed

The rule set for this phase was: every parameter ships with its derivation or
ships marked provisional in the variable that holds it.

| | Value | Status |
|---|---|---|
| Brightness estimator | Wilson lower bound, z=1.96 | **Not a fit.** A standard estimator with a standard constant |
| Competition cluster | co-retrieval, ≥3 distinct callers | **Derived by elimination** — see below |
| Standing floor | 0.1 | **A bound, not a fit.** Stops a tool vanishing between nightly runs |
| Archival floor | 1 effective call | **A natural unit**, not a chosen one |
| Dependency damping | 0.25 | **Guess** |
| Decay half-life | 90 days | **Guess** |
| Star threshold | 20 effective calls | **Guess** |
| Closure fraction | 0.8 | **Guess** |

Four guesses. That is four fewer than a naive build and four more than zero, and
each is named in the variable that holds it rather than buried.

### The one that was measured, by failing

Deciding *which tools compete* was the hard part of decay, and the first two
answers are measurably wrong.

**Category does not work** — it is a filing convention.

**Description similarity does not work either.** Measured against my own
hand-assigned categories:

| | n | p05 | p50 | p95 |
|---|---|---|---|---|
| same category | 27 | 0.0558 | 0.1898 | 0.6112 |
| different category | 204 | 0.0056 | 0.0865 | 0.1822 |

Best F1 across the whole sweep: **0.565**. The distributions overlap far worse
than the gap clustering did. `sunrise-sunset` and `postal-code-lookup` are both
filed "geo" and share nothing; `air-quality` and `weather-forecast` are close
neighbours filed apart.

So neither what a tool claims nor how it is filed says who competes. What does is
**which tools come back in the same search** — behavioural, recorded rather than
declared, and immune to the obvious dodge of writing an unusual description to
land in a cluster of one and never decay.

---

## Decay is relative, and that was the right correction

The original plan was an absolute half-life on time since last use. It is wrong
twice for a registry of small tools: a tool used heavily every April looks
identical to one nobody wants, and a niche serving three calls a month loses
every tool in it including the only one that does the job.

Decay's actual purpose is *"a rushed fix fades and frees the slot for something
better"* — and the slot is within a job, so the question is comparative.

Proven on live data before the fix below:

```
air-quality    share 1.0   standing 1.0   half-life 90d
air-by-place   share 0.0   standing 0.1   half-life  9d
```

Same cluster, tenfold difference in fade rate, decided by which one people
actually use.

Consequences that fall out for free:

- A cluster that goes quiet **together** puts nobody behind. Seasonality solved.
- A tool with **no known rivals sits at par**. Not knowing who competes is not
  evidence that somebody is losing.
- Every call **ages individually**, so one fresh call adds exactly one call
  rather than resurrecting a dead tool.

---

## Five defects, all found by looking rather than reasoning

### 1. The competition graph could be built by one person — mine

I created the first competition cluster with **nine searches from a single
caller**. That is not a quirk, it is an attack: craft queries that return a rival
beside a tool that dominates, repeat, and the rival's half-life drops tenfold.
Search traffic is free, so it costs nothing.

Found by asking *why* the cluster had appeared instead of being pleased that it
had. Edges now need distinct verified callers; the same nine searches now build
**zero** clusters.

### 2. Self-calls were excluded from mass but not from brightness

`self_call` was stamped only on the success path. So an owner's successful calls
to their own tool were correctly excluded from mass, while their **failures still
counted against quality** — an owner's own tool showed brightness 0 with every
success excluded and only failures surviving. The flag is now written on every
event from the moment the tool row resolves.

### 3. The simulation quarantine covered gaps and not scores

`tools.json` is a public claim about what people use, and a number inflated by a
test harness is the same lie as a manufactured gap. It now covers both.

### 4. My own CLI could sell a promotion

`stasis --stage star` on a planet would have sold a *promotion* rather than a
*hold*, with the rule living in whoever was at the keyboard. The stage is now
read from `tools.json` and anything higher is refused.

### 5. Two of my test assertions were wrong, not the code

A decay test asserted a total under 5 and failed at 10.19 — 200 calls at 400 days
legitimately retain 9.2 effective calls. And a bounty test expected a
`manufactured` flag that correctly did not fire, because the distinct-owner rule
had already refused the claim before beneficiary exclusion was reached.

Both were replaced with the property that actually mattered. The pattern across
three phases now: **a green tick whose reason was never read is worth nothing**,
and so is a red one.

---

## What money can and cannot touch

Phase 2 is the first phase that sells something adjacent to visibility, so the
invariant stopped being a sentence and became a structure.

**Two files, two audiences.** `tools.json` is what agents consume and contains no
paid field. `world.json` is what the 3D world renders and carries stasis. A flag
on the existing row would have worked and relied on everyone downstream
remembering not to read it.

The paid state lives in an S3 object nothing on the agent path touches.
Everything that computes a ranking reads DynamoDB; stasis is not in any table a
ranking is computed from. Verified live:

| | |
|---|---|
| `tools.json`, `gaps.json`, `world.json` | 200 |
| `stasis.json`, `audit.json`, `sim-gaps.json` | **403** |

And `assertNoPaidInputs` runs over every scored row on every nightly pass, now
refusing `stasis` alongside `credits` and `sponsored`.

**The rule the design turns on:** an archived tool with stasis is *still
archived*. It keeps a star in the sky and stays out of every result an agent sees.

---

## The audit surfaces, it does not block

Every pattern it reports has an innocent explanation and a guilty one, and no
amount of arithmetic tells them apart. A new creator whose only users are friends
looks exactly like a creator with sock puppets — and the first honest person
through the door is the one this project does not have yet.

First run, on real data: **21 flags.** One tool whose mass rests on a single
caller (correct — that is me), and twenty tools whose ownership was never
verified (the Phase 1 defect, still visible and still unrepairable without
rewriting immutable rows).

It writes to a private object. It names callers and owners and says which look
like puppets, which is an accusation a machine is not entitled to make in public.

---

## Bounties: three rules, and the limit

1. **The closer's own demand does not count toward their bounty.** Removes the
   payoff rather than detecting intent, because intent is not observable.
2. **Closure is judged per query by the adjudicator, not by a threshold.** This
   closes the item filed in `deferred-corrections.md`: a bounty paid on a moving
   number could be earned on Monday and not on Wednesday with nothing about the
   tool having changed.
3. **It waits for independent use.** Publishing is not closing. A claim that has
   closed but is unused reports as *pending*, not refused — the distinction
   matters to whoever is looking at a claim that will probably pay next month.

The limit is rule 1 meeting the Sybil question above, and it is pinned as a test.

---

## Against the gate

The gate written in the Phase 2 deck, answered honestly.

| Must hold | |
|---|---|
| Every parameter has a derivation or is marked provisional | **Yes** — four are marked guesses |
| Dependency weight cannot be self-awarded | **Yes** — tested, and demonstrated live |
| A paid field cannot reach a score | **Yes** — enforced every run, not asserted |
| Decay does not archive something still in use | **Yes** by construction; not observed over real time |
| An archived tool still resolves for dependents | **Yes** — archival hides from discovery, never deletes |

Five of five, and the sixth row the deck wrote for itself still stands: none of
this demonstrates that a stranger would trust the ranking, because there is still
no stranger.

---

## Carried forward

- **Decide what a caller costs.** It now gates paying a bounty, not just opening
  registration. Everything above degrades to "one determined person" without it.
- **Derive the four guesses.** The simulation in `sim/` is the instrument and
  already did this once, turning a clustering guess of 0.5 into a measured 0.35
  — and, more usefully, establishing that no perfect threshold exists.
- **Ranking is still not wired to any of this.** Search ranks purely on
  retrieval. Feeding mass or brightness into it changes what Phase 0 measured, so
  it needs a re-run of the eval harness rather than a code change.
- **Owner identity has no canonical form.** The audit surfaces near-duplicates
  and explicitly does not catch `erics` / `ericsonasamoah3`, which is the actual
  case that bit. Owners as entities with ids is the real fix.
- **Nobody else has used any of this**, three phases running.
