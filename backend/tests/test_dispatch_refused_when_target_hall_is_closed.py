"""`Tenant.dispatch_enabled` 从 2026-10-08 起真的拦人(此前它只有序列化器与种子命令两个读者)。

一个点,四条路:`DispatchService.check_target_accepts` 在 `_check_proposable`(直接发起 `create`、
草稿 `submit`、受刑计划的系统发起 `_dispatch` 三条都经它)、`approve`、`execute` 里各问一次 ——
批准与执行再问,是因为殿可以在提案挂着的时候关掉。驳回、存草稿不问:驳回不是收,草稿不出门。

每条测试都是「开着 → 过,关着 → 拒」两面;拒时响应带 `code=target_dispatch_disabled`,前端照它翻译。
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService, TargetHallClosedError
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests import sentence_plan_support as plan

User = get_user_model()
URL = "/api/v1/dispatch/records/"
LONG_REASON = "此魂生前口业深重,须往他界受审,理由写足二十个字以上。"
CODE = "target_dispatch_disabled"

pytestmark = pytest.mark.django_db


def _client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def w(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "地府"})[0]
    eu = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "天堂地狱"})[0]
    return {
        "cn": cn, "eu": eu,
        "cn_mod": User.objects.create_user(username="hc_cn_mod", password="x", role="MODERATOR", tenant=cn),
        "eu_mod": User.objects.create_user(username="hc_eu_mod", password="x", role="MODERATOR", tenant=eu),
        "soul": Soul.objects.create(name="沈青梧", current_state=SoulState.JUDGING, tenant=cn),
    }


def _set(tenant, enabled):
    tenant.dispatch_enabled = enabled
    tenant.save(update_fields=["dispatch_enabled"])


def _proposal(w, status=DispatchStatus.PROPOSED):
    return DispatchRecord.objects.create(
        source_tenant=w["cn"], target_tenant=w["eu"], soul=w["soul"], status=status,
        reason=LONG_REASON, tenant=w["cn"], dispatched_by=w["cn_mod"],
    )


# ── 发起:直接 create ───────────────────────────────────────────────

@pytest.mark.parametrize("enabled, expected", [(True, 201), (False, 400)])
def test_create_toward_a_closed_hall_is_refused_with_a_code(w, enabled, expected):
    """变异:`_check_proposable` 里去掉 `check_target_accepts` → 关着那条拿到 201,红。"""
    _set(w["eu"], enabled)
    resp = _client(w["cn_mod"]).post(URL, {
        "source_tenant": w["cn"].pk, "target_tenant": w["eu"].pk, "soul": str(w["soul"].pk), "reason": LONG_REASON,
    }, format="json")
    assert resp.status_code == expected, resp.data
    if enabled:
        assert DispatchRecord.all_objects.filter(soul=w["soul"], status=DispatchStatus.PROPOSED).exists()
    else:
        assert resp.data["code"] == CODE and "EU_HEAVEN_HELL" in resp.data["error"]
        assert not DispatchRecord.all_objects.filter(soul=w["soul"]).exists()


# ── 发起:草稿提交(草稿本身可以存)────────────────────────────────

@pytest.mark.parametrize("enabled, expected", [(True, 200), (False, 400)])
def test_submitting_a_draft_toward_a_closed_hall_is_refused_and_it_stays_a_draft(w, enabled, expected):
    _set(w["eu"], enabled)
    client = _client(w["cn_mod"])
    # Saving the draft is allowed either way: a draft goes nowhere.
    resp = client.post(f"{URL}drafts/", {"soul": str(w["soul"].pk), "target_tenant": w["eu"].pk}, format="json")
    assert resp.status_code == 201, resp.data
    record = DispatchRecord.all_objects.get(pk=resp.data["id"])

    resp = client.post(f"{URL}{record.pk}/submit/", {"reason": LONG_REASON}, format="json")
    assert resp.status_code == expected, resp.data
    record.refresh_from_db()
    if enabled:
        assert record.status == DispatchStatus.PROPOSED
    else:
        assert resp.data["code"] == CODE
        assert record.status == DispatchStatus.DRAFT


# ── 发起:受刑计划的系统调拨(`dispatched_by=None`,经同一个 `propose`)──

@pytest.mark.parametrize("enabled", [True, False])
def test_the_sentence_plan_does_not_dispatch_toward_a_closed_hall(enabled):
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 12)])
    _set(eg, enabled)

    assert plan.serve(soul, p, 1) is True

    if enabled:
        assert plan.node(p, 2).status == "DISPATCHING" and plan.records(soul).count() == 1
    else:
        # The service refused (ValueError subclass), the plan logged it and left the stop PENDING.
        assert plan.node(p, 2).status == "PENDING" and not plan.records(soul).exists()
        with pytest.raises(TargetHallClosedError):
            DispatchService.propose(cn, eg, soul, None, "受刑计划")


# ── 批准 / 驳回:提案挂着的时候殿关了 ──────────────────────────────

@pytest.mark.parametrize("enabled, expected", [(True, 200), (False, 400)])
def test_approving_a_pending_proposal_after_the_hall_closed_is_refused(w, enabled, expected):
    """变异:`approve` 里去掉 `check_target_accepts` → 关着那条 200,红。"""
    record = _proposal(w)
    _set(w["eu"], enabled)
    resp = _client(w["eu_mod"]).post(f"{URL}{record.pk}/approve/", {}, format="json")
    assert resp.status_code == expected, resp.data
    record.refresh_from_db()
    if enabled:
        assert record.status == DispatchStatus.APPROVED
    else:
        assert resp.data["code"] == CODE and record.status == DispatchStatus.PROPOSED


def test_a_closed_hall_can_still_reject_the_pending_proposal(w):
    record = _proposal(w)
    _set(w["eu"], False)
    resp = _client(w["eu_mod"]).post(f"{URL}{record.pk}/reject/", {"reason": "本殿已闭"}, format="json")
    assert resp.status_code == 200, resp.data
    record.refresh_from_db()
    assert record.status == DispatchStatus.REJECTED


# ── 执行:批准到执行之间殿关了 ─────────────────────────────────────

@pytest.mark.parametrize("enabled, expected", [(True, 200), (False, 400)])
def test_executing_an_approved_dispatch_after_the_hall_closed_is_refused_and_the_soul_stays(w, enabled, expected):
    """变异:`execute` 里去掉 `check_target_accepts` → 关着那条 200 且灵魂已进殿,红。"""
    record = _proposal(w, status=DispatchStatus.APPROVED)
    _set(w["eu"], enabled)
    resp = _client(w["eu_mod"]).post(f"{URL}{record.pk}/execute/", {}, format="json")
    assert resp.status_code == expected, resp.data
    record.refresh_from_db()
    w["soul"].refresh_from_db()
    if enabled:
        assert record.status == DispatchStatus.EXECUTED and w["soul"].tenant_id == w["eu"].pk
    else:
        assert resp.data["code"] == CODE
        assert record.status == DispatchStatus.APPROVED and w["soul"].tenant_id == w["cn"].pk


def test_the_stats_overview_tells_the_form_which_halls_are_closed(w, admin_user):
    """发起移交页的目标殿单选读 `/ledger/stats/overview/` 的 `tenants`;禁用与说明靠这一列。"""
    _set(w["eu"], False)
    Soul.objects.create(name="客", current_state=SoulState.ALIVE, tenant=w["eu"])
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin_user).access_token}")
    resp = client.get("/api/v1/ledger/stats/overview/")
    assert resp.status_code == 200, resp.data
    flags = {row["tenant_code"]: row["dispatch_enabled"] for row in resp.data["tenants"]}
    assert flags == {"CN_DIYU": True, "EU_HEAVEN_HELL": False}
