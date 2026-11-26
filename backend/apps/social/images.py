"""Moved to `apps.core.images` (2026-11-26); re-exported here for the callers and tests that import it."""
from apps.core.images import (  # noqa: F401
    CONTENT_TYPES,
    FORMATS,
    HEIF_BRANDS,
    MAX_BYTES,
    MAX_PIXELS,
    ImageRejectedError,
    Reencoded,
    reencode,
    sniff_format,
)
