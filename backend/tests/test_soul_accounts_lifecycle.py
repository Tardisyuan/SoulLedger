"""灵魂账号的生命周期:开通、初始密码三道保护与投递、待交付、转世停用、链、存量补齐。"""
from datetime import timedelta
from io import StringIO

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.death_sync.models import ExternalApiKey
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, CredentialStatus, InitialCredential, SoulAccount
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import dead_soul, officer_client, password_in_last_mail, provision_with_password

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh_soul_login_counter():
    from django.core.cache import cache

    cache.delete("soul_login_rate:127.0.0.1")
    yield
    cache.delete("soul_login_rate:127.0.0.1")


def _login(soul_code, password):
    return APIClient().post("/api/v1/soul-auth/login/", {"soul_code": soul_code, "password": password},
                            format="json")


# ── 死亡同步自动开通 ─────────────────────────────────────────────────────


@pytest.fixture
def api_client_with_key(cn_tenant):
    raw, key_hash, prefix = ExternalApiKey.generate_key()
    ExternalApiKey.objects.create(tenant=cn_tenant, name="feed", system_type="HOSPITAL",
                                  key_hash=key_hash, key_prefix=prefix)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw}")
    return client


def test_death_sync_opens_the_account_and_mails_the_password_once(
    cn_tenant, api_client_with_key, django_capture_on_commit_callbacks
):
    soul = Soul.objects.create(name="张三", tenant=cn_tenant)
    body = {"soul_lookup": {"soul_id": str(soul.pk)}, "death_date": "2026-09-01",
            "contact_email": "zhang@example.com", "idempotency_key": "k1"}
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client_with_key.post("/api/v1/death-sync/register/", body, format="json")
    assert response.status_code == 201, response.data
    account = SoulAccount.objects.get(soul=soul)
    assert (account.cycle, account.origin, account.must_change_password) == (0, AccountOrigin.DEATH_SYNC, True)
    assert account.user.role == "SOUL" and account.user.email == ""
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["zhang@example.com"]
    password = password_in_last_mail()
    credential = InitialCredential.objects.get(account=account)
    assert credential.status == CredentialStatus.SENT and credential.secret == "", "发出去的明文必须抹掉"
    soul.refresh_from_db()
    assert soul.soul_code in mail.outbox[0].body
    assert _login(soul.soul_code, password).status_code == 200

    # 同一次死亡再登记一次(另一个幂等键):不新建账号、不再发邮件。
    with django_capture_on_commit_callbacks(execute=True):
        svc.provision_account(soul, AccountOrigin.DEATH_SYNC)
    assert SoulAccount.objects.filter(soul=soul).count() == 1
    assert len(mail.outbox) == 1


def test_death_sync_rejects_a_malformed_contact(cn_tenant, api_client_with_key):
    soul = Soul.objects.create(name="李四", tenant=cn_tenant)
    for bad in ({"contact_email": "not-an-email"}, {"contact_phone": "12ab"}):
        body = {"soul_lookup": {"soul_id": str(soul.pk)}, "death_date": "2026-09-01", **bad}
        assert api_client_with_key.post("/api/v1/death-sync/register/", body, format="json").status_code == 400
    assert not SoulAccount.objects.filter(soul=soul).exists()


def test_an_alive_soul_cannot_get_an_account(cn_tenant):
    with pytest.raises(svc.SoulAccountError) as exc:
        svc.provision_account(Soul.objects.create(name="活人", tenant=cn_tenant), AccountOrigin.OFFICER)
    assert exc.value.code == "soul_alive"


def test_the_password_is_never_resent_only_reset(cn_tenant, admin_user, django_capture_on_commit_callbacks):
    soul = dead_soul(cn_tenant, contact_email="a@example.com")
    with django_capture_on_commit_callbacks(execute=True):
        account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    first = password_in_last_mail()
    credential = InitialCredential.objects.get(account=account)
    client = officer_client(admin_user)
    # 已发送的凭据不能「重试」,也不能「查看」—— 明文已经不在了。
    assert client.post(f"/api/v1/soul-accounts/credentials/{credential.pk}/retry/").status_code == 409
    assert client.post(f"/api/v1/soul-accounts/credentials/{credential.pk}/reveal/").status_code == 409
    assert len(mail.outbox) == 1

    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(f"/api/v1/soul-accounts/accounts/{account.pk}/reset-credential/", {}, format="json")
    assert response.status_code == 200, response.data
    assert len(mail.outbox) == 2
    second = password_in_last_mail()
    assert second != first
    assert _login(soul.soul_code, first).status_code == 401
    assert _login(soul.soul_code, second).status_code == 200
    assert AuditLog.objects.filter(resource="soul_account", action="UPDATE", user=admin_user).exists()


