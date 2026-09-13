#!/usr/bin/env python3
"""Tiny R2 (S3-compatible) helper for the housekeeping backups.

Credentials come from the environment (loaded from .env by the calling
script): R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.

Commands:
  put <local-file> <key>   upload, then HEAD the key and verify the stored
                           size matches the local file; prints the verified
                           size; exits non-zero on any mismatch
  latest <prefix>          print the lexicographically newest key under the
                           prefix (our keys embed sortable timestamps)
  exists <prefix>          exit 0 if any object exists under the prefix
  get <key> <local-file>   download
"""
import os
import sys

import boto3


def client():
    endpoint = os.environ.get("R2_ENDPOINT")
    if not endpoint:
        sys.exit("R2_ENDPOINT not set")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def main():
    cmd = sys.argv[1]
    bucket = os.environ["R2_BUCKET"]
    s3 = client()

    if cmd == "put":
        local, key = sys.argv[2], sys.argv[3]
        local_size = os.path.getsize(local)
        s3.upload_file(local, bucket, key)
        # Trust nothing: verify the object actually landed with the right size
        head = s3.head_object(Bucket=bucket, Key=key)
        remote_size = head["ContentLength"]
        if remote_size != local_size:
            sys.exit(f"VERIFY FAILED {key}: local {local_size} bytes, stored {remote_size} bytes")
        print(f"verified {key}: {remote_size:,} bytes")

    elif cmd == "latest":
        prefix = sys.argv[2]
        keys = []
        token = None
        while True:
            kw = {"Bucket": bucket, "Prefix": prefix}
            if token:
                kw["ContinuationToken"] = token
            resp = s3.list_objects_v2(**kw)
            keys += [o["Key"] for o in resp.get("Contents", [])]
            token = resp.get("NextContinuationToken")
            if not token:
                break
        if not keys:
            sys.exit(1)
        print(sorted(keys)[-1])

    elif cmd == "exists":
        prefix = sys.argv[2]
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)
        sys.exit(0 if resp.get("KeyCount", 0) > 0 else 1)

    elif cmd == "get":
        key, local = sys.argv[2], sys.argv[3]
        s3.download_file(bucket, key, local)
        print(f"downloaded {key} -> {local} ({os.path.getsize(local):,} bytes)")

    else:
        sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
