# mcp-fn — Phase 1, issue #7.
#
# The endpoint an agent can actually use. Everything before this was reachable
# only by someone able to sign an AWS request, which is not how a tool-using
# agent works.
#
# It is a protocol adapter and holds no authority of its own. The caller's
# Authorization header is forwarded to search-fn and exec-fn, which verify it
# exactly as they would for any other caller — so this function cannot do
# anything the caller could not already do, and gap counts record the agent
# rather than the adapter.

data "archive_file" "mcp" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/mcp"
  output_path      = "${path.module}/.build/mcp.zip"
  output_file_mode = "0666"
}

resource "aws_cloudwatch_log_group" "mcp" {
  name              = "/aws/lambda/${local.prefix}-mcp"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "mcp" {
  name               = "${local.prefix}-mcp-role"
  description        = "MCP protocol adapter. Invokes search and exec; touches no table."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "mcp" {
  # Two functions, named individually. Not a prefix: an adapter that took a
  # caller-supplied name and invoked it would be a path from the internet into
  # whatever function that name resolved to.
  statement {
    sid     = "InvokeSearchAndExecOnly"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.search.arn,
      aws_lambda_function.exec.arn,
    ]
  }

  # No DynamoDB at all, deliberately. This function has no reason to read the
  # registry, the log, the gaps or the callers directly, and the absence of the
  # grant is what keeps it an adapter rather than a second front door.
  statement {
    sid       = "DenyAllData"
    effect    = "Deny"
    actions   = ["dynamodb:*", "s3:*", "bedrock:*"]
    resources = ["*"]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.mcp.arn}:*"]
  }
}

resource "aws_iam_role_policy" "mcp" {
  name   = "${local.prefix}-mcp-policy"
  role   = aws_iam_role.mcp.id
  policy = data.aws_iam_policy_document.mcp.json
}

resource "aws_lambda_function" "mcp" {
  function_name = "${local.prefix}-mcp"
  role          = aws_iam_role.mcp.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 512

  # Longer than exec-fn's 60, because an MCP call to endless_call waits on it.
  timeout = 90

  filename         = data.archive_file.mcp.output_path
  source_code_hash = data.archive_file.mcp.output_base64sha256

  environment {
    variables = {
      SEARCH_FN = aws_lambda_function.search.function_name
      EXEC_FN   = aws_lambda_function.exec.function_name
      BOARD_URL = "https://${aws_cloudfront_distribution.board.domain_name}/"
    }
  }

  depends_on = [aws_cloudwatch_log_group.mcp, aws_iam_role_policy.mcp]
}

# NONE, not AWS_IAM — and this is the one endpoint where that is correct.
#
# An MCP client is a general agent runtime. It can send an Authorization header;
# it cannot sign a SigV4 request against an account it has no credentials for.
# Requiring IAM here would mean no agent can ever connect, which defeats the
# purpose of the issue.
#
# The endpoint is NOT unauthenticated. Every method that touches data forwards
# the caller's Endless API key to search-fn or exec-fn, and those refuse without
# one. What NONE removes is the AWS-shaped outer layer, not the inner check.
#
# The exposure this accepts: initialize, ping and tools/list answer without a
# key, so an unauthenticated flood can make this function run. That is the DDoS
# surface named in the Phase 1 risks and it is why CloudFront and WAF in front
# of this is the next item on that list rather than a nicety.
resource "aws_lambda_function_url" "mcp" {
  function_name      = aws_lambda_function.mcp.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["POST"]
    allow_headers = ["content-type", "authorization", "mcp-protocol-version"]
    max_age       = 86400
  }
}

output "mcp_url" {
  description = "MCP endpoint. Send an Endless API key as a bearer token."
  value       = aws_lambda_function_url.mcp.function_url
}
