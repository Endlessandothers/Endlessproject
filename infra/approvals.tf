# approvals — the review gate. Phase 1, the half of #11 that is a safety control
# rather than an onboarding convenience.
#
# Publishing a tool and being allowed to RUN it are now two different events.
# Until this table says a version is approved, exec-fn refuses it. Absence means
# refusal, so a tool is unrunnable by default and becomes runnable only by a
# deliberate act.
#
# WHY A SEPARATE TABLE RATHER THAN A FIELD ON THE TOOL ROW.
#
# Two reasons, and the second is the important one.
#
# Invariant #5 says a published version is never edited. A review_status field
# on the version row would have to be written after publication, which breaks
# that literally — dependents would no longer resolve to a byte-identical row.
#
# And registry-fn holds PutItem on the tools table, because it must. If the
# approval lived there, the function that ACCEPTS submissions could APPROVE
# them, and a compromise of registry-fn would defeat the gate entirely rather
# than merely filling it with pending entries. No Lambda has any write on this
# table at all; approving is an operator action from real credentials, like
# minting a caller.
#
# CAPACITY. This takes the region to exactly 23/23 of the always-free 25, paid
# for by dropping the two by_day indexes from 3/3 to 2/2. Neither is on a hot
# path — cluster-fn scans rather than querying by day, and the events index is
# for Phase 2 replay that does not exist yet.
resource "aws_dynamodb_table" "approvals" {
  name           = "${local.prefix}-approvals"
  billing_mode   = "PROVISIONED"
  read_capacity  = var.approvals_rcu
  write_capacity = var.approvals_wcu
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
    Name      = "${local.prefix}-approvals"
    Invariant = "unreviewed-code-does-not-run"
  }
}
