provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "Endless"
      Phase     = "0"
      ManagedBy = "Terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  prefix     = "${var.project}-p0"
  account_id = data.aws_caller_identity.current.account_id

  # Bedrock foundation models are account-agnostic ARNs (no account field).
  embed_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/${var.embed_model_id}"
  judge_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/${var.judge_model_id}"
}
