"""业务模块接入 AI 的公共底座(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分 0 号)。

问一问之外的每个接入点(权限解释、审计查询,以后的律条建议、判词草稿、审核预筛)都从 `complete()` 调模型:
同一个生效配置、同一个主备与断路器(`failover`)、同一个并发名额、同一个月度上限,用量按 `feature` 记一行。

所有接入点的共同规矩(同一份文档):
- **只读加建议**:`complete()` 只返回文本,从不写业务;人点「采纳」才走原来的写接口(出处记在 `drafts.py`)。
- **每殿开关**:与官员助手同一个开关(`service.officer_enabled_for`):殿没开,它的数据不送模型。
- **失败可退**:模型不可用时抛 `FeatureUnavailableError`,调用方要有不靠模型的退路(权限解释退回模板句;
  审计查询退回手动筛选)。

接入点自己决定送什么(白名单、`redact.py`)、怎么校验产出 —— 这里不碰任何业务数据。
"""
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from apps.soul_assist import config, failover, service
from apps.soul_assist.models import FEATURES
from apps.soul_assist.providers import ProviderError, Turn, get_provider


class FeatureUnavailableError(Exception):
    """`code` 与问一问同一套:assistant_not_configured / assistant_unavailable / assistant_busy。"""

    def __init__(self, code, status=503):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass
class Completion:
    text: str
    model: str = ""
    provider_role: str = ""
    usage: dict = field(default_factory=dict)


def evalset(name) -> dict:
    """离线评测集(`evalsets/<功能>.json`):数据,不是代码。每个接入点一份,由它自己的 `evaluate` 读。"""
    return json.loads((Path(__file__).parent / "evalsets" / f"{name}.json").read_text(encoding="utf-8"))


def enabled(request) -> bool:
    return service.officer_enabled_for(request)


def record_usage(feature, tenant, status, model="", tokens=None, *, provider_role="", fallback_reason=""):
    """`usage.record` 加上 `feature`。单独写一份是为了不改动问一问的那条签名。"""
    from apps.soul_assist.models import AssistUsage

    tokens = tokens or {}
    AssistUsage.objects.create(side="officer", feature=feature, tenant=tenant, status=status, model=model or "",
                               provider_role=provider_role, fallback_reason=fallback_reason,
                               input_tokens=tokens.get("input", 0), output_tokens=tokens.get("output", 0),
                               cache_read_tokens=tokens.get("cache_read", 0))


def complete(feature, request, *, system, prompt, facts="", tools=(), run_tool=None, max_rounds=0, conn=None):
    """一次不落会话的模型调用 → `Completion`;不可用抛 `FeatureUnavailableError`。

    `system` 是规则(缓存前缀),`facts` 是这一次的结构化材料(已脱敏、已过白名单),`prompt` 是这一问。
    `tools` / `run_tool` 留给要工具循环的接入点(律条建议的检索);默认不给工具。
    `conn` 缺省是生效配置连同备用与断路器;评测传候选配置,只测那一套。"""
    assert feature in FEATURES and feature != "assist", feature
    tenant = getattr(request, "tenant", None)
    if conn is None and not enabled(request):
        record_usage(feature, tenant, "not_configured")
        raise FeatureUnavailableError("assistant_not_configured")
    backup = None
    if conn is None:
        eff = config.effective()
        conn, backup = eff.connection, eff.backup
    slot = service._Slot()
    try:
        slot.__enter__()
    except service.AssistError:
        record_usage(feature, tenant, "busy", conn.model)
        raise FeatureUnavailableError("assistant_busy", 429) from None
    try:
        return _call(feature, tenant, system, facts, prompt, tools, run_tool, max_rounds, conn, backup)
    finally:
        slot.__exit__()


def _call(feature, tenant, system, facts, prompt, tools, run_tool, max_rounds, conn, backup):
    start = time.monotonic()
    service._release_db()
    attempts = failover.plan(conn, backup, start)
    reason = ""
    for index, (role, attempt, deadline, planned) in enumerate(attempts):
        reason = planned or reason
        try:
            answer = get_provider(attempt).answer(
                system=system, facts=facts, history=[Turn("user", prompt)], tools=list(tools),
                call_tool=run_tool or (lambda name: '{"error": "unknown_tool"}'), max_rounds=max_rounds,
                deadline=deadline)
        except ProviderError as exc:
            if role == "primary" and backup is not None and exc.reason:
                failover.record_failure(conn)
            if exc.reason and index + 1 < len(attempts):
                reason = exc.reason
                if any(exc.usage.values()):
                    record_usage(feature, tenant, "failed_over", attempt.model, exc.usage, provider_role="primary")
                continue
            record_usage(feature, tenant, "unavailable", attempt.model, exc.usage, provider_role=role,
                         fallback_reason=reason)
            raise FeatureUnavailableError("assistant_unavailable") from exc
        if role == "primary" and backup is not None:
            failover.record_success(conn)
        text = answer.text.strip()
        record_usage(feature, tenant, "ok" if text else "empty", attempt.model, answer.usage, provider_role=role,
                     fallback_reason=reason)
        _enforce_cap()
        return Completion(text=text, model=attempt.model, provider_role=role, usage=answer.usage)
    raise FeatureUnavailableError("assistant_unavailable")  # 没有任何一次尝试(plan 至少给一项,走不到这里)


def _enforce_cap():
    from apps.soul_assist import usage

    try:
        usage.enforce_cap()
    except Exception:  # 与问一问同一条:上限检查坏了不让调用方拿到 500
        service.logger.exception("assistant monthly cap check failed")
