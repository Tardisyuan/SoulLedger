"""管理页的连通测试与评测(docs/ARCHITECTURE-assist-admin.md §3)。

**评测走正式的 `service.ask`**:同一个工具循环、同一套工具、同一个落库与审计,身份是配置里的
评测灵魂 / 评测官员,数据范围照正式规则(灵魂读本人,官员经各视图集的 `get_queryset`)——
不开后门。与正式提问只差三处:用候选配置、每条开新会话(`is_eval`,不续、不进本人的会话列表)、
不计用量与月度上限。**不查每殿开关与总开关**:管理员正是要在打开之前先试。
"""
import logging
import time
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from django.utils.module_loading import import_string

from apps.soul_assist import config, corpus, eval_identities, service
from apps.soul_assist.providers import ProviderError, ToolSpec, Turn
from apps.soul_assist.usage import estimate_tokens

logger = logging.getLogger(__name__)

#: 单次运行的请求条数上限(候选数 × 用例数)。
MAX_ASKS = 100
PREVIEW_TTL_SECONDS = 10 * 60
PREVIEW_KEY = "soul_assist:eval_preview:"
#: 排队或运行超过这么久的评测视为死了(worker 崩了、任务丢了)。100 条 × 22 秒约 37 分钟,留足余量。
STALE_AFTER = timedelta(hours=1)
#: 预估用:每一轮在 system prompt 之外的输入(事实头、问题、工具结果)与每轮输出。宁高勿低。
EXTRA_INPUT_PER_ROUND = 300
OUTPUT_PER_ROUND = 400


# ── 连通测试(§3.1)────────────────────────────────────────────────────────


def probe(conn: config.Connection) -> dict:
    """用候选配置发一条最小请求(带一个工具,测得出「不支持工具调用」)。不走进程缓存的客户端:
    候选的 key 不该留在缓存里。"""
    start = time.monotonic()
    try:
        provider = import_string(conn.provider)(conn=conn)
        result = provider.answer(
            system="Connectivity check. Reply with the single word OK.", facts="FACTS: none",
            history=[Turn("user", "ping")], tools=[ToolSpec("ping", "Connectivity check. Returns {}.")],
            call_tool=lambda name: "{}", max_rounds=1, deadline=start + settings.ASSISTANT_TIMEOUT_SECONDS,
        )
    except ProviderError as exc:
        return {"ok": False, "error_kind": exc.kind, "latency_ms": _ms(start), "tokens": {}}
    config.remember_tested(conn)
    return {"ok": True, "error_kind": None, "latency_ms": _ms(start), "tokens": result.usage}


def _ms(start):
    return int((time.monotonic() - start) * 1000)


# ── 评测:预估与确认(§3.2)──────────────────────────────────────────────────


def _estimate(conn, cases, prices):
    """(输入 token, 输出 token, 花费或 None)。期望调工具的用例按两轮算。"""
    prompts = {}
    tokens_in = tokens_out = 0
    for case in cases:
        key = (case.locale, case.side)
        if key not in prompts:
            prompts[key] = estimate_tokens(corpus.system_prompt(case.locale, case.side))
        rounds = 2 if case.expected_tools else 1
        tokens_in += rounds * (prompts[key] + EXTRA_INPUT_PER_ROUND + estimate_tokens(case.question))
        tokens_out += rounds * OUTPUT_PER_ROUND
    return tokens_in, tokens_out, config.cost(prices, conn.model, tokens_in, tokens_out)


def preview(candidates, cases, user) -> dict:
    """「约 N 条请求、预计花费」;没有问题时发一个确认令牌,开始运行必须带它回来。"""
    eff = config.effective()
    base = eff.connection
    conns = [config.candidate(c, base) for c in candidates]
    rows = []
    total_cost, problems = 0.0, []
    for i, conn in enumerate(conns):
        tokens_in, tokens_out, cost = _estimate(conn, cases, eff.prices)
        rows.append({"candidate": i, "provider": config.provider_name(conn.provider), "model": conn.model,
                     "asks": len(cases), "input_tokens": tokens_in, "output_tokens": tokens_out,
                     "estimated_cost": cost})
        if cost is None:
            problems.append("unpriced_model")
        else:
            total_cost += cost
    asks = len(conns) * len(cases)
    sides = {c.side for c in cases}
    if not cases:
        problems.append("no_cases")
    if asks > MAX_ASKS:
        problems.append("too_many_asks")
    if "unpriced_model" not in problems and total_cost > eff.eval_spend_cap:
        problems.append("over_spend_cap")
    if "soul" in sides and eval_identities.live_account(eff.eval_soul_account_id) is None:
        problems.append("no_eval_soul")
    if "officer" in sides and eval_identities.live_officer(eff.eval_officer_id) is None:
        problems.append("no_eval_officer")
    token = None
    if not problems:
        token = uuid.uuid4().hex
        cache.set(PREVIEW_KEY + token, {
            "user_id": user.pk, "case_ids": [c.pk for c in cases], "estimated_cost": round(total_cost, 6),
            "candidates": [_stored(conn) for conn in conns],
        }, PREVIEW_TTL_SECONDS)
    return {"asks": asks, "max_asks": MAX_ASKS, "estimated_cost": round(total_cost, 6),
            "spend_cap": eff.eval_spend_cap, "candidates": rows, "problems": sorted(set(problems)),
            "confirm_token": token}


