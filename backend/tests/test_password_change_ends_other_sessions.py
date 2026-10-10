"""官员改密码 / 邮箱重置密码:其他设备立刻退出,当前设备保持。

机制(`apps/authentication/passwords.py`):刷新令牌进黑名单 + `User.session_version` +1。
官员令牌带 `sv` 声明,比对不上的 access 在 HTTP(`OfficerJWTAuthentication`)与
WebSocket 握手(`ws_auth`)都立刻被拒,不等 access 自然过期。
"""
import re
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.core import mail
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken as StockRefreshToken

from apps.audit.models import AuditLog
from apps.authentication import tasks

LOGIN = "/api/v1/auth/login/"
REFRESH = "/api/v1/auth/refresh/"
PROFILE = "/api/v1/auth/profile/"
CHANGE = "/api/v1/auth/change-password/"
CONFIRM = "/api/v1/auth/officer-reset/confirm/"
OLD = "OldPass!123-x"
NEW = "N0t-Guessable!2026-b"


@pytest.fixture(autouse=True)
def _clean(db):
    cache.clear()
    mail.outbox.clear()
    yield
    cache.clear()


@pytest.fixture
def officer(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="two_devices", email="two@example.com", password=OLD, role="JUDGE", tenant=cn_tenant,
    )


_ip = iter(range(10, 250))


def _login(remember=False, password=OLD):
    res = APIClient().post(
        LOGIN, {"username": "two_devices", "password": password, "remember": remember},
        format="json", REMOTE_ADDR=f"198.51.100.{next(_ip)}",
    )
    assert res.status_code == 200, res.content
    return res.data


def _get(access):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return c.get(PROFILE).status_code


def _change(device, new=NEW, old=OLD, **extra):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {device['access']}")
    body = {"old_password": old, "new_password": new, "refresh": device["refresh"], **extra}
    return c.post(CHANGE, body, format="json")


def _refresh(token):
    return APIClient().post(REFRESH, {"refresh": token}, format="json").status_code


class TestChangePassword:
    def test_other_device_is_out_at_once_this_one_stays(self, officer):
        a, b = _login(), _login()
        assert _get(a["access"]) == _get(b["access"]) == 200

        res = _change(a)
        assert res.status_code == 200, res.content

        # B: access dies immediately (not at expiry), refresh is blacklisted.
        assert _get(b["access"]) == 401
        assert _refresh(b["refresh"]) == 401
        # A: the pair it held is spent too -- A swaps in the new one from the response.
        assert _get(a["access"]) == 401
        assert _get(res.data["access"]) == 200
        assert _refresh(res.data["refresh"]) == 200

    def test_old_password_no_longer_logs_in(self, officer):
        _change(_login())
        bad = APIClient().post(LOGIN, {"username": "two_devices", "password": OLD}, format="json", REMOTE_ADDR="198.51.100.9")
        assert bad.status_code == 401
        _login(password=NEW)

    def test_a_refused_change_revokes_nothing(self, officer):
        a, b = _login(), _login()
        before = officer.session_version
        res = _change(a, old="wrong-old-password")
        assert res.status_code == 400 and "old_password" in res.data
        weak = _change(a, new="short")
        assert weak.status_code == 400
        officer.refresh_from_db()
        assert officer.session_version == before
        assert _get(a["access"]) == _get(b["access"]) == 200
        assert _refresh(b["refresh"]) == 200

    def test_without_the_refresh_token_this_device_goes_too_and_no_tokens_come_back(self, officer):
        a, b = _login(), _login()
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {a['access']}")
        res = c.post(CHANGE, {"old_password": OLD, "new_password": NEW}, format="json")
        assert res.status_code == 200 and "access" not in res.data and "refresh" not in res.data
        assert _get(a["access"]) == _get(b["access"]) == 401

    def test_someone_elses_refresh_token_is_refused_and_nothing_changes(self, officer, django_user_model, cn_tenant):
        other = django_user_model.objects.create_user(username="other_o", password="x", role="JUDGE", tenant=cn_tenant)
        foreign = str(StockRefreshToken.for_user(other))
        a = _login()
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {a['access']}")
        res = c.post(CHANGE, {"old_password": OLD, "new_password": NEW, "refresh": foreign}, format="json")
        assert res.status_code == 400 and "refresh" in res.data
        officer.refresh_from_db()
        assert officer.check_password(OLD) and officer.session_version == 0
        assert _get(a["access"]) == 200

    def test_the_device_keeps_its_thirty_day_lifetime(self, officer):
        a = _login(remember=True)
        res = _change(a)
        exp = datetime.fromtimestamp(StockRefreshToken(res.data["refresh"])["exp"], tz=UTC)
        assert exp - timezone.now() > timedelta(days=29)

    def test_an_audit_row_is_written(self, officer):
        _change(_login())
        assert AuditLog.objects.filter(user=officer, description__contains="其他设备已退出").count() == 1


class TestEmailReset:
    def _link(self, officer):
        from apps.authentication import officer_reset

        officer.email_verified_address = officer.email
        officer.email_verified_at = timezone.now()
        officer.save(update_fields=["email_verified_address", "email_verified_at"])
        with patch.object(tasks.send_officer_reset_mail, "delay", side_effect=tasks.send_officer_reset_mail.run):
            officer_reset.send_reset_mail_if_eligible("two_devices")
        m = re.search(r"uid=([^&\s]+)&token=([^\s]+)", mail.outbox[-1].body)
        return m.group(1), m.group(2)

    def _confirm(self, uid, token, password):
        return APIClient().post(
            CONFIRM, {"uid": uid, "token": token, "new_password": password}, format="json", REMOTE_ADDR="198.51.100.200"
        )

    def test_every_device_is_out_access_included(self, officer):
        a, b = _login(), _login()
        uid, token = self._link(officer)
        assert self._confirm(uid, token, NEW).status_code == 200
        assert _get(a["access"]) == _get(b["access"]) == 401
        assert _refresh(a["refresh"]) == _refresh(b["refresh"]) == 401


@database_sync_to_async
def _sign(user_pk):
    from apps.authentication.models import User
    from apps.authentication.serializers import CustomTokenObtainPairSerializer

    return str(CustomTokenObtainPairSerializer.get_token(User.objects.get(pk=user_pk)).access_token)


@database_sync_to_async
def _end(user_pk):
    from apps.authentication.models import User
    from apps.authentication.passwords import end_sessions

    end_sessions(User.objects.get(pk=user_pk))


async def _connects(token):
    from config.asgi import application

    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={token}")
    try:
        ok, _ = await comm.connect()
    except Exception:
        return False
    await comm.disconnect()
    return ok


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_websocket_handshake_refuses_a_token_from_before_the_change(officer_ws):
    token = await _sign(officer_ws)
    assert await _connects(token) is True
    await _end(officer_ws)
    assert await _connects(token) is False
    assert await _connects(await _sign(officer_ws)) is True


@pytest.fixture
def officer_ws(db, django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="ws_sv", password="x", role="JUDGE", tenant=cn_tenant,
    ).pk
