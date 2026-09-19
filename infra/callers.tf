# callers — Phase 1, issue #1.
#
# Identity for everything that calls Endless. Until this table exists, an actor
# is whatever the caller types in a JSON field, which is not a defence against
# anything: gap counts computed from claimed identity count claims.
#
# One row per caller, addressed by primary key, because the caller id is carried
# IN the key (see lambda/exec/auth.mjs). Verification is therefore a single
# GetItem — no secondary index, and no extra draw on the free-tier budget.
#
# CAPACITY. Adding 2/2 here takes the region to 23 RCU / 23 WCU of the always-free
# 25. Deliberately the smallest table: every search and every call reads it, but
# reads are eventually consistent GetItems at 0.5 RCU each, so 2 RCU sustains
# ~4/sec against an account concurrency ceiling of 10. Burst capacity covers the
# rest. It is the first thing to raise if throttling ever shows up in logs.
#
# NOT CACHED in the functions, on purpose. A cached caller row means a suspended
# or drained caller keeps working until the cache expires, and suspension that
# takes effect eventually is not suspension.
resource "aws_dynamodb_table" "callers" {
  name           = "${local.prefix}-callers"
  billing_mode   = "PROVISIONED"
  read_capacity  = var.callers_rcu
  write_capacity = var.callers_wcu
  hash_key       = "caller_id"

  attribute {
    name = "caller_id"
    type = "S"
  }

  # The only table holding a credential, even a hashed one, and the only one
  # whose loss locks every caller out rather than losing derived data.
  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name      = "${local.prefix}-callers"
    Invariant = "caller-identity-verified-not-claimed"
  }
}

# Read access is granted to search, exec and registry in iam.tf and exec.tf.
# None of them may mint a caller or hand out credit: minting happens out of band
# from an operator's own credentials (cli/mint-caller.mjs), so compromising any
# function cannot issue it an identity or top up its balance.
