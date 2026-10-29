"""rbac-be1 (2026-10-29): the business-line fixes from the RBAC review and the user's decisions 17–22.

Each rule is pinned from both sides — the write that is now refused, and the write next to it that still goes
through — so a rule that refuses everything is as red as one that refuses nothing.
"""
import uuid

import pytest
from django.db import transaction
from django.utils import timezone

from apps.actors.models import Actor
from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.disposition.models import Disposition
from apps.judgment.models import EvidenceAdmission, Judgment
from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.models import Permission, Role, RolePermission
from apps.realms.models import Realm
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.workflow.models import ApprovalNode, ApprovalWorkflow
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

WORKFLOWS = "/api/v1/workflows"
NODES = "/api/v1/nodes"
PLANS = "/api/v1/sentence-plans/"


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eu():
    return plan.tenant("EU_HEAVEN_HELL")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


@pytest.fixture
def mod(cn):
    return plan.officer("be1_mod", "MODERATOR", cn)


def _role(name, *codenames):
    role, _ = Role.objects.get_or_create(name=name, defaults={"display_name": name})
    for codename in codenames:
        perm, _ = Permission.objects.get_or_create(codename=codename,
                                                   defaults={"name": codename, "category": codename.split(".")[0]})
        RolePermission.objects.get_or_create(role=role, permission=perm)
    invalidate_all_permissions()
    return role


def _realm(code, tenant):
    return Realm.objects.create(realm_code=code, civilization="CHINESE", name_local=code, realm_type="HELL",
                                tenant=tenant)


def _concluded_flow(cn):
    """A concluded original case with its running approval flow (the engine started it: IN_PROGRESS)."""
    soul, case = plan.open_case(cn)
    case.conclude("FAILED", "")
    return soul, case, ApprovalWorkflow.objects.get(judgment=case)


# ── H1 deleting an approval flow ─────────────────────────────────────────────


def test_a_started_or_judgment_bound_flow_cannot_be_deleted(cn, mod):
    _soul, case, flow = _concluded_flow(cn)
    client = officer_client(mod)
    response = client.delete(f"{WORKFLOWS}/{flow.pk}/")
    assert response.status_code == 409 and response.data["code"] == "workflow_in_use", response.data
    assert ApprovalWorkflow.objects.filter(pk=flow.pk).exists()

    # Not started, but it decides a judgment: still refused.
    soul2, case2 = plan.open_case(cn, name="另一魂")
    bound = ApprovalWorkflow.objects.create(tenant=cn, soul=soul2, judgment=case2, workflow_name="挂审判")
    assert client.delete(f"{WORKFLOWS}/{bound.pk}/").status_code == 409
    assert ApprovalWorkflow.objects.filter(pk=bound.pk).exists()

    # Not started, no judgment: the one flow that may go.
    loose = ApprovalWorkflow.objects.create(tenant=cn, soul=soul2, workflow_name="未开始")
    assert client.delete(f"{WORKFLOWS}/{loose.pk}/").status_code == 204
    assert not ApprovalWorkflow.objects.filter(pk=loose.pk).exists()


# ── H2 / L10 a started flow's stations and kind are fixed ────────────────────


def test_a_started_flows_stations_cannot_be_added_changed_or_removed(cn, mod):
    _soul, _case, flow = _concluded_flow(cn)
    client = officer_client(mod)
    node = flow.nodes.order_by("node_order").last()
    before = (node.approver_type, node.approver_role, node.approver_actor_id, node.node_order)

    patched = client.patch(f"{NODES}/{node.pk}/", {"approver_type": "ROLE", "approver_role": "JUDGE"}, format="json")
    assert patched.status_code == 409 and patched.data["code"] == "workflow_started", patched.data
    node.refresh_from_db()
    assert (node.approver_type, node.approver_role, node.approver_actor_id, node.node_order) == before

    assert client.delete(f"{NODES}/{node.pk}/").status_code == 409
    assert ApprovalNode.objects.filter(pk=node.pk).exists()

    count = flow.nodes.count()
    added = client.post(f"{NODES}/", {"workflow": str(flow.pk), "node_name": "插站", "node_order": 99}, format="json")
    assert added.status_code == 409 and added.data["code"] == "workflow_started", added.data
    assert flow.nodes.count() == count


