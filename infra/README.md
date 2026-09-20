# Endless Phase 0 — infrastructure and CI/CD

Terraform for the Phase 0 stack, plus the GitHub Actions pipeline that manages it.

## Layout

```
infra/
  bootstrap/      OIDC provider + the two CI roles.   Applied BY A HUMAN, locally.
  lambda/         Function source. Each directory is zipped as one package.
    registry/       index.mjs + vector.mjs (packVector) + auth.mjs
    search/         index.mjs + vector.mjs (unpackVector, cosine) + auth.mjs
    events/         index.mjs
    exec/           index.mjs + auth.mjs      orchestrates a tool call
    fetcher/        the only component allowed to open a connection
    runtime/        the sandbox: no network, no role, no disk
  tests/          Pure unit tests. No AWS SDK, no credentials, no network.
  *.tf            The Phase 0 stack.                  Applied BY CI, from main.
```

## Two states, deliberately

| | State key | Applied by | Why |
|---|---|---|---|
| `bootstrap/` | `endless/bootstrap/terraform.tfstate` | a human, locally | Defines the roles CI runs as |
| `infra/` | `endless/phase-0/terraform.tfstate` | CI, from `main` | The actual stack |

They are separate so a bad apply in CI cannot delete the role CI authenticates
with. If both lived in one state, recovering would mean local credentials
anyway — so the split just makes that explicit up front.

Both use the same bucket with `use_lockfile = true`: S3-native locking through
conditional writes. There is no DynamoDB lock table, and there should not be —
`use_lockfile` replaced that pattern in Terraform 1.11.

## Authentication: OIDC, no stored secrets

GitHub mints a short-lived JWT per workflow run; AWS validates it against the
OIDC provider and returns temporary credentials. **Nothing is stored in the
repository.** The role ARNs sit in plain text in the workflow files, which is
fine: an ARN is useless to anyone whose token does not match the trust policy.

| Role | Assumable from | Can |
|---|---|---|
| `endless-gha-plan` | any branch, any PR | read only |
| `endless-gha-apply` | `refs/heads/main` only | manage `endless-p0-*` |

The branch restriction is enforced in the **trust policy**, not in the workflow.
Editing a workflow file on a branch cannot grant apply rights, because AWS
checks the branch claim in the OIDC token itself.

Verified by simulation, not assumption:

```
plan  role: DescribeTable allowed · DeleteTable, UpdateFunctionCode,
            CreateRole, PutObject all denied
apply role: UpdateAssumeRolePolicy explicitDeny · cannot delete the CI roles
            · cannot create access keys
```

## Workflows

| File | Trigger | Does |
|---|---|---|
| `terraform-plan.yml` | PR, non-main push | fmt, init, validate, plan; posts plan to the PR |
| `terraform-apply.yml` | manual only | plan then apply, from `main` only |
| `lambda-ci.yml` | changes under `lambda/` or `tests/` | syntax check + unit tests, no AWS access |

Plan runs with `-lock=false` because the plan role cannot write the lock object.
The trade-off: a plan racing a concurrent apply could read stale state. That is
acceptable for a PR preview, and apply always takes a real lock.

### Why apply is manual

The right gate is a GitHub Environment with required reviewers. That needs
**admin** on the repository, and this account has `push` only. So the gate is a
typed confirmation (`apply`) plus the branch-scoped trust policy.

**If you get admin, replace it.** Add `environment: production` to the apply job
and configure required reviewers. A typed word stops an accident; it does not
stop a decision made too quickly.

## Running it locally

```bash
# one-time, by a human with real credentials
cd infra/bootstrap && terraform init && terraform apply

# the stack
cd infra && terraform init && terraform plan

# the checks CI runs
node --test $(find infra/tests -name '*.test.mjs')
```

## Connecting an agent (MCP)

The only endpoint an ordinary agent can reach. Everything else needs a signed
AWS request.

```json
{
  "mcpServers": {
    "endless": {
      "type": "http",
      "url": "https://uhob535yiaaebmey6yiythlase0aeqro.lambda-url.us-east-1.on.aws/",
      "headers": { "Authorization": "Bearer elk_<caller>_<secret>" }
    }
  }
}
```

Three tools: `endless_search` (find a tool, and log a gap when there is none),
`endless_call` (run one), `endless_gaps` (read unmet needs).

`mcp-fn` is an adapter and holds no authority. It forwards the caller's
Authorization header to search-fn and exec-fn, which verify it as they would for
anyone — so it cannot do anything the caller could not, and gap counts record
the agent rather than the adapter.

Its Function URL is the one endpoint with `authorization_type = "NONE"`, which
is correct: an agent runtime can send a bearer token and cannot sign SigV4
against an account it has no credentials for.

**Every method needs a key, `initialize` included.** The header is shape-checked
before anything downstream is invoked, so an unauthenticated flood is refused
for the cost of a regex. It is a shape check, not a verification — this function
holds no credentials by design — and a well-formed but invented key still gets a
401 from search-fn or exec-fn the moment it asks for anything real.

