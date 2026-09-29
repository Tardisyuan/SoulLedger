"""永久刑期 = 不转生,原属地的永久刑期同样(2026-09-29 用户决定)。

此前原属地永久的最后一站结束后,计划 COMPLETED、`_complete` 只看文明 → 中国 / 希腊灵魂进 REINCARNATING,
转生申请 201;而 App「我的受刑」同时写着「刑期永久者不申请转生」。现在:原属地 ETERNAL 节点收尾的计划
→ 灵魂 SETTLED(已有的终态),`eligibility` 走已有的 `soul_state` 拒绝,完成事件 `rebirth_open=False`
(不推「可以申请转生」)。外地永久(计划 HELD)与非永久的原属地不变。
"""
import pytest

from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.realms.models import Realm
from apps.sentence_plan.soul_view import soul_plan
from apps.soul_accounts import rebirth
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, RebirthApplication
from apps.soul_push.services import _sentence_rule
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as plan
from tests.soul_account_support import soul_client

pytestmark = pytest.mark.django_db
APPLY = "/api/v1/me/rebirth-applications/"


def _account(soul):
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.must_change_password = False
    account.initial_password_expires_at = None
    account.save()
    return account


def _completion(soul):
    return SoulEvent.objects.get(soul=soul, event_type="SENTENCE_PLAN_COMPLETED").payload


@pytest.mark.parametrize("home_code, realm_code, civ", [
    ("CN_DIYU", "DY_01_HEAVEN", "CHINESE"),
    ("GR_HADES", "GR_ISLES_OF_THE_BLESSED", "GREEK"),
])
def test_a_home_eternal_term_settles_the_soul_and_opens_no_rebirth(home_code, realm_code, civ):
    home = plan.tenant(home_code)
    Realm.all_objects.filter(pk=plan.realm(realm_code, civ).pk).update(is_eternal=True)
    soul, p = plan.planned(home)
    plan.serve(soul, p, 1)
    soul.refresh_from_db()
    p.refresh_from_db()
    assert plan.node(p, 1).status == "ETERNAL" and p.status == "COMPLETED"
    assert soul.current_state == SoulState.SETTLED
    assert not SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").exists()

    payload = _completion(soul)
    assert payload["rebirth_open"] is False
    assert _sentence_rule("SENTENCE_PLAN_COMPLETED", payload) is None  # 不推「可以申请转生」

    account = _account(soul)
    assert rebirth.eligibility(account) == (False, "soul_state", None)
    assert soul_plan(account)["rebirth_open"] is False
    client = soul_client(account)
    listing = client.get(APPLY)
    assert (listing.data["can_apply"], listing.data["reason"]) == (False, "soul_state")
    post = client.post(APPLY, {"desired_form": "HUMAN", "statement": "x"}, format="json")
    assert post.status_code == 409 and post.data["code"] == "soul_state", post.data
    assert not RebirthApplication.objects.filter(soul=soul).exists()


def test_a_home_non_eternal_term_still_opens_rebirth():
    cn = plan.tenant("CN_DIYU")
    plan.realm("DY_01_HEAVEN", "CHINESE")
    soul, p = plan.planned(cn)
    plan.serve(soul, p, 1)
    soul.refresh_from_db()
    assert soul.current_state == SoulState.REINCARNATING

    payload = _completion(soul)
    assert payload["rebirth_open"] is True
    assert _sentence_rule("SENTENCE_PLAN_COMPLETED", payload)[1] == "sentence_completed"

    account = _account(soul)
    assert rebirth.eligibility(account) == (True, None, None)
    assert soul_plan(account)["rebirth_open"] is True
    post = soul_client(account).post(APPLY, {"desired_form": "HUMAN", "statement": "x"}, format="json")
    assert post.status_code == 201, post.data


def test_an_abroad_eternal_term_is_unchanged_held_and_refused_as_in_progress():
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    soul, p, _ = plan.at_stop(cn, eg, eternal=True)
    plan.serve(soul, p, 2)
    soul.refresh_from_db()
    p.refresh_from_db()
    assert p.status == "HELD" and soul.current_state == SoulState.DISPOSED

    account = _account(soul)
    assert rebirth.eligibility(account) == (False, "sentence_in_progress", None)
    # 受着永久刑期的灵魂,「我的受刑」同样不说转生开放(App 在 eternal 态本就不看它;助手工具看)。
    assert soul_plan(account)["rebirth_open"] is False


def test_a_planless_eternal_disposition_settles_a_rebirth_capable_soul():
    """没有计划节点的存量处置(阶段 1 之前)走 `DispositionService.execute` 的旧分支:同一条规则。"""
    cn = plan.tenant("CN_DIYU")
    soul = Soul.objects.create(name="旧魂", tenant=cn, current_state=SoulState.DISPOSED)
    disposition = Disposition.objects.create(soul=soul, tenant=cn, is_eternal=True)
    assert DispositionService.execute(disposition)
    soul.refresh_from_db()
    assert soul.current_state == SoulState.SETTLED
