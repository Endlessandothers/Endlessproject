# Evaluation set — issue #9

60 queries, written **before any tool was seeded**, and frozen.

```
sha256  6ff8f77cd01aff77418b657477adfe984ad4edd71c7384f1de212bbb41daabdf
n       60
frozen  2026-09-14
```

## Why the order matters

The obvious way to build an eval set is to seed twenty tools, then write queries
to test them. That produces queries phrased the way the descriptions were
phrased, recall looks excellent, and what you have measured is your own
vocabulary.

So the queries came first. They were written from the task side — what an agent
needs mid-task, in the words it would actually use — with no tool catalogue in
front of the author.

## The rules

1. **No labels yet.** Which tool should win for each query gets decided in issue
   #11, after the seed set exists. Labelling before seeding would smuggle the
   catalogue back in.
2. **No edits, ever.** Changing a query after watching it fail turns the harness
   into a mirror. `queries.sha256` covers the canonical `id + text` of every
   query, so any edit is detectable in review.
3. **Additions are a new version.** If the set needs to grow, bump `version`,
   append, and record a new checksum. Never rewrite v1.
4. **The unanswerable split is an outcome, not a target.** The deck says "about
   15 with no correct answer". Because these were frozen before seeding, how
   many turn out unanswerable falls where it falls. That is better — a target
   would tempt you to seed toward it — but it does mean the count is discovered
   in #11, not designed here.

## Verifying the freeze

```bash
python - <<'EOF'
import json, hashlib
qs = json.load(open('eval/queries.json', encoding='utf-8'))['queries']
canon = "\n".join(f"{q['id']}\t{q['text']}" for q in qs)
print(hashlib.sha256(canon.encode()).hexdigest())
EOF
```

Compare against `queries.sha256`. Metadata around the list can be edited freely;
the queries cannot.

## Known contamination

Three throwaway tools were registered during infrastructure verification, before
these queries were written: `weather-forecast`, `currency-convert`,
`wikipedia-summary`. The author had seen those three descriptions.

The queries were written without a catalogue in view, but that exposure cannot
be undone. **If any of those three end up in the final seed set, their results
are weaker evidence than the rest** and the findings write-up should say so.
Everything else seeded in #10 is unseen by the author of this file.

This is recorded rather than quietly ignored because the entire point of Phase 0
is deciding whether gap signal can be trusted. An eval set with an undisclosed
thumb on the scale would answer the wrong question.

## What happens next

| Issue | Does |
|---|---|
| #10 | Seed 15–20 tools wrapping public APIs, descriptions written for retrieval |
| #11 | Label these 60 against the seeded set, build the recall@k harness |
| #12 | Derive threshold `T` from the score distributions this produces |

Note for #11: measured on 2026-09-14, `amazon.titan-embed-text-v2:0` produces
cosine scores near zero, not the 0.4–0.8 typical of other embedding models. A
correct hit scored 0.0595 against 0.0464 for an unrelated tool. If that thin
separation holds across these 60, then cosine distance alone cannot separate a
gap from a miss — which is a finding, not a failure.
