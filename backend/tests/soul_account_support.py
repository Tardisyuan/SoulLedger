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


def sentence_served(account):
    """本世的受刑计划已完成、灵魂在轮回中 —— 转生申请开放的前提(Q6,
    docs/ARCHITECTURE-sentence-plan.md §6)。只写记录,不走推进;要走真实推进的测试
    用 `tests/sentence_plan_support.py`。"""
    from django.utils import timezone

    from apps.sentence_plan.models import SentencePlan, SentencePlanStatus

    soul = account.soul
    SentencePlan.all_objects.create(
        soul=soul, tenant_id=soul.home_tenant_id or soul.tenant_id, cycle=account.cycle,
        status=SentencePlanStatus.COMPLETED, completed_at=timezone.now(),
    )
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    soul.refresh_from_db()
    return account


def rebirth_ready_soul(tenant, name="亡魂甲", **fields):
    """`ready_soul` + `sentence_served`:可以提交转生申请的灵魂。返回 (account, client)。"""
    account, client = ready_soul(tenant, name=name, **fields)
    return sentence_served(account), client


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


def soul_login_rate_keys():
    """缓存里所有灵魂登录限流键的原始键名。测试环境是 LocMem,生产是 Redis,两种都认。"""
    from django.core.cache import cache

    store = cache._cache
    if hasattr(store, "get_client"):
        return [k.decode() for k in store.get_client().scan_iter(match="*soul_login_rate:*")]
    return [k for k in list(store.keys()) if "soul_login_rate:" in k]


def clear_soul_login_counters():
    """失败计数在进程内跨测试累积。只删本模块的键,不 clear 整个缓存。"""
    from django.core.cache import cache

    store = cache._cache
    for key in soul_login_rate_keys():
        if hasattr(store, "get_client"):
            store.get_client(write=True).delete(key)
        else:
            store.pop(key, None)
            cache._expire_info.pop(key, None)
