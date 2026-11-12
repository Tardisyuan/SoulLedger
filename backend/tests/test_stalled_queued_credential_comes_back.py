"""停住的 QUEUED 初始密码回到待交付(流程走查 2026-11-12 F-ACCT-02)。

入队后 worker 没在跑或消息丢了,`.delay` 不抛,行一直停在 QUEUED:查看、重试都只收 PENDING,
前端的默认签也只列 PENDING —— 有邮箱的灵魂反而拿不到密码,72 小时后作废。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, CredentialStatus, InitialCredential
from tests.soul_account_support import dead_soul, officer_client

pytestmark = pytest.mark.django_db


def _queued(tenant, name, age):
    account, _ = svc.provision_account(dead_soul(tenant, name=name), AccountOrigin.OFFICER)
    credential = InitialCredential.objects.get(account=account)
    InitialCredential.objects.filter(pk=credential.pk).update(
        status=CredentialStatus.QUEUED, channel="EMAIL", created_at=timezone.now() - age)
    return credential


def test_a_stalled_queued_credential_is_listed_as_pending_and_can_be_retried(cn_tenant, admin_user):
    stalled = _queued(cn_tenant, "停住的魂", timedelta(minutes=30))
    fresh = _queued(cn_tenant, "刚入队的魂", timedelta(seconds=5))
    client = officer_client(admin_user)

    rows = client.get("/api/v1/soul-accounts/credentials/", {"status": "PENDING"}).data["results"]
    assert str(stalled.pk) in {r["id"] for r in rows}
    assert str(fresh.pk) not in {r["id"] for r in rows}
    assert InitialCredential.objects.get(pk=fresh.pk).status == CredentialStatus.QUEUED

    response = client.post(f"/api/v1/soul-accounts/credentials/{stalled.pk}/retry/")
    assert response.status_code == 200, response.data
