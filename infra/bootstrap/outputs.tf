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
    plan  = "repo:${var.github_repo}:*  (any branch, any PR - read only)"
    apply = "repo:${var.github_repo}:ref:refs/heads/${var.apply_branch}  (default branch only)"
  }
}
