"""A hall's civilization, and an account's, are fixed; one SYSTEM_ADMIN action moves an account (user decisions
2026-11-16).

1. A hall's civilization does not change after creation: no API writes it, the Django admin does not offer it,
   and `Tenant.save` refuses a change (`apps/tenants/models.py`).
2. No ordinary edit path changes an account's civilization (profile, `PATCH /users/{id}/`, the Django admin).
   `POST /users/{id}/migrate-civilization/` and `manage.py migrate_account_civilization` do, for SYSTEM_ADMIN only,
   under the preconditions of `apps/authentication/civilization_move.py`.
3. Creating a hall stays SYSTEM_ADMIN's: a civilization ADMIN gets 403.
"""
import time

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.core.management import CommandError, call_command
from django.test import override_settings
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication import mfa
from apps.authentication.civilization_move import GROUPS, OPEN_WORK
from apps.authentication.models import User
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.conftest import sign_in
from tests.soul_account_support import officer_client, ready_soul
from tests.test_shard_sync import _sync, sharded

pytestmark = pytest.mark.django_db

USERS = "/api/v1/users/"


def _move(pk):
    return f"{USERS}{pk}/migrate-civilization/"


@pytest.fixture
def halls(cn_tenant):
    gr = Tenant.objects.create(code="GR_FIXED", display_name="Greek", declared_civilization="GREEK")
    return {"cn": cn_tenant, "gr": gr}


@pytest.fixture
def system():
    return User.objects.create_user(username="sys_fixed", password="x", role="SYSTEM_ADMIN", tenant=None)


@pytest.fixture
def judge(halls):
    return User.objects.create_user(username="judge_fixed", password="x", role="JUDGE", tenant=halls["cn"])


def _as(user):
    return sign_in(APIClient(), user)


# ---- 1. a hall ------------------------------------------------------------------------------------------------

def test_a_hall_refuses_a_change_of_civilization_on_save(halls):
    gr = halls["gr"]
    gr.declared_civilization = "EGYPTIAN"
    with pytest.raises(ValidationError) as e:
        gr.save()
    assert "civilization_fixed" in str(e.value.error_dict["declared_civilization"][0].code)
    gr.declared_civilization = "EGYPTIAN"
    with pytest.raises(ValidationError):
        gr.save(update_fields=["declared_civilization"])
    assert Tenant.objects.get(pk=gr.pk).civilization == "GREEK"


def test_a_seeded_hall_cannot_change_civilization_through_its_code_either(halls):
    cn = halls["cn"]
    cn.code = "CN_RENAMED"  # out of TENANT_CIVILIZATION: its civilization would fall to declared_civilization ("")
    with pytest.raises(ValidationError):
        cn.save()


def test_a_hall_saves_normally_when_its_civilization_stays(halls):
    gr = halls["gr"]
    gr.description = "unchanged civilization"
    gr.save()
    gr.is_active = False
    gr.save(update_fields=["is_active"])
    assert Tenant.objects.get(pk=gr.pk).description == "unchanged civilization"


def test_no_api_path_writes_a_halls_civilization(halls, system):
    client = _as(system)
    gr = halls["gr"]
    assert client.patch(f"/api/v1/tenants/{gr.code}/", {"civilization": "EGYPTIAN"}, format="json").status_code == 405
    client.patch(f"/api/v1/tenants/{gr.code}/settings/", {"civilization": "EGYPTIAN",
                                                         "declared_civilization": "EGYPTIAN"}, format="json")
    assert Tenant.objects.get(pk=gr.pk).civilization == "GREEK"


def test_the_django_admin_does_not_edit_a_halls_civilization():
    model_admin = admin.site._registry.get(Tenant)
    if model_admin is None:  # not in the admin at all: nothing there can edit it
        return
    assert "declared_civilization" in model_admin.get_readonly_fields(None)


# ---- 3. creating a hall ----------------------------------------------------------------------------------------

