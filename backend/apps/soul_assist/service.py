"""一次问答(docs/ARCHITECTURE-soul-assist.md §2、§4)。

开关 → 并发名额 → 会话 → 历史 → 供应商(工具循环在适配器里)→ 落库 + 审计。

**失败时什么都不落库。** 供应商超时 / 不可用答 503,问题与回答都不写;App 把问题原样
留在输入框里重试(设计稿 1e)。成功时问与答在一个事务里一起写 —— 即使 App 已经点了取消,
服务端照常跑完并落库,下次打开会话能看到(§3)。
"""
import hashlib
import hmac
import logging
import time
import uuid
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone

from apps.soul_assist import config, corpus, failover, tools, usage, vectors
from apps.soul_assist.models import AssistConversation, AssistMessage
from apps.soul_assist.providers import Answer, ProviderError, Turn, get_provider

logger = logging.getLogger(__name__)

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
#: 官员就是殿司,「写信给殿司」对它们不成立;按 OFFICER_RULES 引到本殿殿主或管理员(Design 1f)。
OFFICER_EMPTY_ANSWER = {
    "zh-Hans": "这个问题我答不了。这类问题请询问本殿殿主或管理员。",
    "en": "I can't answer that. Please ask your hall's realm lead or the administrator.",
}


class AssistError(Exception):
    def __init__(self, detail, code, status):
        super().__init__(detail)
        self.code = code
        self.status = status


def enabled_for(account) -> bool:
    """全局开关 + 原属殿的开关(决策 A6:读 home_tenant,与冷却天数同一处)。两个都默认关。
    全局开关是生效配置(管理页覆盖 env,env 为假时恒关,`config.Effective.enabled`)。"""
    usage.maybe_reopen()
    if not config.effective().enabled:
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
    """`owner` 是会话归属的过滤条件:灵魂 `{"account": a}`,官员 `{"user": u}`。评测开的会话不续。"""
    owner = {**owner, "is_eval": False}
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
    empty_answer: dict = None  # 模型交回空文本时的固定回答,按回答语言;见 EMPTY_ANSWER / OFFICER_EMPTY_ANSWER
    civilization: str = None  # 检索按它过滤条目(§7.5);官员为 None,不按文明过滤

    @property
    def side(self):
        return "soul" if "account" in self.owner else "officer"


def soul_asker(account, screen, lang):
    soul = account.soul
    return Asker(owner={"account": account}, user=account.user, tenant=soul.home_tenant or soul.tenant,
                 system=corpus.system_prompt(lang), facts=corpus.facts(account, screen), tools=tools.SPECS,
                 run_tool=lambda name: tools.run(name, account), civilization=soul.home_civilization)


def answer(account, question, screen, *, locale, conversation_id=None, request=None, stream=False):
    """非流式返回 `(会话, 回答)`;`stream=True` 返回 `session` 的事件生成器(开关在这里就查,不等迭代)。"""
    if not enabled_for(account):
        soul = account.soul
        usage.record("soul", soul.home_tenant or soul.tenant, "not_configured")
        raise AssistError("本殿尚未开通助手。", "assistant_not_configured", 503)
    lang = corpus.corpus_locale(locale)
    return (session if stream else ask)(soul_asker(account, screen, lang), question, screen, lang=lang,
                                        conversation_id=conversation_id, request=request)


def officer_enabled_for(request) -> bool:
    """全局开关 + 请求所在殿的开关(Q3 = A:与灵魂端共用同一个每殿开关)。

    **没有殿的 ADMIN 只看全局开关** —— ADMIN 是唯一跨殿的角色(`apps/core/tenant.py`),
    令牌里可以不带殿;带了殿的 ADMIN 与别人一样读那个殿的开关。没有殿的非 ADMIN 到不了这里
    (`TenantPermission` 先拒),万一到了也答关。"""
    from apps.core.tenant import is_tenant_exempt

    usage.maybe_reopen()
    if not config.effective().enabled:
        return False
    tenant = getattr(request, "tenant", None)
    if tenant is None:
        return is_tenant_exempt(request.user)
    return (tenant.settings or {}).get("assistant_enabled") is True


