# The kill switch — the other half of closing Phase 1.
#
# mcp-fn's Function URL is authorization_type NONE, because an agent runtime can
# send a bearer token and cannot sign SigV4. That makes it the one publicly
# reachable surface in Endless, and a public surface with no ceiling is a
# standing invitation to spend the account's money.
#
# Two controls, in the order they act:
#
#   1. mcp-fn refuses any request without a well-formed Endless key, before
#      invoking anything. Free, and it removes the cheap flood.
#   2. If invocations still cross the threshold below, this throttles the
#      function to zero and tells you. Throttled invocations are not billed.
#
# WHY A KILL SWITCH RATHER THAN A RATE LIMITER. A rate limiter needs per-caller
# state on the hot path, which is exactly what a flood makes expensive — the
# defence would scale its cost with the attack. This costs nothing until it
# fires and nothing after.
#
# WHAT IT TRADES. The endpoint goes down for everyone until a human restores it.
# Right for a free-tier project with one operator, where an outage is one
# command to undo and a surprise bill is not. Wrong the moment there is a
# customer, and at that point this should be replaced with a real rate limiter
# rather than have its threshold quietly raised.

data "archive_file" "killswitch" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/killswitch"
  output_path      = "${path.module}/.build/killswitch.zip"
  output_file_mode = "0666"
}

resource "aws_cloudwatch_log_group" "killswitch" {
  name              = "/aws/lambda/${local.prefix}-killswitch"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "killswitch" {
  name               = "${local.prefix}-killswitch-role"
  description        = "Throttles the public MCP endpoint when its alarm fires."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "killswitch" {
  # One function, named. It can throttle the public endpoint and nothing else —
  # in particular it cannot throttle exec, search or the registry, so a bug here
  # cannot take down the parts that are already behind AWS_IAM.
  statement {
    sid       = "ThrottleTheMcpEndpointOnly"
    actions   = ["lambda:PutFunctionConcurrency", "lambda:GetFunctionConcurrency"]
    resources = [aws_lambda_function.mcp.arn]
  }

  # It can raise the alarm, not clear it. Restoring service is deliberately a
  # human action taken after looking at why this fired.
  statement {
    sid       = "Alert"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.billing.arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.killswitch.arn}:*"]
  }
}

resource "aws_iam_role_policy" "killswitch" {
  name   = "${local.prefix}-killswitch-policy"
  role   = aws_iam_role.killswitch.id
  policy = data.aws_iam_policy_document.killswitch.json
}

resource "aws_lambda_function" "killswitch" {
  function_name = "${local.prefix}-killswitch"
  role          = aws_iam_role.killswitch.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 30

  filename         = data.archive_file.killswitch.output_path
  source_code_hash = data.archive_file.killswitch.output_base64sha256

  environment {
    variables = {
      TARGET_FN   = aws_lambda_function.mcp.function_name
      ALERT_TOPIC = aws_sns_topic.billing.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.killswitch, aws_iam_role_policy.killswitch]
}

resource "aws_sns_topic_subscription" "killswitch" {
  topic_arn = aws_sns_topic.billing.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.killswitch.arn
}

resource "aws_lambda_permission" "killswitch_sns" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.killswitch.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.billing.arn
}

# The threshold is a rate nobody legitimate reaches yet.
#
# Measured: the whole blind-set replay was 35 requests. The account's concurrency
# ceiling is 10, so a determined flood tops out around 500/sec — this fires
# within a minute of one starting, and is far above anything real traffic does
# today. It is a number to revisit when there is real traffic to revisit it
# against, not a permanent judgement about what busy looks like.
resource "aws_cloudwatch_metric_alarm" "mcp_flood" {
  alarm_name          = "${local.prefix}-mcp-flood"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.mcp_flood_threshold
  alarm_description   = "The public MCP endpoint was invoked more than ${var.mcp_flood_threshold} times in five minutes. Throttling it to zero."
  alarm_actions       = [aws_sns_topic.billing.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.mcp.function_name
  }
}

output "mcp_restore_command" {
  description = "Run this after the kill switch fires, once you know why it fired."
  value       = "aws lambda delete-function-concurrency --function-name ${aws_lambda_function.mcp.function_name} --region ${var.region}"
}
