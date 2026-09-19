# The sandbox network — Phase 1, issue #3.
#
# This VPC has NO internet gateway and NO NAT gateway. That is the whole point:
# a Lambda placed in these subnets has no route off the network, so "the tool
# cannot reach the internet" is a routing fact rather than a promise made in
# application code.
#
# It also has no VPC endpoints, so the runtime cannot reach the AWS API either.
# Combined with a role that grants nothing, a tool that escapes its process finds
# no credentials and nowhere to send them.
#
# CloudWatch Logs still work: Lambda delivers logs through the service, not
# across the customer network path, so observability survives the isolation.
#
# Cost: a VPC, subnets and a security group are free. A NAT gateway is not, which
# is the other reason there isn't one.

resource "aws_vpc" "sandbox" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = false

  tags = {
    Name      = "${local.prefix}-sandbox"
    Invariant = "no-egress"
  }
}

# Two subnets in different AZs so Lambda keeps working if one is impaired.
# Both are private by construction: nothing routes them anywhere.
resource "aws_subnet" "sandbox" {
  for_each = toset(["a", "b"])

  vpc_id                  = aws_vpc.sandbox.id
  cidr_block              = each.key == "a" ? "10.42.1.0/24" : "10.42.2.0/24"
  availability_zone       = "${var.region}${each.key}"
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.prefix}-sandbox-${each.key}"
  }
}

# The default route table for this VPC carries only the local route AWS creates
# for the CIDR itself. No 0.0.0.0/0 entry is defined anywhere in this file, and
# that absence is the control.
resource "aws_default_route_table" "sandbox" {
  default_route_table_id = aws_vpc.sandbox.default_route_table_id

  tags = {
    Name      = "${local.prefix}-sandbox-no-egress"
    Invariant = "no-default-route"
  }
}

# A security group with no egress rules at all. Terraform's aws_security_group
# would otherwise inherit AWS's default allow-all egress, so the empty egress
# block is doing real work rather than being a placeholder.
resource "aws_security_group" "sandbox" {
  name        = "${local.prefix}-sandbox"
  description = "Tool runtime: no ingress, no egress."
  vpc_id      = aws_vpc.sandbox.id

  tags = {
    Name      = "${local.prefix}-sandbox"
    Invariant = "no-egress"
  }
}

# Belt and braces. Even if something later attaches a route, the NACL denies
# outbound to anywhere outside the VPC. Two independent controls, because one
# of them will eventually be edited by someone who does not know why it matters.
resource "aws_network_acl" "sandbox" {
  vpc_id     = aws_vpc.sandbox.id
  subnet_ids = [for s in aws_subnet.sandbox : s.id]

  ingress {
    rule_no    = 100
    protocol   = "-1"
    action     = "allow"
    cidr_block = aws_vpc.sandbox.cidr_block
    from_port  = 0
    to_port    = 0
  }

  egress {
    rule_no    = 100
    protocol   = "-1"
    action     = "allow"
    cidr_block = aws_vpc.sandbox.cidr_block
    from_port  = 0
    to_port    = 0
  }

  egress {
    rule_no    = 200
    protocol   = "-1"
    action     = "deny"
    cidr_block = "0.0.0.0/0"
    from_port  = 0
    to_port    = 0
  }

  tags = {
    Name = "${local.prefix}-sandbox-deny-outbound"
  }
}
