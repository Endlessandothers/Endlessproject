# Gap clustering and demand integrity

**Decided:** 2026-09-19
**Applies from:** Phase 1, issues #8 (clustering) and #9 (distinct-caller threshold)
**Status:** binding on the clustering build. Nothing here is implemented yet.

A gap is only evidence if the demand behind it is real. Clustering is where that
is decided, because clustering is what turns individual logged queries into the
number a builder, a bounty or a creator acts on.

The attack this exists to defeat: **ask the same thing many ways until it looks
like a market, then build the tool and collect on it.** It needs no exploit. It
is the system working exactly as designed, driven by a caller who wants a
particular gap to look hot.

## Why sign-in pages and cookies do not apply

Callers here are **agents, not browsers**. There is no cookie jar, no session, no
login form — an agent calls an API from a server. Every browser-shaped control is
unenforceable at this layer, and a cookie is in any case cleared with one line.

The instinct behind them is right, though: friction has to exist at identity. It
belongs at **key issuance**, not at query time — the moment someone becomes a
caller, not the moment they ask something. That is the sign-in page, moved to
where it can actually be enforced.

## The counting rule

**One caller, one vote per cluster.** A caller who asks the same thing five
hundred times, phrased five hundred ways, contributes exactly once.

This is why clusters are formed by **meaning**, not by string equality. Matching
on text makes the countermeasure trivial — rephrase. Cluster semantically, then
deduplicate by verified `caller_id` inside the cluster.

So the headline number on a gap is **distinct verified callers**, never
occurrences. Occurrences stay on the record because they are useful for reading
intensity, but they are not what any decision is taken on.

## Three corroborating signals

Distinct-caller counting alone is defeated by anyone who can mint callers freely.
These make that materially harder, and all three are computable from what the
event and gap rows already hold.

| Signal | Reads as real | Reads as manufactured |
|---|---|---|
| **Time spread** | ten callers over ten days | ten callers in ten minutes |
| **Caller age** | callers active for months | callers created after the cluster |
| **Caller breadth** | callers that ask about many things | callers that only ever ask about this one |

None is a verdict on its own. A legitimate burst happens — an outage, a news
event, a popular framework release. They are inputs to a score and to review,
not automatic rejection, and a cluster that trips all three is worth a human look
before it is worth a bounty.

## Beneficiary exclusion

The sharpest control, and the one that does not require detecting intent:

> **When a tool closes a cluster, the closer's own contributions are discounted
> from the evidence that justified it.**

If a creator's callers supplied eight of the twelve votes behind a gap, and that
creator then publishes the tool and claims the bounty, those eight do not count.
The bounty is assessed on the remaining four.

This is the demand-side twin of the rule already in `auth.mjs`: a call by a
tool's own owner is not usage, so it never counts toward mass. Same shape, other
direction. Both work by **removing the payoff** rather than by identifying a bad
actor, which matters because intent is not observable and ownership can change.

Exclusion is by `owner`, not by `caller_id` — one person holding ten keys is the
case this is for.

## The limit, stated honestly

This is a **Sybil problem**, and none of the above solves it outright. Counting
distinct callers counts nothing if callers are free to create. Everything here
rests on the cost of becoming a caller.

That friction is a Phase 1 decision that has not been taken yet — verified email
or domain, a payment method on file, rate-limited issuance, or the publication
stake. It is where the "adding a tool costs money" instinct genuinely applies:
the cost sits on **becoming able to supply and to benefit**, not on asking.

The goal is not prevention. It is making the cost of faking demand exceed the
payoff, and keeping enough provenance that faking is visible afterwards.

## Data prerequisite — satisfied 2026-09-19

Clustering needs verified identity on every row, because clustering on a claimed
identity counts whatever a caller types in a JSON field.

Issue #1 landed and every gap and event row now carries:

- `caller_id` — proved against the stored key hash, not claimed
- `owner` — the accountable party, for beneficiary exclusion
- `caller_created_at` — copied onto the row, for the caller-age signal
- `actor_verified: true` — explicitly

`actor` survives alongside them as the caller's own sub-identity: which of its
agents and which session asked. It is still useful and still unverified, and no
count is ever taken from it.

**Do not backfill.** Rows written before 2026-09-19 carry `actor_verified: false`
or no caller at all. They stay that way and stay outside distinct-caller counts.
A number that silently mixes verified and claimed callers is worse than a smaller
number that does not.

## Still open — and it is the load-bearing one

Nothing above works if callers are free to create. Minting is currently an
operator action (`cli/mint-caller.mjs`) with no cost attached, which is fine while
the operator is the only caller and is **not** fine the moment anyone can sign up.

Deciding what makes a caller costly — verified email or domain, a payment method
on file, rate-limited issuance, or a stake — is a prerequisite for opening
registration, not for building the clustering. Build the counting; do not open
the door until the cost is decided.

## Deliberately not doing

- **Blocking repeated queries.** A caller asking the same thing twice is usually
  a retry, and refusing it breaks legitimate agents to prevent something that
  deduplication already handles at counting time. Screen at the count, not at
  the door.
- **Rate-limiting as an integrity control.** Rate limits exist for cost, and are
  tracked with the other DDoS work. They slow manufacturing slightly and prevent
  none of it — patience defeats a rate limit.
- **Scoring manufactured-ness with a model.** Not until the three signals above
  have been measured against real traffic. There is no training data yet, and a
  model here would be guessing with more steps.
