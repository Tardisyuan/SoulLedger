"""`POST /judgment/{id}/request-reassign/` —— 改派名单空时「请管理员改派」(第三类 F 组 2.7)。

权限:`judgment.execute`,且案子在调用者的租户范围里(`get_object`)。
收件人:案子所在租户的在职 ADMIN;没有就是全局 ADMIN;求助者自己不算。
限流:同一人、同一件案子 10 分钟一次,多了 429 带 `retry_after`。
"""
import time

import pytest

from apps.authentication.models import User
from apps.judgment import claims
from apps.notifications.models import UserNotification
from tests.test_judgment_claim import _case, _client, _post, world  # noqa: F401

TYPE = "JUDGMENT_REASSIGN_REQUESTED"


def _ask(client, case):
    return _post(client, case, "request-reassign")


def _notified(case=None):
    rows = UserNotification.objects.filter(notification_type=TYPE)
    if case is not None:
        rows = rows.filter(related_id=str(case.pk))
    return sorted(rows.values_list("user__username", flat=True))


@pytest.fixture
def admins(world):  # noqa: F811
    def admin(name, tenant):
        return User.objects.create_user(username=name, password="x", role="ADMIN", tenant=tenant)

    world.users.update(
        cn_admin=admin("rr_cn_admin", world.cn),
        cn_admin2=admin("rr_cn_admin2", world.cn),
        eu_admin=admin("rr_eu_admin", world.eu),
        global_admin=admin("rr_global_admin", None),
    )
    User.objects.create_user(username="rr_cn_admin_off", password="x", role="ADMIN", tenant=world.cn, is_active=False)
    return world


@pytest.mark.django_db
class TestRecipients:
    def test_the_case_tenants_admins_hear_it_with_who_asked_and_which_soul(self, admins):
        admins.users["mod"].display_name = "崔珏"
        admins.users["mod"].save()
        case = _case(admins.cn, name="张三")
        response = _ask(admins.clients["mod"], case)
        assert response.status_code == 200, response.data
        assert response.data == {"notified": 2}
        assert _notified() == ["rr_cn_admin", "rr_cn_admin2"]
        note = UserNotification.objects.filter(notification_type=TYPE).first()
        assert note.params == {"by": "崔珏", "soul": "张三"}
        assert (note.title, note.message) == ("请求改派", "崔珏 请求改派案件 张三")
        assert (note.related_resource, note.related_id) == ("judgment", str(case.pk))

    def test_no_admin_in_the_tenant_falls_back_to_the_global_admins(self, world):  # noqa: F811
        User.objects.create_user(username="rr_only_global", password="x", role="ADMIN", tenant=None)
        User.objects.create_user(username="rr_eu_only", password="x", role="ADMIN", tenant=world.eu)
        response = _ask(world.clients["mod"], _case(world.cn))
        assert response.data == {"notified": 1}
        assert _notified() == ["rr_only_global"]

    def test_an_admin_asking_is_not_their_own_recipient(self, admins):
        me = admins.users["cn_admin"]
        _ask(_client(me), _case(admins.cn))
        assert _notified() == ["rr_cn_admin2"]


@pytest.mark.django_db
class TestPermissionAndTenant:
    def test_a_judge_with_judgment_execute_may_ask(self, admins):
        assert _ask(admins.clients["a"], _case(admins.cn)).status_code == 200

    @pytest.mark.parametrize("who", ["viewer", "guardian"])
    def test_without_judgment_execute_it_is_403_and_nobody_hears(self, admins, who):
        assert _ask(admins.clients[who], _case(admins.cn)).status_code == 403
        assert _notified() == []

    def test_another_tenants_case_is_404_and_nobody_hears(self, admins):
        assert _ask(admins.clients["mod"], _case(admins.eu)).status_code == 404
        assert _notified() == []


@pytest.mark.django_db
class TestRateLimit:
    def test_a_second_ask_within_ten_minutes_is_429_with_retry_after_and_sends_nothing(self, admins):
        case = _case(admins.cn)
        assert _ask(admins.clients["mod"], case).status_code == 200
        again = _ask(admins.clients["mod"], case)
        assert again.status_code == 429
        assert again.data["code"] == "rate_limited"
        assert 590 <= again.data["retry_after"] <= 600
        assert again["Retry-After"] == str(again.data["retry_after"])
        assert len(_notified(case)) == 2  # the first ask only

    def test_the_limit_is_per_case_and_per_caller(self, admins):
        first, second = _case(admins.cn, name="甲"), _case(admins.cn, name="乙")
        assert _ask(admins.clients["mod"], first).status_code == 200
        assert _ask(admins.clients["mod"], second).status_code == 200
        assert _ask(admins.clients["a"], first).status_code == 200

    def test_after_the_window_it_goes_through_again(self, admins, monkeypatch):
        case = _case(admins.cn)
        assert _ask(admins.clients["mod"], case).status_code == 200
        from django.core.cache import cache

        cache.delete(f"judgment_reassign_request:{case.pk}:{admins.users['mod'].pk}")  # the TTL running out
        assert _ask(admins.clients["mod"], case).status_code == 200
        assert len(_notified(case)) == 4

    def test_the_window_is_ten_minutes(self):
        assert claims.REASSIGN_REQUEST_WINDOW_SECONDS == 600

    def test_retry_after_counts_down(self, admins, monkeypatch):
        case = _case(admins.cn)
        _ask(admins.clients["mod"], case)
        now = time.time()
        monkeypatch.setattr(time, "time", lambda: now + 400)
        assert 199 <= _ask(admins.clients["mod"], case).data["retry_after"] <= 200
