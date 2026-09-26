"""联系邮箱同步为登录邮箱(2026-09-26 产品决定)。

此前只有 `Soul.contact_email` 被写,邮箱自助重置却按 `User.email` 找人,于是没有一个
灵魂收得到验证码。`User.email` 在未删除的行里唯一,联系邮箱不唯一(一家人可共用),
所以撞上别的账号时不写、在官员侧响应里标 `email_not_synced: "taken"`。
"""
import importlib

import pytest
from django.apps import apps as django_apps
from django.core import mail
from django.core.cache import cache

from apps.audit.models import AuditLog
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import dead_soul, officer_client

pytestmark = pytest.mark.django_db

SHARED = "family@example.com"


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    mail.outbox.clear()
    yield
    cache.clear()


def _provision(client, soul, email):
    return client.post("/api/v1/soul-accounts/accounts/provision/",
                       {"soul_id": str(soul.pk), "contact_email": email}, format="json")


def _login_email(soul):
    return svc.current_account_of(soul).user.email


def test_a_soul_with_a_contact_email_gets_a_reset_code(cn_tenant, admin_user, api_client):
    soul = dead_soul(cn_tenant)
    response = _provision(officer_client(admin_user), soul, "mine@example.com")
    assert response.status_code == 201, response.data
    assert response.data["email_not_synced"] is None
    assert _login_email(soul) == "mine@example.com"

    mail.outbox.clear()
    api_client.post("/api/v1/auth/reset-password/", {"email": "mine@example.com"}, format="json")
    code = cache.get("pwd_reset:mine@example.com")
    assert code and len(mail.outbox) == 1 and code in mail.outbox[0].body


def test_death_sync_path_syncs_when_the_account_is_opened(cn_tenant):
    """联系邮箱先落库、账号后开(death_sync 的顺序):开号那一刻同步。"""
    soul = Soul.objects.create(name="甲", tenant=cn_tenant, current_state=SoulState.ALIVE)
    svc.apply_contacts(soul, "late@example.com")
    assert soul.die() is not None
    assert _login_email(soul) == "late@example.com"


def test_a_shared_address_goes_to_the_first_soul_only_and_the_second_is_flagged(cn_tenant, admin_user):
    client = officer_client(admin_user)
    first, second = dead_soul(cn_tenant, name="甲"), dead_soul(cn_tenant, name="乙")
    assert _provision(client, first, SHARED).data["email_not_synced"] is None
    response = _provision(client, second, SHARED.upper())
    assert response.status_code == 201, response.data
    assert response.data["email_not_synced"] == "taken"
    assert _login_email(first) == SHARED
    assert _login_email(second) == ""
    assert Soul.objects.get(pk=second.pk).contact_email == SHARED.upper()  # 联系邮箱照写
    account = svc.current_account_of(second)
    assert AuditLog.objects.filter(resource="soul_account", resource_id=str(account.pk),
                                   changes__email_not_synced="taken").exists()
    # 官员重置时也看得见;列表同样带着它。
    reset = client.post(f"/api/v1/soul-accounts/accounts/{account.pk}/reset-credential/", {}, format="json")
    assert reset.status_code == 200 and reset.data["email_not_synced"] == "taken"
    # 换成一个没人用的地址,同步恢复。
    reset = client.post(f"/api/v1/soul-accounts/accounts/{account.pk}/reset-credential/",
                        {"contact_email": "own@example.com"}, format="json")
    assert reset.data["email_not_synced"] is None and _login_email(second) == "own@example.com"


def test_changing_the_contact_email_moves_the_login_email(cn_tenant):
    soul = dead_soul(cn_tenant)
    svc.provision_account(soul, AccountOrigin.OFFICER)
    svc.apply_contacts(soul, "a@example.com")
    svc.apply_contacts(soul, "b@example.com")
    assert _login_email(soul) == "b@example.com"


def test_clearing_clears_only_a_login_email_that_still_equals_the_old_contact(cn_tenant):
    soul = dead_soul(cn_tenant)
    svc.provision_account(soul, AccountOrigin.OFFICER)
    svc.apply_contacts(soul, "a@example.com")
    soul.contact_email = ""
    soul.save(update_fields=["contact_email"])
    svc.sync_login_email(soul, "a@example.com")
    assert _login_email(soul) == ""

    user = svc.current_account_of(soul).user
    user.email = "set-elsewhere@example.com"
    user.save(update_fields=["email"])
    svc.sync_login_email(soul, "a@example.com")
    assert _login_email(soul) == "set-elsewhere@example.com"


def test_rebirth_releases_the_address_for_the_next_life(cn_tenant):
    from apps.reincarnation.services import ReincarnationService

    soul = dead_soul(cn_tenant)
    svc.apply_contacts(soul, "life@example.com")
    first, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    soul.refresh_from_db()
    ReincarnationService.complete_rebirth(soul, new_identity="新名字")
    first.user.refresh_from_db()
    assert first.user.email == ""
    soul.refresh_from_db()
    soul.die()
    assert _login_email(soul) == "life@example.com"


# ── 存量回填 ─────────────────────────────────────────────────────────────

migration = importlib.import_module("apps.soul_accounts.migrations.0003_sync_contact_email_to_login_email")


def test_backfill_syncs_first_come_is_idempotent_and_reverses_only_what_it_set(cn_tenant):
    a, b, c = (dead_soul(cn_tenant, name=n) for n in "甲乙丙")
    for soul in (a, b, c):
        svc.provision_account(soul, AccountOrigin.BACKFILL)
    # 回填之前的存量:只有联系邮箱,登录邮箱是空的(绕过同步直接写)。
    Soul.all_objects.filter(pk__in=[a.pk, b.pk]).update(contact_email=SHARED)
    Soul.all_objects.filter(pk=c.pk).update(contact_email="c@example.com")
    pre_set = svc.current_account_of(c).user
    pre_set.email = "c@example.com"  # 已经一致的:不写,不留标记,反向不清
    pre_set.save(update_fields=["email"])

    migration.forward(django_apps, None)
    assert (_login_email(a), _login_email(b), _login_email(c)) == (SHARED, "", "c@example.com")
    markers = AuditLog.objects.filter(changes__login_email_backfill=migration.MARKER)
    assert markers.count() == 1

    migration.forward(django_apps, None)  # 幂等
    assert markers.count() == 1 and _login_email(b) == ""

    migration.backward(django_apps, None)
    assert (_login_email(a), _login_email(b), _login_email(c)) == ("", "", "c@example.com")
    assert markers.count() == 0
