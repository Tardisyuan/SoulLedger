"""停用官员不再把他手上的事无声地留在一个停用账号名下(2026-10-27 用户决定,检查业务 #10)。

手上有事 → 409 `officer_has_open_work` 附件数;带 `handover_to` → 交接与停用同一个事务,交接的审计行也在里面,
审计写不进去则停用一并回滚。批量停用不做交接,有人手上有事就整批 409。
"""
import pytest
from django.db import OperationalError, connection

from apps.audit.models import AuditLog
from apps.judgment.models import Judgment
from tests.soul_account_support import officer_client
from tests.test_judgment_claim import _case, _post, world  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def held(world, admin_user):  # noqa: F811
    case = _case(world.cn)
    assert _post(world.clients["a"], case, "claim").status_code == 200
    return world, case, officer_client(admin_user)


def _deactivate(client, user, **body):
    return client.post(f"/api/v1/users/{user.pk}/deactivate/", body, format="json")


def _active(user):
    user.refresh_from_db()
    return user.is_active


def test_open_work_without_a_receiver_is_a_409_with_the_counts(held):
    w, case, admin = held
    a = w.users["a"]
    res = _deactivate(admin, a)
    assert res.status_code == 409, res.data
    assert res.data["code"] == "officer_has_open_work"
    assert res.data["open_work"][str(a.pk)]["judgments"] == 1
    assert _active(a)
    assert Judgment.all_objects.get(pk=case.pk).claimed_by_id == a.pk


def test_naming_a_receiver_hands_over_and_deactivates_together(held):
    w, case, admin = held
    a, b = w.users["a"], w.users["b"]
    res = _deactivate(admin, a, handover_to=b.pk)
    assert res.status_code == 200, res.data
    assert not _active(a)
    assert Judgment.all_objects.get(pk=case.pk).claimed_by_id == b.pk
    assert AuditLog.objects.filter(resource="officer_handover", resource_id=str(a.pk)).count() == 1


def test_a_receiver_from_another_hall_refuses_both(held):
    w, case, admin = held
    a = w.users["a"]
    res = _deactivate(admin, a, handover_to=w.users["eu_judge"].pk)
    assert (res.status_code, res.data["code"]) == (400, "invalid_target")
    assert _active(a)
    assert Judgment.all_objects.get(pk=case.pk).claimed_by_id == a.pk


def test_no_open_work_deactivates_directly(held):
    w, _, admin = held
    b = w.users["b"]
    assert _deactivate(admin, b).status_code == 200
    assert not _active(b)


def test_batch_with_a_holder_deactivates_nobody(held):
    w, _, admin = held
    a, b = w.users["a"], w.users["b"]
    res = admin.post("/api/v1/users/batch_deactivate/", {"user_ids": [a.pk, b.pk]}, format="json")
    assert res.status_code == 409, res.data
    assert list(res.data["open_work"]) == [str(a.pk)]
    assert _active(a) and _active(b)


def test_the_handover_audit_failing_rolls_back_the_deactivation(held):
    w, case, admin = held
    a, b = w.users["a"], w.users["b"]
    table = AuditLog._meta.db_table

    def fail_handover_audit(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT INTO") and f'"{table}"' in sql and "officer_handover" in (params or ()):
            raise OperationalError("injected: handover audit insert failed")
        return execute(sql, params, many, context)

    with connection.execute_wrapper(fail_handover_audit), pytest.raises(OperationalError):
        _deactivate(admin, a, handover_to=b.pk)
    assert _active(a)
    assert Judgment.all_objects.get(pk=case.pk).claimed_by_id == a.pk
