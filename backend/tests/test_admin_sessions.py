"""管理员的在线会话列表与强退(2026-10-29 用户决定):`/auth/admin/sessions/`。

钉住:码门 `session.manage`(无码 403);范围 —— 绑殿管理员只看本殿的人,无殿管理员看全部,范围外的 id 404;
官员 / 灵魂两个页签互不混;按用户筛;强退一台后它的 access 与刷新都失效、别的会话照常、实时连接被关;
强退一个人的全部;不能在这里退自己正在用的这台、也不能强退自己;都写审计;登录记下 IP。
"""
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.models import SignInSession, User
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

LIST = "/api/v1/auth/admin/sessions/"
REVOKE_USER = "/api/v1/auth/admin/sessions/revoke-user/"
PROFILE = "/api/v1/auth/profile/"
REFRESH = "/api/v1/auth/refresh/"
PASSWORD = "Sessions!Pass-2026-x"
_ip = iter(range(10, 250))


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    yield
    cache.clear()


def _user(username, role, tenant):
    return User.objects.create_user(username=username, password=PASSWORD, role=role, tenant=tenant)


def _login(username):
    res = APIClient().post("/api/v1/auth/login/", {"username": username, "password": PASSWORD}, format="json",
                           REMOTE_ADDR=f"203.0.113.{next(_ip)}")
    assert res.status_code == 200, res.content
    return res.data


def _as(device):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {device['access']}")
    return c


def _sid(device):
    from rest_framework_simplejwt.tokens import AccessToken

    return AccessToken(device["access"])["sid"]


@pytest.fixture
def world(cn_tenant, eu_tenant):
    cn_judge, eu_judge = _user("cn_judge", "JUDGE", cn_tenant), _user("eu_judge", "JUDGE", eu_tenant)
    cn_soul = _user("soul.cn.0", "SOUL", cn_tenant)
    sessions = {
        "cn_judge": SignInSession.objects.create(user=cn_judge, label="macOS · Safari", ip_address="198.51.100.7"),
        "eu_judge": SignInSession.objects.create(user=eu_judge, label="Windows · Edge"),
        "cn_soul": SignInSession.objects.create(user=cn_soul, label="iPhone"),
        # 不在线的两种:已退出、30 天没活动
        "revoked": SignInSession.objects.create(user=cn_judge, label="old", revoked_at=timezone.now()),
        "idle": SignInSession.objects.create(user=cn_judge, label="idle",
                                             last_seen_at=timezone.now() - timedelta(days=31)),
    }
    return {
        "cn_judge": cn_judge, "eu_judge": eu_judge, "cn_soul": cn_soul, "sessions": sessions,
        "root": _user("root_admin", "ADMIN", None),
        "cn_admin": _user("cn_admin", "ADMIN", cn_tenant),
    }


def _ids(res):
    assert res.status_code == 200, res.content
    return {row["id"] for row in res.data["results"]}


class TestListing:
    def test_a_hall_less_admin_sees_every_hall_and_a_bound_admin_only_its_own(self, world):
        s = world["sessions"]
        assert _ids(officer_client(world["root"]).get(LIST)) == {str(s["cn_judge"].pk), str(s["eu_judge"].pk)}
        assert _ids(officer_client(world["cn_admin"]).get(LIST)) == {str(s["cn_judge"].pk)}

    def test_souls_have_their_own_tab_and_never_appear_among_officers(self, world):
        s = world["sessions"]
        client = officer_client(world["root"])
        assert _ids(client.get(LIST, {"kind": "soul"})) == {str(s["cn_soul"].pk)}
        assert str(s["cn_soul"].pk) not in _ids(client.get(LIST, {"kind": "officer"}))
        assert client.get(LIST, {"kind": "ghost"}).status_code == 400

    def test_filter_by_user_and_the_row_shape(self, world):
        res = officer_client(world["root"]).get(LIST, {"user": world["cn_judge"].pk})
        assert _ids(res) == {str(world["sessions"]["cn_judge"].pk)}
        row = res.data["results"][0]
        assert (row["username"], row["label"], row["ip_address"], row["tenant_code"], row["current"]) == (
            "cn_judge", "macOS · Safari", "198.51.100.7", "CN_DIYU", False)

    def test_without_the_codename_it_is_403(self, world):
        judge = officer_client(world["cn_judge"])
        assert judge.get(LIST).status_code == 403
        assert judge.post(f"{LIST}{world['sessions']['cn_judge'].pk}/revoke/").status_code == 403
        assert judge.post(REVOKE_USER, {"user": world["cn_judge"].pk}, format="json").status_code == 403
        assert SignInSession.objects.filter(revoked_at__isnull=True).count() == 4

    def test_sign_in_records_the_address(self, cn_tenant):
        _user("addr_judge", "JUDGE", cn_tenant)
        device = _login("addr_judge")
        assert SignInSession.objects.get(pk=_sid(device)).ip_address.startswith("203.0.113.")


