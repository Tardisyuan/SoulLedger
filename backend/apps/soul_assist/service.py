"""一次问答(docs/ARCHITECTURE-soul-assist.md §2、§4)。

开关 → 并发名额 → 会话 → 历史 → 供应商(工具循环在适配器里)→ 落库 + 审计。

**失败时什么都不落库。** 供应商超时 / 不可用答 503,问题与回答都不写;App 把问题原样
留在输入框里重试(设计稿 1e)。成功时问与答在一个事务里一起写 —— 即使 App 已经点了取消,
服务端照常跑完并落库,下次打开会话能看到(§3)。
"""
import hashlib
import hmac
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone

from apps.soul_assist import corpus, tools
from apps.soul_assist.models import AssistConversation, AssistMessage
from apps.soul_assist.providers import ProviderError, Turn, get_provider

MAX_ROUNDS = 3
#: 同一页面多久之内再点「问一问」续上次的会话(决策 A4)。
CONTINUE_WINDOW = timedelta(minutes=30)
#: 原文保存天数(决策 A3)。帮助条目 `assistant` 里写的天数由测试钉在这个值上。
RETENTION_DAYS = 30
INFLIGHT_KEY = "soul_assist:inflight"

#: 模型交回空文本(拒答、只输出了思考)时的固定回答。
EMPTY_ANSWER = {
    "zh-Hans": "这个问题我答不了。需要人来处理的事，请写信给殿司。",
    "en": "I can't answer that. For anything that needs a person, write to the hall office.",
}


class AssistError(Exception):
    def __init__(self, detail, code, status):
        super().__init__(detail)
        self.code = code
        self.status = status


def enabled_for(account) -> bool:
    """全局开关 + 原属殿的开关(决策 A6:读 home_tenant,与冷却天数同一处)。两个都默认关。"""
    if not settings.ASSISTANT_ENABLED:
        return False
    home = account.soul.home_tenant or account.soul.tenant
    return (home.settings or {}).get("assistant_enabled") is True


class _Slot:
    """全局同时进行的问答数上限(§4.5)。一次回答最长占一个线程约 22 秒;真正的上限是 PG 连接。

    ponytail: 计数键带 TTL,进程崩在 finally 之前留下的名额最多泄漏一个 TTL;要精确就换成
    按请求 id 的有序集合。"""

    TTL = 120

    def __enter__(self):
        cache.add(INFLIGHT_KEY, 0, self.TTL)
        try:
            count = cache.incr(INFLIGHT_KEY)
        except ValueError:  # add 与 incr 之间键过期了
            cache.set(INFLIGHT_KEY, 1, self.TTL)
            count = 1
        # INCR 保留原 TTL,键在 exists 与 INCR 之间过期还会被建成**无 TTL**;每次进出都重设。
        cache.touch(INFLIGHT_KEY, self.TTL)
        if count > settings.ASSISTANT_MAX_CONCURRENT:
            self.__exit__()
            raise AssistError("助手正忙,请稍后再问。", "assistant_busy", 429)
        return self

    def __exit__(self, *exc):
        try:
            if cache.decr(INFLIGHT_KEY) < 0:  # 键曾过期重建:别让负数放进多余的请求
                cache.set(INFLIGHT_KEY, 0, self.TTL)
            else:
                cache.touch(INFLIGHT_KEY, self.TTL)
        except ValueError:  # 键已过期
            pass


def _release_db():
    """调模型前后不占着 PG 连接(§4.5)。在事务里(测试、或将来有人开 ATOMIC_REQUESTS)不关。"""
    if not connection.in_atomic_block:
        connection.close()


def conversation_for(owner, screen, conversation_id=None):
    """`owner` 是会话归属的过滤条件:灵魂 `{"account": a}`,官员 `{"user": u}`。"""
    if conversation_id is not None:
        found = AssistConversation.objects.filter(pk=conversation_id, **owner).first()
        if found is None:
            raise AssistError("会话不存在。", "not_found", 404)
        return found
    # 没有可续的就返回 None:新会话在回答成功之后才建,失败的请求不留空会话。
    return (AssistConversation.objects.filter(**owner, screen=screen,
                                              last_active_at__gte=timezone.now() - CONTINUE_WINDOW)
            .order_by("-last_active_at").first())


