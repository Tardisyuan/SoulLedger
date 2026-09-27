"""`/api/v1/me/welcomed/`:App 欢迎过场(设计「文明气质」1b)的服务端记录。

只写本人那一行;别的灵魂那一行不动;文明值在边界校验;重复写是幂等的,
已记过的文明被移到末尾(末项 = 上一次欢迎进入的文明)。
"""
import pytest

from apps.soul_accounts.models import SoulAccount
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

URL = "/api/v1/me/welcomed/"


def _welcomed(account):
    return SoulAccount.objects.get(pk=account.pk).welcomed_civilizations


def test_a_new_account_has_welcomed_nothing(cn_tenant):
    _, client = ready_soul(cn_tenant)
    assert client.get("/api/v1/me/").data["welcomed_civilizations"] == []


def test_marking_writes_only_the_callers_own_row(cn_tenant):
    account, client = ready_soul(cn_tenant, name="甲")
    other, _ = ready_soul(cn_tenant, name="乙")
    response = client.post(URL, {"civilization": "CHINESE"}, format="json")
    assert response.status_code == 200
    assert response.data == {"welcomed_civilizations": ["CHINESE"]}
    assert _welcomed(account) == ["CHINESE"]
    assert _welcomed(other) == []
    assert client.get("/api/v1/me/").data["welcomed_civilizations"] == ["CHINESE"]


def test_the_body_cannot_name_another_soul(cn_tenant):
    """URL 与请求体里都没有灵魂 id 的位置;塞一个进去也只写到本人。"""
    account, client = ready_soul(cn_tenant, name="甲")
    other, _ = ready_soul(cn_tenant, name="乙")
    body = {"civilization": "EGYPTIAN", "soul": str(other.soul_id), "account": str(other.pk)}
    assert client.post(URL, body, format="json").status_code == 200
    assert _welcomed(other) == []
    assert _welcomed(account) == ["EGYPTIAN"]


@pytest.mark.parametrize("value", ["cn", "chinese", "ATLANTEAN", "", None, ["CHINESE"]])
def test_an_unknown_civilization_is_refused_and_nothing_is_written(cn_tenant, value):
    account, client = ready_soul(cn_tenant)
    assert client.post(URL, {"civilization": value}, format="json").status_code == 400
    assert _welcomed(account) == []


def test_marking_is_idempotent_and_the_last_welcome_moves_to_the_end(cn_tenant):
    account, client = ready_soul(cn_tenant)
    for civ in ("CHINESE", "CHINESE", "EGYPTIAN", "EGYPTIAN"):
        assert client.post(URL, {"civilization": civ}, format="json").status_code == 200
    assert _welcomed(account) == ["CHINESE", "EGYPTIAN"]
    # 回归原籍:原籍已记过,再记一次只是移到末尾,不重复。
    again = client.post(URL, {"civilization": "CHINESE"}, format="json").data["welcomed_civilizations"]
    assert again == ["EGYPTIAN", "CHINESE"]


def test_an_officer_token_cannot_write(cn_tenant, admin_user):
    account, _ = ready_soul(cn_tenant)
    assert officer_client(admin_user).post(URL, {"civilization": "CHINESE"}, format="json").status_code in (401, 403)
    assert _welcomed(account) == []


def test_before_the_password_change_nothing_is_written(cn_tenant):
    account, client = ready_soul(cn_tenant)
    SoulAccount.objects.filter(pk=account.pk).update(must_change_password=True)
    assert client.post(URL, {"civilization": "CHINESE"}, format="json").status_code == 403
    assert _welcomed(account) == []
