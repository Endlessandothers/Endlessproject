# GitHub Actions OIDC — no long-lived AWS keys anywhere.
#
# GitHub mints a short-lived JWT for each workflow run. AWS validates it against
# this provider and hands back temporary credentials. Nothing is stored in the
# repository: a role ARN is not a secret, because it is useless to anyone whose
# OIDC token does not match the trust conditions below.
#
# On thumbprint_list: since 2023 AWS validates token.actions.githubusercontent.com
# against its own trusted CA store, so the thumbprint is no longer load-bearing -
# AWS ignores it for this provider. It is set anyway because the API still
# accepts it and some tooling expects the field to be populated. If GitHub
# rotates its CA, nothing here needs changing.

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = {
    Name = "github-actions-oidc"
  }
}

# ---------------------------------------------------------------- plan role
# Assumable from ANY ref in the repo, including pull requests, because a plan on
# a PR is the whole point. It is read-only, so a malicious PR can at worst read
# infrastructure metadata it could already infer from the repository.
data "aws_iam_policy_document" "plan_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.sub_claim_prefix}:*"]
    }
  }
}

resource "aws_iam_role" "plan" {
  name                 = "endless-gha-plan"
  description          = "Read-only role for terraform plan in GitHub Actions."
  assume_role_policy   = data.aws_iam_policy_document.plan_assume.json
  max_session_duration = 3600
}

# Scoped read-only rather than the managed ReadOnlyAccess policy, which would
# also grant s3:GetObject across every bucket in the account - including state
# files for unrelated projects.
data "aws_iam_policy_document" "plan" {
  statement {
    sid = "ReadInfrastructure"
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:DescribeContinuousBackups",
      "dynamodb:DescribeTimeToLive",
      "dynamodb:ListTagsOfResource",
      "dynamodb:ListTables",
      "lambda:GetFunction*",
      "lambda:ListFunctions",
      "lambda:ListVersionsByFunction",
      "lambda:GetPolicy",
      "lambda:ListTags",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListRoles",
      "iam:GetOpenIDConnectProvider",
      "logs:DescribeLogGroups",
      "logs:ListTagsForResource",
      "sns:GetTopicAttributes",
      "sns:ListTagsForResource",
      "sns:ListSubscriptionsByTopic",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource",
      "s3:GetBucket*",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetAccelerateConfiguration",
      "s3:GetReplicationConfiguration",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }

  # s3:ListBucket is deliberately NOT in the statement above. Granting it on "*"
  # there would silently override the prefix-scoped grant below and let a PR
  # from any branch enumerate every bucket in the account.

  # Read the state, and nothing else in the bucket. Plan runs with -lock=false
  # in CI, so no write to the lock object is needed either.
  statement {
    sid       = "ReadStateObjectOnly"
    actions   = ["s3:GetObject"]
    resources = local.state_objects
  }

  statement {
    sid       = "ListStatePrefixOnly"
    actions   = ["s3:ListBucket"]
    resources = [local.state_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["endless/phase-0/*"]
    }
  }
}

resource "aws_iam_role_policy" "plan" {
  name   = "endless-gha-plan-policy"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan.json
}

# ---------------------------------------------------------------- apply role
# Assumable ONLY from the default branch. This is the real control: it lives in
# the trust policy, so editing a workflow file on a branch cannot grant it.
data "aws_iam_policy_document" "apply_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.sub_claim_prefix}:ref:refs/heads/${var.apply_branch}"]
    }
  }
}