def _sha(text):
    """加密钥的哈希:短问题(「怎么申请转生?」)的裸 SHA-256 猜得出来,而审计行比原文活得久。"""
    return hmac.new(settings.SECRET_KEY.encode(), text.encode(), hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class Asker:
    """提问的是谁 —— 灵魂端与官员端之间**唯一**不同的部分(docs/ARCHITECTURE-officer-assist.md §1)。
    名额、释放连接、供应商调用、落库、HMAC 审计都在 `ask` 里,两端共用。"""

    owner: dict  # 会话归属:{"account": 灵魂账号} 或 {"user": 官员}
    user: object  # 审计行的 user
    tenant: object  # 审计行的 tenant
    system: str
    facts: str
    tools: list
    run_tool: Callable[[str], str]


def answer(account, question, screen, *, locale, conversation_id=None, request=None):
    if not enabled_for(account):
        raise AssistError("本殿尚未开通助手。", "assistant_not_configured", 503)
    lang = corpus.corpus_locale(locale)
    soul = account.soul
    asker = Asker(owner={"account": account}, user=account.user, tenant=soul.home_tenant or soul.tenant,
                  system=corpus.system_prompt(lang), facts=corpus.facts(account, screen), tools=tools.SPECS,
                  run_tool=lambda name: tools.run(name, account))
    return ask(asker, question, screen, lang=lang, conversation_id=conversation_id, request=request)


def officer_enabled_for(request) -> bool:
    """全局开关 + 请求所在殿的开关(Q3 = A:与灵魂端共用同一个每殿开关)。

    **没有殿的 ADMIN 只看全局开关** —— ADMIN 是唯一跨殿的角色(`apps/core/tenant.py`),
    令牌里可以不带殿;带了殿的 ADMIN 与别人一样读那个殿的开关。没有殿的非 ADMIN 到不了这里
    (`TenantPermission` 先拒),万一到了也答关。"""
    from apps.core.tenant import is_tenant_exempt

    if not settings.ASSISTANT_ENABLED:
        return False
    tenant = getattr(request, "tenant", None)
    if tenant is None:
        return is_tenant_exempt(request.user)
    return (tenant.settings or {}).get("assistant_enabled") is True


def officer_answer(request, question, screen, *, locale, conversation_id=None):
    from apps.soul_assist import officer_tools

    if not officer_enabled_for(request):
        raise AssistError("本殿尚未开通助手。", "assistant_not_configured", 503)
    lang = corpus.corpus_locale(locale)
    user = request.user
    asker = Asker(owner={"user": user}, user=user, tenant=getattr(request, "tenant", None),
                  system=corpus.system_prompt(lang, "officer"), facts=corpus.officer_facts(request, screen),
                  tools=officer_tools.offered(user), run_tool=lambda name: officer_tools.run(name, request))
    return ask(asker, question, screen, lang=lang, conversation_id=conversation_id, request=request)


def officer_delete_conversation(request, conversation_id):
    _delete({"user": request.user}, request.user, getattr(request, "tenant", None), conversation_id,
            "assistant conversation deleted by the officer", request)


def ask(asker, question, screen, *, lang, conversation_id=None, request=None):
    with _Slot():
        conversation = conversation_for(asker.owner, screen, conversation_id)
        recent = [] if conversation is None else list(
            conversation.messages.order_by("-created_at", "-id")[:settings.ASSISTANT_HISTORY_TURNS])
        history = [Turn(m.role, m.content) for m in reversed(recent)] + [Turn("user", question)]

        def call_tool(name):
            try:
                return asker.run_tool(name)
            finally:
                _release_db()

        provider = get_provider()
        _release_db()
        try:
            result = provider.answer(
                system=asker.system, facts=asker.facts, history=history, tools=asker.tools,
                call_tool=call_tool, max_rounds=MAX_ROUNDS,
                deadline=time.monotonic() + settings.ASSISTANT_TIMEOUT_SECONDS,
            )
        except ProviderError as exc:
            raise AssistError("助手一时答不上来,请稍后重试。", "assistant_unavailable", 503) from exc
    text = result.text.strip() or EMPTY_ANSWER[lang]
    with transaction.atomic():
        # 续的会话可能在模型答题的这 22 秒里被删(本人删、或留存清理删空):那就新开一个,不丢这条回答。
        if conversation is None or not AssistConversation.objects.filter(pk=conversation.pk).exists():
            conversation = AssistConversation.objects.create(**asker.owner, screen=screen)
        AssistMessage.objects.create(conversation=conversation, role="user", content=question)
        reply = AssistMessage.objects.create(conversation=conversation, role="assistant", content=text,
                                             tool_calls=result.tool_calls, tokens=result.usage)
        AssistConversation.objects.filter(pk=conversation.pk).update(last_active_at=timezone.now())
        _audit(asker.user, asker.tenant, conversation, "EXECUTE", "assistant answer", request, {
            "question_hmac": _sha(question), "answer_hmac": _sha(text), "tools": result.tool_calls,
            "provider": settings.ASSISTANT_PROVIDER.rsplit(".", 1)[-1], "model": settings.ASSISTANT_MODEL,
            "tokens": result.usage, "locale": lang,
        })
    return conversation, reply


def delete_conversation(account, conversation_id, request=None):
    soul = account.soul
    _delete({"account": account}, account.user, soul.home_tenant or soul.tenant, conversation_id,
            "assistant conversation deleted by the soul", request)


def _delete(owner, user, tenant, conversation_id, description, request):
    conversation = AssistConversation.objects.filter(pk=conversation_id, **owner).first()
    if conversation is None:
        raise AssistError("会话不存在。", "not_found", 404)
    with transaction.atomic():
        conversation.soft_delete(user=user, reason="author")
        _audit(user, tenant, conversation, "DELETE", description, request, None)


def _audit(user, tenant, conversation, action, description, request, changes):
    """**不存原文**:原文只在 AssistMessage 里、30 天(§4.6)。"""
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant=tenant, user=user, action=action, resource="assistant",
        resource_id=str(conversation.pk), description=description, changes=changes,
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )


def purge_history(now=None) -> dict:
    """真删:超过留存期的消息(两端同一个留存期)、本人已删除的会话、已停用账号(转世后的前世账号)
    与已停用官员的会话,以及删空了的会话。登记在 apps/scheduler/registry.py;beat 未部署前用
    `manage.py purge_assist_history`(§4.2)。"""
    now = now or timezone.now()
    cutoff = now - timedelta(days=RETENTION_DAYS)
    old = AssistMessage.objects.filter(created_at__lt=cutoff).delete()[0]
    gone = AssistConversation.all_objects.filter(is_deleted=True)
    retired = AssistConversation.all_objects.filter(account__retired_at__isnull=False)
    deactivated = AssistConversation.all_objects.filter(user__is_active=False)
    empty = AssistConversation.all_objects.filter(messages__isnull=True)
    conversations = 0
    for qs in (gone, retired, deactivated, empty):
        conversations += qs.delete()[1].get("soul_assist.AssistConversation", 0)
    return {"messages": old, "conversations": conversations}