def test_a_civilization_admin_cannot_create_a_hall(halls):
    civ_admin = User.objects.create_user(username="civ_fixed", password="x", role="ADMIN", tenant=None,
                                         civilization="GREEK")
    res = _as(civ_admin).post("/api/v1/tenants/", {"code": "GR_MINE", "display_name": "mine",
                                                   "civilization": "GREEK"}, format="json")
    assert res.status_code == 403
    assert not Tenant.objects.filter(code="GR_MINE").exists()


# ---- 2. an account: the ordinary paths -------------------------------------------------------------------------

def test_the_user_edit_refuses_another_hall_or_civilization(halls, system, judge):
    client = _as(system)
    for body in ({"tenant": halls["gr"].pk}, {"civilization": "GREEK"}):
        res = client.patch(f"{USERS}{judge.pk}/", body, format="json")
        assert res.status_code == 400, res.data
        assert "civilization_fixed" in str(res.data)
    judge.refresh_from_db()
    assert judge.tenant_id == halls["cn"].pk and judge.civilization is None
    # The edit dialog sends the current hall back: that is not a change.
    assert client.patch(f"{USERS}{judge.pk}/", {"tenant": halls["cn"].pk, "position": "p"},
                        format="json").status_code == 200


def test_the_profile_does_not_change_ones_own_civilization(halls):
    civ_admin = User.objects.create_user(username="civ_self", password="x", role="ADMIN", tenant=None,
                                         civilization="GREEK")
    _as(civ_admin).patch("/api/v1/auth/profile/", {"civilization": "CHINESE", "tenant": halls["cn"].pk},
                         format="json")
    civ_admin.refresh_from_db()
    assert civ_admin.civilization == "GREEK" and civ_admin.tenant_id is None


def test_the_django_admin_shows_hall_and_civilization_read_only(halls, judge, client):
    superuser = User.objects.create_superuser(username="su_fixed", password="x", email="su@example.com")
    client.force_login(superuser)
    page = client.get(f"/admin/authentication/user/{judge.pk}/change/")
    assert page.status_code == 200
    form = page.context["adminform"].form
    assert not {"tenant", "civilization", "organization"} & set(form.fields)
    assert {"tenant", "civilization", "organization"} <= set(admin.site._registry[User].get_readonly_fields(None))


# ---- 2. an account: the migration ------------------------------------------------------------------------------

def test_system_admin_moves_a_judge_with_hall_and_organization_and_ends_its_sessions(halls, system, judge):
    old = officer_client(judge)
    assert old.get("/api/v1/auth/profile/").status_code == 200
    res = _as(system).post(_move(judge.pk), {"civilization": "GREEK", "tenant": "GR_FIXED",
                                             "reason": "transferred"}, format="json")
    assert res.status_code == 200, res.data
    judge.refresh_from_db()
    assert judge.tenant_id == halls["gr"].pk
    assert judge.organization is not None and judge.organization.tenant_id == halls["gr"].pk
    assert judge.civilization is None
    assert old.get("/api/v1/auth/profile/").status_code == 401  # the old token named the old hall
    # The move's own row; `end_sessions` also saves the user, and that save has its generic UPDATE row.
    row = AuditLog.objects.get(resource="user", resource_id=str(judge.pk), user=system,
                               description__startswith="civilization moved")
    assert row.changes["civilization"] == ["CHINESE", "GREEK"]
    assert row.changes["tenant"] == ["CN_DIYU", "GR_FIXED"]
    assert row.changes["reason"] == "transferred"