def officer_asker(request, screen, lang):
    from apps.soul_assist import officer_tools

    user = request.user
    return Asker(owner={"user": user}, user=user, tenant=getattr(request, "tenant", None),
                 system=corpus.system_prompt(lang, "officer"), facts=corpus.officer_facts(request, screen),
                 tools=officer_tools.offered(user), run_tool=lambda name: officer_tools.run(name, request),
                 empty_answer=OFFICER_EMPTY_ANSWER)


def officer_answer(request, question, screen, *, locale, conversation_id=None, stream=False):
    if not officer_enabled_for(request):
        usage.record("officer", getattr(request, "tenant", None), "not_configured")
        raise AssistError("本殿尚未开通助手。", "assistant_not_configured", 503)
    lang = corpus.corpus_locale(locale)
    return (session if stream else ask)(officer_asker(request, screen, lang), question, screen, lang=lang,
                                        conversation_id=conversation_id, request=request)


def officer_delete_conversation(request, conversation_id):
    _delete({"user": request.user}, request.user, getattr(request, "tenant", None), conversation_id,
            "assistant conversation deleted by the officer", request)


def ask(asker, question, screen, *, lang, conversation_id=None, request=None, conn=None, is_eval=False):
    """非流式:与流式同一条路(`session`),只是答完才一次返回 `(会话, 回答)`;失败抛 `AssistError`。

    `conn` 缺省是生效配置(连同备用与断路器);管理页评测传候选配置(只测这一套,不改用备用),
    并以 `is_eval` 开新会话、不计用量与月度上限。"""
    *_, done = session(asker, question, screen, lang=lang, conversation_id=conversation_id, request=request,
                       conn=conn, is_eval=is_eval, stream=False)
    return done["conversation"], done["reply"]


def session(asker, question, screen, *, lang, conversation_id=None, request=None, conn=None, is_eval=False,
            stream=True):
    """一次问答,产出事件(`event` 为 meta / delta / done / error;docs/ARCHITECTURE-soul-assist.md §13)。

    - **meta 之前的失败都抛 `AssistError`**(忙、会话不存在):视图先取出 meta 才开始流式响应,
      所以它们仍是普通的 JSON 错误与状态码。
    - 非流式(`stream=False`)只产出 meta 与 done,供应商失败抛 503(与流式之前的行为相同)。
    - 流式的失败以一个 error 事件收尾:没出过字是 `unavailable`,出过字是 `interrupted`(已发出的部分照存)。
    - **调用方关掉生成器 = 客户端停止或断开**:GeneratorExit 从正在等的那一段抛进来,供应商的流随之关闭
      (不再生成、不再计费),已生成的部分按 `stopped` 存下、记用量。
    - 并发名额从进门占到生成器结束,每条路都在 finally 里还。"""
    backup = None
    if conn is None:
        eff = config.effective()
        conn, backup = eff.connection, eff.backup
    slot = _Slot()
    try:
        slot.__enter__()
    except AssistError:
        usage.record(asker.side, asker.tenant, "busy", conn.model, is_eval=is_eval)
        raise
    try:
        yield from _run(asker, question, screen, lang, conversation_id, request, conn, backup, is_eval, stream)
    finally:
        slot.__exit__()


