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
  # Embeddings still run on Bedrock, granted by IAM and scoped to one model.
  # There is no judge ARN any more: the adjudicator moved to the Anthropic API,
  # where access is a key rather than a role. See iam.tf.
  embed_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/${var.embed_model_id}"
}