def test_a_started_flows_case_type_is_fixed_and_its_notes_are_not(cn, mod):
    _soul, _case, flow = _concluded_flow(cn)
    client = officer_client(mod)
    refused = client.patch(f"{WORKFLOWS}/{flow.pk}/", {"case_type": "SPECIAL"}, format="json")
    assert refused.status_code == 409 and refused.data["code"] == "workflow_started", refused.data
    for field, value in (("is_appeal", not flow.is_appeal), ("cross_civilization", not flow.cross_civilization)):
        assert client.patch(f"{WORKFLOWS}/{flow.pk}/", {field: value}, format="json").status_code == 409
    flow.refresh_from_db()
    assert flow.case_type != "SPECIAL"
    assert client.patch(f"{WORKFLOWS}/{flow.pk}/", {"notes": "备注"}, format="json").status_code == 200

    soul2, _ = plan.open_case(cn, name="未开始魂")
    pending = ApprovalWorkflow.objects.create(tenant=cn, soul=soul2, workflow_name="未开始")
    assert client.patch(f"{WORKFLOWS}/{pending.pk}/", {"case_type": "SPECIAL"}, format="json").status_code == 200


# ── L3 a station's realm / approver and a flow's coordinating realm are this hall's ──


def test_station_and_flow_references_must_be_in_this_hall(cn, eu, mod):
    soul, _ = plan.open_case(cn)
    pending = ApprovalWorkflow.objects.create(tenant=cn, soul=soul, workflow_name="未开始")
    client = officer_client(mod)
    ours, theirs = _realm("BE1_CN_HALL", cn), _realm("BE1_EU_HALL", eu)
    their_actor = Actor.objects.create(name="外殿判官", civilization="CHINESE", role="JUDGE", tenant=eu)
    our_actor = Actor.objects.create(name="本殿判官", civilization="CHINESE", role="JUDGE", tenant=cn)
    body = {"workflow": str(pending.pk), "node_name": "站", "node_order": 1}

    assert client.post(f"{NODES}/", {**body, "realm": str(theirs.pk)}, format="json").status_code == 400
    assert client.post(f"{NODES}/", {**body, "approver_actor": str(their_actor.pk)}, format="json").status_code == 400
    ok = client.post(f"{NODES}/", {**body, "realm": str(ours.pk), "approver_actor": str(our_actor.pk)}, format="json")
    assert ok.status_code == 201, ok.data

    assert client.patch(f"{WORKFLOWS}/{pending.pk}/", {"coordinating_realm": str(theirs.pk)},
                        format="json").status_code == 400
    assert client.patch(f"{WORKFLOWS}/{pending.pk}/", {"coordinating_realm": str(ours.pk)},
                        format="json").status_code == 200


# ── M1 / item 18 a judgment's soul, and a concluded judgment ─────────────────


def test_a_judgments_soul_is_fixed(cn, mod):
    soul, case = plan.open_case(cn)
    other = Soul.objects.create(name="别的魂", tenant=cn, current_state=SoulState.JUDGING)
    client = officer_client(mod)
    response = client.patch(f"/api/v1/judgment/{case.pk}/", {"soul": str(other.pk)}, format="json")
    assert response.status_code == 400 and response.data["soul"][0].code == "soul_fixed", response.data
    case.refresh_from_db()
    assert case.soul_id == soul.pk
    assert client.patch(f"/api/v1/judgment/{case.pk}/", {"soul": str(soul.pk), "summary": "同一魂"},
                        format="json").status_code == 200


def test_a_concluded_judgment_keeps_only_its_notes_writable(cn, mod):
    _soul, case = plan.open_case(cn)
    Judgment.all_objects.filter(pk=case.pk).update(verdict="FAILED", is_final=True, concluded_at=timezone.now())
    client = officer_client(mod)
    court = _realm("BE1_COURT_2", cn)
    for body in ({"court": "第二殿"}, {"summary": "改案由"}, {"confession": "改供词"}, {"realm_id": str(court.pk)}):
        response = client.patch(f"/api/v1/judgment/{case.pk}/", body, format="json")
        assert response.status_code == 400, (body, response.data)
    case.refresh_from_db()
    assert (case.court, case.summary, case.realm_id) == ("第一殿", "", None)
    assert client.patch(f"/api/v1/judgment/{case.pk}/", {"notes": "补记"}, format="json").status_code == 200
    # Sending an unchanged value back is not a change.
    assert client.patch(f"/api/v1/judgment/{case.pk}/", {"court": "第一殿", "notes": "再补"},
                        format="json").status_code == 200