def test_a_civilization_admin_moves_its_civilization_only(halls, system):
    civ_admin = User.objects.create_user(username="civ_moved", password="x", role="ADMIN", tenant=None,
                                         civilization="CHINESE")
    row = mfa.begin_setup(system)
    mfa.confirm_setup(row, mfa.totp_at(row.secret, int(time.time() // mfa.TOTP_STEP_SECONDS)))
    mfa.complete_setup(row)
    row.last_step = None
    row.save(update_fields=["last_step"])
    proof = {"mfa_method": "totp", "mfa_code": mfa.totp_at(row.secret, int(time.time() // mfa.TOTP_STEP_SECONDS))}
    client = _as(system)
    res = client.post(_move(civ_admin.pk), {"civilization": "GREEK", "tenant": "GR_FIXED", "reason": "r", **proof},
                      format="json")
    assert res.status_code == 400 and res.data["code"] == "hall_not_allowed"
    row.refresh_from_db()
    row.last_step = None
    row.save(update_fields=["last_step"])
    res = client.post(_move(civ_admin.pk), {"civilization": "GREEK", "reason": "r", **proof}, format="json")
    assert res.status_code == 200, res.data
    civ_admin.refresh_from_db()
    assert civ_admin.civilization == "GREEK" and civ_admin.tenant_id is None


@pytest.mark.parametrize("body, code", [
    ({"civilization": "GREEK", "reason": "r"}, "hall_required"),
    ({"civilization": "GREEK", "tenant": "CN_DIYU", "reason": "r"}, "hall_of_another_civilization"),
    ({"civilization": "CHINESE", "tenant": "CN_DIYU", "reason": "r"}, "same_civilization"),
    ({"civilization": "GREEK", "tenant": "GR_FIXED", "reason": "  "}, "reason_required"),
])
def test_each_refusal_names_its_condition_and_changes_nothing(halls, system, judge, body, code):
    res = _as(system).post(_move(judge.pk), body, format="json")
    assert res.status_code == 400, res.data
    assert res.data["code"] == code or code in str(res.data)
    judge.refresh_from_db()
    assert judge.tenant_id == halls["cn"].pk


def test_a_closed_hall_and_another_halls_organization_are_refused(halls, system, judge):
    from apps.org.ownership import tenant_root

    cn_org = tenant_root(halls["cn"])
    res = _as(system).post(_move(judge.pk), {"civilization": "GREEK", "tenant": "GR_FIXED", "organization": cn_org.pk,
                                             "reason": "r"}, format="json")
    assert res.status_code == 400 and res.data["code"] == "organization_of_another_hall"
    Tenant.objects.filter(pk=halls["gr"].pk).update(is_active=False)
    res = _as(system).post(_move(judge.pk), {"civilization": "GREEK", "tenant": "GR_FIXED", "reason": "r"},
                           format="json")
    assert res.status_code == 400 and res.data["code"] == "hall_inactive"


def test_a_soul_account_is_refused(halls, system):
    account, _ = ready_soul(halls["cn"], name="moving soul")
    res = _as(system).post(_move(account.user_id), {"civilization": "GREEK", "tenant": "GR_FIXED", "reason": "r"},
                           format="json")
    assert res.status_code == 409 and res.data["code"] == "soul_account"
    assert User.objects.get(pk=account.user_id).tenant_id == halls["cn"].pk


@pytest.mark.parametrize("role", ["ADMIN", "JUDGE"])
def test_anyone_but_system_admin_is_refused(halls, judge, role):
    caller = User.objects.create_user(username=f"not_sys_{role}", password="x", role=role,
                                      tenant=None if role == "ADMIN" else halls["cn"],
                                      civilization="CHINESE" if role == "ADMIN" else None)
    res = _as(caller).post(_move(judge.pk), {"civilization": "GREEK", "tenant": "GR_FIXED", "reason": "r"},
                           format="json")
    assert res.status_code == 403
    judge.refresh_from_db()
    assert judge.tenant_id == halls["cn"].pk


def _claimed_judgment(user, hall):
    from apps.judgment.models import Judgment

    soul = Soul.objects.create(name="claimed", tenant=hall, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, civilization="CHINESE", court="第一殿", tenant=hall, claimed_by=user)


def _pending_node(user, hall):
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, NodeStatus

    soul = Soul.objects.create(name="node", tenant=hall, current_state=SoulState.JUDGING)
    wf = ApprovalWorkflow.objects.create(workflow_name="w", soul=soul, tenant=hall)
    return ApprovalNode.objects.create(workflow=wf, node_name="n", node_order=1, node_type="TRIAL",
                                       status=NodeStatus.PENDING, approver=user)


def _proposed_dispatch(user, hall):
    from apps.dispatch.models import DispatchRecord

    soul = Soul.objects.create(name="dispatch", tenant=hall, current_state=SoulState.JUDGING)
    eu = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})[0]
    return DispatchRecord.objects.create(source_tenant=hall, target_tenant=eu, soul=soul, dispatched_by=user,
                                         reason="r", tenant=hall)


def _cross_judgment(user, hall):
    from apps.dispatch.models import CrossTenantJudgment

    return CrossTenantJudgment.objects.create(title="t", description="d", initiating_tenant=hall, tenant=hall,
                                              create_user=user)


def _sentence_request(user, hall):
    from apps.sentence_plan.models import SentencePlan, SentencePlanRequest, SentencePlanStatus

    soul = Soul.objects.create(name="plan", tenant=hall, current_state=SoulState.JUDGING)
    plan = SentencePlan.all_objects.create(soul=soul, tenant=hall, status=SentencePlanStatus.ACTIVE)
    return SentencePlanRequest.objects.create(plan=plan, from_tenant_code="EU_HEAVEN_HELL", kind="AMEND",
                                              create_user=user)


def _city_god(user, hall):
    from apps.judgment.models import CityGod

    god = CityGod.objects.create(tenant=hall, name="城隍", regions=["x"])
    god.officers.add(user)
    return god


def _tudi_god(user, hall):
    from apps.death_sync.models import TudiGod

    god = TudiGod.objects.create(tenant=hall, name="土地")
    god.officers.add(user)
    return god


def _letter(user, hall):
    from apps.chat.models import Conversation, ConversationKind

    soul = Soul.objects.create(name="letter", tenant=hall, current_state=SoulState.JUDGING)
    return Conversation.objects.create(kind=ConversationKind.OFFICER_INBOX, room_id="!fixed:x", soul_a=soul,
                                       tenant=hall, last_from="soul", assignee=user)


def _appeal(user, hall):
    from apps.judgment.models import JudgmentAppeal

    case = _claimed_judgment(None, hall)
    return JudgmentAppeal.objects.create(judgment=case, soul=case.soul, tenant=hall, round=1, reason="冤",
                                         reviewer=user, status="IN_REVIEW")


OPEN_WORK_MAKERS = {
    "judgments": _claimed_judgment, "approval_nodes": _pending_node, "dispatches": _proposed_dispatch,
    "cross_judgments": _cross_judgment, "sentence_requests": _sentence_request, "city_gods": _city_god,
    "tudi_gods": _tudi_god, "letters": _letter, "appeals": _appeal,
}


def test_every_kind_of_open_work_has_a_refusal_test_and_one_row_of_the_dialog():
    assert set(OPEN_WORK_MAKERS) == set(OPEN_WORK)
    folded = [k for kinds in GROUPS.values() for k in kinds]
    assert sorted(folded) == sorted(OPEN_WORK)


def test_the_open_work_check_is_system_admins_and_all_zero_for_a_free_account(halls, system, judge):
    assert _as(system).get(f"{_move(judge.pk)}open-work/").data == {g: 0 for g in GROUPS} | {"kinds": {}}
    assert _as(judge).get(f"{_move(judge.pk)}open-work/").status_code == 403


@pytest.mark.parametrize("kind", sorted(OPEN_WORK_MAKERS))
def test_open_work_of_each_kind_refuses_the_move(halls, system, judge, kind):
    OPEN_WORK_MAKERS[kind](judge, halls["cn"])
    res = _as(system).post(_move(judge.pk), {"civilization": "GREEK", "tenant": "GR_FIXED", "reason": "r"},
                           format="json")
    assert res.status_code == 409, res.data
    assert res.data["code"] == "account_has_open_work"
    assert res.data["open_work_kinds"] == {kind: 1}
    group = next(g for g, kinds in GROUPS.items() if kind in kinds)
    assert res.data["open_work"] == {g: int(g == group) for g in GROUPS}
    check = _as(system).get(f"{_move(judge.pk)}open-work/")
    assert check.status_code == 200 and check.data == {**res.data["open_work"], "kinds": {kind: 1}}
    judge.refresh_from_db()
    assert judge.tenant_id == halls["cn"].pk


def test_the_original_judge_holds_a_pending_request_on_its_plan(halls, system, judge):
    """The decider of a pending sentence-plan request is the judge who concluded the original case."""
    from apps.sentence_plan.models import SentencePlan, SentencePlanRequest, SentencePlanStatus

    case = _claimed_judgment(None, halls["cn"])
    type(case).all_objects.filter(pk=case.pk).update(concluded_by=judge)
    plan = SentencePlan.all_objects.create(soul=case.soul, tenant=halls["cn"], status=SentencePlanStatus.ACTIVE,
                                           origin_judgment_id=case.pk)
    SentencePlanRequest.objects.create(plan=plan, from_tenant_code="EU_HEAVEN_HELL", kind="AMEND")
    res = _as(system).post(_move(judge.pk), {"civilization": "GREEK", "tenant": "GR_FIXED", "reason": "r"},
                           format="json")
    assert res.status_code == 409 and res.data["open_work_kinds"] == {"sentence_requests": 1}


# ---- the command ---------------------------------------------------------------------------------------------

def test_the_command_moves_on_system_admins_authority_and_refuses_anyone_else(halls, system, judge):
    with pytest.raises(CommandError, match="system_admin_only"):
        call_command("migrate_account_civilization", judge.username, civilization="GREEK", hall="GR_FIXED",
                     reason="r", by=judge.username)
    with pytest.raises(CommandError, match="reason_required"):
        call_command("migrate_account_civilization", judge.username, civilization="GREEK", hall="GR_FIXED",
                     reason=" ", by=system.username)
    call_command("migrate_account_civilization", judge.username, civilization="GREEK", hall="GR_FIXED",
                 reason="by command", by=system.username)
    judge.refresh_from_db()
    assert judge.tenant_id == halls["gr"].pk
    assert AuditLog.objects.filter(resource="user", resource_id=str(judge.pk), user=system).count() == 1


# ---- after the move, reads follow the new civilization ------------------------------------------------------

@sharded
def test_after_the_move_the_accounts_reads_come_from_the_new_civilizations_shard():
    from apps.authentication.civilization_move import migrate

    cn = Tenant.objects.create(code="FX_CN", display_name="cn", declared_civilization="CHINESE")
    gr = Tenant.objects.create(code="FX_GR", display_name="gr", declared_civilization="GREEK")
    system = User.objects.create_user(username="sys_shard", password="x", role="SYSTEM_ADMIN", tenant=None)
    judge = User.objects.create_user(username="judge_shard", password="x", role="JUDGE", tenant=cn)
    soul = Soul.objects.create(name="on the shard", tenant=gr, current_state=SoulState.JUDGING)
    _sync()
    Soul._base_manager.using("default").filter(pk=soul.pk).update(name="on control only")
    migrate(judge, civilization="GREEK", hall=gr, reason="r", actor=system)
    judge = User.objects.get(pk=judge.pk)
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(judge)  # signing in again: the new hall and the new session version
    token["tenant_code"], token["sv"] = judge.tenant.code, judge.session_version
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    with override_settings(SHARD_READ_CIVS=["GREEK"]):
        res = client.get(f"/api/v1/souls/{soul.pk}/")
    assert res.status_code == 200, res.data
    assert res.data["name"] == "on the shard"  # read from civ_greek, which the sync left one write behind