def _run(asker, question, screen, lang, conversation_id, request, conn, backup, is_eval, stream):
    conversation = None if is_eval else conversation_for(asker.owner, screen, conversation_id)
    recent = [] if conversation is None else list(
        conversation.messages.order_by("-created_at", "-id")[:settings.ASSISTANT_HISTORY_TURNS])
    history = [Turn(m.role, m.content) for m in reversed(recent)] + [Turn("user", question)]
    # 新会话在回答落库时才建(失败不留空会话),但 id 现在就定下,meta 里告诉客户端。
    new_id = uuid.uuid4()
    out = _Outcome(asker, question, screen, lang, request, is_eval, conversation, new_id)

    def call_tool(name):
        try:
            return asker.run_tool(name)
        finally:
            _release_db()

    # 截止时刻从这里算:取问题向量(至多 3 秒)也在预算里(§7.5)。
    start = time.monotonic()
    total = start + (settings.ASSISTANT_STREAM_TOTAL_SECONDS if stream else settings.ASSISTANT_TIMEOUT_SECONDS)
    try:
        yield {"event": "meta", "conversation_id": conversation.pk if conversation else new_id}
        found = vectors.retrieve(question, lang, asker.side, asker.civilization, screen=screen, release=_release_db)
        out.found = found
        system, facts = asker.system, asker.facts
        if found.mode == "vector":
            # 规则(与 PINNED 条目)仍是缓存前缀;检索出的 k 条随问题变,接在断点之后的事实头后面。
            by_id = {e["id"]: e for e in corpus.entries(lang, asker.side)}
            system = corpus.system_prompt(lang, asker.side, retrieved=True)
            facts = f"{asker.facts}\n\n{corpus.entries_block([by_id[i] for i in found.entries])}"
        _release_db()
        attempts = failover.plan(conn, backup, start)
        error = None
        for index, (role, attempt, first_deadline, planned) in enumerate(attempts):
            out.role, out.model, out.provider, out.reason = role, attempt.model, attempt.provider, planned or out.reason
            out.result = Answer(text="")
            try:
                provider = get_provider(attempt)  # 建客户端也可能失败(ProviderError):同样是 503、记用量
                params = {"system": system, "facts": facts, "history": history, "tools": asker.tools,
                          "call_tool": call_tool, "max_rounds": MAX_ROUNDS}
                if stream:
                    with closing(provider.stream(**params, deadline=total, first_token_deadline=first_deadline,
                                                 result=out.result)) as pieces:
                        for piece in pieces:
                            out.sent = True
                            yield {"event": "delta", "text": piece}
                else:
                    out.result = provider.answer(**params, deadline=min(total, first_deadline))
            except ProviderError as exc:
                if role == "primary" and backup is not None and exc.reason:
                    failover.record_failure(conn)
                if exc.reason and not out.sent and index + 1 < len(attempts):
                    out.reason = exc.reason
                    spent = exc.usage or out.result.usage
                    if any(spent.values()):  # 主用失败前已花的 token(如工具轮之后才 5xx):只记账
                        usage.record(asker.side, asker.tenant, "failed_over", attempt.model, spent, is_eval=is_eval,
                                     provider_role="primary")
                    continue
                error = exc
                break
            if role == "primary" and backup is not None:
                failover.record_success(conn)
            break
    except GeneratorExit:
        out.finish("stopped")
        raise
    if error is not None:
        if out.sent:
            reply = out.finish("interrupted", error.usage or out.result.usage)
            yield {"event": "error", "kind": "interrupted", "text_sent": True, "detail": INTERRUPTED_DETAIL,
                   "conversation_id": reply.conversation_id, "message_id": reply.pk}
            return
        usage.record(asker.side, asker.tenant, "unavailable", out.model, error.usage or out.result.usage,
                     is_eval=is_eval, retrieval=out.found.mode if out.found else "", provider_role=out.role,
                     fallback_reason=out.reason)
        if not stream:
            raise AssistError(UNAVAILABLE_DETAIL, "assistant_unavailable", 503) from error
        yield {"event": "error", "kind": "unavailable", "text_sent": False, "detail": UNAVAILABLE_DETAIL}
        return
    if not out.result.text.strip():
        # 模型交回空文本(拒答、只输出了思考):固定的「答不了」。流式也当一段文本发出去,客户端只认 delta 也看得到。
        out.result.text = (asker.empty_answer or EMPTY_ANSWER)[lang]
        out.empty = True
        if stream:
            yield {"event": "delta", "text": out.result.text}
    reply = out.finish("")
    yield {"event": "done", "conversation": reply.conversation, "reply": reply, "usage": out.result.usage}