# ── M3 a disposition's soul / judgment, and its destination once executed ────


def test_a_dispositions_soul_and_judgment_are_fixed_and_its_destination_once_executed(cn, mod):
    soul, case, _flow = _concluded_flow(cn)
    disposition = Disposition.objects.get(judgment=case)
    other = Soul.objects.create(name="别的魂", tenant=cn, current_state=SoulState.DISPOSED)
    client = officer_client(mod)
    url = f"/api/v1/disposition/{disposition.pk}/"
    assert client.patch(url, {"soul": str(other.pk)}, format="json").status_code == 400
    assert client.patch(url, {"judgment": None}, format="json").status_code == 400
    disposition.refresh_from_db()
    assert (disposition.soul_id, disposition.judgment_id) == (soul.pk, case.pk)

    elsewhere = _realm("BE1_ELSEWHERE", cn)
    Disposition.all_objects.filter(pk=disposition.pk).update(is_executed=True, executed_at=timezone.now())
    refused = client.patch(url, {"destination_realm": str(elsewhere.pk)}, format="json")
    assert refused.status_code == 400 and "destination_realm" in refused.data, refused.data
    assert client.patch(url, {"notes": "执行后备注"}, format="json").status_code == 200


def test_a_new_disposition_carries_out_its_own_souls_judgment(cn, mod):
    _soul, case = plan.open_case(cn)
    other = Soul.objects.create(name="别的魂", tenant=cn, current_state=SoulState.DISPOSED)
    response = officer_client(mod).post("/api/v1/disposition/", {"soul": str(other.pk), "judgment": str(case.pk)},
                                        format="json")
    assert response.status_code == 400 and "judgment" in response.data, response.data


# ── M4 a hall-less ADMIN files the case / disposition in the soul's hall ─────


def test_a_hall_less_admin_files_in_the_souls_hall(eu):
    admin = User.objects.create_user(username="be1_global", password="x", role="ADMIN", tenant=None)
    soul = Soul.objects.create(name="Anima", tenant=eu, current_state=SoulState.JUDGING)
    client = officer_client(admin)
    created = client.post("/api/v1/judgment/", {"soul": str(soul.pk)}, format="json")
    assert created.status_code == 201, created.data
    assert Judgment.all_objects.get(pk=created.data["id"]).tenant_id == eu.pk
    filed = client.post("/api/v1/disposition/", {"soul": str(soul.pk)}, format="json")
    assert filed.status_code == 201, filed.data
    assert Disposition.all_objects.get(pk=filed.data["id"]).tenant_id == eu.pk


# ── L5 / L7 ──────────────────────────────────────────────────────────────────


def test_the_reincarnation_and_sentence_plan_writes_record_their_author():
    from apps.core.viewsets import AuditUserViewSetMixin
    from apps.reincarnation.views import ReincarnationViewSet
    from apps.sentence_plan.views import SentencePlanViewSet

    assert issubclass(ReincarnationViewSet, AuditUserViewSetMixin)
    assert issubclass(SentencePlanViewSet, AuditUserViewSetMixin)


def test_a_record_id_that_is_not_a_uuid_is_a_400(cn, mod):
    soul = Soul.objects.create(name="魂", tenant=cn)
    client = officer_client(mod)
    for verb in ("acknowledge", "unacknowledge"):
        response = client.post(f"/api/v1/souls/{soul.pk}/records/not-a-uuid/{verb}-date-warning/")
        assert response.status_code == 400 and response.data["code"] == "invalid_record_id", response.data
        missing = client.post(f"/api/v1/souls/{soul.pk}/records/{uuid.uuid4()}/{verb}-date-warning/")
        assert missing.status_code == 404


# ── item 17 another officer's claimed case ───────────────────────────────────


