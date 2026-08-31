"""三处丢弃 `transition_to` 返回值的地方,现在都不丢了。

`transition_to` 返回 False 表示「这条边不存在,什么都没写」。三个调用方把它
丢在地上,于是各自宣布了一件没有发生的事:

* `JudgmentConclusionService.conclude` —— 接口回 **200**,judgment 标记 final、
  处置已创建、工作流可能也建了,而灵魂还是 ALIVE。**十条既有测试正踩在这个
  形态上**:它们用 ALIVE 的灵魂 conclude 并断言 200,而从不断言灵魂状态。
  这一条不是推测出来的:加上检查之后,那十条一起报红。
* `ReincarnationService.complete_rebirth` —— 最重的一个。到这一行时
  `Reincarnation` 行已建、`merit_score`/`demerit_score` 已被继承值覆盖、
  `name`/`death_date`/`origin_location` 已改写,**全都在同一个 `atomic()` 里**。
  没有异常就没有回滚,副作用照常提交。
* `Soul.transition_to` 自己的 `**kwargs`(L14):`hasattr` 把拼错的字段名静默丢弃
  并返回 True。`deathdate=` / `orgin_location=` 都被接受、都被丢掉。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.judgment.models import Judgment, Verdict
from apps.judgment.services import JudgmentNotConcludableError
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.fixture
def tenant(db):
    row, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    return row


@pytest.fixture
def admin(tenant):
    user = User.objects.create_user(
        username="concluder", password="x", role=UserRole.ADMIN, tenant=tenant
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _judgment(tenant, state):
    soul = Soul.objects.create(name="案主", tenant=tenant, current_state=state)
    return Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant
    )


@pytest.mark.django_db
def test_concluding_a_case_on_a_living_soul_is_refused(tenant):
    judgment = _judgment(tenant, SoulState.ALIVE)
    with pytest.raises(JudgmentNotConcludableError):
        judgment.conclude(Verdict.PASSED, "")
    judgment.refresh_from_db()
    assert judgment.is_final is False, "被拒的结案还是把 judgment 标成了 final"
    assert judgment.soul.current_state == SoulState.ALIVE


@pytest.mark.django_db
def test_the_api_says_400_rather_than_200(admin, tenant):
    judgment = _judgment(tenant, SoulState.ALIVE)
    response = admin.post(
        f"/api/v1/judgment/{judgment.id}/conclude/",
        {"verdict": Verdict.PASSED, "notes": ""},
        format="json",
    )
    assert response.status_code == 400, (
        f"对一个 ALIVE 的灵魂结案得到 {response.status_code};"
        f"旧行为是 200,而灵魂一动不动"
    )
    judgment.refresh_from_db()
    assert judgment.is_final is False


@pytest.mark.django_db
def test_a_case_on_a_soul_under_judgment_still_concludes(admin, tenant):
    """**断存在。** 只断「被拒」的测试,在 conclude 一律 400 时也全绿。"""
    judgment = _judgment(tenant, SoulState.JUDGING)
    response = admin.post(
        f"/api/v1/judgment/{judgment.id}/conclude/",
        {"verdict": Verdict.PASSED, "notes": ""},
        format="json",
    )
    assert response.status_code == 200, (response.status_code, response.data)
    judgment.refresh_from_db()
    assert judgment.is_final is True
    judgment.soul.refresh_from_db()
    assert judgment.soul.current_state == SoulState.DISPOSED, (
        "结案成功了,而灵魂没有走到 DISPOSED —— 这正是被丢掉的那个返回值说的事"
    )


@pytest.mark.django_db
def test_a_misspelt_kwarg_is_an_error_not_a_shrug(tenant):
    """L14。`hasattr` 把拼错的字段名丢掉并返回 True。"""
    soul = Soul.objects.create(name="x", tenant=tenant, current_state=SoulState.ALIVE)
    with pytest.raises(TypeError, match="deathdate"):
        soul.transition_to(SoulState.JUDGING, "typo", deathdate="2020-01-01")


@pytest.mark.django_db
def test_a_correctly_spelt_kwarg_still_lands(tenant):
    """**断存在。** 一个对所有 kwargs 都抛异常的实现会让上面那条绿。"""
    soul = Soul.objects.create(name="x", tenant=tenant, current_state=SoulState.ALIVE)
    assert soul.transition_to(SoulState.JUDGING, "ok", origin_location="北京") is True
    soul.refresh_from_db()
    assert soul.origin_location == "北京"
