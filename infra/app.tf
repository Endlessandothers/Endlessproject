# endless-app — the page people use, on Fargate.
#
# THIS IS THE FIRST THING THAT LEAVES THE FREE TIER.
#
# Everything else in this project runs inside an always-free allowance and has
# cost under $5 across four phases. One 0.25 vCPU / 0.5 GB Fargate task running
# continuously is roughly $9 a month, and it is billed whether anyone visits or
# not. That is a deliberate choice made in the open rather than a surprise on a
# statement — see the cost notes on aws_ecs_service below for how to stop paying
# for it without destroying anything.
#
# ITS OWN NETWORK, AND THAT IS NOT OPTIONAL.
#
# The sandbox VPC has no internet gateway and no NAT. That absence is the entire
# execution guarantee: 22 live escape tests prove a handler that fully escapes
# the source screen still reaches nothing, because there is nowhere to reach.
# Putting a public-facing container in that VPC would mean adding an internet
# gateway to the one network whose value is not having one.
#
# So the app gets a separate VPC. No peering, no shared subnets, no route
# between them. The app talks to the platform the same way any other client
# does: over the public MCP endpoint, with a key.
#
# AND NO NAT GATEWAY. A NAT gateway is about $32 a month — three times the task
# it would serve. The task sits in a public subnet with its own public IP
# instead, which is the cheap arrangement and, for a container that holds no
# credentials and stores nothing, an entirely reasonable one.

resource "aws_vpc" "app" {
  cidr_block           = "10.43.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name      = "${local.prefix}-app"
    Invariant = "separate-from-the-sandbox-vpc"
  }
}

resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id
  tags   = { Name = "${local.prefix}-app-igw" }
}

# Two subnets in different zones. Fargate places the task in one of them; the
# second exists so a zone going away is a restart rather than an outage.
resource "aws_subnet" "app" {
  for_each = { a = "us-east-1a", b = "us-east-1b" }

  vpc_id                  = aws_vpc.app.id
  cidr_block              = each.key == "a" ? "10.43.1.0/24" : "10.43.2.0/24"
  availability_zone       = each.value
  map_public_ip_on_launch = true

  tags = { Name = "${local.prefix}-app-${each.key}" }
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.app.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }

  tags = { Name = "${local.prefix}-app-rt" }
}

resource "aws_route_table_association" "app" {
  for_each       = aws_subnet.app
  subnet_id      = each.value.id
  route_table_id = aws_route_table.app.id
}

# Inbound on the app port only. No SSH, no exec, nothing else — there is nothing
# in this container worth reaching and no credential to steal from it.
resource "aws_security_group" "app" {
  name        = "${local.prefix}-app-sg"
  description = "endless-app: HTTP in, everything out."
  vpc_id      = aws_vpc.app.id

  ingress {
    description = "The page itself."
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Outbound is open because the app must reach the MCP endpoint, CloudFront and
  # ECR. This is the opposite of the sandbox security group, which has no egress
  # rules at all — and the contrast is the point of them being separate.
  egress {
    description = "Pull images, and reach the platform like any other client."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.prefix}-app-sg" }
}

# ---------------------------------------------------------------- image
resource "aws_ecr_repository" "app" {
  name                 = "${local.prefix}-app"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Old images are not history worth keeping. The tag that matters is the one
# running, and the source is in git.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 3 images."
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 3 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------- roles
#
# The execution role is ECS's, not the app's: it pulls the image and writes
# logs, before any of our code runs.
resource "aws_iam_role" "app_execution" {
  name        = "${local.prefix}-app-execution-role"
  description = "Used by ECS to pull the image and write logs. Never by the app."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "app_execution" {
  role       = aws_iam_role.app_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# THERE IS NO TASK ROLE.
#
# Not an omission. The app holds no AWS credentials because it needs none: it
# reaches the registry over the public MCP endpoint with the visitor's own key,
# and reads the board from CloudFront like anyone else. A task role would be a
# credential sitting in a public-facing container for no reason.

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.prefix}-app"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------- the task
resource "aws_ecs_cluster" "app" {
  name = "${local.prefix}-app"

  setting {
    name  = "containerInsights"
    value = "disabled" # Billed per metric, and this is one container.
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.prefix}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"

  # The smallest Fargate size there is. The app serves a static page and relays
  # JSON; anything larger would be paying for idle.
  cpu                = "256"
  memory             = "512"
  execution_role_arn = aws_iam_role.app_execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64" # Graviton: cheaper per second, same image.
  }

  container_definitions = jsonencode([{
    name      = "app"
    image     = "${aws_ecr_repository.app.repository_url}:${var.app_image_tag}"
    essential = true

    portMappings = [{ containerPort = 8080, protocol = "tcp" }]

    environment = [
      { name = "MCP_URL", value = aws_lambda_function_url.mcp.function_url },
      { name = "BOARD_URL", value = "https://${aws_cloudfront_distribution.board.domain_name}/" },
    ]

    # Reports whether the container is alive, not whether the registry is
    # reachable. Conflating them would have ECS restart the task every time
    # Bedrock was slow.
    healthCheck = {
      command     = ["CMD-SHELL", "wget -q -O /dev/null http://localhost:8080/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 10
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "app"
      }
    }

    readonlyRootFilesystem = true
    user                   = "node"
  }])
}

# desired_count is a variable so this can be turned off without destroying
# anything: set app_desired_count to 0 and the bill stops. The VPC, the
# repository and the definition all cost nothing when no task is running.
resource "aws_ecs_service" "app" {
  name            = "${local.prefix}-app"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.app_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for s in aws_subnet.app : s.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true # Instead of a NAT gateway, which costs more than the task.
  }

  # One task, replaced rather than doubled. A moment of downtime on a deploy is
  # the right trade for not paying for two.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  lifecycle {
    ignore_changes = [desired_count]
  }
}

output "app_repository" {
  description = "Push the image here, then deploy."
  value       = aws_ecr_repository.app.repository_url
}

output "app_hint" {
  description = "Fargate gives the task a public IP rather than a stable name; this finds it."
  value       = "aws ecs list-tasks --cluster ${aws_ecs_cluster.app.name} --region ${var.region}"
}