@pytest.fixture
def claimed(cn, mod):
    holder = plan.officer("be1_holder", "JUDGE", cn)
    other = plan.officer("be1_other", "JUDGE", cn)
    _soul, case = plan.open_case(cn)
    Judgment.all_objects.filter(pk=case.pk).update(claimed_by=holder, claimed_at=timezone.now())
    case.refresh_from_db()
    return case, officer_client(holder), officer_client(other), officer_client(mod)


def test_a_non_claimant_cannot_edit_someone_elses_claimed_case(claimed):
    case, _holder, other, _mod = claimed
    base = f"/api/v1/judgment/{case.pk}"
    attempts = [
        other.patch(f"{base}/", {"summary": "旁人改"}, format="json"),
        other.patch(f"{base}/draft/", {"version": 0, "notes": "旁人草稿"}, format="json"),
        other.put(f"{base}/evidence/{uuid.uuid4()}/", {"admitted": True}, format="json"),
        other.delete(f"{base}/citations/{uuid.uuid4()}/"),
        other.post(f"{base}/attachments/", {}, format="multipart"),
        other.delete(f"{base}/"),
    ]
    for response in attempts:
        assert response.status_code == 403 and response.data["code"] == "not_claimant", response.data
    case.refresh_from_db()
    assert (case.summary, case.notes, case.is_deleted) == ("", "", False)


def test_the_claimant_edits_as_before(claimed):
    case, holder, _other, _mod = claimed
    base = f"/api/v1/judgment/{case.pk}"
    assert holder.patch(f"{base}/", {"summary": "认领人改"}, format="json").status_code == 200
    assert holder.patch(f"{base}/draft/", {"version": 0, "notes": "草稿"}, format="json").status_code == 200
    # Past the claim check: the services' own answers.
    assert holder.put(f"{base}/evidence/{uuid.uuid4()}/", {"admitted": True}, format="json").status_code == 400
    assert holder.delete(f"{base}/citations/{uuid.uuid4()}/").status_code == 404
    assert holder.post(f"{base}/attachments/", {}, format="multipart").status_code == 400
    assert not AuditLog.objects.filter(resource="judgment.claim_override").exists()


def test_an_officer_who_may_reassign_overrides_and_leaves_a_record(claimed):
    case, _holder, _other, mod = claimed
    assert mod.patch(f"/api/v1/judgment/{case.pk}/", {"summary": "殿主改"}, format="json").status_code == 200
    row = AuditLog.objects.get(resource="judgment.claim_override", resource_id=str(case.pk))
    assert row.changes["action"] == "update" and row.changes["claimed_by"] == case.claimed_by_id


def test_an_unclaimed_case_is_open_to_any_judge(cn):
    judge = plan.officer("be1_any", "JUDGE", cn)
    _soul, case = plan.open_case(cn)
    assert officer_client(judge).patch(f"/api/v1/judgment/{case.pk}/", {"summary": "谁都能改"},
                                       format="json").status_code == 200


# ── item 19 merit / demerit records ──────────────────────────────────────────


def _payload(**over):
    return {"record_type": "MERIT", "category": RecordCategory.CHARITY, "description": "賑濟", "weight": 10, **over}


def test_records_are_written_under_ledger_manage(cn):
    soul = Soul.objects.create(name="魂", tenant=cn)
    # The roles that wrote records through soul.update got ledger.manage (souls/0053).
    assert RolePermission.objects.filter(role__name="GUARDIAN", permission__codename="ledger.manage").exists()
    guardian = plan.officer("be1_guardian", "GUARDIAN", cn)
    assert officer_client(guardian).post(f"/api/v1/souls/{soul.pk}/add_record/", _payload(),
                                         format="json").status_code == 201
    # soul.update alone no longer writes the ledger.
    _role("BE1_KEEPER", "soul.read", "soul.update")
    keeper = plan.officer("be1_keeper", "VIEWER", cn, extra_roles=["BE1_KEEPER"])
    assert check_permission(keeper, "soul.update") and not check_permission(keeper, "ledger.manage")
    client = officer_client(keeper)
    assert client.post(f"/api/v1/souls/{soul.pk}/add_record/", _payload(), format="json").status_code == 403
    record = SoulRecord.objects.create(soul=soul, **_payload())
    assert client.patch(f"/api/v1/souls/{soul.pk}/records/{record.pk}/", {"weight": 3},
                        format="json").status_code == 403


