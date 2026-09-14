output "plan_role_arn" {
  description = "Paste into .github/workflows/terraform-plan.yml. Not a secret - useless without a matching OIDC token."
  value       = aws_iam_role.plan.arn
}

output "apply_role_arn" {
  description = "Paste into .github/workflows/terraform-apply.yml."
  value       = aws_iam_role.apply.arn
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "trust_summary" {
  description = "Who can assume what. Worth re-reading after any change here."
  value = {
    plan  = "${var.sub_claim_prefix}:*  (any branch, any PR - read only)"
    apply = "${var.sub_claim_prefix}:ref:refs/heads/${var.apply_branch}  (default branch only)"
    note  = "Subject uses immutable numeric ids, not owner/name. See var.sub_claim_prefix."
  }
}
