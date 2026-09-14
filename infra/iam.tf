# The invariants live here, not in application code.
#
# An Allow that merely omits UpdateItem can be widened later by accident. An
# explicit Deny cannot be overridden by any other policy attached to the role,
# so the append-only guarantee survives future carelessness.
#
# BatchWriteItem is denied alongside DeleteItem because BatchWriteItem can
# delete. Denying only DeleteItem leaves the back door open.

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  mutating_actions = [
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:BatchWriteItem",
  ]
}

# ---------------------------------------------------------------- registry
resource "aws_iam_role" "registry" {
  name               = "${local.prefix}-registry-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "registry" {
  statement {
    sid       = "WriteAndReadTools"
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.tools.arn]
  }

  # Invariant #5: tool versions are immutable once published.
  # NOTE: this Deny stops UpdateItem/DeleteItem, but PutItem can still overwrite
  # an item with an identical key. The actual guard against that is the
  # ConditionExpression in registry/index.mjs. Both are required.
  statement {
    sid       = "DenyToolMutation"
    effect    = "Deny"
    actions   = local.mutating_actions
    resources = [aws_dynamodb_table.tools.arn]
  }

  statement {
    sid       = "EmbedToolText"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.embed_model_arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.registry.arn}:*"]
  }
}

resource "aws_iam_role_policy" "registry" {
  name   = "${local.prefix}-registry-policy"
  role   = aws_iam_role.registry.id
  policy = data.aws_iam_policy_document.registry.json
}

# ---------------------------------------------------------------- search
resource "aws_iam_role" "search" {
  name               = "${local.prefix}-search-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "search" {
  statement {
    sid       = "ReadTools"
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]
    resources = [aws_dynamodb_table.tools.arn]
  }

  # search-fn can never mutate the registry.
  statement {
    sid       = "DenyToolWrites"
    effect    = "Deny"
    actions   = concat(local.mutating_actions, ["dynamodb:PutItem"])
    resources = [aws_dynamodb_table.tools.arn]
  }

  statement {
    sid     = "AppendEventsAndGaps"
    actions = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = [
      aws_dynamodb_table.events.arn,
      "${aws_dynamodb_table.events.arn}/index/*",
      aws_dynamodb_table.gaps.arn,
      "${aws_dynamodb_table.gaps.arn}/index/*",
    ]
  }

  statement {
    sid     = "DenyEventAndGapMutation"
    effect  = "Deny"
    actions = local.mutating_actions
    resources = [
      aws_dynamodb_table.events.arn,
      "${aws_dynamodb_table.events.arn}/index/*",
      aws_dynamodb_table.gaps.arn,
      "${aws_dynamodb_table.gaps.arn}/index/*",
    ]
  }

  statement {
    sid       = "EmbedQuery"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.embed_model_arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.search.arn}:*"]
  }
}

resource "aws_iam_role_policy" "search" {
  name   = "${local.prefix}-search-policy"
  role   = aws_iam_role.search.id
  policy = data.aws_iam_policy_document.search.json
}

# ---------------------------------------------------------------- events
resource "aws_iam_role" "events" {
  name               = "${local.prefix}-events-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "events" {
  statement {
    sid     = "AppendEvents"
    actions = ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:GetItem"]
    resources = [
      aws_dynamodb_table.events.arn,
      "${aws_dynamodb_table.events.arn}/index/*",
    ]
  }

  statement {
    sid     = "DenyEventMutation"
    effect  = "Deny"
    actions = local.mutating_actions
    resources = [
      aws_dynamodb_table.events.arn,
      "${aws_dynamodb_table.events.arn}/index/*",
    ]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.events.arn}:*"]
  }
}

resource "aws_iam_role_policy" "events" {
  name   = "${local.prefix}-events-policy"
  role   = aws_iam_role.events.id
  policy = data.aws_iam_policy_document.events.json
}
