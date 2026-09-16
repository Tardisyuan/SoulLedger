"""灵魂端测试共用的造数据函数(不是测试文件,pytest 不收集)。"""
import re

from django.core import mail
from rest_framework.test import APIClient

from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, InitialCredential
from apps.souls.models import Soul, SoulState


def dead_soul(tenant, name="亡魂甲", state=SoulState.JUDGING, **fields):
    return Soul.objects.create(name=name, tenant=tenant, current_state=state, **fields)


def provision_with_password(soul, origin=AccountOrigin.OFFICER):
    """开号并拿到初始密码明文。无联系方式 → 待交付,明文从 PENDING 行上读。"""
    account, created = svc.provision_account(soul, origin)
    assert created
    credential = InitialCredential.objects.get(account=account)
    return account, credential.secret


def ready_soul(tenant, name="亡魂甲", state=SoulState.JUDGING, **fields):
    """已改过密、可以直接用 /me 的灵魂。返回 (account, client)。"""
    soul = dead_soul(tenant, name=name, state=state, **fields)
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.must_change_password = False
    account.initial_password_expires_at = None
    account.save()
    return account, soul_client(account)


def soul_client(account):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {svc.issue_tokens(account)['access']}")
    return client


def officer_client(user):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    if user.tenant_id:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def password_in_last_mail():
    match = re.search(r"初始密码:(\S+)", mail.outbox[-1].body)
    assert match, mail.outbox[-1].body
    return match.group(1)
