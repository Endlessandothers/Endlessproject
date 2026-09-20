# The public gaps board — Phase 1, issue #12.
#
# CloudFront in front of the snapshot bucket. PROJECT.md calls the gaps board a
# standalone product that is useful before the ecosystem exists, which is why it
# is worth building while there are still few tools to rank.
#
# WHY CLOUDFRONT RATHER THAN A PUBLIC BUCKET OR A LAMBDA URL.
#
# This is the one part of Endless with an obvious reason to be attacked: it is
# public, it is the product, and it is where a manufactured trend would be shown
# off. Served as two static objects from an edge cache it has no per-visitor
# compute, no database read, and no way for traffic to cost more than the free
# tier. A Lambda URL would put a billable function on the path of every visitor.
#
# The bucket stays private. CloudFront reaches it through an origin access
# control, so there is no public S3 endpoint to find and no way to enumerate the
# bucket even if the distribution is known.

resource "aws_cloudfront_origin_access_control" "board" {
  name                              = "${local.prefix}-board-oac"
  description                       = "CloudFront to the gaps board bucket."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "board" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "Endless public gaps board"

  # North America and Europe only. The cheapest class, and the board has no
  # audience yet that would justify paying for the others.
  price_class = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.board.bucket_regional_domain_name
    origin_id                = "board"
    origin_access_control_id = aws_cloudfront_origin_access_control.board.id
  }

  default_cache_behavior {
    target_origin_id       = "board"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # CachingOptimized, the AWS managed policy. The origin sets Cache-Control on
    # gaps.json to 5 minutes, and a nightly job does not need anything cleverer.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # The default *.cloudfront.net certificate. A custom domain is a Phase 2
    # concern and needs a certificate in us-east-1 plus DNS that does not exist.
    cloudfront_default_certificate = true
  }
}

# Only this distribution may read the bucket, and only these three objects.
#
# NAMED INDIVIDUALLY, not "/*". The bucket also holds sim-gaps.json, which
# carries caller identities for analysis — and with a wildcard policy CloudFront
# served it happily on the open internet at the first attempt, because "nothing
# links to it" is not access control and a default cache behaviour serves
# whatever it is asked for.
#
# So the public surface is an allowlist of objects rather than a bucket with
# things in it that are hoped to stay unnoticed. Anything added to this bucket
# is private until someone deliberately names it here.
data "aws_iam_policy_document" "board_bucket" {
  statement {
    sid     = "AllowCloudFrontReadPublishedObjects"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.board.arn}/index.html",
      "${aws_s3_bucket.board.arn}/gaps.json",
      "${aws_s3_bucket.board.arn}/tools.json",
    ]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.board.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "board" {
  bucket = aws_s3_bucket.board.id
  policy = data.aws_iam_policy_document.board_bucket.json
}

# The page itself, deployed with the infrastructure rather than by hand.
#
# etag on the source file means Terraform redeploys it when it changes and
# leaves it alone when it has not — the board is a static asset, not state.
resource "aws_s3_object" "board_index" {
  bucket       = aws_s3_bucket.board.id
  key          = "index.html"
  source       = "${path.module}/../board/index.html"
  etag         = filemd5("${path.module}/../board/index.html")
  content_type = "text/html; charset=utf-8"

  # Short, so a corrected board reaches people the same day. The file is 8 KB
  # and CloudFront absorbs the requests.
  cache_control = "public, max-age=300"
}

output "board_url" {
  description = "The public gaps board."
  value       = "https://${aws_cloudfront_distribution.board.domain_name}/"
}
