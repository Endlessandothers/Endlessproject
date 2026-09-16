locals {
  common_env = {
    TOOLS_TABLE  = aws_dynamodb_table.tools.name
    EVENTS_TABLE = aws_dynamodb_table.events.name
    GAPS_TABLE   = aws_dynamodb_table.gaps.name
    # No VECTORS_BUCKET. Authority for a tool's vector is the tool row, and at
    # 15-20 tools a cold-start scan is cheaper than maintaining a second copy.
    # A snapshot cache becomes a real decision when the corpus outgrows a scan,
    # which is a Phase 1 problem with Phase 0 data in hand.
    EMBED_MODEL_ID   = var.embed_model_id
    EMBED_DIMS       = tostring(var.embed_dims)
    THRESHOLD_T      = tostring(var.threshold_t)
    CACHE_TTL_MS     = tostring(var.cache_ttl_ms)
    FUSION_ALPHA     = tostring(var.fusion_alpha)
    JUDGE_MODEL_ID   = var.judge_model_id
    JUDGE_CANDIDATES = tostring(var.judge_candidates)
  }
}

# ---------------------------------------------------------------- packaging
#
# output_file_mode is not cosmetic. Without it the archive provider stamps the
# host's file modes into each zip entry, so a zip built on Windows and one built
# on a Linux runner differ even when the source bytes are identical. The result
# is aws_lambda_function.source_code_hash never matching between a local plan
# and a CI plan: the three functions show as changing forever, they redeploy on
# every apply, and "No changes" stops meaning anything.
#
# A plan you have learned to ignore is worse than no plan at all.
data "archive_file" "registry" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/registry"
  output_path      = "${path.module}/.build/registry.zip"
  output_file_mode = "0666"
}

data "archive_file" "search" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/search"
  output_path      = "${path.module}/.build/search.zip"
  output_file_mode = "0666"
}

data "archive_file" "events" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/events"
  output_path      = "${path.module}/.build/events.zip"
  output_file_mode = "0666"
}

# ---------------------------------------------------------------- log groups
# Created explicitly so retention is bounded. Lambda would otherwise create them
# with retention "never expire", which quietly grows past the free 5 GB.
resource "aws_cloudwatch_log_group" "registry" {
  name              = "/aws/lambda/${local.prefix}-registry"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "search" {
  name              = "/aws/lambda/${local.prefix}-search"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "events" {
  name              = "/aws/lambda/${local.prefix}-events"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------- functions
resource "aws_lambda_function" "registry" {
  function_name    = "${local.prefix}-registry"
  role             = aws_iam_role.registry.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  memory_size      = 512
  timeout          = 30
  filename         = data.archive_file.registry.output_path
  source_code_hash = data.archive_file.registry.output_base64sha256

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.registry]
}

# More memory than it strictly needs: Lambda scales CPU with memory, so 1024 MB
# makes the cosine loop and JSON handling faster and often costs the same or
# fewer GB-seconds overall.
resource "aws_lambda_function" "search" {
  function_name = "${local.prefix}-search"
  role          = aws_iam_role.search.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 1024
  timeout       = 30

  # No reserved_concurrent_executions here, deliberately.
  #
  # This account's TOTAL Lambda concurrency limit is 10, and AWS refuses any
  # reservation that would drop unreserved concurrency below 10 - so reserving
  # anything at all is impossible until the account limit is raised.
  #
  # That account cap of 10 is itself a tighter ceiling on concurrent Bedrock
  # spend than the reservation would have been, so the cost control still holds.
  # If the limit is ever raised, add a reservation back here: the billing alarm
  # reports spend after the fact and is not a cap.

  filename         = data.archive_file.search.output_path
  source_code_hash = data.archive_file.search.output_base64sha256

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.search]
}

resource "aws_lambda_function" "events" {
  function_name    = "${local.prefix}-events"
  role             = aws_iam_role.events.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  memory_size      = 512
  timeout          = 30
  filename         = data.archive_file.events.output_path
  source_code_hash = data.archive_file.events.output_base64sha256

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.events]
}

# ---------------------------------------------------------------- URLs
# Function URLs rather than API Gateway: Lambda has an always-free allowance,
# API Gateway is free for 12 months only.
resource "aws_lambda_function_url" "registry" {
  function_name      = aws_lambda_function.registry.function_name
  authorization_type = "AWS_IAM"
}

resource "aws_lambda_function_url" "search" {
  function_name      = aws_lambda_function.search.function_name
  authorization_type = var.search_url_auth
}

resource "aws_lambda_function_url" "events" {
  function_name      = aws_lambda_function.events.function_name
  authorization_type = "AWS_IAM"
}
