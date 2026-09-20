"""Builds docs/plans/endless-phase-3.pptx.

Generated rather than hand-edited, for the reason the Phase 0 deck learned the
hard way: an edit script that selects shapes by shape matched the wrong table
once and silently overwrote a runbook column.

    python docs/plans/build-phase-3-deck.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deckkit import (  # noqa: E402
    deck, slide, text, heading, callout, table, legend_card, title_slide, numbered, verify,
    INK, ORANGE, BODY, DIM, DONE_BG, DONE_TX, WARN_BG, WARN_TX,
)

OUT = Path(__file__).resolve().parent / "endless-phase-3.pptx"
prs = deck()

# ---------------------------------------------------------------- 1. title
title_slide(
    prs, "ENDLESS", "Phase 3 — Agents building tools",
    "When enough people ask for something nobody built, the system writes it. It does not\n"
    "get to decide its own code is safe to run.",
    "Done when a recurring gap is closed by a tool no human wrote, and the closure test confirms it.",
    ["lambda", "bedrock", "dynamodb", "s3", "cloudfront", "iam"],
)

# ---------------------------------------------------------------- 2. about
s = slide(prs)
heading(s, "ABOUT THIS PHASE", "What Phase 3 is for")
text(s, 0.85, 2.0, 5.6, 3.5,
     "Phase 0 measured the loop. Phase 1 made it real. Phase 2\n"
     "made the ranking defensible.\n\n"
     "All three end the same way: a need is recorded, and then\n"
     "somebody has to build the thing.\n\n"
     "Phase 3 is the system doing it — reading a need that\n"
     "several unrelated people recorded, and writing the tool\n"
     "that answers it.", 15, BODY, spacing=1.3)
callout(s, 6.7, 2.0, 5.75, 1.5,
        "The registry stops being a catalogue of what\nsomeone happened to build.", size=14)
text(s, 6.95, 3.75, 5.3, 2.6,
     "That is the whole idea behind Endless: a failed search is\n"
     "evidence of an unsolved need. Until now the evidence had\n"
     "nowhere to go except a board somebody might read.\n\n"
     "This phase closes the loop — demand recorded, demand\n"
     "answered — without waiting for the right person to\n"
     "notice the right entry.", 14, BODY, spacing=1.3)

# ---------------------------------------------------------------- 3. starting point
s = slide(prs)
heading(s, "STARTING POINT", "What Phase 2 leaves behind")
table(s, 0.85, 2.0, 11.5, [
    ["", "State at the end of Phase 2"],
    ["Needs", "Clustered by meaning, counted by distinct callers, published with their evidence"],
    ["Execution", "Sandboxed and gated. Unreviewed code does not run, at any depth"],
    ["Composition", "A tool may declare a dependency on another; the platform resolves it"],
    ["Scoring", "Mass, brightness and dependency weight, computed apart and never blended"],
    ["Decay", "Relative to the tools a search returns alongside it, with an archival floor"],
    ["Money", "Publishing costs credits. Stasis buys visibility in the world and nothing else"],
    ["Users", "None. Still nobody outside the operator"],
], widths=[1.9, 9.6])
callout(s, 0.85, 4.95, 11.5, 1.05,
        "Everything a builder needs already exists: a recorded need, a sandbox that holds, a review gate,\n"
        "and a closure test written for bounties that works unchanged here.", size=13.5)
text(s, 0.85, 6.2, 11.5, 0.8,
     "Phase 3 adds one component and one decision. The component is the builder. The decision is what it\n"
     "is allowed to do on its own, which turns out to be the whole phase.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 4. scope
s = slide(prs)
heading(s, "SCOPE", "What Phase 3 adds, and what it does not")
table(s, 0.85, 1.95, 11.5, [
    ["Adds", "Leaves alone"],
    ["A builder that writes a tool from a confirmed need", "The sandbox. Generated code runs where all code runs"],
    ["A duplicate check that runs before generation", "The review gate. Generated tools are not exempt"],
    ["A tighter package envelope for generated code", "Retrieval, clustering and the gap adjudicator"],
    ["A smoke test: the tool runs before anyone reads it", "Scoring. A provisional tool is scored like any other"],
    ["Provisional status, set by the platform not the publisher", "Decay, which applies to generated tools in full"],
    ["Judge independence for the closure test", "Bounties, whose closure test this reuses unchanged"],
], widths=[5.75, 5.75])
callout(s, 0.85, 4.4, 11.5, 0.95,
        "No new AWS service. The builder is one more Bedrock model behind one more CLI, and everything it\n"
        "produces goes through the path a person's tool already goes through.", size=13.5)
text(s, 0.85, 5.6, 11.5, 1.4,
     "That is deliberate and it is the cheapest safety property in the phase. A separate publishing path for\n"
     "generated tools would be a second place for the review gate to be forgotten, a second envelope to keep\n"
     "in step, and a second thing to audit. There is one path, and generated code is held to it plus more.",
     12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 5. architecture
s = slide(prs)
heading(s, "ARCHITECTURE", "What runs, and in what order")
table(s, 0.85, 1.95, 11.5, [
    ["Step", "Component", "What it does"],
    ["1", "build-tool CLI", "Reads a confirmed need from the gaps board"],
    ["2", "search-fn + Nova Micro", "Asks whether anything already answers it — the duplicate check"],
    ["3", "Bedrock · Nova Pro", "Writes the manifest and the handler from the cluster's phrasings"],
    ["4", "builder.mjs", "The envelope: size, runtime, https, request count"],
    ["5", "fetcher-fn + runtime-fn", "Runs it once, for real, against its own sample"],
    ["6", "registry-fn", "Registers it provisional, from the caller's role"],
    ["7", "review.mjs", "A person reads it. Nothing executes before this"],
    ["8", "closure test", "Do the originating queries now resolve, judged blind"],
], widths=[0.8, 3.0, 7.7])
callout(s, 0.85, 4.9, 11.5, 1.0,
        "Steps 2 and 5 are the ones that were not in the original plan. Both were added after a generated tool\n"
        "passed every other check and did not work.", bg=WARN_BG, tx=WARN_TX, size=13.5)
text(s, 0.85, 6.15, 11.5, 0.85,
     "The builder holds its own caller key, with role=builder. It can publish and it cannot approve — the same\n"
     "separation every other component has, applied to the one component that writes code.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 6. board layout
s = slide(prs)
heading(s, "THE BOARD", "Where the Phase 3 frame sits")
text(s, 0.85, 1.95, 11.4, 0.4, "miro.com/app/board/uXjVHpGFCos=", 15, ORANGE, bold=True)
table(s, 0.85, 2.5, 11.5, [
    ["Frame", "Size", "What it shows"],
    ["Phase 0 Architecture", "2000 x 1350", "As built and measured. Registry, search, gap logging"],
    ["Phase 1 Architecture", "2400 x 1480", "The phantom layer. Sandbox, identity, clustering, the board"],
    ["Phase 2 Architecture", "2400 x 1520", "Dependencies, the four score components, decay and the floor"],
    ["Phase 3 Architecture", "2400 x 1500", "The builder, the checks it must pass, and where it stops"],
], widths=[3.0, 1.8, 6.7])
text(s, 0.85, 4.35, 11.5, 2.5,
     "Four frames stacked top to bottom on one canvas, a section-gap apart, all the same width so a component\n"
     "that did not change sits directly above its later self. Zooming out shows the whole system and how it\n"
     "grew, which is the thing a static diagram in a deck cannot do.\n\n"
     "The Phase 3 frame reads left to right as a pipeline rather than as layers, because that is what it is:\n"
     "one need entering on the left, and either a tool for review or a discard on the right. The two red gates\n"
     "in the middle are where most attempts stop.", 13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 7. board legend
s = slide(prs)
heading(s, "THE BOARD", "Reading the Phase 3 frame")
text(s, 0.85, 1.95, 6.5, 4.4,
     "Icons are real AWS assets, from AWS Labs' own icon set rather\n"
     "than an approximation.\n\n"
     "Dashed rectangles are stages in the pipeline, not layers of a\n"
     "stack. A need moves left to right and can stop at any of them.\n\n"
     "Colour carries the same meaning as the earlier frames. Green is\n"
     "new in this phase, amber already existed, red is a gate that\n"
     "discards, blue is stored state, purple is public.\n\n"
     "Red appears twice, which is the shape of the phase: most\n"
     "generated tools do not reach a reviewer, and both gates that\n"
     "stop them were added after something got through.", 13, BODY, spacing=1.3)

legend_card(s, 7.75, 2.0, 4.6, "bedrock", "Nova Pro", "NEW — writes the manifest and handler", "new")
legend_card(s, 7.75, 2.92, 4.6, "lambda", "search-fn", "the duplicate check, unchanged", "existing")
legend_card(s, 7.75, 3.84, 4.6, "fargate", "runtime-fn", "runs it once before anyone reads it", "sandbox")
legend_card(s, 7.75, 4.76, 4.6, "dynamodb", "tools · approvals", "provisional, and still unapproved", "data")
legend_card(s, 7.75, 5.68, 4.6, "cloudfront", "gaps board", "where the need came from", "public")
text(s, 7.75, 6.65, 4.6, 0.3, "The card convention used on the board", 11, DIM)

# ---------------------------------------------------------------- 8. the decision
s = slide(prs)
heading(s, "THE DECISION", "A generated tool still needs approval")
text(s, 0.85, 2.0, 11.5, 1.0,
     "The argument for exempting it is good. The sandbox is proven — 22 live escape attacks, no route, no\n"
     "useful credentials, no reachable filesystem — so generated code can do no more damage than a person's.",
     15, BODY, spacing=1.3)
table(s, 0.85, 3.2, 11.5, [
    ["Why not", ""],
    ["CLAUDE.md", "Nothing runs \"because it came from a verified source\". This is the least verified source there has been"],
    ["The builder is the platform", "A platform that approves its own output has a gate protecting against everyone except itself"],
    ["The shape is familiar", "Confused deputy. Already refused twice, in exec-fn and in mcp-fn"],
    ["The Done-when still holds", "A human approving is not a human writing"],
], widths=[3.0, 8.5])
callout(s, 0.85, 5.0, 11.5, 1.0,
        "Full autonomy needs an independent judge of code. Asking the same platform twice is not independence,\n"
        "and there is no second party here to be one.", size=13.5)
text(s, 0.85, 6.25, 11.5, 0.8,
     "So the loop closes with a person in it, once, at the point where untrusted code becomes running code.\n"
     "Everything before and after that point is automatic.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 9. the sequence
s = slide(prs)
heading(s, "THE SEQUENCE", "PROJECT.md's five steps, and why each one is there")
rows = [
    ("1", "Search the registry first", "Near-duplicate generation is the most likely failure and it inflates the world\nwithout adding to it. Asked of the adjudicator, not of a similarity score."),
    ("2", "Build against the cluster", "Never one query. A tool built to satisfy one phrasing satisfies one phrasing."),
    ("3", "Publish as provisional", "Visibly auto-generated, and marked by the platform from the caller's role so\nneither a builder nor a person can claim to be the other."),
    ("4", "Run the closure test", "A gap does not close because something was published. It closes because the\nneed is met, judged per query by a judge that cannot tell what wrote it."),
    ("5", "Apply full decay", "A rushed fix fades and frees the slot. Generated tools decay like any other."),
]
y = 2.05
for num, title_, body_ in rows:
    numbered(s, y, num, title_, body_)
    y += 1.0
callout(s, 0.85, 7.0, 11.5, 0.4, "Steps 1, 2, 3 and 5 are built. Step 4 is the rest of the phase.", size=12.5)

# ---------------------------------------------------------------- 10. what a tool is
s = slide(prs)
heading(s, "WHY A MACHINE CAN WRITE ONE", "A tool here is three small things")
table(s, 0.85, 1.95, 11.5, [
    ["", "What it is", "Who checks it"],
    ["A description", "So search can find it", "Embedded and adjudicated like any other"],
    ["A declared endpoint", "The platform fetches it; the tool never opens a connection", "The allowlist, and a person — see below"],
    ["A transform", "A few lines that reshape the response", "The source screen, the sandbox, and review"],
], widths=[2.3, 5.4, 3.8])
callout(s, 0.85, 3.6, 11.5, 1.1,
        "The endpoint is the only part a model can lie about convincingly. The code is short enough to read and\n"
        "the description is checkable — but \"this host is a real, free, keyless API\" is an assertion.",
        bg=WARN_BG, tx=WARN_TX, size=13.5)
text(s, 0.85, 5.0, 11.5, 2.0,
     "Which is why a host the registry has never approved is surfaced to the reviewer by name rather than\n"
     "buried in a manifest, and why the smoke test exists at all.\n\n"
     "It is also why generated tools are viable in the first place. A tool that had to open its own connections\n"
     "would be a program, and reviewing a program somebody else's machine wrote is a different and much\n"
     "harder job than reading twenty lines that reshape a JSON response.", 13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 11. the finding
s = slide(prs)
heading(s, "THE FINDING", "Plausible and wrong, three times")
text(s, 0.85, 2.0, 11.5, 0.75,
     "The expected failure was duplication. It was not. The builder's real failure mode is producing something\n"
     "that looks entirely correct and does not work.", 15, BODY, spacing=1.3)
table(s, 0.85, 3.0, 11.5, [
    ["Round", "What it produced", "What caught it"],
    ["1", "Declared a web app's HTML homepage as an API; handler grepped the markup for \"Response Time\"", "A person, after the novel-host flag"],
    ["2", "Declared a host that answered, and transformed the answer into {}", "The new smoke test"],
    ["3", "response.includes is not a function", "The new smoke test"],
], widths=[0.9, 7.4, 3.2])
callout(s, 0.85, 4.75, 11.5, 1.1,
        "Round one passed the duplicate check and the entire safety envelope. Every automated check said yes.\n"
        "The only reason anyone looked was a flag saying \"this uses a host we have never approved\".",
        bg=WARN_BG, tx=WARN_TX, size=13.5)
text(s, 0.85, 6.1, 11.5, 0.9,
     "So the package is now run once, through the real fetcher and the real sandbox, against its own sample,\n"
     "before a reviewer is asked for a minute of attention. Rounds two and three cost seconds each.",
     12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 12. what it gets right
s = slide(prs)
heading(s, "AND WHAT IT GETS RIGHT", "One working tool, and one honest refusal")
text(s, 0.85, 2.0, 5.6, 0.4, "Given a need with a real API behind it:", 14, INK, bold=True)
callout(s, 0.85, 2.5, 5.6, 2.6,
        "pokemon-info-lookup\n\n268 bytes against pokeapi.co.\nSearched first, found nothing,\nwrote it, ran it, returned\npikachu's type and base stats\non the first attempt.",
        bg=DONE_BG, tx=DONE_TX, size=13)
text(s, 6.85, 2.0, 5.5, 0.4, "Asked for the space station:", 14, INK, bold=True)
callout(s, 6.85, 2.5, 5.5, 2.6,
        "It named open-notify.org.\n\nThat is the correct API. It is\nHTTP-only, and the fetcher\nrequires HTTPS.\n\nRefused three times out of three.",
        bg=WARN_BG, tx=WARN_TX, size=13)
text(s, 0.85, 5.4, 11.5, 1.6,
     "The second is worth as much as the first. A right answer the platform cannot accept is a constraint, not a\n"
     "builder failure, and the two look identical in a log — both are just a refusal.\n\n"
     "Knowing which one you are looking at is the difference between fixing the generator and fixing the rule.",
     13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 13. independence
s = slide(prs)
heading(s, "INDEPENDENCE", "The judge must not know what wrote the tool")
text(s, 0.85, 2.0, 11.5, 1.2,
     "docs/deferred-corrections.md filed this against Phase 3 before any of it was built: the adjudicator judging\n"
     "a tool the builder just generated is still the system marking its own homework, one level up.", 15, BODY, spacing=1.3)
table(s, 0.85, 3.4, 11.5, [
    ["The closure judge sees", "It never sees"],
    ["tool_id", "provisional"],
    ["name", "generated_by, generated_at, the model that wrote it"],
    ["description", "the cluster it was built for"],
], widths=[4.0, 7.5])
callout(s, 0.85, 5.1, 11.5, 1.0,
        "Stripped in code rather than trusted not to matter. A human tool and a generated tool produce a\n"
        "byte-identical view, and there is a test asserting exactly that.", size=13.5)
text(s, 0.85, 6.3, 11.5, 0.8,
     "It is not full independence — the same platform still supplies both the builder and the judge. It removes\n"
     "the one signal that could bias the judge in either direction, which is what was actually available.",
     12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 14. plan
s = slide(prs)
heading(s, "PLAN", "Six issues")
text(s, 0.85, 1.95, 11.4, 0.4, "Estimates for one developer. #1 to #4 are done.", 15, BODY)
table(s, 0.85, 2.45, 11.5, [
    ["#", "Issue", "Est.", "Depends on"],
    ["1", "Duplicate check before generation, asked of the adjudicator", "S", "— DONE"],
    ["2", "The builder: manifest and handler from a confirmed cluster", "L", "1 — DONE"],
    ["3", "Generated-package envelope, plus the smoke test", "M", "2 — DONE"],
    ["4", "Provisional publishing from the caller's role", "S", "2 — DONE"],
    ["5", "Closure test against the originating cluster, judged blind", "M", "4"],
    ["6", "Phase 3 findings, with what the builder gets wrong", "S", "all"],
], widths=[0.6, 7.3, 1.1, 2.5])
callout(s, 0.85, 4.85, 11.5, 1.35,
        "#5 is the Done-when. Everything before it proves a tool can be written; only #5 proves a need was met.\n"
        "A gap does not close because something was published — and the difference is the entire product.",
        size=13.5)
text(s, 0.85, 6.4, 11.5, 0.6,
     "#6 is the exit, as in every phase. The gate clears, or a written finding says why it does not.", 12.5, DIM)

# ---------------------------------------------------------------- 15. cost
s = slide(prs)
heading(s, "COST", "What generating a tool costs")
table(s, 0.85, 1.95, 11.5, [
    ["", "Per attempt", "Note"],
    ["Duplicate check", "3 to 5 searches", "About $0.000015 each — the Phase 1 measured figure"],
    ["Generation", "Nova Pro, ~600 in, ~500 out", "Estimated $0.002 from published rates and prompt size"],
    ["Smoke test", "1 fetcher + 1 runtime", "Rounding error; the sandbox is 4 ms p50"],
    ["Review", "A person's attention", "The expensive one, and the reason for the smoke test"],
], widths=[2.4, 3.4, 5.7])
callout(s, 0.85, 3.8, 11.5, 1.05,
        "A successful tool took four attempts, so roughly a cent in models. The smoke test pays for itself the\n"
        "first time it stops a reviewer reading something that was never going to work.", size=13.5)
text(s, 0.85, 5.1, 11.5, 1.9,
     "The generation figure is ESTIMATED, not measured. The Bedrock response carries a token count and the\n"
     "builder currently discards it — which is the same mistake Phase 1 corrected for search, where the honest\n"
     "number only appeared once the tokens were logged.\n\n"
     "Log it before quoting it. Everything else on this slide comes from measurements already taken.",
     13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 16. risks
s = slide(prs)
heading(s, "RISKS", "What could go wrong")
table(s, 0.85, 1.95, 11.5, [
    ["Risk", "Why it bites here"],
    ["Plausible and wrong", "Demonstrated three times out of four. The failure mode is confident, not obvious"],
    ["Review becomes a rubber stamp", "Volume is the enemy of attention, and a builder can generate faster than anyone reads"],
    ["Invented endpoints", "The one claim nothing but a person or a live call can check"],
    ["The closure test marks its own homework", "Same platform, builder and judge. Blinding reduces it and does not remove it"],
    ["Generated tools crowd the registry", "Decay applies, but a tool nobody calls still occupies a search result until it fades"],
    ["Still no users", "A need closed by a tool nobody asked for afterwards has not been demonstrated"],
], widths=[3.6, 7.9])
callout(s, 0.85, 4.35, 11.5, 1.1,
        "The second row is the one to watch. Every check added so far exists to protect a reviewer's attention,\n"
        "because attention is the scarce resource and the only thing standing between a plausible tool and a\n"
        "running one.", bg=WARN_BG, tx=WARN_TX, size=13.5)
text(s, 0.85, 5.75, 11.5, 1.2,
     "A rate limit on generation is the obvious answer and is not built. Neither is any measure of how often a\n"
     "reviewer approves something they should not have — which would need a stranger reviewing, and there is\n"
     "still no stranger.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 17. the gate
s = slide(prs)
heading(s, "THE GATE", "What would prove Phase 3")
text(s, 0.85, 2.0, 11.5, 0.6,
     "Written to avoid the Phase 0 failure, where both floors passed while a third of answerable queries were\n"
     "being logged as unmet needs, because the gate never asked about false gaps.", 14, BODY, spacing=1.3)
table(s, 0.85, 2.95, 11.5, [
    ["Must hold", "How it is checked"],
    ["A generated tool cannot execute unapproved", "Try it. The 403 is the same one any tool gets"],
    ["The duplicate check refuses a met need", "Give it a cluster an existing tool already answers"],
    ["The smoke test refuses a tool that does not work", "Demonstrated three times; keep the cases"],
    ["The closure judge cannot identify a generated tool", "Byte-identical judge view, asserted in a test"],
    ["The originating queries resolve afterwards", "The Done-when. Not yet demonstrated"],
], widths=[5.4, 6.1])
callout(s, 0.85, 4.95, 11.5, 1.0,
        "Four of five hold today. The fifth is the phase — and it is the only one that says anything about whether\n"
        "the need was actually met rather than whether the machinery behaved.", size=13.5)
text(s, 0.85, 6.2, 11.5, 0.8,
     "The gate clears, or a written finding says why it does not.", 12.5, DIM)

# ---------------------------------------------------------------- 18. start here
s = slide(prs)
heading(s, "START HERE", "The next four moves")
rows = [
    ("1", "Closure test (#5)", "The Done-when. Re-run the cluster's queries after publication and ask the\nblinded judge whether the need is met."),
    ("2", "Log the generation tokens", "The cost figure on this deck is estimated. Phase 1 found the honest number\nonly once the tokens were logged."),
    ("3", "A rate limit on generation", "A builder writes faster than anyone reads, and review is the scarce resource\nrather than compute."),
    ("4", "Decide what a caller costs", "Unchanged from Phase 1 and Phase 2, and now it also gates paying a bounty\nfor a tool the platform wrote."),
]
y = 2.05
for num, title_, body_ in rows:
    numbered(s, y, num, title_, body_)
    y += 1.15

callout(s, 0.85, 6.75, 11.5, 0.6,
        "Three phases built, everything working, and nobody outside this project has used any of it.", size=13)

prs.save(OUT)
problems = verify(OUT)
print(f"wrote {OUT.name} — {len(prs.slides._sldIdLst)} slides")
for p in problems:
    print(f"  LAYOUT: {p}")
if not problems:
    print("  no overflow, no overlap")
