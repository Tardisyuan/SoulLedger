"""处置期满:边界日、永久刑、幂等、租户扇出与每租户的 contextvar。

期满的算法在 `apps/disposition/expiry.py`;每日任务在 `apps/disposition/tasks.py`,
由 `apps/scheduler/registry.py` 每租户注册一行。
"""
import datetime
from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.disposition.expiry import expire_for_tenant, term_end, term_has_ended
from apps.disposition.models import Disposition
from apps.disposition.tasks import expire_due_dispositions, expire_due_dispositions_for_tenant
from apps.events.models import SoulEvent
from apps.scheduler import registry
from apps.souls.models import Soul, SoulState
from apps.tenants.managers import get_current_tenant
from apps.tenants.models import Tenant

D = datetime.date


# ---------------------------------------------------------------------------
# The rule itself
# ---------------------------------------------------------------------------

class TestTermEndBoundary:
    def test_the_anniversary_is_the_first_expired_day(self):
        start, years = (2000, 6, 15), 10
        assert term_end(start, years) == (2010, 6, 15)
        assert term_has_ended(start, years, D(2010, 6, 14)) is False
        assert term_has_ended(start, years, D(2010, 6, 15)) is True
        assert term_has_ended(start, years, D(2010, 6, 16)) is True

    def test_there_is_no_year_zero(self):
        # 5 BCE + 5 years is 1 CE, not "year 0" — year_span(-5, 1) == 5.
        assert term_end((-5, 1, 1), 5) == (1, 1, 1)
        # Staying on one side of the boundary needs no correction.
        assert term_end((-500, 1, 1), 100) == (-400, 1, 1)
        assert term_has_ended((-399, None, None), 1000, D(2026, 1, 1)) is True

    def test_unknown_month_waits_for_the_last_day_of_the_year(self):
        start, years = (2000, None, None), 10
        assert term_has_ended(start, years, D(2010, 12, 30)) is False
        assert term_has_ended(start, years, D(2010, 12, 31)) is True

    def test_unknown_day_waits_for_the_last_day_of_the_month(self):
        start, years = (2000, 2, None), 10
        assert term_has_ended(start, years, D(2010, 2, 27)) is False
        assert term_has_ended(start, years, D(2010, 2, 28)) is True

    def test_a_leap_day_start_expires_on_the_first_of_march(self):
        assert term_has_ended((2000, 2, 29), 1, D(2001, 2, 28)) is False
        assert term_has_ended((2000, 2, 29), 1, D(2001, 3, 1)) is True

    def test_a_zero_year_term_ends_on_its_start_day(self):
        assert term_has_ended((2026, 9, 24), 0, D(2026, 9, 23)) is False
        assert term_has_ended((2026, 9, 24), 0, D(2026, 9, 24)) is True

    def test_nothing_recorded_never_ends(self):
        assert term_has_ended(None, 10, D(9999, 1, 1)) is False
        assert term_has_ended((None, None, None), 10, D(9999, 1, 1)) is False
        assert term_has_ended((2000, 1, 1), None, D(9999, 1, 1)) is False


# ---------------------------------------------------------------------------
# The per-tenant run
# ---------------------------------------------------------------------------

def _soul(tenant, name):
    soul = Soul.objects.create(name=name, tenant=tenant, birth_year=1900, death_year=1950)
    soul.current_state = SoulState.REINCARNATING
    soul.save(update_fields=["current_state"])
    return soul


def _disposition(tenant, name, *, start=(2000, 6, 15), years=10, executed=True, eternal=False):
    return Disposition.objects.create(
        soul=_soul(tenant, name),
        tenant=tenant,
        is_executed=executed,
        executed_at=timezone.now() if executed else None,
        is_eternal=eternal,
        sentence_years=years,
        term_start_year=start[0] if start else None,
        term_start_month=start[1] if start else None,
        term_start_day=start[2] if start else None,
    )


BOUNDARY = D(2010, 6, 15)


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(code="EXP_A", display_name="Expiry A")


@pytest.fixture
def other_tenant(db):
    return Tenant.objects.create(code="EXP_B", display_name="Expiry B")


