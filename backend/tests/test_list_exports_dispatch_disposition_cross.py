"""CSV exports of /dispatch, /disposition and /cross-judgments (Design batch 15, C3).

Each export is "the list, as a file": same tenant scope, same filters, same
codename. Callers are MODERATORs (not ADMIN, which is tenant-exempt and so
cannot tell a working scope from a missing one) and VIEWER (holds none of the
three read codenames).
"""
import csv
import io

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.dispatch.models import (
    CrossTenantJudgment,
    CrossTenantJudgmentParticipant,
    DispatchRecord,
    DispatchStatus,
)
from apps.disposition.models import Disposition
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
DISPATCH = "/api/v1/dispatch/records/export/"
CROSS = "/api/v1/dispatch/cross-tenant-judgments/export/"
DISPOSITION = "/api/v1/disposition/export/"


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
    a = Tenant.objects.get_or_create(code="EX_A", defaults={"display_name": "Hall A"})[0]
    b = Tenant.objects.get_or_create(code="EX_B", defaults={"display_name": "Hall B"})[0]
    c = Tenant.objects.get_or_create(code="EX_C", defaults={"display_name": "Hall C"})[0]
    mod_a = User.objects.create_user(username="ex_mod_a", password="x", role="MODERATOR", tenant=a)
    mod_b = User.objects.create_user(username="ex_mod_b", password="x", role="MODERATOR", tenant=b)
    mod_c = User.objects.create_user(username="ex_mod_c", password="x", role="MODERATOR", tenant=c)
    viewer = User.objects.create_user(username="ex_viewer", password="x", role="VIEWER", tenant=a)
    soul_a = Soul.objects.create(name="=SUM(1,1)", current_state=SoulState.ALIVE, tenant=a)
    soul_c = Soul.objects.create(name="OutsiderSoul", current_state=SoulState.ALIVE, tenant=c)
    d_ab = DispatchRecord.objects.create(
        source_tenant=a, target_tenant=b, soul=soul_a, dispatched_by=mod_a,
        status=DispatchStatus.PROPOSED, tenant=a,
    )
    DispatchRecord.objects.create(
        source_tenant=c, target_tenant=c, soul=soul_c, dispatched_by=mod_c,
        status=DispatchStatus.PROPOSED, tenant=c,
    )
    # A draft belongs to its author: mod_b is a party (target) but must not get it.
    DispatchRecord.objects.create(
        source_tenant=a, target_tenant=b, soul=soul_a, dispatched_by=mod_a,
        status=DispatchStatus.DRAFT, tenant=a,
    )
    joint = CrossTenantJudgment.objects.create(
        title="Joint case", description="secret description", initiating_tenant=a, tenant=a,
    )
    CrossTenantJudgmentParticipant.objects.create(judgment=joint, participant_tenant=b, role="CO_JUDGE")
    CrossTenantJudgment.objects.create(title="Other hall case", description="d", initiating_tenant=c, tenant=c)
    disp_a = Disposition.objects.create(soul=soul_a, tenant=a, notes="@cmd|calc", sentence_years=3)
    Disposition.objects.create(soul=soul_c, tenant=c)
    return {
        "a": a, "b": b, "d_ab": d_ab, "joint": joint, "disp_a": disp_a,
        "client_a": _client(mod_a, a), "client_b": _client(mod_b, b), "client_c": _client(mod_c, c),
        "viewer": _client(viewer, a),
    }


# ── dispatch ────────────────────────────────────────────────────────────────

def test_dispatch_export_is_the_list_for_this_hall(world):
    header, rows = _table(world["client_a"].get(DISPATCH))
    assert header[:3] == ["Dispatch ID", "Soul", "From"]
    # a's two records (proposed + own draft); never c's.
    assert sorted(r[0] for r in rows) == sorted(
        str(r.pk) for r in DispatchRecord.objects.filter(source_tenant=world["a"])
    )
    assert "OutsiderSoul" not in "".join(",".join(r) for r in rows)


def test_dispatch_export_hides_other_peoples_drafts(world):
    _, rows = _table(world["client_b"].get(DISPATCH))
    assert [r[0] for r in rows] == [str(world["d_ab"].pk)]