def test_no_channel_goes_to_pending_and_plaintext_is_viewable_exactly_once(cn_tenant, admin_user):
    soul = dead_soul(cn_tenant)
    account, password = provision_with_password(soul)
    credential = InitialCredential.objects.get(account=account)
    assert credential.status == CredentialStatus.PENDING and credential.channel == ""
    client = officer_client(admin_user)
    listed = client.get("/api/v1/soul-accounts/credentials/", {"status": "PENDING"}).data
    rows = listed["results"] if isinstance(listed, dict) else listed
    assert [row["id"] for row in rows] == [str(credential.pk)]
    assert "secret" not in rows[0] and "password" not in rows[0]

    first = client.post(f"/api/v1/soul-accounts/credentials/{credential.pk}/reveal/")
    assert first.status_code == 200 and first.data["password"] == password
    assert first.data["soul_code"] == soul.soul_code
    second = client.post(f"/api/v1/soul-accounts/credentials/{credential.pk}/reveal/")
    assert second.status_code == 409 and "password" not in second.data
    credential.refresh_from_db()
    assert credential.secret == "" and credential.status == CredentialStatus.REVEALED
    assert AuditLog.objects.filter(resource="soul_account", action="VIEW", user=admin_user).count() == 1

    delivered = client.post(f"/api/v1/soul-accounts/credentials/{credential.pk}/mark-delivered/")
    assert delivered.status_code == 200 and delivered.data["status"] == "DELIVERED"


def test_a_send_failure_lands_in_pending_and_retry_sends(cn_tenant, admin_user, settings,
                                                          django_capture_on_commit_callbacks):
    settings.EMAIL_BACKEND = "tests.test_soul_accounts_lifecycle.BrokenBackend"
    soul = dead_soul(cn_tenant, contact_email="b@example.com")
    with django_capture_on_commit_callbacks(execute=True):
        account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    credential = InitialCredential.objects.get(account=account)
    assert credential.status == CredentialStatus.PENDING and credential.secret
    assert credential.last_error == "ConnectionRefusedError" and credential.attempts == 1

    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    response = officer_client(admin_user).post(f"/api/v1/soul-accounts/credentials/{credential.pk}/retry/")
    assert response.status_code == 200 and response.data["status"] == "SENT"
    assert len(mail.outbox) == 1
    credential.refresh_from_db()
    assert credential.secret == ""


class BrokenBackend:
    def __init__(self, *args, **kwargs):
        pass

    def send_messages(self, messages):
        raise ConnectionRefusedError("smtp down")


def test_sms_is_unavailable_unless_configured(cn_tenant, settings):
    soul = dead_soul(cn_tenant, contact_phone="+8613800000000")
    account, _ = provision_with_password(soul)
    assert InitialCredential.objects.get(account=account).status == CredentialStatus.PENDING

    sent = []
    settings.SOUL_SMS_SENDER = "tests.test_soul_accounts_lifecycle.record_sms"
    record_sms.sink = sent
    soul2 = dead_soul(cn_tenant, name="乙", contact_phone="+8613800000001")
    account2, _ = svc.provision_account(soul2, AccountOrigin.OFFICER)
    credential = InitialCredential.objects.get(account=account2)
    assert credential.channel == "SMS" and credential.status == CredentialStatus.QUEUED
    svc.send_credential(credential.pk)
    assert sent and sent[0][0] == "+8613800000001"


def record_sms(phone, text):
    record_sms.sink.append((phone, text))


