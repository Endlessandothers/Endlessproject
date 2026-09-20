# exec-fn — Phase 1, issue #6.
#
# The orchestrator. It is the only component that can invoke both sides of the
# sandbox boundary, and it holds exactly the permissions that requires and no
# more: read the registry, append an event, invoke the two functions by name.
#
# It cannot mutate the registry, cannot read gaps, and cannot invoke anything
# other than the fetcher and the runtime.

data "archive_file" "exec" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/exec"
  output_path      = "${path.module}/.build/exec.zip"
  output_file_mode = "0666"
}

resource "aws_cloudwatch_log_group" "exec" {
  name              = "/aws/lambda/${local.prefix}-exec"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "exec" {
  name               = "${local.prefix}-exec-role"
  description        = "Tool execution orchestrator."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "exec" {
  statement {
    sid       = "ReadRegistry"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.tools.arn]
  }

  # Resolving a tool must never be able to change one.
  statement {
    sid       = "DenyRegistryWrites"
    effect    = "Deny"
    actions   = concat(local.mutating_actions, ["dynamodb:PutItem"])
    resources = [aws_dynamodb_table.tools.arn]
  }

  statement {
    sid       = "AppendCallEvents"
    actions   = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.events.arn, "${aws_dynamodb_table.events.arn}/index/*"]
  }

  statement {
    sid       = "DenyEventMutation"
    effect    = "Deny"
    actions   = local.mutating_actions
    resources = [aws_dynamodb_table.events.arn, "${aws_dynamodb_table.events.arn}/index/*"]
  }

  # The review gate. Read only, and there is no Allow for writing anywhere on
  # this table by any function — approving is an operator action from real
  # credentials. A compromise of exec-fn cannot approve the code it then runs.
  statement {
    sid       = "ReadApprovals"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.approvals.arn]
  }

  statement {
    sid       = "DenyApprovalWrites"
    effect    = "Deny"
    actions   = concat(local.mutating_actions, ["dynamodb:PutItem"])
    resources = [aws_dynamodb_table.approvals.arn]
  }

  # Read only, as with search-fn: exec-fn identifies its caller and records the
  # result, and calling a tool costs nothing, so it has no reason to write here.
  statement {
    sid       = "ReadCallers"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.callers.arn]
  }

  statement {
    sid       = "DenyCallerWrites"
    effect    = "Deny"
    actions   = concat(local.mutating_actions, ["dynamodb:PutItem"])
    resources = [aws_dynamodb_table.callers.arn]
  }

  # Named individually rather than by prefix. exec-fn invoking search-fn or
  # registry-fn would be a confused-deputy path from a caller-supplied payload
  # into a function with more authority than this one.
  statement {
    sid     = "InvokeSandboxOnly"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.fetcher.arn,
      aws_lambda_function.runtime.arn,
    ]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.exec.arn}:*"]
  }
}

resource "aws_iam_role_policy" "exec" {
  name   = "${local.prefix}-exec-policy"
  role   = aws_iam_role.exec.id
  policy = data.aws_iam_policy_document.exec.json
}

resource "aws_lambda_function" "exec" {
  function_name = "${local.prefix}-exec"
  role          = aws_iam_role.exec.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 512

  # Longer than the two it calls combined, so a slow upstream surfaces as the
  # tool being slow rather than as this function being broken.
  timeout = 60

  filename         = data.archive_file.exec.output_path
  source_code_hash = data.archive_file.exec.output_base64sha256

  environment {
    variables = {
      TOOLS_TABLE     = aws_dynamodb_table.tools.name
      EVENTS_TABLE    = aws_dynamodb_table.events.name
      FETCHER_FN      = aws_lambda_function.fetcher.function_name
      RUNTIME_FN      = aws_lambda_function.runtime.function_name
      CALLERS_TABLE   = aws_dynamodb_table.callers.name
      APPROVALS_TABLE = aws_dynamodb_table.approvals.name
    }
  }

  depends_on = [aws_cloudwatch_log_group.exec, aws_iam_role_policy.exec]
}

resource "aws_lambda_function_url" "exec" {
  function_name      = aws_lambda_function.exec.function_name
  authorization_type = "AWS_IAM"
}

output "exec_url" {
  description = "Tool execution endpoint. AWS_IAM on the URL, and an Endless API key in the Authorization header on top of it."
  value       = aws_lambda_function_url.exec.function_url
}
