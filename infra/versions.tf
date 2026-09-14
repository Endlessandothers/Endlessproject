terraform {
  # use_lockfile (S3-native state locking via conditional writes) is GA from 1.11.
  # It replaces the old dynamodb_table lock, which is why no lock table exists here.
  required_version = ">= 1.11"

  backend "s3" {
    bucket       = "local-shop-design-app-tfstate-258506450105"
    key          = "endless/phase-0/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.70, < 7.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
  }
}
