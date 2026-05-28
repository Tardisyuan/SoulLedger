"""
Karma domain models.

SoulRecord (the core karma data model) is defined in souls/record_models.py
for backward compatibility. This module re-exports it as the canonical
karma-domain interface.

TODO (M8-2): Move SoulRecord physically to this file and create a proper
             app_label migration.
"""
from apps.souls.record_models import SoulRecord, RecordType, RecordCategory

# Canonical alias for karma-domain usage
KarmaRecord = SoulRecord

__all__ = ["SoulRecord", "KarmaRecord", "RecordType", "RecordCategory"]
