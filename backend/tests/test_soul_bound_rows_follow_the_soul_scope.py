"""挂在灵魂上的六类行跟灵魂的数据范围走(审计 2026-11-11 P-10,用户 2026-11-11):
受刑计划、受刑计划变更请求、转生申请、缩短冷却、灵魂账号与待交付凭据、殿司收件箱。

判官配「本机构」(ORG)后,别的机构的灵魂在这些列表、计数与详情里都不出现;范围内的照常。
判官另兼一个**没配范围**的角色(P10_CLERK,持账号与收件箱的码)—— 按 P-12 它不把范围放宽成全殿。
所有角色都没配时仍是全殿。每条都断言两边。
"""
from types import SimpleNamespace

import pytest
from django.utils import timezone

from apps.chat.models import Conversation, ConversationKind
from apps.officer_app import todo
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Role, RolePermission
from apps.sentence_plan.models import SentencePlan, SentencePlanRequest, SentencePlanStatus
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, CooldownShorteningRequest, RebirthApplication
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflow, CaseType
from tests import sentence_plan_support as sp
from tests.data_scope_support import org, scope
from tests.perm_support import seeded_grants, seeded_permission
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

LISTS = ("/api/v1/sentence-plans/", "/api/v1/soul-accounts/accounts/", "/api/v1/soul-accounts/credentials/",
         "/api/v1/soul-accounts/rebirth-applications/", "/api/v1/soul-accounts/cooldown-shortenings/",
         "/api/v1/chat/inbox/")


def _rows(tenant, owner, name, judge):
    soul = Soul.objects.create(name=name, tenant=tenant, owner_org=owner, current_state=SoulState.JUDGING)
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)  # 无联系方式 → 一条待交付凭据
    plan = SentencePlan.all_objects.create(soul=soul, tenant=tenant, cycle=account.cycle,
                                           status=SentencePlanStatus.ACTIVE)
    change = SentencePlanRequest.objects.create(plan=plan, from_tenant_code="EU_HEAVEN_HELL", kind="AMEND")
    application = RebirthApplication.objects.create(
        soul=soul, account=account, cycle=account.cycle, desired_form="HUMAN", status="REJECTED",
        workflow=ApprovalWorkflow.objects.create(soul=soul, workflow_name="x", case_type=CaseType.REBIRTH_APPLICATION),
        decided_at=timezone.now())
    cooldown = CooldownShorteningRequest.objects.create(soul=soul, account=account, application=application,
                                                        cycle=account.cycle, reason="x")
    letter = Conversation.objects.create(kind=ConversationKind.OFFICER_INBOX, room_id=f"!p10{name}:x", soul_a=soul,
                                         tenant=tenant, last_from="soul", assignee=judge)
    return SimpleNamespace(soul=soul, account=account, plan=plan, change=change, application=application,
                           cooldown=cooldown, letter=letter)


@pytest.fixture
def w(cn_tenant):
    seeded_grants()
    clerk = Role.objects.get_or_create(name="P10_CLERK", defaults={"display_name": "书吏"})[0]
    for codename in ("soul_account.read", "soul_inbox.read", "soul_inbox.reply"):
        RolePermission.objects.get_or_create(role=clerk, permission=seeded_permission(codename))
    invalidate_all_permissions()
    mine_org, theirs_org = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    judge = sp.officer("p10_judge", "JUDGE", cn_tenant, organization=mine_org, extra_roles=["P10_CLERK"])
    return SimpleNamespace(judge=judge, client=officer_client(judge),
                           mine=_rows(cn_tenant, mine_org, "本司魂", judge),
                           theirs=_rows(cn_tenant, theirs_org, "他司魂", judge))


def _counts(client):
    out = {}
    for url in LISTS:
        response = client.get(url)
        assert response.status_code == 200, (url, response.data)
        out[url] = response.data["count"]
    return out


def _details(w, side):
    rows = getattr(w, side)
    return {
        "plan": w.client.get(f"/api/v1/sentence-plans/{rows.plan.pk}/").status_code,
        "account": w.client.get(f"/api/v1/soul-accounts/accounts/{rows.account.pk}/").status_code,
        "application": w.client.get(f"/api/v1/soul-accounts/rebirth-applications/{rows.application.pk}/").status_code,
        "cooldown": w.client.get(f"/api/v1/soul-accounts/cooldown-shortenings/{rows.cooldown.pk}/").status_code,
        "letter": w.client.get(f"/api/v1/chat/inbox/{rows.letter.pk}/").status_code,
    }


def test_an_org_scoped_judge_sees_only_his_orgs_souls_rows(w):
    """兼任的 P10_CLERK 没配范围:P-12 之前它会把范围放宽成全殿,这里每个计数都会是 2。"""
    scope("JUDGE", "ORG")
    assert _counts(w.client) == dict.fromkeys(LISTS, 1)
    assert set(_details(w, "theirs").values()) == {404}
    mine = _details(w, "mine")
    assert all(code != 404 for code in mine.values()), mine

    cooldowns = w.client.get("/api/v1/soul-accounts/cooldown-shortenings/counts/").data
    assert cooldowns["PENDING"] == 1
    folders = w.client.get("/api/v1/chat/inbox/folders/").data
    assert folders["all"] == 1

    built = todo.build(w.judge)
    assert [i["id"] for i in built["sentence_changes"]["items"]] == [str(w.mine.change.pk)]
    assert [i["id"] for i in built["letters"]["items"]] == [str(w.mine.letter.pk)]
    assert built["cooldowns"]["count"] == 1


def test_with_no_role_configured_the_whole_hall_is_still_visible(w):
    assert _counts(w.client) == dict.fromkeys(LISTS, 2)
    assert all(code != 404 for code in _details(w, "theirs").values())
    built = todo.build(w.judge)
    assert built["sentence_changes"]["count"] == 2 and built["letters"]["count"] == 2


def test_a_soul_the_judge_created_stays_visible_under_any_scope(w):
    """灵魂自己的「本人创建」那条照算(注册表的 user_paths):SELF 下别司的魂,是他建的就看得到。"""
    scope("JUDGE", "SELF")
    assert _counts(w.client) == dict.fromkeys(LISTS, 0)
    Soul.all_objects.filter(pk=w.theirs.soul.pk).update(create_user=w.judge)
    assert _counts(w.client) == dict.fromkeys(LISTS, 1)
