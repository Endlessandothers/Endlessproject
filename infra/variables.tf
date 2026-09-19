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

variable "gsi_rcu" {
  description = "Read capacity per global secondary index."
  type        = number
  default     = 3
}

variable "gsi_wcu" {
  description = "Write capacity per global secondary index."
  type        = number
  default     = 3
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
  description = <<-EOT
    Small model that decides whether anything in the shortlist actually does the
    job. Set to "" to disable and fall back to the threshold alone.

    An absolute threshold could not make this call: on a held-out set it logged
    31.6% of answerable queries as gaps, because correct-hit scores ran 0.21 and
    up on one set and as low as 0.12 on the next. Retrieval was never the
    problem — recall@3 was 100% on both sets, and in every false gap the right
    tool was already in the top three.

    So the ranking is untouched and only the yes/no changed. This is the
    "mini LLM at the edge" from PROJECT.md.
  EOT
  type        = string
  default     = "amazon.nova-micro-v1:0"
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
