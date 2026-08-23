"""
Ledger domain models.

SoulRecord (the core ledger data model) is defined in souls/record_models.py
for backward compatibility. This module re-exports it as the canonical
ledger-domain interface.

DECIDED (M8-2), not pending. The TODO that stood here — "Move SoulRecord
physically to this file and create a proper app_label migration" — was costed
on 2026-08-23 and declined. Moving the app_label renames `souls_soulrecord`
(the table name is derived, not declared), edits state across 22 of the 27
`apps/souls` migrations, and carries one ContentType row plus four
`auth_permission` codenames with it, in exchange for nothing a caller can see:
`from apps.ledger.models import SoulRecord` already works, and it is the same
class object rather than a second definition. The full count, and what would
have to be deleted to reverse the decision, is in `apps/ledger/test_models.py`,
which pins it.
"""
from apps.souls.record_models import RecordCategory, RecordType, SoulRecord

# Canonical alias for ledger-domain usage
LedgerRecord = SoulRecord

__all__ = ["SoulRecord", "LedgerRecord", "RecordType", "RecordCategory"]
