# The vector snapshot is a DERIVED CACHE, not a source of truth.
#
# Authority for a tool's vector is the tool row in DynamoDB. This bucket holds a
# rebuildable snapshot so a Lambda cold start can load every vector with one GET
# instead of scanning the table. If the two disagree, the table wins and the
# snapshot gets rebuilt. Naming that now is what stops them drifting silently.

resource "aws_s3_bucket" "vectors" {
  bucket = "${local.prefix}-vectors-${local.account_id}"

  tags = {
    Name = "${local.prefix}-vectors"
    Role = "derived-cache-rebuildable"
  }
}

resource "aws_s3_bucket_public_access_block" "vectors" {
  bucket                  = aws_s3_bucket.vectors.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "vectors" {
  bucket = aws_s3_bucket.vectors.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "vectors" {
  bucket = aws_s3_bucket.vectors.id

  versioning_configuration {
    status = "Enabled"
  }
}

# The snapshot is rebuildable, so old versions are pure cost. Expire them.
resource "aws_s3_bucket_lifecycle_configuration" "vectors" {
  bucket = aws_s3_bucket.vectors.id

  rule {
    id     = "expire-old-snapshots"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.vectors]
}