class TestForceSignOut:
    def test_revoking_one_session_kills_its_tokens_and_sockets_and_leaves_the_others(self, world, monkeypatch):
        import apps.events.realtime as realtime

        closed = []
        monkeypatch.setattr(realtime, "close_user_sockets", lambda user_id, min_version=None: closed.append(user_id))
        a, b = _login("cn_judge"), _login("cn_judge")
        res = officer_client(world["cn_admin"]).post(f"{LIST}{_sid(a)}/revoke/")
        assert res.status_code == 204, res.content
        assert _as(a).get(PROFILE).status_code == 401
        assert APIClient().post(REFRESH, {"refresh": a["refresh"]}, format="json").status_code == 401
        assert _as(b).get(PROFILE).status_code == 200
        assert closed == [world["cn_judge"].pk]
        audit = AuditLog.objects.get(description__startswith="管理员强退会话")
        assert audit.user == world["cn_admin"] and audit.changes["session_revoked"] == _sid(a)

    def test_revoking_a_user_ends_every_session_of_theirs_only(self, world, monkeypatch):
        import apps.events.realtime as realtime

        closed = []
        monkeypatch.setattr(realtime, "close_user_sockets", lambda user_id, min_version=None: closed.append(user_id))
        a, b = _login("cn_judge"), _login("cn_judge")
        res = officer_client(world["root"]).post(REVOKE_USER, {"user": world["cn_judge"].pk}, format="json")
        assert res.status_code == 200 and res.data["revoked"] == 3  # 两次登录 + 夹具里那一台
        assert _as(a).get(PROFILE).status_code == 401 and _as(b).get(PROFILE).status_code == 401
        assert closed == [world["cn_judge"].pk]
        assert SignInSession.objects.get(pk=world["sessions"]["eu_judge"].pk).revoked_at is None
        assert AuditLog.objects.filter(description__startswith="管理员强退 cn_judge 的全部会话").count() == 1

    # 强退的审计是同步写的(`officer_reset._audit`,不经 on_commit),所以「没有这一行」在未提交的事务里也成立。
    @pytest.mark.allow_uncommitted_audit
    def test_out_of_scope_ids_are_404_and_change_nothing(self, world):
        bound = officer_client(world["cn_admin"])
        eu = world["sessions"]["eu_judge"]
        assert bound.post(f"{LIST}{eu.pk}/revoke/").status_code == 404
        assert bound.post(REVOKE_USER, {"user": world["eu_judge"].pk}, format="json").status_code == 404
        eu.refresh_from_db()
        assert eu.revoked_at is None
        assert not AuditLog.objects.filter(description__startswith="管理员强退").exists()

    def test_not_this_device_and_not_oneself(self, world):
        device = _login("root_admin")
        client = _as(device)
        rows = client.get(LIST, {"user": world["root"].pk}).data["results"]
        assert [r["current"] for r in rows] == [True]
        res = client.post(f"{LIST}{_sid(device)}/revoke/")
        assert (res.status_code, res.data["code"]) == (400, "current_session")
        res = client.post(REVOKE_USER, {"user": world["root"].pk}, format="json")
        assert (res.status_code, res.data["code"]) == (400, "self")
        assert client.get(PROFILE).status_code == 200
