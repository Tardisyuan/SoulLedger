"""`GET /me/notifications/`:灵魂只看自己的推送记录,最新在前,分页,每个状态都在,一件事一行。"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.soul_push.models import PushDelivery, PushDevice, PushStatus
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import TOKEN_A, TOKEN_B, register

pytestmark = pytest.mark.django_db

URL = "/api/v1/me/notifications/"


def _device(account, token=TOKEN_A):
    return PushDevice.objects.get_or_create(
        token=token, defaults={"account": account, "soul": account.soul, "platform": "IOS", "last_seen_at": timezone.now()}
    )[0]


def _delivery(account, key, *, status=PushStatus.SENT, token=TOKEN_A, data=None, created=None, title="t"):
    row = PushDelivery.objects.create(
        dedupe_key=key, device=_device(account, token), account=account, soul=account.soul,
        event_type="E", kind="judgment_result", title=title, body="b", status=status, data=data or {"screen": "Life"},
    )
    if created is not None:  # auto_now_add 不接受传值,事后改
        PushDelivery.objects.filter(pk=row.pk).update(created_at=created)
    return row


def test_only_a_soul_reads_its_own_history_and_another_souls_rows_are_excluded(cn_tenant):
    mine, client = ready_soul(cn_tenant, name="甲")
    other, other_client = ready_soul(cn_tenant, name="乙")
    _delivery(mine, "judgment:1", title="mine")
    _delivery(other, "judgment:2", token=TOKEN_B, title="theirs")
    officer = User.objects.create_user(username="pan", password="x", role="ADMIN", tenant=cn_tenant)

    assert APIClient().get(URL).status_code == 401
    assert officer_client(officer).get(URL).status_code == 403

    page = client.get(URL)
    assert page.status_code == 200, page.data
    assert [r["title"] for r in page.data["results"]] == ["mine"]
    assert [r["title"] for r in other_client.get(URL).data["results"]] == ["theirs"]

    # 首登改密之前也不行:与 /me 其余接口同一道闸。
    mine.must_change_password = True
    mine.save()
    assert client.get(URL).status_code == 403


def test_every_status_is_readable_and_the_row_carries_the_target(cn_tenant):
    account, client = ready_soul(cn_tenant)
    for i, status in enumerate(PushStatus.values):
        _delivery(account, f"k:{i}", status=status, data={"screen": "ApplicationDetail", "application_id": "a-1"})
    rows = client.get(URL).data["results"]
    assert sorted(r["status"] for r in rows) == sorted(PushStatus.values)
    assert set(rows[0]) == {"id", "kind", "title", "body", "status", "data", "created_at"}
    assert rows[0]["data"] == {"screen": "ApplicationDetail", "application_id": "a-1"}


def test_newest_first_and_paginated(cn_tenant):
    account, client = ready_soul(cn_tenant)
    now = timezone.now()
    for i in range(25):
        _delivery(account, f"k:{i}", title=f"n{i}", created=now - timedelta(minutes=25 - i))
    first = client.get(URL).data
    assert first["count"] == 25 and first["next"] and first["previous"] is None
    assert [r["title"] for r in first["results"]] == [f"n{i}" for i in range(24, 4, -1)]
    second = client.get(URL, {"page": 2}).data
    assert [r["title"] for r in second["results"]] == ["n4", "n3", "n2", "n1", "n0"]
    assert second["next"] is None


def test_one_event_on_two_devices_is_one_row(cn_tenant):
    account, client = ready_soul(cn_tenant)
    register(client, TOKEN_A)
    register(client, TOKEN_B, "ANDROID")
    _delivery(account, "judgment:1", token=TOKEN_A)
    _delivery(account, "judgment:1", token=TOKEN_B)
    _delivery(account, "judgment:2", token=TOKEN_B)
    page = client.get(URL).data
    assert page["count"] == 2 and len(page["results"]) == 2
