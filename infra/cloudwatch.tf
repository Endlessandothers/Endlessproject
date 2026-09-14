# The billing alarm is a NOTIFICATION, not a cap. It tells you money is being
# spent; it does not stop it. The real cost controls are the AWS_IAM default on
# the search Function URL and the Lambda concurrency limit below.

resource "aws_sns_topic" "billing" {
  name = "${local.prefix}-billing-alerts"
}

resource "aws_sns_topic_subscription" "billing_email" {
  count     = var.billing_alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.billing.arn
  protocol  = "email"
  endpoint  = var.billing_alarm_email
}

# AWS/Billing metrics are only published in us-east-1, whatever region the
# resources live in. This stack is us-east-1 throughout, so no provider alias is
# needed - but if var.region ever moves, this alarm has to stay behind.
resource "aws_cloudwatch_metric_alarm" "billing" {
  alarm_name          = "${local.prefix}-estimated-charges"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600
  statistic           = "Maximum"
  threshold           = var.billing_alarm_threshold_usd
  alarm_description   = "Endless Phase 0 estimated charges exceeded $${var.billing_alarm_threshold_usd}."
  alarm_actions       = [aws_sns_topic.billing.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    Currency = "USD"
  }
}

# A retry on a Bedrock call is a second charge for the same request. Off.
resource "aws_lambda_function_event_invoke_config" "search" {
  function_name          = aws_lambda_function.search.function_name
  maximum_retry_attempts = 0
}

# The real ceiling on runaway Bedrock spend lives on the function itself:
# see reserved_concurrent_executions on aws_lambda_function.search in lambda.tf.