def _stored(conn):
    """候选配置落库时 key 是 Fernet 密文(没配 ENCRYPTION_KEY 的 DEBUG 环境与 EncryptedCharField 一样存原文)。"""
    from apps.death_sync.fields import get_fernet

    fernet = get_fernet()
    key = fernet.encrypt(conn.api_key.encode()).decode() if fernet and conn.api_key else conn.api_key
    return {"provider": conn.provider, "base_url": conn.base_url, "api_key": key, "model": conn.model,
            "effort": conn.effort, "fallbacks": conn.fallbacks}


def _connection(stored):
    from apps.death_sync.fields import get_fernet

    fernet = get_fernet()
    key = stored["api_key"]
    if fernet and key:
        key = fernet.decrypt(key.encode()).decode()
    return config.Connection(stored["provider"], stored["base_url"], key, stored["model"], stored["effort"],
                             stored["fallbacks"])


def start(token, user):
    """凭预估时发的令牌开始(一次性)。令牌过期、被用过、或不是这个人拿的 → None。"""
    from apps.soul_assist.models import AssistEvalRun

    key = PREVIEW_KEY + (token or "")
    held = cache.get(key)
    if held is None or held["user_id"] != user.pk:
        return None
    if not cache.delete(key):  # 两次并发的开始:只有删掉令牌的那一次算数
        return None
    fail_stale()
    return AssistEvalRun.objects.create(created_by=user, candidates=held["candidates"], case_ids=held["case_ids"],
                                        estimated_cost=held["estimated_cost"],
                                        total=len(held["candidates"]) * len(held["case_ids"]))


# ── 评测:执行 ──────────────────────────────────────────────────────────────


def _officer_request(user):
    """评测官员的请求对象:与 `TenantMiddleware` 给出的一样 —— `tenant` 是它自己的殿(ADMIN 可以没有)。"""
    from django.http import HttpRequest
    from rest_framework.request import Request

    raw = HttpRequest()
    raw.method = "GET"
    raw.tenant = user.tenant
    request = Request(raw)
    request.user = user
    return request


def _asker(side, screen, locale, eff):
    if side == "soul":
        account = eval_identities.live_account(eff.eval_soul_account_id)
        return None if account is None else service.soul_asker(account, screen, locale)
    user = eval_identities.live_officer(eff.eval_officer_id)
    return None if user is None else service.officer_asker(_officer_request(user), screen, locale)


def _ask_as(asker, question, screen, lang, conn, request=None):
    """以评测身份走正式的 `service.ask`(`is_eval`:开新会话、不计用量与月度上限)。租户上下文按提问者设。"""
    from apps.tenants.managers import clear_current_tenant, set_current_tenant

    set_current_tenant(asker.tenant)
    try:
        return service.ask(asker, question, screen, lang=lang, conn=conn, is_eval=True, request=request)[1]
    finally:
        clear_current_tenant()


def judge(case, text, tools_called):
    lowered = text.lower()
    included = {p: p.lower() in lowered for p in case.must_include}
    excluded = {p: p.lower() in lowered for p in case.must_not_include}
    tools_ok = set(case.expected_tools) <= set(tools_called)
    return tools_ok, included, excluded, tools_ok and all(included.values()) and not any(excluded.values())


def run_case(run, index, conn, case, eff):
    from apps.soul_assist.models import AssistEvalResult

    result = AssistEvalResult(run=run, candidate=index, case=case, question=case.question, side=case.side)
    asker = _asker(case.side, case.screen, case.locale, eff)
    if asker is None:
        result.error = "no_eval_identity"
        result.save()
        return result
    begin = time.monotonic()
    try:
        reply = _ask_as(asker, case.question, case.screen, case.locale, conn)
    except service.AssistError as exc:
        result.error = exc.code
    except Exception:  # 一条用例坏了不拖垮整次运行;原因进日志,结果里只记 internal
        logger.exception("assistant eval case %s failed", case.pk)
        result.error = "internal"
    else:
        result.answer, result.tools_called, result.tokens = reply.content, reply.tool_calls, reply.tokens
        result.tools_ok, result.included, result.excluded, result.passed = judge(case, reply.content,
                                                                                 reply.tool_calls)
        result.cost = config.cost(eff.prices, conn.model, reply.tokens.get("input", 0),
                                  reply.tokens.get("output", 0), reply.tokens.get("cache_read", 0))
    result.latency_ms = _ms(begin)
    result.save()
    return result