resource "aws_iam_role" "apply" {
  name                 = "endless-gha-apply"
  description          = "Write role for terraform apply from the default branch only."
  assume_role_policy   = data.aws_iam_policy_document.apply_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "apply" {
  # Full state access, including the lock object that use_lockfile writes.
  statement {
    sid       = "ManageStateAndLock"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = local.state_objects
  }

  statement {
    sid       = "ListStatePrefixOnly"
    actions   = ["s3:ListBucket"]
    resources = [local.state_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["endless/phase-0/*"]
    }
  }

  statement {
    sid       = "ManageTables"
    actions   = ["dynamodb:*"]
    resources = ["arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.resource_prefix}-*"]
  }

  statement {
    sid       = "ManageFunctions"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:function:${var.resource_prefix}-*"]
  }

  # Prefix-scoped so CI can never touch endless-gha-plan or endless-gha-apply -
  # it cannot escalate itself or delete its own way in.
  statement {
    sid = "ManageServiceRoles"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
      "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
      "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PassRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.resource_prefix}-*"]
  }

  # The sandbox VPC. EC2 networking actions mostly cannot be resource-scoped —
  # Describe* has no resource, and CreateVpc has none until it exists — so this
  # is scoped by ACTION instead: networking only. No instances, no images, no
  # volumes, nothing that could run compute outside the Lambdas above.
  statement {
    sid = "ManageSandboxNetwork"
    actions = [
      "ec2:CreateVpc", "ec2:DeleteVpc", "ec2:DescribeVpcs",
      "ec2:ModifyVpcAttribute", "ec2:DescribeVpcAttribute",
      "ec2:CreateSubnet", "ec2:DeleteSubnet", "ec2:DescribeSubnets",
      "ec2:ModifySubnetAttribute",
      "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup",
      "ec2:DescribeSecurityGroups", "ec2:DescribeSecurityGroupRules",
      "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress",
      "ec2:CreateNetworkAcl", "ec2:DeleteNetworkAcl", "ec2:DescribeNetworkAcls",
      "ec2:CreateNetworkAclEntry", "ec2:DeleteNetworkAclEntry",
      "ec2:ReplaceNetworkAclAssociation",
      "ec2:CreateRouteTable", "ec2:DeleteRouteTable", "ec2:DescribeRouteTables",
      "ec2:ReplaceRouteTableAssociation", "ec2:AssociateRouteTable",
      "ec2:DescribeNetworkInterfaces", "ec2:DescribeAvailabilityZones",
      "ec2:CreateTags", "ec2:DeleteTags", "ec2:DescribeAccountAttributes",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ManageLogGroups"
    actions   = ["logs:*"]
    resources = ["arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.resource_prefix}-*"]
  }

  # logs:DescribeLogGroups CANNOT be resource-scoped. AWS evaluates it against
  # an empty log-group ARN - "log-group::log-stream:" - so the prefix-scoped
  # grant above never matches it and every plan fails on AccessDeniedException
  # while reading existing log groups.
  #
  # It is a list operation, so "*" is the only form that works. The mutating
  # actions stay prefix-scoped above; this only widens discovery.
  statement {
    sid       = "ListLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageTopics"
    actions   = ["sns:*"]
    resources = ["arn:aws:sns:${var.region}:${local.account_id}:${var.resource_prefix}-*"]
  }

  statement {
    sid     = "ManageVectorBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${var.resource_prefix}-vectors-${local.account_id}",
      "arn:aws:s3:::${var.resource_prefix}-vectors-${local.account_id}/*",
    ]
  }

  # CloudWatch alarms do not support resource-level permissions on Describe.
  statement {
    sid = "ManageAlarms"
    actions = [
      "cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms",
      "cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource",
      "cloudwatch:TagResource", "cloudwatch:UntagResource",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ReadIdentityAndBuckets"
    actions   = ["sts:GetCallerIdentity", "s3:ListAllMyBuckets", "iam:ListRoles", "dynamodb:ListTables", "lambda:ListFunctions"]
    resources = ["*"]
  }

  # Belt and braces: CI must never be able to rewrite its own trust policy or
  # touch the OIDC provider, whatever else a future policy edit allows.
  statement {
    sid    = "DenySelfModification"
    effect = "Deny"
    actions = [
      "iam:*OpenIDConnectProvider*",
      "iam:UpdateAssumeRolePolicy",
      "iam:CreateUser", "iam:CreateAccessKey", "iam:AttachUserPolicy",
      "iam:PutUserPolicy", "iam:CreateLoginProfile",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "apply" {
  name   = "endless-gha-apply-policy"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply.json
}
