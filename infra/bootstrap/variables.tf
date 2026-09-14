variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_repo" {
  description = "owner/name of the repository allowed to assume these roles."
  type        = string
  default     = "Endlessandothers/Endlessproject"
}

variable "sub_claim_prefix" {
  description = <<-EOT
    The literal prefix of the OIDC `sub` claim GitHub actually mints for this
    repository. It is NOT simply "repo:owner/name".

    This repository has IMMUTABLE SUBJECT CLAIMS enabled, so GitHub embeds the
    numeric owner id and repository id in the subject:

      repo:Endlessandothers@326342684/Endlessproject@1360952247:ref:refs/heads/main

    That is a hardening feature: the numeric ids survive a rename or transfer,
    so a trust policy pinned to them cannot be hijacked by someone recreating a
    repository with the same name. Matching the human-readable form instead
    fails with "Not authorized to perform sts:AssumeRoleWithWebIdentity", which
    looks like a permissions bug and is not one.

    Read the current value for any repo with:
      gh api repos/OWNER/NAME/actions/oidc/customization/sub
  EOT
  type        = string
  default     = "repo:Endlessandothers@326342684/Endlessproject@1360952247"
}

variable "apply_branch" {
  description = "Only this branch may assume the apply role. Enforced in the trust policy, so it holds even if a workflow file is edited."
  type        = string
  default     = "main"
}

variable "state_bucket" {
  type    = string
  default = "local-shop-design-app-tfstate-258506450105"
}

variable "state_key" {
  description = "State object for the Phase 0 stack. CI gets access to this key only, not the whole bucket."
  type        = string
  default     = "endless/phase-0/terraform.tfstate"
}

variable "resource_prefix" {
  description = "Every resource CI is allowed to manage starts with this."
  type        = string
  default     = "endless-p0"
}
