# answer-fn — the loop that turns a question into an answer.
#
# Everything else in this project returns a TOOL. That is right for an agent,
# which wants a capability it can compose, and wrong for a person, who asked
# "how strong is charizard" and was handed a form with a field called
# pokemon_name. This reads the question into that field, runs the tool, and
# says what came back in a sentence.
#
# IT HOLDS NO DATA PERMISSIONS. Not one table, not one bucket. It can invoke
# search-fn and exec-fn and read one SSM parameter, and that is the whole of it.
# Every read and write still happens inside the functions that already own
# those rights, under the caller's own credential, which this forwards rather
# than replaces. So a question asked here is charged to whoever asked it and
# counts exactly once toward demand — the alternative, a service identity of its
# own, would have made every question look like the same caller and quietly
# corrupted the only number this registry rests on.

resource "aws_cloudwatch_log_group" "answer" {
  name              = "/aws/lambda/${local.prefix}-answer"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "answer" {
  name        = "${local.prefix}-answer-role"
  description = "answer-fn. Invokes search and exec; reads one parameter. No tables."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

data "aws_iam_policy_document" "answer" {
  # Exactly two functions, named. Not a wildcard over the account's lambdas:
  # this one is reachable from a public page, so what it can reach is the
  # boundary that matters.
  statement {
    sid     = "RunTheTwoFunctionsItOrchestrates"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.search.arn,
      aws_lambda_function.exec.arn,
    ]
  }

  statement {
    sid       = "ReadTheAnthropicKey"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${var.anthropic_key_param}"]
  }

  statement {
    sid       = "DecryptThatParameter"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.answer.arn}:*"]
  }

  # Explicit, because this function talks to a model and the cost of a mistake
  # here is measured in money rather than in a failed request.
  statement {
    sid       = "NeverTheTablesDirectly"
    effect    = "Deny"
    actions   = ["dynamodb:*", "s3:*", "bedrock:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "answer" {
  name   = "${local.prefix}-answer-policy"
  role   = aws_iam_role.answer.id
  policy = data.aws_iam_policy_document.answer.json
}

data "archive_file" "answer" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/answer"
  output_path      = "${path.module}/.build/answer.zip"
  output_file_mode = "0666"
}

resource "aws_lambda_function" "answer" {
  function_name = "${local.prefix}-answer"
  role          = aws_iam_role.answer.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 512

  # Two model calls plus a tool run, in series. The 20s request timeout on each
  # model call plus a 30s exec leaves headroom inside this; the point of the
  # arithmetic is that a slow model degrades into an error with a message
  # rather than into a killed Lambda returning no body at all — which is
  # exactly how the judge failed once.
  timeout = 90

  filename         = data.archive_file.answer.output_path
  source_code_hash = data.archive_file.answer.output_base64sha256

  environment {
    variables = {
      SEARCH_FN           = aws_lambda_function.search.function_name
      EXEC_FN             = aws_lambda_function.exec.function_name
      ANTHROPIC_KEY_PARAM = var.anthropic_key_param
      ANSWER_MODEL_ID     = var.answer_model_id
      ANSWER_TIMEOUT_MS   = tostring(var.answer_timeout_ms)
    }
  }

  depends_on = [aws_cloudwatch_log_group.answer, aws_iam_role_policy.answer]
}