def test_expired_credentials_lose_their_plaintext(cn_tenant, admin_user):
    account, _ = provision_with_password(dead_soul(cn_tenant))
    credential = InitialCredential.objects.get(account=account)
    InitialCredential.objects.filter(pk=credential.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
    client = officer_client(admin_user)
    response = client.post(f"/api/v1/soul-accounts/credentials/{credential.pk}/reveal/")
    assert response.status_code == 410
    credential.refresh_from_db()
    assert credential.status == CredentialStatus.VOID and credential.secret == ""


def test_officer_endpoints_are_tenant_scoped_and_codename_gated(cn_tenant, eu_tenant, judge_user):
    from apps.authentication.models import User

    cn_account, _ = provision_with_password(dead_soul(cn_tenant))
    eu_account, _ = provision_with_password(dead_soul(eu_tenant, name="Dante"))
    moderator = User.objects.create_user(username="mod", password="x", role="MODERATOR", tenant=cn_tenant)
    client = officer_client(moderator)
    listed = client.get("/api/v1/soul-accounts/accounts/").data
    rows = listed["results"] if isinstance(listed, dict) else listed
    assert {row["id"] for row in rows} == {str(cn_account.pk)}
    assert client.get(f"/api/v1/soul-accounts/accounts/{eu_account.pk}/").status_code == 404
    eu_credential = InitialCredential.objects.get(account=eu_account)
    assert client.post(f"/api/v1/soul-accounts/credentials/{eu_credential.pk}/reveal/").status_code == 404
    assert client.post("/api/v1/soul-accounts/accounts/provision/",
                       {"soul_id": str(eu_account.soul_id)}, format="json").status_code == 404
    # JUDGE 不持有 soul_account.*
    assert officer_client(judge_user).get("/api/v1/soul-accounts/accounts/").status_code == 403


def test_contacts_are_masked_for_officers_and_redacted_in_audit(cn_tenant, admin_user):
    soul = dead_soul(cn_tenant)
    client = officer_client(admin_user)
    response = client.post("/api/v1/soul-accounts/accounts/provision/",
                           {"soul_id": str(soul.pk), "contact_email": "secret.person@example.com",
                            "contact_phone": "+8613912345678"}, format="json")
    assert response.status_code == 201, response.data
    assert response.data["contact_email_masked"] == "s***@example.com"
    assert "secret.person" not in str(response.data) and "13912345678" not in str(response.data)
    soul_detail = client.get(f"/api/v1/souls/{soul.pk}/").data
    assert "contact_email" not in soul_detail and "contact_phone" not in soul_detail

    from apps.audit.signals import REDACTED, _build_changes

    before = Soul.objects.get(pk=soul.pk)
    after = Soul.objects.get(pk=soul.pk)
    after.contact_email = "other@example.com"
    after.contact_phone = "+8613900000000"
    changes = _build_changes(after, before)
    assert changes["contact_email"] == [REDACTED, REDACTED]
    assert changes["contact_phone"] == [REDACTED, REDACTED]


# ── 转世停用与账号链 ─────────────────────────────────────────────────────


def _complete_rebirth(soul):
    from apps.reincarnation.services import ReincarnationService

    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    soul.refresh_from_db()
    return ReincarnationService.complete_rebirth(soul, new_identity="新名字")


def test_rebirth_retires_the_account_for_good_and_the_next_death_opens_a_linked_one(cn_tenant):
    soul = dead_soul(cn_tenant)
    first, password = provision_with_password(soul)
    assert _login(soul.soul_code, password).status_code == 200
    old_tokens = svc.issue_tokens(first)

    _complete_rebirth(soul)
    first.refresh_from_db()
    first.user.refresh_from_db()
    assert first.retired_at is not None and first.user.is_active is False
    assert _login(soul.soul_code, password).status_code == 401
    # 旧令牌:访问与刷新都失效。
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {old_tokens['access']}")
    assert client.get("/api/v1/me/").status_code == 401
    assert APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": old_tokens["refresh"]},
                            format="json").status_code == 401
    # 官员不能重置一个已停用的账号。
    with pytest.raises(svc.SoulAccountError):
        svc.reset_credential(first)

    soul.refresh_from_db()
    soul.die()
    second, new_password = provision_with_password(soul)
    assert second.cycle == 1 and second.previous_account_id == first.pk
    assert soul.soul_code == Soul.objects.get(pk=soul.pk).soul_code  # 编号跨世不变
    assert _login(soul.soul_code, new_password).status_code == 200
    assert _login(soul.soul_code, password).status_code == 401
    # 停用是终态:没有任何路径让第一世的账号重新成为当前账号。
    assert svc.current_account_of(soul).pk == second.pk
    assert AuditLog.objects.filter(resource="soul_account", resource_id=str(first.pk),
                                   description__contains="停用").exists()


def test_a_failed_rebirth_does_not_retire_the_account(cn_tenant, monkeypatch):
    from apps.reincarnation import services as rs

    soul = dead_soul(cn_tenant)
    account, _ = provision_with_password(soul)
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    soul.refresh_from_db()
    monkeypatch.setattr(rs.Soul, "transition_to", lambda self, *a, **k: False)
    with pytest.raises(rs.RebirthRefusedError):
        rs.ReincarnationService.complete_rebirth(soul)
    account.refresh_from_db()
    assert account.retired_at is None


def test_one_current_account_per_soul_is_a_database_constraint(cn_tenant):
    from django.db import IntegrityError, transaction

    from apps.authentication.models import User

    soul = dead_soul(cn_tenant)
    provision_with_password(soul)
    user = User.objects.create_user(username="soul.dup", role="SOUL", tenant=cn_tenant)
    with pytest.raises(IntegrityError), transaction.atomic():
        SoulAccount.objects.create(user=user, soul=soul, cycle=5, origin=AccountOrigin.OFFICER)


def test_backfill_is_idempotent_and_dry_run_writes_nothing(cn_tenant):
    alive = Soul.objects.create(name="活", tenant=cn_tenant)
    dead_a = dead_soul(cn_tenant, name="甲", contact_email="a@example.com")
    dead_b = dead_soul(cn_tenant, name="乙", state=SoulState.DISPOSED)
    out = StringIO()
    call_command("backfill_soul_accounts", "--dry-run", stdout=out)
    assert "将开通 2 个;其中待交付 1 个" in out.getvalue()
    assert SoulAccount.objects.count() == 0

    out = StringIO()
    call_command("backfill_soul_accounts", stdout=out)
    assert "已开通 2 个" in out.getvalue(), out.getvalue()
    assert set(SoulAccount.objects.values_list("soul_id", flat=True)) == {dead_a.pk, dead_b.pk}
    assert not SoulAccount.objects.filter(soul=alive).exists()
    assert SoulAccount.objects.get(soul=dead_b).credentials.get().status == CredentialStatus.PENDING

    out = StringIO()
    call_command("backfill_soul_accounts", stdout=out)
    assert "已开通 0 个" in out.getvalue() and "跳过 2 个" in out.getvalue()
    assert InitialCredential.objects.count() == 2
