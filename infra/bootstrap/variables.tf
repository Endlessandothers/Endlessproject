variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_repo" {
  description = "owner/name of the repository allowed to assume these roles."
  type        = string
  default     = "Endlessandothers/Endlessproject"
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
