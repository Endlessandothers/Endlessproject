"""Builds docs/plans/endless-summary.pptx — the whole project, so far and ahead.

Generated rather than hand-edited, for the same reason the phase decks are: an
edit script that selects shapes by shape matched the wrong table once and
silently overwrote a runbook column.

Built on deckkit, the same house style as the four phase decks, so this one
sits beside them rather than looking like it came from somewhere else.

    python docs/plans/build-summary-deck.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deckkit import (  # noqa: E402
    deck, slide, text, heading, callout, table, legend_card, title_slide, numbered, verify,
    INK, ORANGE, BODY, DIM, DONE_BG, DONE_TX, WARN_BG, WARN_TX,
)

OUT = Path(__file__).resolve().parent / "endless-summary.pptx"
prs = deck()

# ---------------------------------------------------------------- 1. title
title_slide(
    prs, "ENDLESS", "Where the project stands",
    "A registry of small tools that agents search, where every failed search is kept as evidence\n"
    "of a need nobody met. Four phases built and measured; the fifth arrived out of order.",
    "Phases 0–3 complete against their own gates · a working application · and one unanswered question.",
    ["lambda", "bedrock", "dynamodb", "s3", "cloudfront", "fargate", "iam"],
)

# ---------------------------------------------------------------- 2. the idea
s = slide(prs)
heading(s, "THE IDEA", "What the whole thing rests on")
text(s, 0.85, 2.0, 5.6, 3.6,
     "An agent asks the registry for something. If a tool does\n"
     "the job, it gets it and runs it.\n\n"
     "The interesting case is the other one. When nothing fits,\n"
     "that is written down — not discarded.\n\n"
     "Do that long enough and you have a list of things people\n"
     "actually wanted that did not exist, backed by evidence\n"
     "rather than by somebody's hunch.", 15, BODY, spacing=1.3)
callout(s, 6.7, 2.0, 5.75, 1.35,
        "A failed search is the only honest\nevidence of an unsolved need.", size=14)
text(s, 6.95, 3.6, 5.3, 2.8,
     "Everything else in this project follows from protecting\n"
     "that record. Why a builder's own searches are not counted.\n"
     "Why one person asking twelve times counts once. Why money\n"
     "may buy visibility and never rank.\n\n"
     "The gap log is the one artefact here that cannot be\n"
     "rebuilt from anything else.", 14, BODY, spacing=1.3)

# ---------------------------------------------------------------- 3. the phases at a glance
s = slide(prs)
heading(s, "WHERE THINGS STAND", "Nine phases, four of them behind us")
table(s, 0.85, 1.9, 11.5, [
    ["", "Phase", "State", "Gate"],
    ["0", "Validate the loop", "Complete", "Mechanism proved. Demand signal did not exist"],
    ["1", "Phantom layer MVP", "Complete", "Published, found, called. Repeated gaps surfaced"],
    ["2", "Gravity, trust, decay", "Complete", "Ranking defensible, with the sock-puppet hole named"],
    ["3", "Agents building tools", "Complete", "A recurring gap closed by a tool no human wrote"],
    ["6", "Visual layer", "Built early", "A cockpit, out of order and unplanned"],
    ["4", "Applications joining", "Not started", "Nobody else's application serves traffic here yet"],
    ["5", "Galaxies and routing", "Partly, sideways", "A router exists; galaxies do not"],
    ["7", "Black holes", "Not started", "Needs Phase 5"],
    ["8", "Monetization at scale", "Not started", "Rules written in Phase 2; no money moves"],
], widths=[0.55, 2.9, 1.95, 6.1])
callout(s, 0.85, 5.6, 11.5, 0.95,
        "The order broke, and that is worth noticing: the visual layer was built three phases early because it\n"
        "was wanted, while Phase 4 — the one that would bring in somebody else — has not been touched.", size=13)

# ---------------------------------------------------------------- 4. phase 0
s = slide(prs)
heading(s, "PHASE 0", "Validate the loop, and find the question was wrong")
text(s, 0.85, 1.95, 11.5, 0.5,
     "Asked one thing: is a logged gap real evidence of an unsolved need, or just a search failure?", 14, INK, bold=True)
numbered(s, 2.65, 1, "The mechanism works",
         "96.7% gap detection at 6.7% false positives, holding across two independently written query sets.")
numbered(s, 3.5, 2, "No demand signal existed",
         "Every gap ever logged came from the evaluation harness. Real usage was zero, so no logged gap\nwas evidence that anyone wanted anything.")
numbered(s, 4.6, 3, "Ranking is not deciding",
         "Recall@3 was 100% on both sets while 31.6% of answerable queries were logged as gaps. The\nscores are not on a stable scale, so a fixed threshold cannot survive a new set.")
numbered(s, 5.7, 4, "An LLM on the hot path",
         "An adjudicator reads the shortlist and answers yes or no. False gaps fell from 20% to 6.7%.")
callout(s, 0.85, 6.6, 11.5, 0.6,
        "Cost for the whole phase: under $5.", size=13)

# ---------------------------------------------------------------- 5. phase 1
s = slide(prs)
heading(s, "PHASE 1", "Phantom layer — make it real, then try to break it")
table(s, 0.85, 1.95, 11.5, [
    ["Built", "Proved"],
    ["Sandboxed execution in a VPC with no internet gateway", "22 live escape tests: a handler that fully escapes still reaches nothing"],
    ["Caller identity, so every event carries provenance", "Publishing costs credits; asking is free, so demand is never suppressed"],
    ["Gap clustering by meaning, not by wording", "12 rephrasings from one caller counted once; 4 callers over 9 days confirmed"],
    ["A review gate between publishing and executing", "Absence of an approval is a refusal, so a failed write fails safe"],
], widths=[5.3, 6.2])
callout(s, 0.85, 4.5, 11.5, 1.2,
        "Three things this project had claimed, which were not true, were found and written down:\n"
        "the runtime policy overstated the sandbox, the escape tests passed for the wrong reason,\n"
        "and the wash-trading guard silently never fired.", bg=WARN_BG, tx=WARN_TX, size=13)
text(s, 0.85, 5.95, 11.5, 1.0,
     "The corrections are the output. A phase that only reports what worked has not been checked, it has\n"
     "been narrated — and every one of these was found by looking at the system rather than reasoning\n"
     "about it.", 13, DIM, spacing=1.25)

# ---------------------------------------------------------------- 6. phase 2
s = slide(prs)
heading(s, "PHASE 2", "Gravity, trust, decay — and who would rely on it")
text(s, 0.85, 1.95, 5.6, 2.3,
     "Mass is use. Brightness is a Wilson lower bound over calls\n"
     "that worked. Dependency weight is being built upon.\n\n"
     "They are computed apart and never blended, so no single\n"
     "number can be gamed into meaning something else.", 14, BODY, spacing=1.3)
callout(s, 6.7, 1.95, 5.75, 2.3,
        "Decay is relative to the cluster a tool\ncompetes in, not absolute.\n\n"
        "A tool is judged against what its rivals\nare doing now, not against its own past.", size=13.5)
text(s, 0.85, 4.45, 11.5, 0.45, "Five defects, all found by looking rather than reasoning", 14, INK, bold=True)
table(s, 0.85, 5.0, 11.5, [
    ["The competition graph could be built by one person — mine", "Self-calls excluded from mass but not from brightness"],
    ["The simulation quarantine covered gaps and not scores", "My own CLI could sell a promotion"],
    ["Two of my test assertions were wrong, not the code", "Minting a caller still costs nothing — pinned as a failing test"],
], widths=[5.75, 5.75], header=False)
callout(s, 0.85, 6.3, 11.5, 0.75,
        "Money may buy a tool a brighter star in the world. It may never move it one place in a ranking.",
        bg=DONE_BG, tx=DONE_TX, size=13)

# ---------------------------------------------------------------- 7. phase 3
s = slide(prs)
heading(s, "PHASE 3", "Agents building tools — the loop closed end to end")
text(s, 0.85, 1.9, 11.5, 2.0,
     "4 unrelated callers, over 4 days, asked for the same thing four ways\n"
     "    →  nothing in the registry fitted\n"
     "    →  the builder searched first, found nothing, and wrote the tool\n"
     "    →  244 bytes, run on its own sample before anyone read it\n"
     "    →  published PROVISIONAL, charged a credit, unable to execute\n"
     "    →  a person read it and approved it\n"
     "    →  CLOSED: all 4 originating phrasings now resolve to it",
     13, BODY, spacing=1.35)
callout(s, 0.85, 4.1, 5.6, 1.5,
        "The builder inflates its own demand.\n\n"
        "33 of 36 gaps were the builder asking\n“does this already exist?”", bg=WARN_BG, tx=WARN_TX, size=13)
text(s, 6.7, 4.1, 5.75, 1.6,
     "A justification manufacturing itself — the one shape this\n"
     "project exists to prevent, arriving from the inside.\n\n"
     "Fixed by excluding builder searches from the gap log. That\n"
     "broke the duplicate check, which had been reading “a gap\n"
     "was logged” as “nothing fits”.", 13, BODY, spacing=1.25)
callout(s, 0.85, 5.85, 11.5, 0.8,
        "A side effect should never have been load-bearing. The verdict is now returned explicitly, and the\n"
        "check that reported recent-earthquakes could answer “what type is pikachu” was fixed with it.", size=13)

# ---------------------------------------------------------------- 8. what came after
s = slide(prs)
heading(s, "SINCE PHASE 3", "What was built that no phase asked for")
legend_card(s, 0.85, 1.95, 5.6, "bedrock", "The judge moved to Claude", "Both measured false matches fixed", "new")
legend_card(s, 6.7, 1.95, 5.75, "fargate", "A page people can use", "Fargate, the first thing outside the free tier", "new")
legend_card(s, 0.85, 2.95, 5.6, "lambda", "Answers, not tools", "A question goes in; prose comes back", "new")
legend_card(s, 6.7, 2.95, 5.75, "cloudfront", "A cockpit in real 3D", "Phase 6, arriving three phases early", "new")
text(s, 0.85, 4.15, 11.5, 2.2,
     "The model became the centre and the tools became what it reaches for. Most questions need no tool at\n"
     "all, so the router answers from knowledge first, a registry tool second, the open web third, and records\n"
     "an unmet need only when none of those will do.\n\n"
     "That change nearly destroyed the thing the project is for: once a model can search the web, almost\n"
     "nothing looks like an unmet need, and the gap log would have gone quietly empty while everything\n"
     "appeared to work better than ever.", 13.5, BODY, spacing=1.3)
callout(s, 0.85, 6.35, 11.5, 0.9,
        "So a web search is itself recorded as demand. Going to the open internet is what a missing tool\n"
        "looks like — and the log already holds the same question twice, before and after the change.", size=13)

# ---------------------------------------------------------------- 9. what exists now
s = slide(prs)
heading(s, "WHAT EXISTS", "The running system, today")
table(s, 0.85, 1.9, 11.5, [
    ["", "State"],
    ["Infrastructure", "115 Terraform resources, 10 Lambdas, 5 tables, one Fargate task. Rebuilt from empty twice"],
    ["Registry", "23 tools. 4 with executable code behind them; the rest are descriptions"],
    ["Routing", "Claude decides: answer, call a tool, search the web, or record a need. Multi-tool in parallel"],
    ["Interfaces", "MCP for agents, a CLI for the operator, a plain page and a 3D cockpit for people"],
    ["Evidence", "11 gaps, across four distinct reasons. The newest kind: answered off the open web"],
    ["Tests", "205, with a live sandbox escape gate that runs against the deployed system"],
    ["Cost", "$0.00 this month. Everything inside the free tier except a Fargate task at roughly $9"],
], widths=[2.1, 9.4])
callout(s, 0.85, 4.95, 11.5, 1.0,
        "Still nobody outside the operator. That has been true since Phase 0 and is the single fact that\n"
        "most limits what any of these numbers mean.", bg=WARN_BG, tx=WARN_TX, size=13)
text(s, 0.85, 6.2, 11.5, 0.8,
     "Every measurement in this deck was taken against a system with one user. The mechanisms are\n"
     "proved; the demand they are built to detect has not arrived.", 13, DIM, spacing=1.25)

# ---------------------------------------------------------------- 10. the honest gate
s = slide(prs)
heading(s, "AGAINST THE GATES", "What each phase promised, and whether it delivered")
table(s, 0.85, 1.95, 11.5, [
    ["Phase", "Done when", "Verdict"],
    ["0", "The gate clears, or a finding says why not", "Split. Mechanism yes, demand no — written down"],
    ["1", "A creator publishes, an agent calls, gaps surface", "Yes, with the creator and agent both being me"],
    ["2", "You'd let a stranger trust the ranking unsupervised", "Yes, except a stranger can still mint free identities"],
    ["3", "A recurring gap closed by a tool no human wrote", "Yes. Demand simulated and quarantined; nothing else was"],
], widths=[0.8, 5.0, 5.7])
callout(s, 0.85, 3.9, 11.5, 1.4,
        "Every gate was cleared with simulated demand, by one person, against a system nobody else uses.\n\n"
        "That is not a failure of the phases. It is the thing the next phase has to change.",
        bg=WARN_BG, tx=WARN_TX, size=13.5)
text(s, 0.85, 5.6, 11.5, 1.3,
     "The project has been unusually willing to write down what did not work — four findings documents\n"
     "record corrections to its own earlier claims. That discipline is why the gates above can be read at\n"
     "face value, and why the one unresolved item below has not been quietly dropped.", 13, DIM, spacing=1.3)

# ---------------------------------------------------------------- 11. what is next
s = slide(prs)
heading(s, "WHAT IS NEXT", "Three directions, and they are not equal")
numbered(s, 2.0, 1, "Phase 4 — somebody else",
         "An application Endless did not build, serving traffic inside it. The only phase that produces real\ndemand rather than simulating it, and the one that has not been started.")
numbered(s, 3.2, 2, "Tool development from repos",
         "Mine codebases for jobs worth extracting. The newest direction, raised after the open web turned\nout to answer most questions — which made finding tools more interesting than finding answers.")
numbered(s, 4.4, 3, "Phase 5 — routing",
         "Cluster tools, route fuzzy requests without hitting the central model every time. The prerequisite\nfor Phase 7, and the thing that makes the cost curve survive traffic.")
callout(s, 0.85, 5.6, 11.5, 1.25,
        "The repo direction carries the project's own warning on it. Extracting tools from codebases is SUPPLY,\n"
        "not demand — the same shape as the builder inflating its own gaps. The signal is not that a repo\n"
        "contains a tidy function; it is that two unrelated codebases needed the same job.", size=13)

# ---------------------------------------------------------------- 12. the open question
s = slide(prs)
heading(s, "THE OPEN QUESTION", "What counts as a tool")
text(s, 0.85, 2.0, 5.6, 2.6,
     "Shape does not define a tool. You can read a clean\n"
     "function all day and never learn whether anyone else\n"
     "needs it.\n\n"
     "Multiplicity defines it. A tool is a job that appears in\n"
     "more than one place, built by people who were not\n"
     "talking to each other.", 15, BODY, spacing=1.3)
callout(s, 6.7, 2.0, 5.75, 2.6,
        "Two projects. Same job. Built twice,\nby the same person, who had\nforgotten the first time.\n\n"
        "IDFinder has geocode(). Endless has\ngeocode-address. Nobody produced\nthat evidence on purpose.", size=13.5)
text(s, 0.85, 4.95, 11.5, 1.5,
     "Which gives the measurement a shape the project already has: embed the jobs, cluster them, count\n"
     "distinct sources, confirm at two or more. The same machinery that turns failed searches into\n"
     "confirmed needs, pointed at codebases instead of queries.", 14, BODY, spacing=1.3)
callout(s, 0.85, 6.3, 11.5, 0.8,
        "And the stronger half may be the problems, not the solutions. A comment saying a provider's free tier\n"
        "runs out in three months is unmanufactured demand with a date on it, sitting where nothing counts it.",
        bg=DONE_BG, tx=DONE_TX, size=13)

prs.save(OUT)
problems = verify(OUT)
print(f"wrote {OUT.name} - {len(prs.slides._sldIdLst)} slides")
for p in problems:
    print(f"  LAYOUT: {p}")
if not problems:
    print("  no overflow, no overlap")
