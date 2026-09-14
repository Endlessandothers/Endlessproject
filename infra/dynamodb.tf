# Capacity budget - the always-free DynamoDB allowance is 25 RCU + 25 WCU per
# region per payer account, shared across every table AND every index, and it
# applies to PROVISIONED mode only. On-demand mode is not covered by the free
# tier and bills from the first request.
#
#   3 tables x 5/5                 = 15 RCU / 15 WCU
#   2 indexes (events, gaps) x 3/3 =  6 RCU /  6 WCU
#                                    ----------------
#                                    21 RCU / 21 WCU   (inside 25/25)

# ---------------------------------------------------------------- tools
# version is the sort key, which is what makes versions immutable: a new version
# is a new item, never an edit. The old row is physically untouched, so existing
# dependents keep resolving to exactly what they were built against.
resource "aws_dynamodb_table" "tools" {
  name           = "${local.prefix}-tools"
  billing_mode   = "PROVISIONED"
  read_capacity  = var.table_rcu
  write_capacity = var.table_wcu
  hash_key       = "tool_id"
  range_key      = "version"

  attribute {
    name = "tool_id"
    type = "S"
  }

  attribute {
    name = "version"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name      = "${local.prefix}-tools"
    Invariant = "tool-versions-immutable"
  }
}

# ---------------------------------------------------------------- events
# Append-only and provenance-tagged. The by_day index turns "replay every event
# in order" into a query instead of a full scan - Phase 2 scoring is recomputed
# from this log, so that replay has to stay cheap.
resource "aws_dynamodb_table" "events" {
  name           = "${local.prefix}-events"
  billing_mode   = "PROVISIONED"
  read_capacity  = var.table_rcu
  write_capacity = var.table_wcu
  hash_key       = "event_id"
  range_key      = "ts"

  attribute {
    name = "event_id"
    type = "S"
  }

  attribute {
    name = "ts"
    type = "S"
  }

  attribute {
    name = "day"
    type = "S"
  }

  global_secondary_index {
    name            = "by_day"
    hash_key        = "day"
    range_key       = "ts"
    projection_type = "ALL"
    read_capacity   = var.gsi_rcu
    write_capacity  = var.gsi_wcu
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name      = "${local.prefix}-events"
    Invariant = "append-only-provenance-tagged"
  }
}

# ---------------------------------------------------------------- gaps
# Stores the full top-k with scores and the threshold T in force at write time,
# so a later reader can judge whether search failed or the tool genuinely does
# not exist - and so changing T never silently reinterprets old records.
resource "aws_dynamodb_table" "gaps" {
  name           = "${local.prefix}-gaps"
  billing_mode   = "PROVISIONED"
  read_capacity  = var.table_rcu
  write_capacity = var.table_wcu
  hash_key       = "gap_id"
  range_key      = "ts"

  attribute {
    name = "gap_id"
    type = "S"
  }

  attribute {
    name = "ts"
    type = "S"
  }

  attribute {
    name = "day"
    type = "S"
  }

  global_secondary_index {
    name            = "by_day"
    hash_key        = "day"
    range_key       = "ts"
    projection_type = "ALL"
    read_capacity   = var.gsi_rcu
    write_capacity  = var.gsi_wcu
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name      = "${local.prefix}-gaps"
    Invariant = "append-only-provenance-tagged"
  }
}