Behind that sits a kill switch: a CloudWatch alarm on invocations trips
`killswitch-fn`, which throttles the endpoint to zero concurrency and emails
you. Throttled invocations are not billed. It does not undo itself —
`terraform output mcp_restore_command` gives the one command to restore, and it
is meant to be run after looking at why it fired.

## The review gate

Publishing a tool and being allowed to RUN it are two different events.

```bash
node cli/review.mjs                                     what is waiting
node cli/review.mjs <tool_id> <version>                 read the code
node cli/review.mjs <tool_id> <version> --approve
node cli/review.mjs <tool_id> <version> --revoke --note "why"   the takedown path
```

**Absence of an approval is a refusal.** A missing record, a failed write, a
brand new tool and a deliberate rejection all fail the same safe way. The
opposite arrangement — running unless something says no — fails open on every
one of those, and the failures look identical to success.

Approvals live in their own table for two reasons. A `review_status` field on
the version row would have to be written after publication, breaking the
immutability invariant. More importantly, `registry-fn` holds `PutItem` on the
tools table because it must — so if approvals lived there, the function that
ACCEPTS submissions could APPROVE them. No Lambda has any write on the approvals
table; approving is an operator action from real credentials, like minting.

Revocation takes effect on the next call, because `exec-fn` does not cache
approvals.

## The sandbox gate

```bash
node --test "infra/tests/*.test.mjs"    # offline: no AWS, runs in CI
node infra/tests/escape.live.mjs        # live: attacks the deployed sandbox
```

The second one is issue #5 and it is a **gate, not a task**: it attacks the real
runtime and fetcher, and nothing third-party should be published while it exits
non-zero. It is deliberately outside `node --test` because it needs credentials
and invokes real functions — CI must never run it by accident against whatever
account it happens to hold.

It costs a handful of Lambda invocations and takes about a minute, most of it
spent waiting for two deliberate timeouts.

## Callers and API keys

Every call to search, exec and registry needs an Endless API key in the
`Authorization` header, on top of the SigV4 the Function URL already requires.
Without one there is no verified identity, and a gap count computed from claimed
identity counts claims.

```bash
# mint a caller — run by a human, from real credentials
node cli/mint-caller.mjs <caller_id> --owner <who is accountable> --credits 100

export ENDLESS_API_KEY=elk_<caller_id>_<secret>
```

The key is `elk_<caller_id>_<secret>`. The caller id is carried in the key so
verification is a single GetItem on the primary key — no secondary index, no
extra capacity. Only a SHA-256 of the key is stored, so a dump of the callers
table yields nothing usable and a lost key is replaced, never recovered.

**No Lambda can mint a caller.** `PutItem` on the callers table is granted to no
function, so no compromise of any function can issue itself an identity or top up
a balance. Only `registry-fn` may write there at all, and only `UpdateItem`, to
debit a publication.

| Field | Meaning |
|---|---|
| `status` | `active`, or anything else — any non-active value is refused on the next request, with no cache to wait out |
| `credits` | Spent by **publishing a tool version**, never by searching or calling |
| `owner` | Who is accountable. Decides tool ownership, self-call exclusion and bounty eligibility, and cannot be set from a request |
| `publications` | Count of versions published, incremented with the debit |

**Searching and calling are free; publishing costs credits.** The fee sits where
supply enters the world, because charging for questions would suppress exactly
the gap signal the registry exists to collect.

## Things that will bite you

**DynamoDB capacity is shared.** The always-free 25 RCU / 25 WCU covers every
table *and every index* in the region, and applies to **provisioned mode only** —
on-demand is not in the free tier. Current usage: 23/23 of 25 — three tables at
5/5, two indexes at 2/2, callers and approvals at 2/2 each. The approvals table
was paid for by dropping both by_day indexes from 3/3 to 2/2; neither is on a
hot path. There is no room left for another table at default capacity.

**Titan V2 cosine scores sit near zero.** Not the 0.4–0.8 typical of other
embedding models. Measured: a correct hit scored 0.0595, unrelated tools −0.007
to 0.046. A threshold carried over from another model is meaningless here. `T`
is a Phase 0 *output*, derived from the eval score distributions — the default
in `variables.tf` is a placeholder and says so.

**Reserved Lambda concurrency is impossible on this account.** The total
concurrency limit is 10, and AWS refuses any reservation that drops unreserved
below 10. That account cap is itself the ceiling on concurrent Bedrock spend.

**`range_key is deprecated, use key_schema`** — ignore it. `key_schema` does not
exist in AWS provider 6.64.0; the warning announces something unshipped.

**There is no vector snapshot bucket, deliberately.** An S3 cache was in the
first cut and has been removed. Authority for a tool's vector is the tool row;
at 15-20 tools a cold-start scan is cheaper than keeping a second copy correct,
and a second copy is exactly how two sources of truth drift apart. Revisit when
the corpus outgrows a scan — a Phase 1 decision, made with Phase 0 data.

**The billing alarm is a notification, not a cap.** It reports spend after the
fact. The real controls are the `AWS_IAM` default on the search Function URL and
the account concurrency limit.