@pytest.mark.django_db
class TestExpireForTenant:
    def test_only_the_rows_whose_term_has_ended(self, tenant):
        due = _disposition(tenant, "due")
        tomorrow = _disposition(tenant, "not yet", start=(2000, 6, 16))
        eternal = _disposition(tenant, "eternal", eternal=True)
        no_years = _disposition(tenant, "no term", years=None)
        no_start = _disposition(tenant, "no start", start=None)
        pending = _disposition(tenant, "not executed", executed=False)

        result = expire_for_tenant(tenant, today=BOUNDARY)

        assert result["expired"] == 1
        expired = set(Disposition.objects.filter(expired_at__isnull=False).values_list("pk", flat=True))
        assert expired == {due.pk}
        for row in (tomorrow, eternal, no_years, no_start, pending):
            row.refresh_from_db()
            assert row.expired_at is None, row.soul.name

    def test_eternal_never_expires_however_long_it_has_run(self, tenant):
        eternal = _disposition(tenant, "eternal", start=(-3000, 1, 1), years=1, eternal=True)
        assert expire_for_tenant(tenant, today=D(9999, 12, 31))["expired"] == 0
        eternal.refresh_from_db()
        assert eternal.expired_at is None

    def test_idempotent(self, tenant):
        due = _disposition(tenant, "due")
        assert expire_for_tenant(tenant, today=BOUNDARY)["expired"] == 1
        due.refresh_from_db()
        first_stamp = due.expired_at

        assert expire_for_tenant(tenant, today=BOUNDARY)["expired"] == 0
        assert expire_for_tenant(tenant, today=D(2030, 1, 1))["expired"] == 0
        due.refresh_from_db()
        assert due.expired_at == first_stamp
        assert SoulEvent.objects.filter(soul=due.soul, event_type="DISPOSITION_EXPIRED").count() == 1

    def test_emits_the_event_and_leaves_the_soul_where_it_was(self, tenant):
        due = _disposition(tenant, "due")
        expire_for_tenant(tenant, today=BOUNDARY)
        event = SoulEvent.objects.get(soul=due.soul, event_type="DISPOSITION_EXPIRED")
        assert event.payload["disposition_id"] == str(due.pk)
        assert event.payload["sentence_years"] == 10
        due.soul.refresh_from_db()
        assert due.soul.current_state == SoulState.REINCARNATING

    def test_another_tenants_due_row_is_not_touched(self, tenant, other_tenant):
        mine = _disposition(tenant, "mine")
        theirs = _disposition(other_tenant, "theirs")
        assert expire_for_tenant(tenant, today=BOUNDARY)["expired"] == 1
        mine.refresh_from_db()
        theirs.refresh_from_db()
        assert mine.expired_at is not None, "**断存在。** 本租户到期的那条没被标上"
        assert theirs.expired_at is None, "别的租户的处置被这个租户的检查标了期满"


# ---------------------------------------------------------------------------
# The celery tasks: fan-out and tenant context
# ---------------------------------------------------------------------------

def _due_today(tenant, name):
    """Due by the real clock — the task takes no `today`."""
    today = timezone.localdate()
    return _disposition(tenant, name, start=(today.year - 10, today.month, today.day))


@pytest.mark.django_db
class TestTasks:
    @patch("apps.disposition.tasks.expire_due_dispositions_for_tenant.delay")
    def test_fan_out_dispatches_one_subtask_per_active_tenant(self, mock_delay, tenant, other_tenant):
        inactive = Tenant.objects.create(code="EXP_OFF", display_name="Off", is_active=False)
        result = expire_due_dispositions()
        dispatched = {call.kwargs["tenant_id"] for call in mock_delay.call_args_list}
        assert {str(tenant.pk), str(other_tenant.pk)} <= dispatched
        assert str(inactive.pk) not in dispatched
        assert result["tenants_dispatched"] == len(dispatched)

    def test_the_contextvar_is_this_tenant_during_the_run_and_cleared_after(self, tenant, other_tenant):
        seen = []

        def spy(t, today=None):
            seen.append((t.pk, getattr(get_current_tenant(), "pk", None)))
            return {"tenant": t.code, "expired": 0, "today": ""}

        with patch("apps.disposition.expiry.expire_for_tenant", side_effect=spy):
            expire_due_dispositions_for_tenant(tenant_id=str(tenant.pk))
            expire_due_dispositions_for_tenant(tenant_id=str(other_tenant.pk))

        assert seen == [(tenant.pk, tenant.pk), (other_tenant.pk, other_tenant.pk)]
        assert get_current_tenant() is None

    def test_the_audit_row_is_attributed_to_the_tenant(self, tenant, django_capture_on_commit_callbacks):
        due = _due_today(tenant, "due")
        # Audit rows are written on commit (apps/audit/signals.py).
        with django_capture_on_commit_callbacks(execute=True):
            expire_due_dispositions_for_tenant(tenant_id=str(tenant.pk))
        due.refresh_from_db()
        assert due.expired_at is not None
        rows = AuditLog.objects.filter(resource_id=str(due.pk), changes__has_key="expired_at")
        assert rows.exists(), "期满没有写审计行"
        assert set(rows.values_list("tenant_id", flat=True)) == {tenant.pk}

    def test_the_subtask_only_expires_its_own_tenant(self, tenant, other_tenant):
        mine = _due_today(tenant, "mine")
        theirs = _due_today(other_tenant, "theirs")
        expire_due_dispositions_for_tenant(tenant_id=str(tenant.pk))
        mine.refresh_from_db()
        theirs.refresh_from_db()
        assert mine.expired_at is not None
        assert theirs.expired_at is None

    def test_registered_as_a_tenant_job(self):
        spec = registry.get("disposition.expire_due_for_tenant")
        assert spec is not None and spec.scope == registry.TENANT
        assert spec.cron.split()[2:] == ["*", "*", "*"], "每天一次"


@pytest.mark.django_db
class TestManagementCommand:
    def test_runs_every_active_tenant(self, tenant, other_tenant, capsys):
        a = _due_today(tenant, "a")
        b = _due_today(other_tenant, "b")
        call_command("expire_dispositions")
        a.refresh_from_db()
        b.refresh_from_db()
        assert a.expired_at is not None and b.expired_at is not None
        assert "total expired=2" in capsys.readouterr().out

    def test_one_tenant(self, tenant, other_tenant):
        a = _due_today(tenant, "a")
        b = _due_today(other_tenant, "b")
        call_command("expire_dispositions", "--tenant", tenant.code)
        a.refresh_from_db()
        b.refresh_from_db()
        assert a.expired_at is not None
        assert b.expired_at is None

    def test_unknown_tenant_is_an_error(self, tenant):
        with pytest.raises(CommandError):
            call_command("expire_dispositions", "--tenant", "NOPE")
