"""
HMAC-SHA256 webhook signing utilities.
"""
import hmac
import hashlib
import time


def sign_payload(payload_bytes, secret, timestamp):
    """
    HMAC-SHA256 signature with timestamp to prevent replay.

    Args:
        payload_bytes: The request body as bytes
        secret: The signing secret
        timestamp: Unix timestamp string

    Returns:
        Hex digest string
    """
    message = f"{timestamp}.".encode() + payload_bytes
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify_signature(payload_bytes, secret, timestamp, signature):
    """
    Verify HMAC-SHA256 signature.

    Args:
        payload_bytes: The request body as bytes
        secret: The signing secret
        timestamp: Unix timestamp string
        signature: The signature to verify (with or without 'sha256=' prefix)

    Returns:
        True if signature is valid, False otherwise
    """
    expected = sign_payload(payload_bytes, secret, timestamp)
    # Normalize signature (remove prefix if present)
    if signature.startswith("sha256="):
        signature = signature[7:]
    return hmac.compare_digest(f"sha256={expected}", f"sha256={signature}")


def is_timestamp_fresh(timestamp_str, max_age_seconds=300):
    """
    Check if a timestamp is within acceptable age (replay protection).

    Args:
        timestamp_str: Unix timestamp as string
        max_age_seconds: Maximum allowed age in seconds (default 5 minutes)

    Returns:
        True if timestamp is fresh, False otherwise
    """
    try:
        timestamp = int(timestamp_str)
        return abs(time.time() - timestamp) <= max_age_seconds
    except (ValueError, TypeError):
        return False
