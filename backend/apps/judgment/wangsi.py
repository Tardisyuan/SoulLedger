"""枉死城的冤情申诉(docs/10_枉死城详解.md §3.3「冤情申诉」、§4.2「申诉成功的结果」、§6.2 业务流程)。
`Judgment.grievance_*` 只在这里写;死因分类与冤情等级是普通字段,经 PATCH 写(`JudgmentSerializer`)。

流程
* 只对**还押在枉死城**的案子:枉死(`untimely`)、未结案、`held_until` 还没到。
* 提出(FILED):官员替亡魂记下申诉的内容(必填)。不属实之后可以再提;已提、已属实的不能再提。
* 审核:这件案子城隍名下的官员,或持 `judgment.assign` 的人(没交城隍的案子只有后者)——
  docs/10 §4.2「向城隍申诉 · 地方层面调查核实」。
  - 属实(UPHELD):只在冤情等级为「重」「极重」时可以(§4.2「若确属冤死且冤情重大 → 可提前释放」),
    否则 409 `grievance_not_major`。属实即提前释放:`held_until` 清空,案子当即可以认领、结案。
  - 不属实(REJECTED):照旧押到阳寿那一天。
* 拒绝一律 `WangsiRefusedError`(与认领同一形状),在任何写入之前抛出。

不记事件:没有新的事件类型(加一个要动 events 的迁移与前端几道镜像),改动由审计信号逐列记下。
ponytail: 灵魂时间线上看不到「提前释放」;要看就加 `WANGSI_GRIEVANCE_*` 事件类型。
"""
from django.db import transaction
from django.utils import timezone

from apps.judgment.claims import ClaimRefusedError, _lock
from apps.judgment.models import GRIEVANCE_RELEASE_LEVELS, GrievanceStatus, Judgment

_BOOKKEEPING = ("version", "update_user", "update_time")


class WangsiRefusedError(ClaimRefusedError):
    """枉死城的申诉此刻不接受这个动作。"""


def is_held(judgment: Judgment) -> bool:
    return bool(judgment.untimely and judgment.held_until and judgment.held_until > timezone.localdate())


def _assert_held(judgment: Judgment) -> None:
    if judgment.verdict is not None or judgment.is_final or judgment.is_deleted:
        raise WangsiRefusedError("This judgment is no longer pending.", "not_pending")
    if not is_held(judgment):
        raise WangsiRefusedError("This soul is not held in 枉死城.", "not_in_wangsi")


def may_decide(user, judgment: Judgment) -> bool:
    from apps.judgment import city_gods
    from apps.perm.checker import check_permission

    if judgment.city_god_id is not None:
        return city_gods.may_act(user, judgment)
    return check_permission(user, "judgment.assign")


def _save(judgment: Judgment, *fields: str) -> None:
    judgment.save(update_fields=[*fields, *_BOOKKEEPING])


def file_grievance(pk, user, plea: str) -> Judgment:
    with transaction.atomic():
        judgment = _lock(pk)
        _assert_held(judgment)
        if judgment.grievance_status in (GrievanceStatus.FILED, GrievanceStatus.UPHELD):
            raise WangsiRefusedError("A grievance is already filed for this case.", "grievance_open",
                                     grievance_status=judgment.grievance_status)
        judgment.grievance_status = GrievanceStatus.FILED
        judgment.grievance_plea = plea
        judgment.grievance_note = ""
        judgment.grievance_decided_at = None
        _save(judgment, "grievance_status", "grievance_plea", "grievance_note", "grievance_decided_at")
    return judgment


def decide_grievance(pk, user, *, upheld: bool, note: str) -> Judgment:
    with transaction.atomic():
        judgment = _lock(pk)
        _assert_held(judgment)
        if judgment.grievance_status != GrievanceStatus.FILED:
            raise WangsiRefusedError("No grievance is awaiting review.", "no_grievance_filed",
                                     grievance_status=judgment.grievance_status)
        if not may_decide(user, judgment):
            raise WangsiRefusedError(
                "Only the city god's officers, or a hall administrator, can review this grievance.",
                "not_city_god_officer", status=403)
        if upheld and judgment.grievance_level not in GRIEVANCE_RELEASE_LEVELS:
            raise WangsiRefusedError(
                "Only a major or severe grievance releases the soul early; record the grievance level first.",
                "grievance_not_major", grievance_level=judgment.grievance_level)
        judgment.grievance_status = GrievanceStatus.UPHELD if upheld else GrievanceStatus.REJECTED
        judgment.grievance_note = note
        judgment.grievance_decided_at = timezone.now()
        fields = ["grievance_status", "grievance_note", "grievance_decided_at"]
        if upheld:
            judgment.held_until = None  # 提前释放:`claims._assert_not_held` 不再拦
            fields.append("held_until")
        _save(judgment, *fields)
    return judgment