def execute(run_id):
    """Celery 任务的本体(测试直接调)。实际花费到了单次上限就停,状态 `stopped_at_cap`。"""
    from apps.soul_assist.models import AssistEvalCase, AssistEvalRun

    # 条件更新认领:同一个运行被投递两次(重试、重复 delay),只有一个 worker 跑。
    if not AssistEvalRun.objects.filter(pk=run_id, status="queued").update(status="running"):
        return None
    run = AssistEvalRun.objects.get(pk=run_id)
    eff = config.effective()
    by_id = AssistEvalCase.objects.in_bulk(run.case_ids)
    cases = [by_id[i] for i in run.case_ids if i in by_id]
    spent, status = 0.0, "done"
    try:
        for index, stored in enumerate(run.candidates):
            conn = _connection(stored)
            for case in cases:
                if spent >= eff.eval_spend_cap:
                    status = "stopped_at_cap"
                    break
                result = run_case(run, index, conn, case, eff)
                # 答出来了却算不出花费(价目表里这个模型中途被删了):花费未知,按已到上限停,不按 0 继续花。
                spent = float("inf") if result.cost is None and not result.error else spent + (result.cost or 0)
                AssistEvalRun.objects.filter(pk=run.pk).update(done=run.results.count())
    except Exception:
        logger.exception("assistant eval run %s failed", run.pk)
        status = "failed"
    # 只在仍是 running 时收尾:被 fail_stale 判死的运行不再被改回来。
    AssistEvalRun.objects.filter(pk=run.pk, status="running").update(
        status=status, summary=summarize(run), finished_at=timezone.now(), done=run.results.count())
    return status


# ── 试问(§3.3)───────────────────────────────────────────────────────────────


class NoEvalIdentityError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def try_question(side, question, conn, lang, request=None) -> dict:
    """以配置里的评测身份问一句,看回答与工具调用。与评测同一条路(`service.ask`,正式的数据范围与审计,
    `is_eval` 不计用量);身份缺了 → `NoEvalIdentityError("no_eval_soul" / "no_eval_officer")`。
    `service.AssistError`(503 / 429)原样抛给调用方。"""
    asker = _asker(side, "other", lang, config.effective())
    if asker is None:
        raise NoEvalIdentityError(f"no_eval_{side}")
    begin = time.monotonic()
    reply = _ask_as(asker, question, "other", lang, conn, request)
    return {"side": side, "answer": reply.content, "tools_called": list(reply.tool_calls),
            "latency_ms": _ms(begin), "tokens": reply.tokens, "provider": config.provider_name(conn.provider),
            "model": conn.model}


def fail_stale():
    """排队或运行超过 `STALE_AFTER` 的评测记为 failed(列表时、开始新运行时顺手做;beat 未部署)。"""
    from apps.soul_assist.models import AssistEvalRun

    now = timezone.now()
    return AssistEvalRun.objects.filter(status__in=("queued", "running"), created_at__lt=now - STALE_AFTER).update(
        status="failed", finished_at=now)


def summarize(run):
    """每套候选一行:工具调用正确率、要点命中率、平均延迟、花费。"""
    out = []
    for index, stored in enumerate(run.candidates):
        rows = list(run.results.filter(candidate=index))
        answered = [r for r in rows if not r.error]
        checks = [v for r in answered for v in r.included.values()] + \
                 [not v for r in answered for v in r.excluded.values()]
        costs = [r.cost for r in answered]
        out.append({
            "candidate": index, "provider": config.provider_name(stored["provider"]), "model": stored["model"],
            "cases": len(rows), "passed": sum(r.passed for r in rows), "errors": len(rows) - len(answered),
            "tool_accuracy": sum(r.tools_ok for r in answered) / len(answered) if answered else None,
            "phrase_hit_rate": sum(checks) / len(checks) if checks else None,
            "mean_latency_ms": sum(r.latency_ms for r in answered) / len(answered) if answered else None,
            "cost": None if any(c is None for c in costs) else round(sum(costs), 6),
            "input_tokens": sum(r.tokens.get("input", 0) for r in answered),
            "output_tokens": sum(r.tokens.get("output", 0) for r in answered),
        })
    return out
