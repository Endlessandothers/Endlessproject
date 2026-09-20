output "registry_url" {
  description = "registry-fn Function URL (AWS_IAM auth - sign requests with SigV4)."
  value       = aws_lambda_function_url.registry.function_url
}

output "search_url" {
  description = "search-fn Function URL."
  value       = aws_lambda_function_url.search.function_url
}

output "events_url" {
  description = "events-fn Function URL (AWS_IAM auth)."
  value       = aws_lambda_function_url.events.function_url
}

output "tables" {
  description = "DynamoDB table names."
  value = {
    tools     = aws_dynamodb_table.tools.name
    events    = aws_dynamodb_table.events.name
    gaps      = aws_dynamodb_table.gaps.name
    callers   = aws_dynamodb_table.callers.name
    approvals = aws_dynamodb_table.approvals.name
  }
}

output "capacity_budget" {
  description = "Provisioned capacity against the always-free 25 RCU / 25 WCU."
  value = format(
    "%d RCU / %d WCU of 25 (3 tables at %d/%d, 2 indexes at %d/%d, callers at %d/%d, approvals at %d/%d)",
    var.table_rcu * 3 + var.gsi_rcu * 2 + var.callers_rcu + var.approvals_rcu,
    var.table_wcu * 3 + var.gsi_wcu * 2 + var.callers_wcu + var.approvals_wcu,
    var.table_rcu, var.table_wcu, var.gsi_rcu, var.gsi_wcu,
    var.callers_rcu, var.callers_wcu, var.approvals_rcu, var.approvals_wcu,
  )
}

output "threshold_t" {
  description = "Starting gap threshold. Per issue #12 this is an output of Phase 0, not an input - it gets derived from the eval score distributions."
  value       = var.threshold_t
}

output "board_bucket" {
  description = "Where the nightly gap snapshot is written. Served through CloudFront, never public directly."
  value       = aws_s3_bucket.board.id
}
