"""
Ledger domain models.

SoulRecord (the core ledger data model) is defined in souls/record_models.py
for backward compatibility. This module re-exports it as the canonical
ledger-domain interface.

TODO (M8-2): Move SoulRecord physically to this file and create a proper
             app_label migration.
"""
from apps.souls.record_models import RecordCategory, RecordType, SoulRecord

# Canonical alias for ledger-domain usage
LedgerRecord = SoulRecord

__all__ = ["SoulRecord", "LedgerRecord", "RecordType", "RecordCategory"]