def test_a_record_a_concluded_case_admitted_is_no_longer_edited(cn, mod):
    soul, case = plan.open_case(cn)
    admitted = SoulRecord.objects.create(soul=soul, **_payload())
    refused = SoulRecord.objects.create(soul=soul, **_payload(description="未采信"))
    EvidenceAdmission.objects.create(judgment=case, record=refused, admitted=False, reason="伪证", tenant=cn)
    Judgment.all_objects.filter(pk=case.pk).update(verdict="FAILED", is_final=True, concluded_at=timezone.now())
    later = SoulRecord.objects.create(soul=soul, **_payload(description="结案后"))
    client = officer_client(mod)
    url = f"/api/v1/souls/{soul.pk}/records/"
    response = client.patch(f"{url}{admitted.pk}/", {"weight": 3}, format="json")
    assert response.status_code == 409 and response.data["code"] == "admitted_in_concluded_case", response.data
    admitted.refresh_from_db()
    assert admitted.weight == 10
    assert client.patch(f"{url}{refused.pk}/", {"weight": 3}, format="json").status_code == 200
    assert client.patch(f"{url}{later.pk}/", {"weight": 3}, format="json").status_code == 200


# ── item 20 who decides a REOPEN request ─────────────────────────────────────


def _reopen_filed(cn, eg, eu):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)
    plan.arrive(soul, p, 3)
    filed = officer_client(plan.officer("be1_eg_judge", "JUDGE", eg)).post(
        f"{PLANS}{p.pk}/requests/", {"kind": "REOPEN", "reason": "新证据"}, format="json")
    assert filed.status_code == 201, filed.data
    return p, f"{PLANS}{p.pk}/requests/{filed.data['id']}/decide/"


def test_only_the_original_judge_decides_a_reopen(cn, eg, eu, mod):
    p, url = _reopen_filed(cn, eg, eu)
    original = plan.officer("be1_original", "JUDGE", cn)
    plan.judged_by(p, original)
    for someone in (plan.officer("be1_colleague", "JUDGE", cn), mod):
        response = officer_client(someone).post(url, {"decision": "ACCEPT"}, format="json")
        assert response.status_code == 403 and response.data["code"] == "not_original_judge", response.data
        assert response.data["original_judge"] == original.pk
    assert officer_client(original).post(url, {"decision": "ACCEPT"}, format="json").status_code == 200


def test_when_the_original_judge_is_gone_the_halls_lead_decides(cn, eg, eu, mod):
    p, url = _reopen_filed(cn, eg, eu)
    plan.judged_by(p, plan.officer("be1_retired", "JUDGE", cn, is_active=False))
    colleague = officer_client(plan.officer("be1_colleague2", "JUDGE", cn))
    assert colleague.post(url, {"decision": "REJECT"}, format="json").status_code == 403
    assert officer_client(mod).post(url, {"decision": "REJECT", "reason": "不重开"}, format="json").status_code == 200


# ── item 21 codes, not role names ────────────────────────────────────────────


def test_hall_admin_and_picker_are_read_from_codes_with_extra_roles(cn):
    from apps.workflow import segments

    soul, _ = plan.open_case(cn)
    flow = ApprovalWorkflow.objects.create(tenant=cn, soul=soul, workflow_name="流程")
    lead_too = plan.officer("be1_judge_lead", "JUDGE", cn, extra_roles=["MODERATOR"])
    plain = plan.officer("be1_plain_judge", "JUDGE", cn)
    assert segments.is_convener_admin(lead_too, flow) and not segments.is_convener_admin(plain, flow)
    _role("BE1_PICKER", "workflow.approve")
    picker = plan.officer("be1_picker", "VIEWER", cn, extra_roles=["BE1_PICKER"])
    viewer = plan.officer("be1_viewer", "VIEWER", cn)
    pickers = segments.pickers(cn.pk)
    assert picker in pickers and plain in pickers and viewer not in pickers
    assert lead_too in segments.hall_admins(cn.pk) and plain not in segments.hall_admins(cn.pk)


