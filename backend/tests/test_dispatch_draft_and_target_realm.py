"""调拨草稿与目标界域(2026-09-25,设计稿「发起移交」的 存草稿 / 目标界域 / 放弃…)。

草稿是 `DispatchStatus.DRAFT`:只有发起人(与 ADMIN)看得见,不进审批收件箱、不占
`unique_active_dispatch`、不通知任何人;缺什么都行,提交时才校验(含至少 20 字的理由)。
放弃 = 软删进回收站,ADMIN 可恢复。目标界域必须是目标租户、目标文明的未软删界域;
执行时写进灵魂行程。

客户端是 MODERATOR(持有 dispatch.manage / approve / execute,且不是 ADMIN)带着
`tenant_code` 的 JWT —— ADMIN 绕过租户与草稿可见性,全用 ADMIN 的测试证明不了规则。
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core import recycle_bin
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.events.models import SoulEvent
from apps.notifications.models import UserNotification
from apps.realms.models import Realm, RealmType, SoulPathEntry
from apps.realms.path import SoulPathService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
URL = "/api/v1/dispatch/records/"
LONG_REASON = "此魂生前口业深重,须往他界受审,理由写足二十个字以上。"


def _client(user):
    from rest_framework_simplejwt.tokens import RefreshToken

    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _realm(code, civilization, tenant, **extra):
    return Realm.all_objects.create(
        realm_code=code, civilization=civilization, name_local=code, name_zh=code, name_en=code,
        realm_type=RealmType.HELL, tenant=tenant, **extra,
    )


@pytest.fixture
def w(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "地府"})[0]
    eu = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "天堂地狱"})[0]
    cn_mod = User.objects.create_user(username="dr_cn_mod", password="x", role="MODERATOR", tenant=cn)
    cn_mod2 = User.objects.create_user(username="dr_cn_mod2", password="x", role="MODERATOR", tenant=cn)
    eu_mod = User.objects.create_user(username="dr_eu_mod", password="x", role="MODERATOR", tenant=eu)
    admin = User.objects.create_user(username="dr_admin", password="x", role="ADMIN", tenant=cn)
    return {
        "cn": cn, "eu": eu, "cn_mod": cn_mod, "cn_mod2": cn_mod2, "eu_mod": eu_mod, "admin": admin,
        "soul": Soul.objects.create(name="沈青梧", current_state=SoulState.JUDGING, tenant=cn),
        "eu_ninth": _realm("EU_T_NINTH", "EUROPEAN", eu),
        "eu_gone": _realm("EU_T_GONE", "EUROPEAN", eu, is_deleted=True),
        "cn_court": _realm("DY_T_COURT", "CHINESE", cn),
        # European by civilization but held by another tenant: only the tenant
        # check refuses it, so it is what proves that check runs.
        "stray": _realm("EU_T_STRAY", "EUROPEAN", cn),
        # The target tenant's row, filed under another civilization: only the
        # civilization check refuses it.
        "misfiled": _realm("GR_T_MISFILED", "GREEK", eu),
    }


def _draft(w, **body):
    resp = _client(w["cn_mod"]).post(f"{URL}drafts/", body, format="json")
    assert resp.status_code == 201, resp.data
    return DispatchRecord.all_objects.get(pk=resp.data["id"])


def _ids(resp):
    return {row["id"] for row in resp.data["results"]}


# ── save / update / submit ─────────────────────────────────────────────

def test_an_empty_draft_is_saved_and_starts_nothing(w):
    record = _draft(w)
    assert record.status == DispatchStatus.DRAFT
    assert record.soul_id is None and record.target_tenant_id is None and record.reason == ""
    assert record.source_tenant_id == w["cn"].pk and record.dispatched_by_id == w["cn_mod"].pk
    # No approval flow: nobody told, nothing on the soul's timeline.
    assert not UserNotification._base_manager.filter(user=w["eu_mod"]).exists()
    assert not SoulEvent.all_objects.filter(payload__action="DISPATCH_PROPOSED").exists()


def test_a_draft_takes_a_short_reason_and_submit_refuses_it(w):
    record = _draft(w, soul=str(w["soul"].pk))
    client = _client(w["cn_mod"])
    resp = client.patch(f"{URL}{record.pk}/draft/", {
        "target_tenant": w["eu"].pk, "target_realm": str(w["eu_ninth"].pk), "reason": "口业",
    }, format="json")
    assert resp.status_code == 200, resp.data
    assert resp.data["status"] == DispatchStatus.DRAFT
    assert str(resp.data["target_realm"]) == str(w["eu_ninth"].pk)

    resp = client.post(f"{URL}{record.pk}/submit/", {}, format="json")
    assert resp.status_code == 400
    assert "reason" in resp.data
    record.refresh_from_db()
    assert record.status == DispatchStatus.DRAFT


def test_submit_applies_the_last_form_values_and_proposes(w):
    record = _draft(w, soul=str(w["soul"].pk), reason="口业")
    drafted_at = record.proposed_at
    resp = _client(w["cn_mod"]).post(f"{URL}{record.pk}/submit/", {
        "target_tenant": w["eu"].pk, "target_realm": str(w["eu_ninth"].pk), "reason": LONG_REASON,
    }, format="json")
    assert resp.status_code == 200, resp.data
    record.refresh_from_db()
    assert record.status == DispatchStatus.PROPOSED
    assert record.reason == LONG_REASON and record.target_realm_id == w["eu_ninth"].pk
    assert record.proposed_at >= drafted_at
    # The same announcement a direct proposal makes.
    assert UserNotification._base_manager.filter(user=w["eu_mod"], related_id=str(record.pk)).count() == 1
    event = SoulEvent.all_objects.get(payload__action="DISPATCH_PROPOSED", payload__dispatch_id=str(record.pk))
    assert event.payload["target_realm"] == "EU_T_NINTH"
    # And it is now in the target's inbox.
    inbox = _client(w["eu_mod"]).get(f"{URL}proposed/")
    assert str(record.pk) in _ids(inbox)
    # A second submit is not a second proposal.
    again = _client(w["cn_mod"]).post(f"{URL}{record.pk}/submit/", {}, format="json")
    assert again.status_code == 409


def test_submit_needs_a_soul_and_a_target(w):
    record = _draft(w, reason=LONG_REASON)
    resp = _client(w["cn_mod"]).post(f"{URL}{record.pk}/submit/", {}, format="json")
    assert resp.status_code == 400
    assert {"soul", "target_tenant"} <= set(resp.data)


def test_a_direct_proposal_still_needs_a_soul_and_a_target(w):
    """The columns became nullable for drafts; the direct proposal path did not."""
    resp = _client(w["cn_mod"]).post(URL, {"source_tenant": w["cn"].pk, "reason": LONG_REASON}, format="json")
    assert resp.status_code == 400
    assert {"soul", "target_tenant"} <= set(resp.data)
    resp = _client(w["cn_mod"]).post(URL, {
        "source_tenant": w["cn"].pk, "target_tenant": w["eu"].pk, "soul": str(w["soul"].pk),
    }, format="json")
    assert resp.status_code == 400 and "reason" in resp.data
    assert not DispatchRecord.all_objects.exists()


def test_a_draft_does_not_hold_the_souls_active_dispatch_slot(w):
    _draft(w, soul=str(w["soul"].pk), target_tenant=w["eu"].pk, reason=LONG_REASON)
    # A draft is not active: a direct proposal for the same soul goes through …
    direct = DispatchService.propose(w["cn"], w["eu"], w["soul"], w["cn_mod"], LONG_REASON)
    assert direct.status == DispatchStatus.PROPOSED
    # … and then the draft cannot be submitted over it.
    draft = DispatchRecord.all_objects.get(status=DispatchStatus.DRAFT)
    resp = _client(w["cn_mod"]).post(f"{URL}{draft.pk}/submit/", {}, format="json")
    assert resp.status_code == 400
    assert "active dispatch" in resp.data["error"]


# ── visibility ─────────────────────────────────────────────────────────

def test_a_draft_is_visible_only_to_its_creator_and_admin(w):
    record = _draft(w, soul=str(w["soul"].pk), target_tenant=w["eu"].pk)
    pid = str(record.pk)
    assert pid in _ids(_client(w["cn_mod"]).get(URL))
    assert pid in _ids(_client(w["cn_mod"]).get(f"{URL}history/"))
    assert _client(w["cn_mod"]).get(f"{URL}{pid}/").status_code == 200
    assert pid in _ids(_client(w["admin"]).get(URL))

    # A colleague in the same tenant, and the target tenant it names: not a trace.
    for user in (w["cn_mod2"], w["eu_mod"]):
        client = _client(user)
        assert pid not in _ids(client.get(URL)), user.username
        assert pid not in _ids(client.get(f"{URL}history/")), user.username
        assert client.get(f"{URL}{pid}/").status_code == 404, user.username
        assert client.patch(f"{URL}{pid}/draft/", {"reason": "x"}, format="json").status_code == 404
        assert client.post(f"{URL}{pid}/submit/", {}, format="json").status_code == 404
        assert client.delete(f"{URL}{pid}/").status_code == 404
    # ADMIN sees it but does not submit someone else's draft.
    assert _client(w["admin"]).post(f"{URL}{pid}/submit/", {}, format="json").status_code == 403


def test_a_draft_is_not_counted_in_the_approval_inbox(w):
    _draft(w, soul=str(w["soul"].pk), target_tenant=w["eu"].pk, reason=LONG_REASON)
    other = Soul.objects.create(name="另一魂", current_state=SoulState.JUDGING, tenant=w["cn"])
    proposed = DispatchService.propose(w["cn"], w["eu"], other, w["cn_mod"], LONG_REASON)
    inbox = _client(w["eu_mod"]).get(f"{URL}proposed/", {"page": "1"})
    # The dashboard's 「待我审批 · 移交」 is this count.
    assert inbox.data["count"] == 1
    assert _ids(inbox) == {str(proposed.pk)}


# ── target realm ───────────────────────────────────────────────────────

@pytest.mark.parametrize("which", ["cn_court", "stray", "misfiled"])
def test_a_realm_of_another_tenant_is_refused_everywhere(w, which):
    foreign = str(w[which].pk)
    client = _client(w["cn_mod"])
    # Draft save, when present.
    resp = client.post(f"{URL}drafts/", {"target_tenant": w["eu"].pk, "target_realm": foreign}, format="json")
    assert resp.status_code == 400 and "target_realm" in resp.data
    # A realm with no target civilization yet.
    resp = client.post(f"{URL}drafts/", {"target_realm": str(w["eu_ninth"].pk)}, format="json")
    assert resp.status_code == 400 and "target_realm" in resp.data
    # A soft-deleted realm of the right tenant.
    resp = client.post(f"{URL}drafts/", {"target_tenant": w["eu"].pk, "target_realm": str(w["eu_gone"].pk)},
                       format="json")
    assert resp.status_code == 400 and "target_realm" in resp.data
    # Direct proposal.
    resp = client.post(URL, {
        "source_tenant": w["cn"].pk, "target_tenant": w["eu"].pk, "soul": str(w["soul"].pk),
        "target_realm": foreign, "reason": LONG_REASON,
    }, format="json")
    assert resp.status_code == 400 and "target_realm" in resp.data
    # Changing only the target on a draft cannot leave the old target's realm behind.
    record = _draft(w, soul=str(w["soul"].pk), target_tenant=w["eu"].pk, target_realm=str(w["eu_ninth"].pk))
    resp = client.post(f"{URL}{record.pk}/submit/", {"target_tenant": w["cn"].pk, "reason": LONG_REASON},
                       format="json")
    assert resp.status_code == 400 and "target_realm" in resp.data
    assert not DispatchRecord.all_objects.exclude(status=DispatchStatus.DRAFT).exists()


def test_the_service_refuses_a_foreign_realm_without_the_serializer(w):
    with pytest.raises(ValueError, match="not a realm of EU_HEAVEN_HELL"):
        DispatchService.propose(w["cn"], w["eu"], w["soul"], w["cn_mod"], LONG_REASON, target_realm=w["cn_court"])


def test_realm_options_are_the_target_tenants_live_realms(w):
    resp = _client(w["cn_mod"]).get(f"{URL}realm-options/", {"target_tenant_code": "EU_HEAVEN_HELL"})
    assert resp.status_code == 200
    codes = [r["realm_code"] for r in resp.data]
    assert codes == ["EU_T_NINTH"]
    assert _client(w["cn_mod"]).get(f"{URL}realm-options/", {"target_tenant_code": "NOPE"}).status_code == 404


def test_execute_puts_the_soul_in_the_target_realm(w):
    before = _realm("DY_T_WAIT", "CHINESE", w["cn"])
    SoulPathService.enter(w["soul"], before)
    record = DispatchService.propose(w["cn"], w["eu"], w["soul"], w["cn_mod"], LONG_REASON,
                                     target_realm=w["eu_ninth"])
    DispatchService.approve(record, w["eu_mod"])
    DispatchService.execute(record, w["eu_mod"])

    path = list(SoulPathEntry.all_objects.filter(soul=w["soul"]).order_by("sequence"))
    assert [(e.realm_id, e.left_at is None) for e in path] == [(before.pk, False), (w["eu_ninth"].pk, True)]
    assert path[1].tenant_id == w["eu"].pk
    assert path[0].left_at == path[1].entered_at


def test_execute_without_a_realm_only_leaves(w):
    before = _realm("DY_T_WAIT", "CHINESE", w["cn"])
    SoulPathService.enter(w["soul"], before)
    record = DispatchService.propose(w["cn"], w["eu"], w["soul"], w["cn_mod"], LONG_REASON)
    DispatchService.approve(record, w["eu_mod"])
    DispatchService.execute(record, w["eu_mod"])
    path = list(SoulPathEntry.all_objects.filter(soul=w["soul"]))
    assert len(path) == 1 and path[0].left_at is not None


# ── discard → recycle bin → restore ────────────────────────────────────

def test_discard_moves_the_draft_to_the_recycle_bin_and_admin_restores_it(w):
    record = _draft(w, soul=str(w["soul"].pk), target_tenant=w["eu"].pk, reason="口业")
    assert _client(w["cn_mod"]).delete(f"{URL}{record.pk}/").status_code == 204
    record.refresh_from_db()
    assert record.is_deleted and record.deleted_by_id == w["cn_mod"].pk
    assert str(record.pk) not in _ids(_client(w["cn_mod"]).get(URL))

    entries = [e for e in recycle_bin.list_bin_entries(is_admin=True) if e["entity_type"] == "dispatch_draft"]
    assert [(e["id"], e["label"]) for e in entries] == [(record.pk, "沈青梧 → EU_HEAVEN_HELL")]

    resp = _client(w["admin"]).post("/api/v1/recycle-bin/restore/", {"cascade_id": entries[0]["cascade_id"]},
                                    format="json")
    assert resp.status_code == 200, resp.data
    record.refresh_from_db()
    assert not record.is_deleted and record.status == DispatchStatus.DRAFT and record.reason == "口业"
    assert str(record.pk) in _ids(_client(w["cn_mod"]).get(URL))


def test_only_drafts_are_listed_in_the_recycle_bin(w):
    record = DispatchService.propose(w["cn"], w["eu"], w["soul"], w["cn_mod"], LONG_REASON)
    record.soft_delete(user=w["admin"])
    assert not [e for e in recycle_bin.list_bin_entries(is_admin=True) if e["entity_type"] == "dispatch_draft"]


# ── migration ──────────────────────────────────────────────────────────

def test_dispatch_0008_round_trip(migration_round_trip):
    """Existing rows keep their status and get a null realm; the reverse drops
    drafts (they cannot exist before 0008) and nothing else."""
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")
        soul = state.get_model("souls", "Soul")
        record = state.get_model("dispatch", "DispatchRecord")
        cn = tenant._base_manager.create(code="CN_DIYU", display_name="地府")
        eu = tenant._base_manager.create(code="EU_HEAVEN_HELL", display_name="天堂地狱")
        for i, status in enumerate(("PROPOSED", "EXECUTED", "CANCELLED")):
            s = soul._base_manager.create(name=f"魂{i}", tenant=cn, home_tenant=cn)
            record._base_manager.create(
                source_tenant=cn, target_tenant=eu, soul=s, status=status, reason=f"r{i}", tenant=cn,
            )

    def snapshot(state):
        record = state.get_model("dispatch", "DispatchRecord")
        return snapshot_rows(
            record._base_manager.all(), key="reason",
            fields={
                "status": "status",
                "soul": lambda r: r.soul.name if r.soul_id else None,
                "target": "target_tenant_id",
                "realm": lambda r: getattr(r, "target_realm_id", "absent"),
            },
        )

    def add_a_draft(state):
        tenant = state.get_model("tenants", "Tenant")
        record = state.get_model("dispatch", "DispatchRecord")
        cn = tenant._base_manager.get(code="CN_DIYU")
        # The row the old schema cannot hold: no soul, no target.
        record._base_manager.create(source_tenant=cn, status="DRAFT", reason="draft", tenant=cn)

    migration_round_trip(
        before=("dispatch", "0007_cross_judgment_sentence_nodes"),
        after=("dispatch", "0008_draft_status_and_target_realm"),
        seed=seed,
        snapshot=snapshot,
        check_forward=add_a_draft,
    )