def test_dispatch_export_applies_the_list_filters_and_sections(world):
    _, rows = _table(world["client_a"].get(DISPATCH, {"status": "DRAFT"}))
    assert [r[5] for r in rows] == ["DRAFT"]
    _, rows = _table(world["client_b"].get(DISPATCH, {"section": "proposed"}))
    assert [r[0] for r in rows] == [str(world["d_ab"].pk)]
    _, rows = _table(world["client_b"].get(DISPATCH, {"section": "history"}))
    assert rows == []  # b has initiated nothing
    assert world["client_b"].get(DISPATCH, {"section": "bogus"}).status_code == 400


def test_dispatch_export_cannot_carry_a_formula(world):
    _, rows = _table(world["client_a"].get(DISPATCH, {"status": "PROPOSED"}))
    assert rows[0][1] == "'=SUM(1,1)"


def test_dispatch_export_needs_dispatch_read(world):
    assert world["viewer"].get(DISPATCH).status_code == 403


# ── cross-judgments ─────────────────────────────────────────────────────────

def test_cross_export_covers_initiator_and_participant_but_not_a_stranger(world):
    for who in ("client_a", "client_b"):
        header, rows = _table(world[who].get(CROSS))
        assert [r[1] for r in rows] == ["Joint case"], who
    _, rows = _table(world["client_c"].get(CROSS))
    assert [r[1] for r in rows] == ["Other hall case"]


def test_cross_export_has_only_the_list_serializer_fields(world):
    header, rows = _table(world["client_b"].get(CROSS))
    assert header == [
        "Case ID", "Title", "Initiating Hall", "Initiating Hall Name", "Status", "Concluded At", "Conclusion",
    ]
    text = "".join(",".join(r) for r in rows)
    assert "secret description" not in text
    assert "EX_B" not in text  # the participant roster is not in the file


def test_cross_export_needs_cross_judgment_read(world):
    assert world["viewer"].get(CROSS).status_code == 403


# ── disposition ─────────────────────────────────────────────────────────────

def test_disposition_export_is_scoped_to_the_hall_and_filtered_like_the_list(world):
    header, rows = _table(world["client_a"].get(DISPOSITION))
    assert [r[0] for r in rows] == [str(world["disp_a"].pk)]
    _, rows = _table(world["client_a"].get(DISPOSITION, {"is_executed": "true"}))
    assert rows == []
    _, rows = _table(world["client_a"].get(DISPOSITION, {"section": "pending"}))
    assert [r[0] for r in rows] == [str(world["disp_a"].pk)]
    _, rows = _table(world["client_a"].get(DISPOSITION, {"section": "expired"}))
    assert rows == []


def test_disposition_export_guards_text_cells(world):
    header, rows = _table(world["client_a"].get(DISPOSITION))
    row = dict(zip(header, rows[0], strict=True))
    assert row["Notes"] == "'@cmd|calc"
    assert row["Soul"] == "'=SUM(1,1)"
    assert row["Sentence Years"] == "3"


def test_disposition_export_needs_disposition_read(world):
    assert world["viewer"].get(DISPOSITION).status_code == 403


# ── shared ──────────────────────────────────────────────────────────────────

def test_an_export_is_written_to_the_audit_log(world):
    before = AuditLog.objects.filter(action=AuditAction.EXPORT).count()
    world["client_a"].get(DISPATCH, {"status": "PROPOSED"})
    world["client_a"].get(DISPOSITION)
    world["client_b"].get(CROSS)
    logs = AuditLog.objects.filter(action=AuditAction.EXPORT).order_by("timestamp")
    assert logs.count() == before + 3
    assert [log.resource for log in logs] == ["dispatch", "disposition", "cross_judgment"]
    assert logs[0].changes == {"query": {"status": "PROPOSED"}, "rows": 1}
    assert logs[0].tenant_id == world["a"].pk


def test_a_refused_export_writes_no_audit_row(world):
    world["viewer"].get(DISPATCH, {"status": "REFUSED"})
    world["client_a"].get(DISPATCH, {"status": "PROPOSED"})
    # The refusal left nothing; the audit reader above only trusts a table that was written to.
    assert [log.changes["query"] for log in AuditLog.objects.filter(action=AuditAction.EXPORT)] == [
        {"status": "PROPOSED"}
    ]


def test_over_the_row_cap_is_a_400_not_a_short_file(world, monkeypatch):
    monkeypatch.setattr("apps.core.exports.EXPORT_MAX_ROWS", 0)
    response = world["client_a"].get(DISPATCH)
    assert response.status_code == 400
