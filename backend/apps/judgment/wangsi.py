"""枉死城的冤情申诉(docs/10_枉死城详解.md §3.3「冤情申诉」、§4.2「申诉成功的结果」、§6.2 业务流程)。
`Judgment.grievance_*` 只在这里写;死因分类与冤情等级是普通字段,经 PATCH 写(`JudgmentSerializer`)。

流程
* 只对**还押在枉死城**的案子:枉死(`untimely`)、未结案、`held_until` 还没到。
* 提出(FILED):官员替亡魂记下申诉的内容(必填),或亡魂自己在灵魂 App 里提(`/me/wangsi/`,只能是自己本世的案子,
  别人的一律 404 `not_found`)。两条路同一个函数、同一套规则。不属实之后可以再提;已提、已属实的不能再提。
* 审核:这件案子城隍名下的官员,或持 `judgment.assign` 的人(没交城隍的案子只有后者)——
  docs/10 §4.2「向城隍申诉 · 地方层面调查核实」。
  - 属实(UPHELD):只在冤情等级为「重」「极重」时可以(§4.2「若确属冤死且冤情重大 → 可提前释放」),
    否则 409 `grievance_not_major`。属实即提前释放:`held_until` 清空,案子当即可以认领、结案。
  - 属实 · 超度(DELIVERED,2026-10-29 用户决定;§4.2「请道士/僧人做法事 · 超度」、§4.3 度化超拔、§6.2
    「属实则提前释放/超度」):同样只给「重」「极重」。亡魂出城、到第十二站莲花台(§4.3「地藏王菩萨定期在莲花台
    度化枉死城亡魂」),免审:案子当场按 PASSED 结案、不走审批流 —— 与埃及早夭者「不受审,直入芦苇原」
    (`Soul._after_egyptian_death`)同一个出口,不另起一套。地府判无罪不发落、直接候转世(`acquitted_to_rebirth`,
    用户 2026-10-29),所以超度出城即候转世。案子还在城隍处(PENDING / RETURNED)时同一事务里先解送(`city_gods.send_on`,
    用户 2026-10-29),再超度 —— 此前是 409 `at_city_god` 要官员先去解送。
  - 不属实(REJECTED):照旧押到阳寿那一天。
* 阳寿到了(或案子已结)而申诉还是 FILED(2026-10-29 审查):仍可审核,只记结论 —— 已经出城,没有什么可提前释放,
  也不能再超度(409 `not_in_wangsi`)。属实记成 UPHELD_LATE(「属实 · 期满出城」),不看冤情等级:等级只决定
  放不放人,这里不放人。不这样,FILED 会永远挂着:审核要求还押,而 `filing_refusal` 又不许再提。
* 拒绝一律 `WangsiRefusedError`(与认领同一形状),在任何写入之前抛出。

事件(2026-10-28):提出 / 属实(提前释放或期满后属实,payload 的 status 分得开)/ 超度 / 不属实各一条 `WANGSI_GRIEVANCE_*`,记在灵魂时间线上,与那一笔同一事务。
payload:judgment_id、status、冤情等级;提出另带 via(officer / soul)。不带申诉原文、审核批语与经办官员。
推送与通知(2026-10-29 用户决定):四种结论推给灵魂 App(`soul_push.services.WANGSI_STATUS_KINDS`,事件总线接);
提出时通知城隍名下官员(`_notify_filed`)。两者都在提交之后发。
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
    # 与 `claims._assert_pending` 同一组列:已归档的案子也不再接申诉(2026-10-29 审查)。
    if judgment.verdict is not None or judgment.is_final or judgment.is_deleted or judgment.is_archived:
        raise WangsiRefusedError("This judgment is no longer pending.", "not_pending")
    if not is_held(judgment):
        raise WangsiRefusedError("This soul is not held in 枉死城.", "not_in_wangsi")


def filing_refusal(judgment: Judgment) -> WangsiRefusedError | None:
    """此刻能不能提申诉;不能时是要抛的那个拒绝。官员端、灵魂端、灵魂端的列表(`can_file`)都读它。"""
    try:
        _assert_held(judgment)
    except WangsiRefusedError as exc:
        return exc
    if judgment.grievance_status in (GrievanceStatus.FILED, GrievanceStatus.UPHELD):
        return WangsiRefusedError("A grievance is already filed for this case.", "grievance_open",
                                  grievance_status=judgment.grievance_status)
    return None


def may_decide(user, judgment: Judgment) -> bool:
    from apps.judgment import city_gods
    from apps.perm.checker import check_permission

    if judgment.city_god_id is not None:
        return city_gods.may_act(user, judgment, execute="wangsi.execute", manage="wangsi.manage")
    return check_permission(user, "wangsi.manage")


def _save(judgment: Judgment, *fields: str) -> None:
    judgment.save(update_fields=[*fields, *_BOOKKEEPING])


def _event(judgment: Judgment, event_type: str, **extra) -> None:
    from apps.events.services import EventService

    EventService.log(judgment.soul, event_type, {
        "judgment_id": str(judgment.pk), "status": judgment.grievance_status,
        "grievance_level": judgment.grievance_level, **extra,
    })


def file_grievance(pk, user, plea: str, *, account=None) -> Judgment:
    """`account`:亡魂自己提(灵魂 App)。案子必须是这个账号的灵魂本世的,否则当作不存在(404)。"""
    with transaction.atomic():
        if account is not None and not Judgment.all_objects.filter(
                pk=pk, soul_id=account.soul_id, cycle=account.cycle, is_deleted=False).exists():
            raise WangsiRefusedError("No such judgment.", "not_found", status=404)
        judgment = _lock(pk)
        refusal = filing_refusal(judgment)
        if refusal is not None:
            raise refusal
        judgment.grievance_status = GrievanceStatus.FILED
        judgment.grievance_plea = plea
        judgment.grievance_note = ""
        judgment.grievance_decided_at = None
        judgment.grievance_filed_at = timezone.now()
        _save(judgment, "grievance_status", "grievance_plea", "grievance_note", "grievance_decided_at",
              "grievance_filed_at")
        _event(judgment, "WANGSI_GRIEVANCE_FILED", via="soul" if account is not None else "officer")
        _notify_filed(judgment)
    return judgment


def _notify_filed(judgment: Judgment) -> None:
    """提出申诉:提交后通知这件案子城隍名下的官员(站内通知 + 官员 App 的待办推送,与城隍收案同一写法);
    名下没有官员、或案子没交城隍时只通知本殿管理员(`may_decide` 的另一半),不推官员 App ——
    「枉死申诉」那组待办只列城隍名下官员的(`officer_app.todo._wangsi_items`),推了他们点开也落不到这一件。"""
    from apps.judgment import city_gods
    from apps.officer_app.push import notify_users

    officers = (list(judgment.city_god.officers.filter(is_active=True))
                if judgment.city_god_id is not None else [])
    recipients = [u.pk for u in officers] or city_gods._hall_admins(judgment.tenant_id)
    city_gods._notify_after_commit(recipients, "WANGSI_GRIEVANCE_FILED", judgment)
    notify_users(officers, target={"kind": "wangsi", "id": str(judgment.pk)})


def decide_grievance(pk, user, *, upheld: bool, note: str, deliver: bool = False) -> Judgment:
    """`deliver`:属实且超度(只在还押时)。到期 / 已结案后仍可审核,只记结论(见模块说明)。"""
    from apps.judgment.models import AT_CITY_GOD

    with transaction.atomic():
        judgment = _lock(pk)
        if judgment.is_deleted or judgment.is_archived:
            raise WangsiRefusedError("This judgment is no longer pending.", "not_pending")
        if not judgment.untimely:
            raise WangsiRefusedError("This soul is not held in 枉死城.", "not_in_wangsi")
        if judgment.grievance_status != GrievanceStatus.FILED:
            raise WangsiRefusedError("No grievance is awaiting review.", "no_grievance_filed",
                                     grievance_status=judgment.grievance_status)
        if not may_decide(user, judgment):
            raise WangsiRefusedError(
                "Only the city god's officers, or a hall administrator, can review this grievance.",
                "not_city_god_officer", status=403)
        held = judgment.verdict is None and not judgment.is_final and is_held(judgment)
        if deliver and not upheld:
            raise WangsiRefusedError("Only an upheld grievance can deliver the soul.", "deliver_needs_upheld",
                                     status=400)
        if deliver and not held:
            raise WangsiRefusedError("This soul has already left 枉死城; it cannot be delivered.", "not_in_wangsi")
        if upheld and held and judgment.grievance_level not in GRIEVANCE_RELEASE_LEVELS:
            raise WangsiRefusedError(
                "Only a major or severe grievance releases the soul early; record the grievance level first.",
                "grievance_not_major", grievance_level=judgment.grievance_level)
        if deliver and judgment.city_god_status in AT_CITY_GOD:
            # 还在城隍初审:超度时顺带解送(用户 2026-10-29),同一事务、同一套规则(`city_gods.send_on`,
            # CITY_GOD_SENT_ON 照记)。能审这件申诉的人(`may_decide`:城隍名下官员或持 `wangsi.manage`)
            # 按默认授予也是能解送它的人(`city_gods.may_act`:city_god.execute / manage 与 wangsi.* 同一批角色),
            # 所以此前的 409 `at_city_god` 不会再出现,已删。矩阵把两族分开授时,`send_on` 自己的 403 照样拦。
            from apps.judgment import city_gods

            judgment = city_gods.send_on(judgment.pk, user, note="超度时一并解送(docs/10 §4.3)")
        if not upheld:
            judgment.grievance_status = GrievanceStatus.REJECTED
        elif deliver:
            judgment.grievance_status = GrievanceStatus.DELIVERED
        elif held:
            judgment.grievance_status = GrievanceStatus.UPHELD
        else:
            judgment.grievance_status = GrievanceStatus.UPHELD_LATE
        judgment.grievance_note = note
        judgment.grievance_decided_at = timezone.now()
        fields = ["grievance_status", "grievance_note", "grievance_decided_at"]
        if upheld and held:
            judgment.held_until = None  # 提前释放 / 超度出城:`claims._assert_not_held` 不再拦
            fields.append("held_until")
        _save(judgment, *fields)
        if deliver:
            _event(judgment, "WANGSI_GRIEVANCE_DELIVERED")
            _deliver(judgment)
        else:
            _event(judgment, "WANGSI_GRIEVANCE_UPHELD" if upheld else "WANGSI_GRIEVANCE_REJECTED")
    return judgment


def _deliver(judgment: Judgment) -> None:
    """超度:到莲花台,免审结案(PASSED,不走审批流)。在调用方的事务里;结案拒绝则整笔回滚。"""
    from apps.judgment.models import Verdict
    from apps.judgment.services import JudgmentConclusionService
    from apps.souls import stations
    from apps.souls.models import Soul

    stations.arrive(judgment.soul, Soul.DiyuStation.LOTUS_TERRACE, via="wangsi_delivered")
    JudgmentConclusionService.conclude_judgment(
        judgment, Verdict.PASSED, notes="Delivered from 枉死城 at the Lotus Terrace (docs/10 §4.3).",
        create_workflow=False)
