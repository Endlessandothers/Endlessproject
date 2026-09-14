# BOOTSTRAP — applied by a human, from a laptop, with long-lived credentials.
#
# This is deliberately a SEPARATE state from infra/. The roles defined here are
# what CI assumes to manage infra/. If they lived in the same state, a bad apply
# in CI could delete the very role it was running as, and the only way back in
# would be local credentials anyway.
#
# Apply this once. After that it should barely change.

terraform {
  required_version = ">= 1.11"

  backend "s3" {
    bucket       = "local-shop-design-app-tfstate-258506450105"
    key          = "endless/bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.70, < 7.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "Endless"
      Component = "cicd-bootstrap"
      ManagedBy = "Terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  state_arn  = "arn:aws:s3:::${var.state_bucket}"

  # The two state objects CI touches, and nothing else in the bucket.
  state_objects = [
    "arn:aws:s3:::${var.state_bucket}/${var.state_key}",
    "arn:aws:s3:::${var.state_bucket}/${var.state_key}.tflock",
  ]
}
