"""CSV exports of /judgment and /workflows (Design batch 28, W5).

Same contract as `test_list_exports_dispatch_disposition_cross.py`: each export is "the list, as
a file" -- same tenant scope, same filters and search, same codename (`judgment.read` /
`workflow.read`). Callers are MODERATORs, not ADMIN (tenant-exempt, so it cannot tell a working
scope from a missing one), and VIEWER, which holds neither codename.
"""
import csv
import io

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.judgment.models import Judgment, Verdict
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalWorkflow

User = get_user_model()
JUDGMENT = "/api/v1/judgment/export/"
WORKFLOW = "/api/v1/workflows/export/"


def _client(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _table(response):
    assert response.status_code == 200, response.content
    assert response["Content-Type"].startswith("text/csv")
    header, *rows = list(csv.reader(io.StringIO(response.content.decode())))
    return header, rows


@pytest.fixture
def world(db):
    a = Tenant.objects.get_or_create(code="JX_A", defaults={"display_name": "Hall A"})[0]
    c = Tenant.objects.get_or_create(code="JX_C", defaults={"display_name": "Hall C"})[0]
    mod_a = User.objects.create_user(username="jx_mod_a", password="x", role="MODERATOR", tenant=a)
    mod_c = User.objects.create_user(username="jx_mod_c", password="x", role="MODERATOR", tenant=c)
    viewer = User.objects.create_user(username="jx_viewer", password="x", role="VIEWER", tenant=a)
    soul_a = Soul.objects.create(name="=SUM(1,1)", current_state=SoulState.ALIVE, tenant=a)
    soul_a2 = Soul.objects.create(name="Second Soul", current_state=SoulState.ALIVE, tenant=a)
    soul_c = Soul.objects.create(name="OutsiderSoul", current_state=SoulState.ALIVE, tenant=c)
    open_a = Judgment.objects.create(soul=soul_a, civilization=soul_a.civilization, court="第一殿", tenant=a)
    done_a = Judgment.objects.create(
        soul=soul_a2, civilization=soul_a2.civilization, court="第二殿", tenant=a,
        verdict=Verdict.PASSED, is_final=True,
    )
    Judgment.objects.create(soul=soul_c, civilization=soul_c.civilization, court="第一殿", tenant=c)
    wf_a = ApprovalWorkflow.objects.create(workflow_name="Flow A", soul=soul_a, tenant=a, case_type="ROUTINE")
    ApprovalWorkflow.objects.create(workflow_name="Flow A2", soul=soul_a2, tenant=a, case_type="APPEAL")
    ApprovalWorkflow.objects.create(workflow_name="Flow Outsider", soul=soul_c, tenant=c)
    return {
        "a": a, "open_a": open_a, "done_a": done_a, "wf_a": wf_a,
        "client_a": _client(mod_a, a), "client_c": _client(mod_c, c), "viewer": _client(viewer, a),
    }


# ── judgment ────────────────────────────────────────────────────────────────

def test_judgment_export_is_the_list_for_this_hall(world):
    header, rows = _table(world["client_a"].get(JUDGMENT))
    assert header[:3] == ["Case ID", "Case Number", "Soul"]
    assert sorted(r[0] for r in rows) == sorted([str(world["open_a"].pk), str(world["done_a"].pk)])
    assert "OutsiderSoul" not in "".join(",".join(r) for r in rows)
    _, rows_c = _table(world["client_c"].get(JUDGMENT))
    assert [r[2] for r in rows_c] == ["OutsiderSoul"]


def test_judgment_export_applies_the_list_filters_and_search(world):
    _, rows = _table(world["client_a"].get(JUDGMENT, {"has_verdict": "false"}))
    assert [r[0] for r in rows] == [str(world["open_a"].pk)]
    _, rows = _table(world["client_a"].get(JUDGMENT, {"has_verdict": "true"}))
    assert [r[0] for r in rows] == [str(world["done_a"].pk)]
    _, rows = _table(world["client_a"].get(JUDGMENT, {"court": "第二殿"}))
    assert [r[0] for r in rows] == [str(world["done_a"].pk)]
    _, rows = _table(world["client_a"].get(JUDGMENT, {"search": "Second"}))
    assert [r[0] for r in rows] == [str(world["done_a"].pk)]


def test_judgment_export_cannot_carry_a_formula(world):
    _, rows = _table(world["client_a"].get(JUDGMENT, {"has_verdict": "false"}))
    assert rows[0][2] == "'=SUM(1,1)"


def test_judgment_export_has_only_the_listed_columns(world):
    header, _ = _table(world["client_a"].get(JUDGMENT))
    assert header == [
        "Case ID", "Case Number", "Soul", "Civilization", "Judge", "Court", "Verdict", "Final",
        "Created At", "Concluded At",
    ]
    assert "Confession" not in header and "Notes" not in header and "Evidence" not in header


def test_judgment_export_needs_judgment_read(world):
    assert world["viewer"].get(JUDGMENT).status_code == 403


# ── workflow ────────────────────────────────────────────────────────────────

def test_workflow_export_is_the_list_for_this_hall(world):
    header, rows = _table(world["client_a"].get(WORKFLOW))
    assert header[:3] == ["Workflow ID", "Name", "Soul"]
    assert sorted(r[1] for r in rows) == ["Flow A", "Flow A2"]
    assert "Flow Outsider" not in "".join(",".join(r) for r in rows)
    _, rows_c = _table(world["client_c"].get(WORKFLOW))
    assert [r[1] for r in rows_c] == ["Flow Outsider"]


def test_workflow_export_applies_the_list_filters(world):
    _, rows = _table(world["client_a"].get(WORKFLOW, {"case_type": "APPEAL"}))
    assert [r[1] for r in rows] == ["Flow A2"]
    _, rows = _table(world["client_a"].get(WORKFLOW, {"search": "Flow A2"}))
    assert [r[1] for r in rows] == ["Flow A2"]
    _, rows = _table(world["client_a"].get(WORKFLOW, {"status": "COMPLETED"}))
    assert rows == []


def test_workflow_export_cannot_carry_a_formula(world):
    _, rows = _table(world["client_a"].get(WORKFLOW, {"search": "Flow A2"}))
    assert rows[0][1] == "Flow A2"
    _, rows = _table(world["client_a"].get(WORKFLOW, {"soul_name": "SUM"}))
    assert rows[0][2] == "'=SUM(1,1)"


def test_workflow_export_needs_workflow_read(world):
    assert world["viewer"].get(WORKFLOW).status_code == 403


# ── shared ──────────────────────────────────────────────────────────────────

def test_an_export_is_written_to_the_audit_log(world):
    before = AuditLog.objects.filter(action=AuditAction.EXPORT).count()
    world["client_a"].get(JUDGMENT, {"has_verdict": "false"})
    world["client_a"].get(WORKFLOW, {"case_type": "APPEAL"})
    logs = AuditLog.objects.filter(action=AuditAction.EXPORT).order_by("timestamp")
    assert logs.count() == before + 2
    assert [log.resource for log in logs] == ["judgment", "workflow"]
    assert logs[0].changes == {"query": {"has_verdict": "false"}, "rows": 1}
    assert logs[1].changes == {"query": {"case_type": "APPEAL"}, "rows": 1}
    assert logs[0].tenant_id == world["a"].pk


@pytest.mark.allow_uncommitted_audit  # `record_export` writes the row directly, not on_commit
def test_a_refused_export_writes_no_audit_row(world):
    world["viewer"].get(JUDGMENT)
    world["viewer"].get(WORKFLOW)
    world["client_a"].get(WORKFLOW, {"case_type": "APPEAL"})
    # Only the allowed call left a row; the reader above is trusted because it saw that one.
    assert [log.resource for log in AuditLog.objects.filter(action=AuditAction.EXPORT)] == ["workflow"]


@pytest.mark.allow_uncommitted_audit
@pytest.mark.parametrize("url", [JUDGMENT, WORKFLOW])
def test_over_the_row_cap_is_a_400_not_a_short_file(world, monkeypatch, url):
    monkeypatch.setattr("apps.core.exports.EXPORT_MAX_ROWS", 0)
    assert world["client_a"].get(url).status_code == 400
    assert not AuditLog.objects.filter(action=AuditAction.EXPORT).exists()
    monkeypatch.undo()
    assert world["client_a"].get(url).status_code == 200
    assert AuditLog.objects.filter(action=AuditAction.EXPORT).count() == 1