UNAVAILABLE_DETAIL = "助手一时答不上来,请稍后重试。"
INTERRUPTED_DETAIL = "回答中断了,已收到的部分已保存。"


class _Outcome:
    """一次问答走到哪一步、怎么收尾。`finish` 是**所有**花过钱的出口(答完、停止、中断)共用的落库 + 审计 + 用量。"""

    def __init__(self, asker, question, screen, lang, request, is_eval, conversation, new_id):
        self.asker, self.question, self.screen, self.lang = asker, question, screen, lang
        self.request, self.is_eval, self.conversation, self.new_id = request, is_eval, conversation, new_id
        self.result = Answer(text="")
        self.found = None
        self.role = self.model = self.reason = self.provider = ""
        self.sent = self.empty = False

    def finish(self, interruption, tokens=None):
        """`interruption`:"" 答完 / stopped / interrupted。没答完又一个字都没有 → 不落消息,只记用量。"""
        asker, result = self.asker, self.result
        tokens = tokens if tokens is not None else result.usage
        text = result.text.strip()
        status = interruption or ("empty" if self.empty else "ok")
        retrieval = self.found.mode if self.found else ""
        if not self.role:
            # 还没走到供应商就停了(响应头之前客户端就走了):没花钱,不记。这条路可能在回收生成器时、
            # 在事件循环的线程里跑,那里不能碰数据库。
            return None
        reply = None
        with transaction.atomic():
            if text:
                reply = self._store(text, tokens, interruption, retrieval)
            usage.record(asker.side, asker.tenant, status, self.model, tokens, is_eval=self.is_eval,
                         retrieval=retrieval, provider_role=self.role, fallback_reason=self.reason)
        if reply is not None:
            #: 不落库,只给评测与试问看:检索方式与进了上下文的条目、哪一家答的。
            reply.retrieval, reply.provider_role, reply.fallback_reason = self.found, self.role, self.reason
            reply.answered_by = (self.provider, self.model)
        if not self.is_eval:
            # 回答已经落库:上限检查坏了也不能让提问的人拿到 500(他会重问,再花一次钱)。只记异常,不记原文。
            try:
                usage.enforce_cap()
            except Exception:
                logger.exception("assistant monthly cap check failed")
        return reply

    def _store(self, text, tokens, interruption, retrieval):
        asker, conversation = self.asker, self.conversation
        # 续的会话可能在模型答题时被删(本人删、或留存清理删空):那就新开一个,不丢这条回答。
        if conversation is not None and not AssistConversation.objects.filter(pk=conversation.pk).exists():
            conversation, self.new_id = None, uuid.uuid4()
        if conversation is None:
            conversation = AssistConversation.objects.create(pk=self.new_id, **asker.owner, screen=self.screen,
                                                             is_eval=self.is_eval)
        self.conversation = conversation
        AssistMessage.objects.create(conversation=conversation, role="user", content=self.question)
        reply = AssistMessage.objects.create(conversation=conversation, role="assistant", content=text,
                                             tool_calls=self.result.tool_calls, tokens=tokens,
                                             interruption=interruption)
        AssistConversation.objects.filter(pk=conversation.pk).update(last_active_at=timezone.now())
        extra = {k: v for k, v in (("interruption", interruption), ("provider_role", self.role),
                                   ("fallback_reason", self.reason)) if v}
        _audit(asker.user, asker.tenant, conversation, "EXECUTE", "assistant answer", self.request, {
            "question_hmac": _sha(self.question), "answer_hmac": _sha(text), "tools": self.result.tool_calls,
            "provider": self.provider.rsplit(".", 1)[-1], "model": self.model,
            "tokens": tokens, "locale": self.lang, "retrieval": retrieval, **extra,
            **({"eval": True} if self.is_eval else {}),
        })
        reply.conversation = conversation
        return reply


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
