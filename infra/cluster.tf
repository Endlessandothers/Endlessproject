# cluster-fn and the gaps board bucket — Phase 1, issues #8, #9 and #12.
#
# The nightly job that turns logged gaps into demand, and the S3 object it
# writes for the public board to serve.
#
# No new DynamoDB table. The free-tier budget is at 23 of 25 RCU/WCU and a
# snapshot in S3 is the better shape anyway: the board is read-mostly and
# public, so serving it from CloudFront costs nothing per visitor and cannot be
# made expensive by traffic. That matters because the board is the part of
# Endless with an obvious reason to be attacked.

data "archive_file" "cluster" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/cluster"
  output_path      = "${path.module}/.build/cluster.zip"
  output_file_mode = "0666"
}

resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aws/lambda/${local.prefix}-cluster"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------- the bucket
resource "aws_s3_bucket" "board" {
  bucket = "${local.prefix}-board-${local.account_id}"
}

# Public access stays blocked at the bucket. The board is served through
# CloudFront with an origin access control, so the bucket itself is never a
# public endpoint — a bucket that is world-readable is one misplaced object away
# from being a data leak, and there is no reason to accept that for a file
# CloudFront can fetch privately.
resource "aws_s3_bucket_public_access_block" "board" {
  bucket                  = aws_s3_bucket.board.id
  block_public_acls       = true
  block_public_policy     = false # the CloudFront OAC policy below is not public
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_server_side_encryption_configuration" "board" {
  bucket = aws_s3_bucket.board.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "board" {
  bucket = aws_s3_bucket.board.id
  # Every nightly run overwrites gaps.json. Versioning means a run that produces
  # a wrong board can be compared against the one before it, which is the only
  # way to tell "demand changed" from "the job broke".
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "board" {
  bucket = aws_s3_bucket.board.id
  rule {
    id     = "expire-old-snapshots"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# ---------------------------------------------------------------- the role
resource "aws_iam_role" "cluster" {
  name               = "${local.prefix}-cluster-role"
  description        = "Nightly gap clustering. Reads gaps, writes one object."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "cluster" {
  statement {
    sid     = "ReadGaps"
    actions = ["dynamodb:Scan", "dynamodb:Query"]
    resources = [
      aws_dynamodb_table.gaps.arn,
      "${aws_dynamodb_table.gaps.arn}/index/*",
    ]
  }

  # Reading gaps must never be able to change one. The board is derived from the
  # log; if the job could edit the log, the board would be evidence of itself.
  statement {
    sid       = "DenyGapWrites"
    effect    = "Deny"
    actions   = concat(local.mutating_actions, ["dynamodb:PutItem"])
    resources = [aws_dynamodb_table.gaps.arn, "${aws_dynamodb_table.gaps.arn}/index/*"]
  }

  # One object, named. Not the bucket, not a prefix: this job writes gaps.json
  # and has no business writing anything else into a bucket CloudFront serves.
  statement {
    sid       = "WriteTheSnapshot"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.board.arn}/gaps.json"]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.cluster.arn}:*"]
  }
}

resource "aws_iam_role_policy" "cluster" {
  name   = "${local.prefix}-cluster-policy"
  role   = aws_iam_role.cluster.id
  policy = data.aws_iam_policy_document.cluster.json
}

# ---------------------------------------------------------------- the function
resource "aws_lambda_function" "cluster" {
  function_name = "${local.prefix}-cluster"
  role          = aws_iam_role.cluster.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 1024

  # Clustering is O(n^2) over gap vectors. At Phase 1 volumes that is
  # milliseconds; the long timeout is headroom for the scan, not for the maths.
  timeout = 300

  filename         = data.archive_file.cluster.output_path
  source_code_hash = data.archive_file.cluster.output_base64sha256

  environment {
    variables = {
      GAPS_TABLE         = aws_dynamodb_table.gaps.name
      BOARD_BUCKET       = aws_s3_bucket.board.id
      CLUSTER_SIMILARITY = tostring(var.cluster_similarity)
    }
  }

  depends_on = [aws_cloudwatch_log_group.cluster, aws_iam_role_policy.cluster]
}

# ---------------------------------------------------------------- the schedule
# Nightly rather than on every search. Demand is a trend, and recomputing it per
# request would cost money to tell you the same thing.
resource "aws_cloudwatch_event_rule" "cluster_nightly" {
  name                = "${local.prefix}-cluster-nightly"
  description         = "Recompute gap clusters and refresh the public board."
  schedule_expression = var.cluster_schedule
}

resource "aws_cloudwatch_event_target" "cluster_nightly" {
  rule      = aws_cloudwatch_event_rule.cluster_nightly.name
  target_id = "cluster"
  arn       = aws_lambda_function.cluster.arn
}

resource "aws_lambda_permission" "cluster_nightly" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cluster.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cluster_nightly.arn
}