def test_concluding_over_a_claim_is_judgment_assign_including_an_extra_role(cn):
    from apps.judgment import claims

    holder = plan.officer("be1_c_holder", "JUDGE", cn)
    _soul, case = plan.open_case(cn)
    Judgment.all_objects.filter(pk=case.pk).update(claimed_by=holder, claimed_at=timezone.now())
    with transaction.atomic():
        assert claims.lock_for_conclude(case.pk, plan.officer("be1_c_lead", "JUDGE", cn, extra_roles=["MODERATOR"]))
    with pytest.raises(claims.ClaimRefusedError) as refused, transaction.atomic():
        claims.lock_for_conclude(case.pk, plan.officer("be1_c_plain", "JUDGE", cn))
    assert refused.value.code == "claimed_by_other"


# ── item 22 handing over letters needs soul_inbox.reply ──────────────────────


def test_letters_move_only_when_the_operator_may_reply(cn, mod):
    from apps.chat.models import Conversation, ConversationKind

    source = plan.officer("be1_leaving", "JUDGE", cn)
    target = plan.officer("be1_taking", "MODERATOR", cn)
    soul = Soul.objects.create(name="来信魂", tenant=cn)
    letter = Conversation.objects.create(kind=ConversationKind.OFFICER_INBOX, room_id="!be1:x", soul_a=soul,
                                         tenant=cn, assignee=source)
    _role("BE1_ASSIGNER", "judgment.assign")
    assigner = officer_client(plan.officer("be1_assigner", "VIEWER", cn, extra_roles=["BE1_ASSIGNER"]))
    body = {"from": source.pk, "to": target.pk}

    preview = assigner.post("/api/v1/judgment/handover/preview/", body, format="json")
    assert preview.status_code == 200 and (preview.data["letters"], preview.data["letters_kept"]) == (0, 1)
    kept = assigner.post("/api/v1/judgment/handover/", body, format="json")
    assert kept.status_code == 200 and (kept.data["letters"], kept.data["letters_kept"]) == (0, 1), kept.data
    letter.refresh_from_db()
    assert letter.assignee_id == source.pk

    moved = officer_client(mod).post("/api/v1/judgment/handover/", body, format="json")
    assert moved.status_code == 200 and (moved.data["letters"], moved.data["letters_kept"]) == (1, 0), moved.data
    letter.refresh_from_db()
    assert letter.assignee_id == target.pk


# ── impl-flow leftover: a case whose flow a cancelled joint judgment ended ───


def test_a_hall_lead_reopens_a_case_held_by_a_cancelled_flow(cn, mod):
    from apps.judgment.weighing import unfinished_flow

    soul, case, flow = _concluded_flow(cn)
    ApprovalWorkflow.objects.filter(pk=flow.pk).update(status="CANCELLED", current_node=None,
                                                       end_reason="CROSS_CANCELLED")
    disposition = Disposition.objects.get(judgment=case)
    assert unfinished_flow(disposition) == "approval_cancelled"
    url = f"/api/v1/judgment/{case.pk}/reopen-cancelled/"
    assert officer_client(plan.officer("be1_r_judge", "JUDGE", cn)).post(url).status_code == 403

    response = officer_client(mod).post(url)
    assert response.status_code == 201, response.data
    retrial = Judgment.all_objects.get(pk=response.data["id"])
    assert retrial.retrial_of_id == case.pk and retrial.verdict is None
    soul.refresh_from_db()
    assert soul.current_state == SoulState.JUDGING
    assert not Disposition.objects.filter(pk=disposition.pk).exists()
    # Once is enough: the case's flow is still the cancelled one, but its soul is no longer waiting.
    assert officer_client(mod).post(url).status_code == 409


def test_reopen_cancelled_is_only_for_a_cancelled_flow(cn, mod):
    _soul, case, _flow = _concluded_flow(cn)
    response = officer_client(mod).post(f"/api/v1/judgment/{case.pk}/reopen-cancelled/")
    assert response.status_code == 409 and response.data["code"] == "not_cancelled", response.data
    assert not Judgment.all_objects.filter(retrial_of=case).exists()
