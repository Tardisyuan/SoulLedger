"""The four older CSV exports leave the same `EXPORT` audit row the newer ones do.

Souls (`/souls/export/`), audit log (`/audit-logs/export/`), ledger stats
(`/ledger/stats/export/`) and ledger journal (`/ledger/journal/export/`) wrote nothing,
while dispatch / disposition / cross-judgment exports did. All of them now go through
`apps.core.exports.record_export`: tenant, caller, the query parameters and the row count.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()


@pytest.fixture
def world(db):
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    admin = User.objects.create_user(username="exp_admin", password="x", role="ADMIN", tenant=cn)
    souls = [Soul.objects.create(name=f"S{i}", current_state=SoulState.ALIVE, tenant=cn) for i in range(3)]
    Soul.objects.create(name="Other", current_state=SoulState.ALIVE, tenant=eg)
    token = RefreshToken.for_user(admin)
    token["tenant_code"] = cn.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return {"client": client, "cn": cn, "eg": eg, "admin": admin, "souls": souls}


def _exports(resource):
    return AuditLog.all_objects.filter(action=AuditAction.EXPORT, resource=resource)


def _case_souls(w):
    ids = ",".join(str(s.pk) for s in w["souls"][:2])
    return "/api/v1/souls/export/", {"ids": ids}, "soul", 2


def _case_ledger_stats(w):
    return "/api/v1/ledger/stats/export/", {}, "soul_ledger", 3


def _case_journal(w):
    return "/api/v1/ledger/journal/export/", {"month": "2026-06"}, "ledger_journal", 0


def _case_audit(w):
    return "/api/v1/audit-logs/export/", {}, "audit_log", None


@pytest.mark.parametrize("case", [_case_souls, _case_ledger_stats, _case_journal, _case_audit])
def test_one_call_adds_exactly_one_export_row_in_the_callers_hall(world, case):
    url, params, resource, rows = case(world)
    assert _exports(resource).count() == 0

    response = world["client"].get(url, params)
    assert response.status_code == 200, response.content

    got = _exports(resource)
    assert got.count() == 1
    row = got.get()
    assert row.tenant == world["cn"] and row.user == world["admin"]
    assert row.changes["query"] == params
    assert row.changes["rows"] == (rows if rows is not None else row.changes["rows"])
    assert not _exports(resource).exclude(tenant=world["cn"]).exists()


def test_the_audit_log_export_audits_itself_and_does_not_list_its_own_row(world):
    first = world["client"].get("/api/v1/audit-logs/export/")
    lines_first = first.content.decode().strip().splitlines()
    assert not any("Exported" in line for line in lines_first)  # the row is written after the file is built
    row = _exports("audit_log").get()
    # The file holds every audit row that existed before the call, and the call adds one more.
    assert row.changes["rows"] == len(lines_first) - 1

    second = world["client"].get("/api/v1/audit-logs/export/")
    assert _exports("audit_log").count() == 2
    assert any("Exported" in line for line in second.content.decode().splitlines())


@pytest.mark.allow_uncommitted_audit  # `record_export` writes the row directly, not on_commit
def test_a_refused_export_leaves_no_row(world):
    ids = ",".join(str(s.pk) for s in world["souls"])
    assert world["client"].get("/api/v1/souls/export/", {"ids": ids}).status_code == 200
    assert _exports("soul").count() == 1  # proves a row would show up here
    # Malformed `ids` is a 400 before any file is built.
    assert world["client"].get("/api/v1/souls/export/", {"ids": "not-a-uuid"}).status_code == 400
    assert _exports("soul").count() == 1
