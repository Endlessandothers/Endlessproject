# Endless Phase 0 — infrastructure and CI/CD

Terraform for the Phase 0 stack, plus the GitHub Actions pipeline that manages it.

## Layout

```
infra/
  bootstrap/      OIDC provider + the two CI roles.   Applied BY A HUMAN, locally.
  lambda/         Function source. Each directory is zipped as one package.
    registry/       index.mjs + vector.mjs (packVector)
    search/         index.mjs + vector.mjs (unpackVector, cosine)
    events/         index.mjs
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

## Things that will bite you

**DynamoDB capacity is shared.** The always-free 25 RCU / 25 WCU covers every
table *and every index* in the region, and applies to **provisioned mode only** —
on-demand is not in the free tier. Current usage: 21/21 of 25. Adding an index
at default capacity would exceed it.

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

**The billing alarm is a notification, not a cap.** It reports spend after the
fact. The real controls are the `AWS_IAM` default on the search Function URL and
the account concurrency limit.
