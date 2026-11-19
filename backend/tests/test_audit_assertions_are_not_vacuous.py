"""An audit assertion in a `django_db` test reads real rows: the rows are written inside the transaction.

H19's shape, until 2026-11-19: the audit signals wrote through `transaction.on_commit`, a `django_db` test's
transaction rolls back, the callbacks never ran -- "an audit row exists" went red, and "no audit row exists"
**passed unconditionally**. `apps/audit/oncommit_guard.py` (a pytest plugin on `pytest.ini`'s addopts) refused
such reads at the end of the test. The rows now go in with the business write (user decision 2026-11-19,
`tests/test_audit_inside_transactions.py`), so the table is not empty by construction and the plugin is gone.

What keeps that true: the first test is the old vacuous probe, now a real assertion that goes red if the row is
deferred again; the second refuses an audit callback queued on commit; the third, the plugin coming back.
"""
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.django_db
def test_a_rolled_back_tests_audit_rows_are_there_to_read():
    """The probe the plugin used to refuse (`count() == 0` after a write): now the row is visible, uncommitted."""
    from apps.audit.models import AuditLog
    from apps.tenants.models import Tenant

    Tenant.objects.get_or_create(code="VAC1", defaults={"display_name": "P"})
    assert AuditLog.objects.filter(resource="tenant", action="CREATE").count() == 1


@pytest.mark.django_db
def test_no_audit_row_waits_for_the_commit(django_capture_on_commit_callbacks):
    from apps.tenants.models import Tenant

    with django_capture_on_commit_callbacks() as callbacks:
        Tenant.objects.get_or_create(code="VAC2", defaults={"display_name": "P"})
    assert [c for c in callbacks if getattr(c, "__module__", "").startswith("apps.audit")] == []


def test_the_on_commit_guard_plugin_is_gone():
    """A guard for a deferral that no longer exists would never fire, and a check that cannot fire reads as green."""
    assert not (REPO_ROOT / "backend/apps/audit/oncommit_guard.py").exists()
    assert "oncommit_guard" not in (REPO_ROOT / "pytest.ini").read_text(encoding="utf-8")
