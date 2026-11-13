"""AI 产出的出处(`AIDraft`,docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分 0 号)。

`record` 在模型产出之后、交给人之前写一行;`decide` 在人采纳 / 改后采纳 / 丢弃时写处置。
两者各写一行审计,**只有** 功能、状态、改动比例与这一行的 id,不记原文(原文只在 `AIDraft.output`)。

`decide` 不碰业务:采纳的内容由前端照原来的写接口提交(审计筛选、引用、判词…),原来的权限与校验照常生效。
"""
import hashlib
from difflib import SequenceMatcher

from django.db import transaction
from django.utils import timezone

from apps.soul_assist.models import AIDraft
from apps.soul_assist.service import _sha


def record(feature, request, completion, *, system, input_text, output, target_type="", target_id=""):
    user = request.user
    with transaction.atomic():
        draft = AIDraft.objects.create(
            feature=feature, tenant=getattr(request, "tenant", None), created_by=user, target_type=target_type,
            target_id=str(target_id or ""), model=completion.model, provider_role=completion.provider_role,
            prompt_fingerprint=hashlib.sha256(system.encode()).hexdigest(), input_fingerprint=_sha(input_text),
            output=output)
        _audit(draft, request, "CREATE", "AI draft", {"feature": feature, "model": completion.model})
    return draft


def edit_ratio(output, final):
    """0 = 原样,1 = 全改。"""
    return round(1 - SequenceMatcher(None, output, final).ratio(), 4)


def decide(draft, request, *, adopted, final_text=""):
    """`adopted=False` → discarded;采纳时按最终文本与产出的差异定 adopted / adopted_edited。
    已处置的再处置答 False(调用方答 409),不改第一次的记录。"""
    with transaction.atomic():
        locked = AIDraft.objects.select_for_update().get(pk=draft.pk)
        if locked.status != "pending":
            return False
        ratio = edit_ratio(locked.output, final_text) if adopted else None
        locked.status = "discarded" if not adopted else ("adopted" if ratio == 0 else "adopted_edited")
        locked.edit_ratio = ratio
        locked.decided_by = request.user
        locked.decided_at = timezone.now()
        locked.save(update_fields=["status", "edit_ratio", "decided_by", "decided_at"])
        _audit(locked, request, "UPDATE", "AI draft decided by a person",
               {"feature": locked.feature, "status": locked.status, "edit_ratio": ratio})
    draft.status, draft.edit_ratio = locked.status, locked.edit_ratio
    return True


def _audit(draft, request, action, description, changes):
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant=draft.tenant, user=request.user, action=action, resource="ai_draft", resource_id=str(draft.pk),
        description=description, changes={"draft_id": draft.pk, **changes},
        ip_address=get_client_ip(request), user_agent=request.META.get("HTTP_USER_AGENT", "")[:500])
