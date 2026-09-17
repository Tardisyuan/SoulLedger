"""`/me/push-tokens/` 与 `/me/notification-settings/`:只有灵魂能登记、token 不串账号、转世停用即失效、偏好。"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.events.services import EventService
from apps.soul_push.models import PushDelivery, PushDevice
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import TOKEN_A, TOKEN_B, enqueued, register  # noqa: F401

pytestmark = pytest.mark.django_db


def _judgment_concluded(soul, judgment_id="j-1"):
    EventService.log(soul, "JUDGMENT_CONCLUDED", {"judgment_id": judgment_id, "verdict": "GUILTY"})


def test_only_a_current_soul_can_register_a_token(cn_tenant):
    account, client = ready_soul(cn_tenant)
    officer = User.objects.create_user(username="pan", password="x", role="ADMIN", tenant=cn_tenant)

    assert register(APIClient()).status_code == 401
    assert register(officer_client(officer)).status_code == 403
    assert not PushDevice.objects.exists()

    created = register(client)
    assert created.status_code == 201, created.data
    assert set(created.data) == {"id", "platform", "is_active", "last_seen_at", "created_at"}
    assert register(client).status_code == 200  # 再登记一次是刷新,不是第二行
    assert PushDevice.objects.get().account_id == account.pk

    # 首登改密之前也不行:与 /me 其余接口同一道闸。
    account.must_change_password = True
    account.save()
    assert register(client, TOKEN_B).status_code == 403
    assert PushDevice.objects.count() == 1


@pytest.mark.parametrize("token", [
    "abc", "ExponentPushToken[]", "ExponentPushToken[a b c d e f g h]", "ExponentPushToken[aaaaaaaa]x",
    "FakePushToken[aaaaaaaaaaaa]", "ExponentPushToken[aaaaaaaa\n]",
])
def test_the_token_must_look_like_an_expo_token(cn_tenant, token):
    _, client = ready_soul(cn_tenant)
    assert register(client, token).status_code == 400
    assert not PushDevice.objects.exists()


def test_both_expo_prefixes_are_accepted(cn_tenant):
    _, client = ready_soul(cn_tenant)
    assert register(client, "ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "ANDROID").status_code == 201


def test_a_token_moves_to_the_account_that_registers_it(cn_tenant, enqueued):  # noqa: F811
    first, first_client = ready_soul(cn_tenant, name="甲")
    second, second_client = ready_soul(cn_tenant, name="乙")
    assert register(first_client).status_code == 201
    assert register(second_client).status_code == 200  # 同一台手机换了账号

    device = PushDevice.objects.get(token=TOKEN_A)
    assert device.account_id == second.pk and device.soul_id == second.soul_id and device.is_active

    _judgment_concluded(first.soul)
    assert not PushDelivery.objects.filter(account=first).exists()  # 旧账号的事件推不到这台手机
    _judgment_concluded(second.soul, "j-2")
    assert PushDelivery.objects.filter(account=second, device=device).count() == 1

    # 旧账号注销同一个 token:动不了新主人的设备。
    assert first_client.post("/api/v1/me/push-tokens/unregister/", {"token": TOKEN_A},
                             format="json").status_code == 204
    device.refresh_from_db()
    assert device.is_active and device.account_id == second.pk


def test_unregister_stops_pushes_to_that_device(cn_tenant, enqueued):  # noqa: F811
    account, client = ready_soul(cn_tenant)
    register(client)
    register(client, TOKEN_B, "ANDROID")
    assert client.post("/api/v1/me/push-tokens/unregister/", {"token": TOKEN_A}, format="json").status_code == 204
    _judgment_concluded(account.soul)
    assert list(PushDelivery.objects.values_list("device__token", flat=True)) == [TOKEN_B]


def test_retiring_the_account_for_rebirth_invalidates_every_device(cn_tenant, enqueued):  # noqa: F811
    from apps.reincarnation.services import ReincarnationService
    from apps.souls.models import Soul, SoulState

    account, client = ready_soul(cn_tenant)
    register(client)
    register(client, TOKEN_B, "ANDROID")
    Soul.all_objects.filter(pk=account.soul_id).update(current_state=SoulState.REINCARNATING)
    soul = Soul.objects.get(pk=account.soul_id)
    ReincarnationService.complete_rebirth(soul, new_identity="新名字")

    assert list(PushDevice.objects.values_list("is_active", "invalid_reason")) == [
        (False, "ACCOUNT_RETIRED"), (False, "ACCOUNT_RETIRED")]
    _judgment_concluded(soul)
    assert not PushDelivery.objects.exists()


def test_notification_settings_default_on_and_can_turn_a_category_off(cn_tenant, enqueued):  # noqa: F811
    account, client = ready_soul(cn_tenant)
    register(client)
    url = "/api/v1/me/notification-settings/"
    assert client.get(url).data == {"rebirth": True, "judgment": True, "residence": True, "locale": "zh-Hans"}

    response = client.patch(url, {"judgment": False, "locale": "en"}, format="json")
    assert response.status_code == 200
    assert response.data == {"rebirth": True, "judgment": False, "residence": True, "locale": "en"}
    assert client.patch(url, {"locale": "fr"}, format="json").status_code == 400

    _judgment_concluded(account.soul)
    assert not PushDelivery.objects.exists()  # 关了审判类:不记、不推

    EventService.log(account.soul, "REBIRTH_APPLICATION_SUBMITTED", {"application_id": "app-1"})
    delivery = PushDelivery.objects.get()
    assert delivery.kind == "rebirth_submitted" and delivery.title == "Rebirth application submitted"


def test_settings_are_per_account(cn_tenant):
    _, first = ready_soul(cn_tenant, name="甲")
    _, second = ready_soul(cn_tenant, name="乙")
    first.patch("/api/v1/me/notification-settings/", {"rebirth": False}, format="json")
    assert second.get("/api/v1/me/notification-settings/").data["rebirth"] is True
