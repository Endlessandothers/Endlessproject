// cluster-fn — the nightly batch. Issues #8, #9 and #10.
//
// Two jobs that share a scan and a schedule:
//
//   gaps.json   needs nobody could meet, grouped by meaning, counted by
//               distinct verified callers
//   tools.json  mass: how much each tool is actually used, recomputed from
//               the append-only event log rather than accumulated anywhere
//
// WHY A SNAPSHOT RATHER THAN A TABLE. The board is a read-mostly public page
// and a snapshot is a single object behind CloudFront: no read capacity, no
// per-visitor cost, and the free-tier DynamoDB budget is already at 23 of 25.
// It also means the board cannot be made slow, or expensive, by traffic — which
// matters, because the board is the part with a reason to be attacked.
//
// The counting rules are in cluster.mjs and are tested without AWS. This file
// is plumbing: read, apply, write.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { unpackVector } from "./vector.mjs";
import { cluster, summarise, assess, RULE, DEFAULT_SIMILARITY } from "./cluster.mjs";
import { scoreTools, assertNoPaidInputs, ownershipTrustworthy } from "./mass.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const GAPS = process.env.GAPS_TABLE;
const EVENTS = process.env.EVENTS_TABLE;
const TOOLS = process.env.TOOLS_TABLE;
const BUCKET = process.env.BOARD_BUCKET;
const SIMILARITY = Number(process.env.CLUSTER_SIMILARITY ?? DEFAULT_SIMILARITY);

async function loadGaps() {
  const rows = [];
  let key;
  do {
    const out = await ddb.send(new ScanCommand({ TableName: GAPS, ExclusiveStartKey: key }));
    for (const item of out.Items ?? []) {
      rows.push({
        gap_id: item.gap_id,
        query: item.query,
        ts: item.ts,
        caller_id: item.caller_id ?? null,
        owner: item.owner ?? null,
        caller_created_at: item.caller_created_at ?? null,
        actor_verified: item.actor_verified === true,
        reason: item.reason,
        // Gaps logged before vectors were stored have none. cluster() drops
        // them rather than guessing where they belong.
        vector: item.vec_b64 ? unpackVector(item.vec_b64) : null,
      });
    }
    key = out.LastEvaluatedKey;
  } while (key);
  return rows;
}

async function scanAll(table, project) {
  const rows = [];
  let key;
  do {
    const out = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key }));
    for (const item of out.Items ?? []) rows.push(project(item));
    key = out.LastEvaluatedKey;
  } while (key);
  return rows;
}

// Mass, recomputed from the log every run. Nothing is accumulated, so a change
// to the scoring rule rescores the whole history under it — see mass.mjs.
async function computeMass() {
  const events = await scanAll(EVENTS, (i) => ({
    type: i.type, tool_id: i.tool_id, outcome: i.outcome, ms: i.ms, ts: i.ts,
    caller_id: i.caller_id ?? null, owner: i.owner ?? null,
    actor_verified: i.actor_verified === true, self_call: i.self_call === true,
  }));

  // Latest version per tool, so a tool is one row however many versions it has.
  const latest = new Map();
  for (const t of await scanAll(TOOLS, (i) => ({
    tool_id: i.tool_id, version: i.version, name: i.name, owner: i.owner,
    owner_verified: i.owner_verified === true,
  }))) {
    const seen = latest.get(t.tool_id);
    if (!seen || Number(t.version) > Number(seen.version)) latest.set(t.tool_id, t);
  }

  const rows = scoreTools([...latest.keys()], events).map((row) => {
    const t = latest.get(row.tool_id);
    // Invariant #3, enforced rather than asserted: if a ranking input ever
    // arrives that came from a payment, this throws and the run fails loudly
    // instead of quietly publishing a bought ranking.
    return assertNoPaidInputs({
      ...row, name: t.name ?? null, version: t.version,
      // False means the self_call figure above cannot be relied on for this
      // tool, because its owner string was never checked against a caller.
      ownership_verified: ownershipTrustworthy(t),
    });
  });

  return {
    generated_at: new Date().toISOString(),
    scoring: "mass-only",
    // Said in the artefact, not only in the docs, because this is the file
    // anything downstream will read.
    note: "Mass is successful, verified, non-self calls. Recomputed from the event log; nothing is accumulated. No paid input touches this ranking.",
    tools_total: rows.length,
    tools_with_usage: rows.filter((r) => r.mass > 0).length,
    tools_with_unverified_ownership: rows.filter((r) => !r.ownership_verified).length,
    events_scanned: events.length,
    tools: rows,
  };
}

// A stable id, so the same need keeps the same URL between nightly runs even as
// members are added. Derived from the label rather than from a random id, which
// would make every run look like a new set of gaps to anyone linking to one.
const clusterId = (label) => createHash("sha256").update(label).digest("hex").slice(0, 12);

export const handler = async () => {
  const started = Date.now();
  const gaps = await loadGaps();
  const groups = cluster(gaps, SIMILARITY);

  const clusters = groups
    .map((members) => {
      const summary = summarise(members);
      const verdict = assess(summary);
      return { id: clusterId(summary.label), ...summary, ...verdict };
    })
    .sort((a, b) => b.distinct_callers - a.distinct_callers || b.occurrences - a.occurrences);

  // WHAT THE PUBLIC SEES. Counts, never identities.
  //
  // The caller list is the raw material for beneficiary exclusion and stays
  // inside the platform. Publishing it would turn the gaps board into a
  // directory of which agents are asking what, which is nobody's business and
  // is not needed to show that a need is real.
  const publicView = {
    generated_at: new Date().toISOString(),
    gaps_total: gaps.length,
    gaps_clustered: groups.flat().length,
    gaps_without_vector: gaps.length - groups.flat().length,
    clusters_total: clusters.length,
    clusters_confirmed: clusters.filter((c) => c.confirmed).length,
    rule: { ...RULE, similarity: SIMILARITY },
    clusters: clusters.map(({ callers, ...rest }) => rest),
  };

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: "gaps.json",
    Body: JSON.stringify(publicView, null, 2),
    ContentType: "application/json",
    // Short, because the job runs nightly and a stale board is a board that
    // quietly stops being evidence of anything.
    CacheControl: "public, max-age=300",
  }));

  const mass = await computeMass();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: "tools.json",
    Body: JSON.stringify(mass, null, 2),
    ContentType: "application/json",
    CacheControl: "public, max-age=300",
  }));

  console.log(JSON.stringify({
    metric: "mass_run", tools: mass.tools_total, used: mass.tools_with_usage,
    events: mass.events_scanned,
  }));

  console.log(JSON.stringify({
    metric: "cluster_run",
    ms: Date.now() - started,
    gaps: gaps.length,
    clusters: clusters.length,
    confirmed: publicView.clusters_confirmed,
  }));

  return {
    ok: true, ...publicView, clusters: undefined,
    tools_total: mass.tools_total, tools_with_usage: mass.tools_with_usage,
  };
};
