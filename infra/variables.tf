variable "region" {
  description = "Single region for every Phase 0 resource. Region drift is the most common way this stalls, so everything is pinned here."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for all resources."
  type        = string
  default     = "endless"
}

variable "embed_model_id" {
  description = "Bedrock embedding model. Verified available in us-east-1."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "embed_dims" {
  description = "Titan V2 output dimensions: 1024 (default), 512 or 256."
  type        = number
  default     = 1024

  validation {
    condition     = contains([256, 512, 1024], var.embed_dims)
    error_message = "Titan Text Embeddings V2 supports only 256, 512 or 1024 dimensions."
  }
}

variable "threshold_t" {
  description = <<-EOT
    Gap threshold. A search whose top score falls below this logs a gap.

    This is a PLACEHOLDER. Per issue #12, T is an output of Phase 0, not an input:
    it gets derived from the score distributions the eval harness produces. Every gap
    row stamps the T that was in force, so records written under this starting value
    stay interpretable after it moves.

    MEASURED 2026-09-14, amazon.titan-embed-text-v2:0 at 1024 dims, normalize=true:
    Titan V2 cosine scores sit near zero, NOT in the 0.4-0.8 range typical of other
    embedding models. A correct hit scored 0.0595; unrelated tools scored -0.007 to
    0.046. Verified against a direct Bedrock call, so this is the model's real scale
    and not a bug in the pipeline.

    The first value here was 0.5, which logged a gap on every search including the
    correct hits. 0.05 is an ORDER-OF-MAGNITUDE correction so the mechanism is not
    degenerate - it is NOT a derived value and must not be treated as one: it is
    fitted to two observations.

    Note also how thin the observed separation is: 0.0595 for a correct hit against
    0.0464 for an unrelated one. If the eval harness confirms that overlap at scale,
    then cosine distance alone cannot separate a gap from a miss - and per the deck,
    that is itself the finding, not a failure.

    SET TO 0.20 on 2026-09-16, derived from the score distributions at
    fusion_alpha 0.8 rather than guessed: it is the highest threshold that still
    logs zero false gaps, and it detects 89.8% of genuine ones. This is issue
    #12 done — T is now an output of the evaluation, as intended.
  EOT
  type        = number
  default     = 0.20
}

variable "table_rcu" {
  description = "Read capacity per table. See capacity budget in README - the always-free 25 RCU/WCU is shared across all tables AND indexes in the region."
  type        = number
  default     = 5
}

variable "table_wcu" {
  description = "Write capacity per table."
  type        = number
  default     = 5
}

variable "cluster_similarity" {
  description = "Cosine similarity at or above which two gap queries are treated as the same need. DERIVED, not guessed: swept against the frozen blind set in sim/ on 2026-09-20. The within-need and across-need distributions OVERLAP, so no value separates them perfectly; 0.35 is the best F1 (0.909) and, more importantly, the lowest value with ZERO wrong merges. The error it does make is splitting a need into two, which under-reports demand — the safe direction. A higher value splits more (at the old 0.5, recall fell to 0.667). See docs/phase-1-simulation-findings.md."
  type        = number
  default     = 0.35
}

variable "cluster_schedule" {
  description = "When the clustering job runs. Nightly rather than per search, because demand is a trend and recomputing it per request would cost money to say the same thing."
  type        = string
  default     = "cron(15 3 * * ? *)"
}

variable "judge_timeout_ms" {
  description = "How long search-fn waits for the adjudicator before giving up and using the threshold. Must stay well under the function's own 30s timeout: a Lambda killed by its timeout cannot run its own fail-open, so a slow judge would take the whole search down rather than degrading it. 12s with one retry keeps the worst case inside 30."
  type        = number
  default     = 12000
}

variable "anthropic_key_param" {
  description = "SSM Parameter Store path holding the Anthropic API key, as a SecureString. The NAME only — Terraform never sees the value, so it never enters the state file. Written out of band: aws ssm put-parameter --name /endless/anthropic-api-key --type SecureString --value sk-ant-... --overwrite"
  type        = string
  default     = "/endless/anthropic-api-key"
}

variable "app_image_tag" {
  description = "Which endless-app image the Fargate task runs. Bump it after pushing a new one; a tag rather than a digest so a redeploy is one variable change. Note it is NOT `latest`, deliberately — but that means pushing `latest` and forcing a new deployment changes nothing, which cost a confused half hour once. Push the new tag, then bump this."
  type        = string
  default     = "v2"
}

variable "app_desired_count" {
  description = "How many app tasks run. This is the off switch: set it to 0 and the Fargate bill stops, while the VPC, the repository and the task definition all keep costing nothing. One 0.25 vCPU task is roughly $9 a month and is billed whether anyone visits or not — the first thing in this project to leave the free tier."
  type        = number
  default     = 1
}

variable "app_allowed_cidr" {
  description = "Who may reach the app. Defaults to one address because the app now carries a key and there is one user. Set it to 0.0.0.0/0 to reopen it, but only alongside removing app_key_param — an open page holding a working key is an open door to someone else's credits and, worse, to Opus 5 calls billed to this account. Home broadband addresses move; if the page stops answering, this is the first thing to check."
  type        = string
  default     = "109.157.66.87/32"
}

variable "app_key_param" {
  description = "SSM parameter NAME holding the key the app calls with. Empty string means the app holds no key and visitors bring their own, which is the arrangement the counts in this system assume. The value is written out of band and injected by ECS at task start, so it appears in neither the task definition nor Terraform state."
  type        = string
  default     = "/endless/app-caller-key"
}

variable "mcp_flood_threshold" {
  description = "Invocations of the public MCP endpoint in five minutes that trip the kill switch. Lowered from 2000 when the adjudicator moved to Claude: a search went from $0.000015 to about $0.00124, so the old ceiling stopped being an abuse detector priced at three cents and became one priced at $2.48 per window — roughly $700 a day if a flood simply sustained itself under the alarm. 250 is still an order of magnitude above anything real traffic does today (the whole blind-set replay was 35 requests) and caps an undetected flood near 30 cents. Revisit when there is real traffic to revisit it against."
  type        = number
  default     = 250
}

variable "approvals_rcu" {
  description = "Read capacity for the approvals table. Read once per tool call. Paid for by dropping the two by_day indexes to 2/2; neither is on a hot path."
  type        = number
  default     = 2
}

variable "approvals_wcu" {
  description = "Write capacity for the approvals table. Written only when a human approves, rejects or revokes a version, which is rare by design."
  type        = number
  default     = 2
}

variable "callers_rcu" {
  description = "Read capacity for the callers table. Read once per search and once per tool call, as an eventually consistent GetItem at 0.5 RCU, so 2 sustains about 4/sec against an account concurrency ceiling of 10. Raise this first if throttling appears."
  type        = number
  default     = 2
}

variable "callers_wcu" {
  description = "Write capacity for the callers table. Written only when a caller is minted and when a publication is charged, both rare, so this is deliberately the smallest allocation in the region."
  type        = number
  default     = 2
}

variable "publish_cost_credits" {
  description = "Credits debited from the publishing caller for each tool VERSION accepted by registry-fn. Charged per version rather than per tool because each version is a separate immutable object that costs its own embedding and its own review. Whether this is a fee or a refundable stake is not decided yet; a stake is this same debit with a later credit back, so the mechanism does not change."
  type        = number
  default     = 1
}

variable "gsi_rcu" {
  description = "Read capacity per global secondary index. Dropped from 3 to 2 to make room for the approvals table: cluster-fn scans rather than querying by day, and the events index is for a Phase 2 replay that does not exist yet."
  type        = number
  default     = 2
}

variable "gsi_wcu" {
  description = "Write capacity per global secondary index. Dropped from 3 to 2 alongside gsi_rcu."
  type        = number
  default     = 2
}

variable "search_url_auth" {
  description = <<-EOT
    Auth mode for the search Function URL: AWS_IAM or NONE.

    Defaults to AWS_IAM deliberately. An unauthenticated URL that invokes a paid
    Bedrock model is an unbounded cost surface, and the billing alarm is a
    notification, not a cap. Set NONE only for a short, watched dev session.
  EOT
  type        = string
  default     = "AWS_IAM"

  validation {
    condition     = contains(["AWS_IAM", "NONE"], var.search_url_auth)
    error_message = "search_url_auth must be AWS_IAM or NONE."
  }
}

variable "billing_alarm_threshold_usd" {
  description = "Billing alarm threshold in USD."
  type        = number
  default     = 5
}

variable "billing_alarm_email" {
  description = "Email for the billing alarm. Leave empty to create the topic without a subscription."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Keeps logs inside the always-free 5 GB."
  type        = number
  default     = 14
}

variable "cache_ttl_ms" {
  description = <<-EOT
    How long search-fn may serve tool vectors from its in-memory cache.

    An unbounded cache makes a newly registered tool invisible until the Lambda
    execution environment happens to recycle. That is unobservable from outside
    and it silently invalidated an evaluation run: two different description
    sets produced byte-identical scores because the second was never loaded.
  EOT
  type        = number
  default     = 60000
}

variable "fusion_alpha" {
  description = <<-EOT
    Weight between dense and lexical retrieval: 1 is pure cosine, 0 is pure BM25.

    Defaults to 1 so deploying hybrid retrieval changes no behaviour. Search
    returns both component scores on every result, so the weight is chosen by
    sweeping real evaluation data offline rather than by guessing here and
    redeploying once per experiment.

    SET TO 0.8 on 2026-09-16 by sweeping the 60-query evaluation set offline.
    Pure cosine (1.0) reached only 67.3% gap detection at zero false gaps; 0.8
    reaches 89.8%. Recall@1 is 100% across the whole sweep, so the lexical
    component is buying gap detection, not retrieval.

    CAVEAT: alpha and threshold_t were chosen on the same 60 queries they are
    measured against. These are fitted parameters, not a held-out result.
  EOT
  type        = number
  default     = 0.8
}

variable "judge_model_id" {
  description = "The model that decides whether any candidate tool genuinely does the job. Runs on EVERY search, at about 207 input and 8 output tokens. On Nova Micro that was roughly $8 per million searches; on Claude Opus 5 it is roughly $1,240 per million, and the judge stops being the largest line item and becomes essentially the whole bill. Chosen anyway because Phase 3 measured the cheap judge FALSELY MATCHING — accepting a currency converter for a question about capitals — which suppresses a real need rather than merely wasting effort."
  type        = string
  default     = "claude-opus-5"
}

variable "judge_candidates" {
  description = "How many ranked tools the judge is shown. Three, because recall@3 is 100% on both evaluation sets — a longer list adds tokens and hallucination surface without adding a right answer."
  type        = number
  default     = 3
}

variable "runtime_memory_mb" {
  description = "Memory for the tool runtime. Lambda scales CPU with memory, and the sandbox is where creator code actually runs, so this is the knob that decides what 'not compute heavy' means in practice."
  type        = number
  default     = 512
}

variable "transform_timeout_ms" {
  description = "Wall clock a creator's transform may use before it is killed. Well under the Lambda timeout so an overrun is reported as a tool failure rather than an infrastructure one."
  type        = number
  default     = 5000
}

variable "fetch_timeout_ms" {
  description = "Per-request timeout for the outbound fetcher."
  type        = number
  default     = 10000
}
