# The sandbox functions — Phase 1, issues #3 and #4.
#
# Two functions on opposite sides of the boundary:
#
#   runtime-fn  runs creator code. Inside the no-egress VPC, no permissions.
#   fetcher-fn  makes the outbound call. Outside the VPC, no permissions.
#
# Neither can do the other's job, which is the entire arrangement.

data "archive_file" "runtime" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/runtime"
  output_path      = "${path.module}/.build/runtime.zip"
  output_file_mode = "0666"
}

data "archive_file" "fetcher" {
  type             = "zip"
  source_dir       = "${path.module}/lambda/fetcher"
  output_path      = "${path.module}/.build/fetcher.zip"
  output_file_mode = "0666"
}

resource "aws_cloudwatch_log_group" "runtime" {
  name              = "/aws/lambda/${local.prefix}-runtime"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "fetcher" {
  name              = "/aws/lambda/${local.prefix}-fetcher"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------- runtime role
# This role is as close to empty as a VPC Lambda can be.
#
# The ec2 network-interface actions are NOT optional and NOT a loophole: Lambda
# itself uses them, as the function's role, to attach an ENI to the subnet. Without
# them the function cannot be placed in a VPC at all. They do not let code inside
# the function reach anything — that is settled by the absence of a route.
#
# They cannot be resource-scoped: CreateNetworkInterface has no resource to name
# at the time it is called, so these five sit on "*". That is the documented AWS
# requirement for any VPC Lambda, not a concession made here — and it buys an
# attacker nothing, because creating an ENI in a subnet with no route reaches
# exactly as far as the subnet does.
resource "aws_iam_role" "runtime" {
  name               = "${local.prefix}-runtime-role"
  description        = "Tool runtime. Grants nothing but its own log stream and the ENI attach Lambda performs on its behalf."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "runtime" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.runtime.arn}:*"]
  }

  statement {
    sid = "VpcAttachmentPerformedByLambdaService"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }

  # Everything a tool might reach for, denied explicitly. None of it would work
  # anyway — there is no route and no other grant — but an explicit Deny cannot
  # be widened later by someone attaching a broader policy to this role.
  #
  # kms is NOT in this list, and that is deliberate. Lambda decrypts a function's
  # environment variables through the execution role at init, and an explicit
  # Deny overrides that service path as surely as it overrides a tool: the first
  # deployment of this role failed every invocation with KMSAccessDeniedException
  # before a single line of tool code ran. KMS stays on implicit deny, which
  # still refuses the tool and permits the platform.
  statement {
    sid    = "DenyEverythingElse"
    effect = "Deny"
    actions = [
      "dynamodb:*", "s3:*", "bedrock:*", "lambda:*", "sts:*",
      "secretsmanager:*", "ssm:*", "iam:*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "runtime" {
  name   = "${local.prefix}-runtime-policy"
  role   = aws_iam_role.runtime.id
  policy = data.aws_iam_policy_document.runtime.json
}

# ---------------------------------------------------------------- fetcher role
# Outside the VPC because it must reach the internet. It holds no AWS
# permissions at all beyond logging, so compromising it yields the ability to
# fetch public URLs — which is already its job.
resource "aws_iam_role" "fetcher" {
  name               = "${local.prefix}-fetcher-role"
  description        = "Outbound fetcher. Internet access, zero AWS access."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "fetcher" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.fetcher.arn}:*"]
  }

  statement {
    sid    = "DenyAllAwsAccess"
    effect = "Deny"
    actions = [
      "dynamodb:*", "s3:*", "bedrock:*", "lambda:*", "sts:*",
      "secretsmanager:*", "ssm:*", "iam:*", "ec2:*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "fetcher" {
  name   = "${local.prefix}-fetcher-policy"
  role   = aws_iam_role.fetcher.id
  policy = data.aws_iam_policy_document.fetcher.json
}

# ---------------------------------------------------------------- functions
resource "aws_lambda_function" "runtime" {
  function_name = "${local.prefix}-runtime"
  role          = aws_iam_role.runtime.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = var.runtime_memory_mb
  timeout       = 30

  filename         = data.archive_file.runtime.output_path
  source_code_hash = data.archive_file.runtime.output_base64sha256

  # The boundary. Subnets with no route out, a security group with no egress.
  vpc_config {
    subnet_ids         = [for s in aws_subnet.sandbox : s.id]
    security_group_ids = [aws_security_group.sandbox.id]
  }

  environment {
    variables = {
      TRANSFORM_TIMEOUT_MS = tostring(var.transform_timeout_ms)
    }
  }

  depends_on = [aws_cloudwatch_log_group.runtime, aws_iam_role_policy.runtime]
}

resource "aws_lambda_function" "fetcher" {
  function_name = "${local.prefix}-fetcher"
  role          = aws_iam_role.fetcher.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 30

  filename         = data.archive_file.fetcher.output_path
  source_code_hash = data.archive_file.fetcher.output_base64sha256

  environment {
    variables = {
      FETCH_TIMEOUT_MS   = tostring(var.fetch_timeout_ms)
      FETCH_MAX_BYTES    = "2097152"
      FETCH_MAX_REQUESTS = "4"
    }
  }

  depends_on = [aws_cloudwatch_log_group.fetcher, aws_iam_role_policy.fetcher]
}
