"""跨文明调拨是暂居,不是迁籍(2026-09-17 用户决定)。

`tenant` = 此刻管辖;`home_tenant` = 原属。调拨执行切 `tenant`、不动 `home_tenant`;
暂居租户的处置执行完毕自动回归;原租户或 ADMIN 可以手动结束暂居。
转生资格、转生申请、申诉、灵魂账号按原属。

每个用户都**不是** ADMIN,除非测试名说它是:ADMIN 绕过租户对象检查,
全用 ADMIN 的测试证明不了原租户 / 目标租户各自能做什么(apps/dispatch/permissions.py)。
"""
import pytest

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": f"{code} 名"})[0]


@pytest.fixture
def cn():
    return _tenant("CN_DIYU")


@pytest.fixture
def eg():
    return _tenant("EG_DUAT")


@pytest.fixture
def eu():
    return _tenant("EU_HEAVEN_HELL")


def _residing(home, away, *, state=SoulState.DISPOSED, name="客魂"):
    """一个从 home 调拨到 away、已执行的灵魂。返回 (soul, record)。"""
    soul = Soul.objects.create(name=name, tenant=home, current_state=state)
    record = DispatchRecord.objects.create(
        source_tenant=home, target_tenant=away, soul=soul, status=DispatchStatus.APPROVED,
        reason="先在彼处受罚", tenant=home,
    )
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    record.refresh_from_db()
    return soul, record


def _disposition(soul, tenant, *, eternal=False):
    return Disposition.objects.create(soul=soul, tenant=tenant, is_eternal=eternal)


def _returned_events(soul):
    return [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_RETURNED"]


def test_a_new_soul_belongs_to_the_tenant_it_is_created_in(cn):
    soul = Soul.objects.create(name="本土", tenant=cn)
    soul.refresh_from_db()
    assert soul.home_tenant_id == cn.pk
    assert soul.is_residing is False
    assert soul.home_civilization == "CHINESE"


# ── 暂居开始 ─────────────────────────────────────────────────────────────


def test_executing_a_dispatch_moves_jurisdiction_but_not_home(cn, eg):
    soul, record = _residing(cn, eg)
    assert record.status == DispatchStatus.EXECUTED
    assert soul.tenant_id == eg.pk
    assert soul.home_tenant_id == cn.pk
    assert soul.is_residing is True
    assert soul.civilization == "EGYPTIAN" and soul.home_civilization == "CHINESE"
    executed = [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_EXECUTED"]
    assert [e.payload["home_tenant"] for e in executed] == ["CN_DIYU"]


def test_a_residing_soul_cannot_be_dispatched_onward(cn, eg, eu):
    soul, _ = _residing(cn, eg)
    with pytest.raises(ValueError, match="return home"):
        DispatchService.propose(eg, eu, soul, None, "转往第三地")
    assert not DispatchRecord.objects.filter(soul=soul, target_tenant=eu).exists()


def test_execute_refuses_a_soul_that_is_no_longer_in_the_source_tenant(cn, eg, eu):
    soul = Soul.objects.create(name="已离开", tenant=cn, current_state=SoulState.DISPOSED)
    record = DispatchRecord.objects.create(source_tenant=cn, target_tenant=eg, soul=soul,
                                           status=DispatchStatus.APPROVED, reason="x", tenant=cn)
    Soul.all_objects.filter(pk=soul.pk).update(tenant=eu)
    with pytest.raises(ValueError):
        DispatchService.execute(record, "executor")
    record.refresh_from_db()
    soul.refresh_from_db()
    assert record.status == DispatchStatus.APPROVED and soul.tenant_id == eu.pk


# ── 处置执行完毕 → 自动回归 ────────────────────────────────────────────────


def test_executing_the_residence_disposition_returns_the_soul_home(cn, eg):
    soul, record = _residing(cn, eg)
    disposition = _disposition(soul, eg)

    assert DispositionService.execute(disposition) is True

    soul.refresh_from_db()
    record.refresh_from_db()
    disposition.refresh_from_db()
    assert disposition.is_executed is True
    assert soul.tenant_id == cn.pk and soul.is_residing is False
    # 生命周期不推进:下一世还是终局,由原文明决定。
    assert soul.current_state == SoulState.DISPOSED
    assert record.status == DispatchStatus.RETURNED and record.returned_at is not None
    [event] = _returned_events(soul)
    assert event.tenant_id == cn.pk
    assert event.payload["trigger"] == "DISPOSITION_EXECUTED"
    assert (event.payload["from_tenant"], event.payload["to_tenant"]) == ("EG_DUAT", "CN_DIYU")
    audit = AuditLog.objects.filter(resource="dispatch_record", resource_id=str(record.pk))
    assert [a.changes["soul_tenant"] for a in audit] == [["EG_DUAT", "CN_DIYU"]]


def test_the_disposition_endpoint_returns_the_soul_home(cn, eg):
    soul, record = _residing(cn, eg)
    disposition = _disposition(soul, eg)
    officer = User.objects.create_user(username="eg_mod", password="x", role="MODERATOR", tenant=eg)

    response = officer_client(officer).post(f"/api/v1/disposition/{disposition.pk}/execute/", {}, format="json")

    assert response.status_code == 200, response.data
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk and soul.current_state == SoulState.DISPOSED
    assert not SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").exists()


def test_an_eternal_sentence_does_not_end_the_residence(cn, eg):
    soul, record = _residing(cn, eg)
    disposition = _disposition(soul, eg, eternal=True)

    assert DispositionService.execute(disposition) is True

    soul.refresh_from_db()
    record.refresh_from_db()
    assert soul.tenant_id == eg.pk and soul.is_residing is True
    assert record.status == DispatchStatus.EXECUTED and record.returned_at is None
    assert _returned_events(soul) == []


def test_the_home_tenant_cannot_execute_its_own_disposition_while_the_soul_is_away(cn, eg):
    soul, _ = _residing(cn, eg)
    home_disposition = _disposition(soul, cn)

    assert DispositionService.execute(home_disposition) is False

    home_disposition.refresh_from_db()
    soul.refresh_from_db()
    assert home_disposition.is_executed is False
    assert soul.tenant_id == eg.pk and soul.current_state == SoulState.DISPOSED


@pytest.mark.parametrize("target", [SoulState.REINCARNATING, SoulState.SETTLED])
def test_a_residing_soul_neither_reincarnates_nor_settles(cn, eg, target):
    soul, _ = _residing(cn, eg)
    assert soul.transition_to(target) is False
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED


def test_after_returning_a_chinese_soul_can_still_reincarnate(cn, eg):
    soul, _ = _residing(cn, eg)
    DispositionService.execute(_disposition(soul, eg))
    soul.refresh_from_db()
    assert soul.transition_to(SoulState.REINCARNATING) is True
