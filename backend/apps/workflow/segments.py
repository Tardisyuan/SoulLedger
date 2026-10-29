"""审批流程按域分段(第四十三批):选站、门口等待、加减站、按默认流程走、提醒,以及跨域审判并入后的两头 —— 流程走完 /
被驳回时结束跨域审判,跨域审判取消时跳过外域段。

**一段 = 一个域的默认流程。** 第 1 段是流程所属的殿(本域),生成时由判官选站(`skip_node_orders`);挂着未结束的
跨域审判时,每个参与域再接一段(按 `CrossTenantJudgmentParticipant.node_order`,没有序号的顾问按入席先后排在后面),
节点在生成时就按那个域的默认流程建好、等那个域的人选站(AWAITING_PICK)。各段依次走,不并行:流程走到一个还没选站的段,
停在门口(`ApprovalWorkflow._stop_at_gate`:没有当前节点、仍是 IN_PROGRESS),那个域选好后从该段第一站继续(`_resume`)。

**驳回时会转到的站(别的站的 `on_fail` 目标)与条件分支的目标也锁着**,只要还有一个来源要走
(`jump_target_required`);来源一并跳过时才能跳过它(2026-10-19)。来源是自动节点(希腊流程按来处分流那一步)时
它不能跳过,目标就一直锁着。

**每段的终审(`is_required`)必须走**:选站、加减站都不能跳过它;唯一的例外是流程走到某个外域段中间时取消跨域审判,
那一段的当前站与之后的站(含终审)一并跳过(`on_cross_cancelled`)。

**谁能做什么,只看这一段的 `tenant`**(跨租户只经这里放行,见 `foreign_workflows` 与 `views.WorkflowPartyPermission`):
* 选站 / 改选:该段所属域的判官(JUDGE / ADMIN,有 `workflow.approve`)或殿管理员(ADMIN / MODERATOR);该段开始之前。
* 加减站:当前站的审批人(当前站就在这一段)或该段所属域的殿管理员;只动当前站之后的站(没开始的段:全部站)。
* 按默认流程走:召集殿(流程所属殿)的管理员;门口满 `OVERDUE_DAYS` 天,或该域没有能选站的人。
* 再提醒一次:召集殿的人,每段一小时一次。

每一次选站 / 加减站带该段的 `version`,与库里不同就拒(`segment_changed`),不覆盖别人刚做的选择。
状态改动都在调用方的事务里;通知与推送在 `transaction.on_commit` 之后发。
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.workflow.models import (
    AUTOMATIC_KINDS,
    RESTORABLE_SKIPS,
    TERMINAL_WORKFLOW_STATUSES,
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeKind,
    NodeStatus,
    NodeType,
    SegmentState,
    SkipKind,
    WorkflowSegment,
)

logger = logging.getLogger(__name__)

#: 门口满几天没选:召集殿管理员可以「按默认流程走」,并收到一次 `workflow_pick_overdue`。
OVERDUE_DAYS = 3
#: 「再提醒一次」的最短间隔(第 4 条规则:限频)。
REMIND_INTERVAL = timedelta(hours=1)
#: 每日提醒:定时任务每天跑一次,留几个小时余量,跑得早一点也不会漏掉一天。
DAILY_REMINDER = timedelta(hours=20)

#: 能选站的人:有 `workflow.approve` 的判官 / 管理员。都没有 = 「没有能选站的人」,待办转给殿管理员。
PICKER_ROLES = ("JUDGE", "ADMIN")
#: 殿管理员(与 `CrossTenantJudgmentService.can_end` 同一组角色)。
HALL_ADMIN_ROLES = ("ADMIN", "MODERATOR")
#: 跨域审判取消让流程提前结束时写在 `end_reason` 上(不再去结束那场已取消的审判)。
END_REASON_CANCELLED = "CROSS_CANCELLED"
#: 外域的人经 `foreign_workflows` 能做的动作。列表、改、删、推进、越级都不在内。
FOREIGN_ACTIONS = ("retrieve", "approve_node", "pick", "adjust")


class SegmentRefusedError(Exception):
    """一次选站 / 加减站 / 默认 / 提醒被拒;什么都没写。视图原样转成 `{code, error, **extra}` 与 `status`。"""

    def __init__(self, message, code, status=400, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra


class CrossConclusionRefusedError(Exception):
    """流程走完要结束跨域审判,而那场审判结束不了(参与方的站还没填等)。决定整体回滚。"""

    code = "cross_judgment_incomplete"


# ── 建 ──────────────────────────────────────────────────────────────────


def case_type_for(civilization, case_type):
    """外域那一段用哪种案件的默认流程:与本域相同的案件类型,该文明不收这种就用 ROUTINE。"""
    from apps.workflow.models import CaseType
    from apps.workflow.templates import VALID_CASE_TYPES_BY_CIVILIZATION

    return case_type if case_type in VALID_CASE_TYPES_BY_CIVILIZATION.get(civilization, ()) else CaseType.ROUTINE


def mark_required(segment):
    """这一段的终审:最后一个 FINAL 类型的人工节点,没有就最后一个人工节点。自动节点(结束、通知 —— 希腊流程
    按来处分流的那一步就是通知)也不能被选掉:它们不是一站,没有人审。"""
    nodes = list(segment.nodes.order_by("node_order"))
    manual = [n for n in nodes if n.kind not in AUTOMATIC_KINDS]
    finals = [n for n in manual if n.node_type == NodeType.FINAL]
    required = {n.pk for n in nodes if n.kind in AUTOMATIC_KINDS}
    if finals or manual:
        required.add((finals or manual)[-1].pk)
    ApprovalNode.objects.filter(pk__in=required).update(is_required=True)


def jump_sources(nodes):
    """{target pk: [source nodes]}:`on_fail` 边与条件分支的目标,只算同一段里的(引擎只走这种,
    `ApprovalWorkflow._fail_target`)。分支目标与驳回目标同一条规则(2026-10-19 用户决定):来源还要走,
    目标就不能跳过 —— 条件选中的站被跳过时流程以驳回结束(`BRANCH_SKIPPED`),不落到默认那一站。"""
    by_pk = {str(n.pk): n for n in nodes}
    out = {}
    for node in sorted(nodes, key=lambda n: n.node_order):
        ids = [node.on_fail_id, *(b.get("target") for b in node.branches_json or [] if isinstance(b, dict))]
        targets = []
        for target in (by_pk.get(str(i)) for i in ids if i):
            if (target is not None and target.pk != node.pk and target.segment_id == node.segment_id
                    and target not in targets):
                targets.append(target)
        for target in targets:
            out.setdefault(target.pk, []).append(node)
    return out


def _unskippable(keys, fixed, sources):
    """The keys that can never be skipped: `fixed` (终审、自动节点), and — to a fixed point — every target with a
    source among them (a source that cannot be unticked keeps its target locked for good)."""
    locked = set(fixed)
    changed = True
    while changed:
        changed = False
        for key in keys:
            if key not in locked and any(s in locked for s in sources.get(key, ())):
                locked.add(key)
                changed = True
    return locked


def station_count(raw_nodes):
    """「默认流程 N 站」的 N:模板里的人工节点。自动节点(结束、通知 —— 按出身地域分流那一步)不是一站(第四十五批)。"""
    return sum(1 for n in raw_nodes if (n.get("kind") or NodeKind.APPROVAL) not in AUTOMATIC_KINDS)


def jump_via(target_key, on_fail_key):
    """来源怎样转到目标(第四十五批 W-6):`on_fail` 是驳回转来,其余是条件分支。客户端按它写两种理由。"""
    return "on_fail" if on_fail_key is not None and str(on_fail_key) == str(target_key) else "branch"


def nothing_to_pick(nodes):
    """这一段没有一站能跳过(Design 第四十五批):每一站都是终审、自动节点,或锁着的驳回 / 分支目标。希腊常规流程就是这样。
    `nodes` 是这一段的 ApprovalNode(`mark_required` 之后)。"""
    keys = [n.pk for n in nodes]
    fixed = {n.pk for n in nodes if n.is_required or n.kind in AUTOMATIC_KINDS}
    sources = {target: [s.pk for s in srcs] for target, srcs in jump_sources(nodes).items()}
    return set(keys) <= _unskippable(keys, fixed, sources)


def _refuse_skipped_jump_targets(nodes, skipped, changed):
    """被跳过的站若是某个还要走的站的 `on_fail` 目标,拒(2026-10-19 用户决定:驳回不能落到没人选的站上)。

    `skipped` = 这次请求之后会是 SKIPPED 的 pk;「还要走」= 不在 `skipped` 里、还没决定(PENDING,或这次被加回的
    SKIPPED)。只拦这次请求动到的(`changed`:目标被跳过,或来源被加回),库里早就存在的不归这次请求管。
    来源一并跳过时目标就能跳过。"""
    refused = []
    for target_pk, sources in jump_sources(nodes).items():
        running = [s for s in sources if s.pk not in skipped and s.status in (NodeStatus.PENDING, NodeStatus.SKIPPED)]
        if target_pk in skipped and running and (target_pk in changed or any(s.pk in changed for s in running)):
            target = next(n for n in nodes if n.pk == target_pk)
            refused.append({"node_id": str(target.pk), "node_order": target.node_order, "node_name": target.node_name,
                            "sources": [s.node_name for s in running]})
    if refused:
        names = "; ".join(f"{r['node_name']} ← {', '.join(r['sources'])}" for r in refused)
        raise SegmentRefusedError(f"Rejected cases are handed to this station, so it cannot be skipped: {names}",
                                  "jump_target_required", jump_targets=refused)


def build_local(workflow, template, civilization, skip_node_orders=(), user=None, ruled=None):
    """本域那一段:建段、建节点(不进入)、按 `skip_node_orders`(模板里的站序)跳过。返回模板的第一个节点。

    `ruled`(`{"orders": …, "reason": …}`):按规则跳过的站(五逆直入阿鼻),不是判官选的 —— 模板里没有的站、终审
    不跳,原因写进 `skip_reason`,不记跳过人;它们是驳回目标也照跳(规则定的,驳回落到被跳的站时流程以驳回结束,
    `_fail_target`)。判官自己选的站照旧全部校验。"""
    from apps.workflow.services import WorkflowService

    if workflow.tenant_id is None:
        # No hall, no realm to run a segment (only hand-built data has such a workflow): built as before segments.
        if skip_node_orders:
            raise SegmentRefusedError("A workflow without a hall has no stations to pick", "no_realm")
        return WorkflowService._create_nodes(workflow, template, civilization, enter=False)
    now = timezone.now()
    segment = WorkflowSegment.objects.create(
        workflow=workflow, order=1, tenant_id=workflow.tenant_id, civilization=civilization,
        name=template["name"], state=SegmentState.LOCAL_PICKED, picked_by=user, picked_at=now,
        default_node_count=station_count(template["nodes"]),
    )
    first = WorkflowService._create_nodes(workflow, template, civilization, segment=segment, enter=False)
    mark_required(segment)
    wanted = set(skip_node_orders or ())
    nodes = {n.node_order: n for n in segment.nodes.all()} if wanted or ruled else {}
    ruled_orders = ({o for o in ruled["orders"] if o in nodes and not nodes[o].is_required} - wanted
                    if ruled else set())
    if wanted:
        unknown = sorted(wanted - set(nodes))
        if unknown:
            raise SegmentRefusedError(f"No station {unknown} in this flow", "unknown_node", orders=unknown)
        required = sorted(o for o in wanted if nodes[o].is_required)
        if required:
            raise SegmentRefusedError("The final review cannot be skipped", "final_required", orders=required)
        skipped = {nodes[o].pk for o in wanted | ruled_orders}
        _refuse_skipped_jump_targets(list(nodes.values()), skipped, {nodes[o].pk for o in wanted})
        ApprovalNode.objects.filter(pk__in=[nodes[o].pk for o in wanted]).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.AT_PICK, skipped_by=user, decided_at=now)
    if ruled_orders:
        ApprovalNode.objects.filter(pk__in=[nodes[o].pk for o in ruled_orders]).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.AT_PICK, skip_reason=ruled["reason"], decided_at=now)
    return first


def open_cross_for(judgment):
    """挂在这份审判上、还没结束的跨域审判(PROPOSED / ACTIVE),或 None。"""
    from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus

    if judgment is None:
        return None
    return CrossTenantJudgment._base_manager.filter(
        judgment_id=judgment.pk, is_deleted=False, status__in=(JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE),
    ).first()


def cross_of(workflow):
    """流程经它的审判挂着的跨域审判(任何状态),或 None。"""
    from apps.dispatch.models import CrossTenantJudgment

    if workflow.judgment_id is None:
        return None
    return CrossTenantJudgment._base_manager.filter(judgment_id=workflow.judgment_id, is_deleted=False).first()


def foreign_realms(cross, own_tenant_id, case_type):
    """跨域审判的各参与域,按流程里各段的顺序:`node_order`(入席时定的「各域顺序」)。顾问席不另起一段(审查 D)。
    同一个域入席两次只算一段;发起方自己不另起一段。每项 (租户, 文明, 该域的默认流程)。
    `add_foreign` 与生成之前的选站列表(`flow_preview`)共用,两处的外域段不会不一样。"""
    from apps.dispatch.models import ParticipantRole
    from apps.workflow.services import WorkflowService

    # 顾问席不走审批段(用户 2026-10-29,审查 D):顾问不带站、不定处置,只提意见。
    seats = (cross.participants.filter(is_deleted=False).exclude(role=ParticipantRole.ADVISOR)
             .select_related("participant_tenant")
             .order_by(F("node_order").asc(nulls_last=True), "joined_at", "pk"))
    seen = {own_tenant_id}
    for seat in seats:
        realm = seat.participant_tenant
        if realm.pk in seen:
            continue
        seen.add(realm.pk)
        civilization = realm.known_civilization or realm.code
        template, _priority = WorkflowService._resolve_template(
            civilization, case_type_for(civilization, case_type), realm)
        yield realm, civilization, template


def flow_preview(soul, case_type, tenant, template, judgment=None):
    """W-1 选站列表,在流程生成之前:本域默认流程的各站(站序 = `skip_node_orders` 认的 `node_order`、名、殿、
    审批人、是否必须走),以及按跨域审判顺序接在后面的外域段(只给域名与默认站数,外域的站由那个域自己选)。
    模板由调用方按 `start_workflow` 同一套解析好传进来;审批人经 `preview.preview_node`(与 `_create_nodes` 同一个
    解析器);「必须走」与 `mark_required` 同一条规则。自动节点(结束、通知)不列:它们不能选,也不是一站。"""
    from apps.workflow.node_shape import normalize_template_node
    from apps.workflow.preview import preview_node

    civilization = soul.civilization
    nodes = [normalize_template_node(raw, i) for i, raw in enumerate(template["nodes"], start=1)]
    manual = [n for n in nodes if (n.get("kind") or NodeKind.APPROVAL) not in AUTOMATIC_KINDS]
    finals = [n for n in manual if n.get("node_type") == NodeType.FINAL]
    required = (finals or manual or [None])[-1]
    # 驳回时转到哪一站(`on_fail`)与条件分支的目标(模板里按模板内 id):目标那一行带上来源,客户端据此锁住、
    # 来源都勾掉时解锁。来源是自动节点(按来处分流)时它不在列表里、勾不掉,目标就一直锁着 —— 与 `jump_sources` 同。
    sources = _template_sources(nodes)
    stations = []
    for node in nodes:
        # 自动节点(结束、通知)不是一站:不能选,也不列。
        if (node.get("kind") or NodeKind.APPROVAL) in AUTOMATIC_KINDS:
            continue
        who = preview_node(node, civilization, tenant) if tenant is not None else {}
        actor = who.get("actor")
        users = who.get("users") or []
        stations.append({
            "node_order": node["node_order"],
            "node_name": node["node_name"],
            "court_code": node.get("court_code") or "",
            # 一个具名的人(角色 / 冥官);按角色派、不止一人时只给角色,由客户端翻译。
            "approver": (actor["name_zh"] or actor["name"]) if actor else (
                users[0]["display_name"] if who.get("user_count") == 1 else None),
            "approver_role": who.get("role"),
            "is_required": node is required,
            "jump_target_of": sources.get(node["node_order"], []),
        })
    foreign = []
    cross = open_cross_for(judgment)
    if cross is not None and tenant is not None:
        for order, (realm, _civilization, realm_template) in enumerate(
                foreign_realms(cross, tenant.pk, case_type), start=2):
            foreign.append({"order": order, "tenant_code": realm.code, "realm_name": _realm(realm),
                            "default_node_count": station_count(realm_template["nodes"]),
                            # 那一段建好就是 PICKED(`_foreign_segment`):客户端写「全部必须走」,不写「由该域判官选站」。
                            "nothing_to_pick": _template_nothing_to_pick(realm_template)})
    return {"name": template["name"], "stations": stations, "foreign": foreign,
            "nothing_to_pick": _template_nothing_to_pick(template)}


def _template_sources(nodes):
    """{target node_order: [{key, node_name, via}]}:模板(已 `normalize_template_node`)里驳回 / 条件分支的来源,按模板内 id。"""
    by_id = {str(n["id"]): n for n in nodes if n.get("id")}
    sources = {}
    for node in nodes:
        ids = [node.get("on_fail"), *(b.get("target") for b in node.get("branches") or [] if isinstance(b, dict))]
        seen = []
        for target_id in (i for i in ids if i):
            target = by_id.get(str(target_id))
            if target is not None and target is not node and not any(t is target for t in seen):
                seen.append(target)
                sources.setdefault(target["node_order"], []).append(
                    {"key": str(node["node_order"]), "node_name": node["node_name"],
                     "via": jump_via(target_id, node.get("on_fail"))})
    return sources


def _template_nothing_to_pick(template):
    """没有一站能跳过(第四十五批):客户端跳过选站这一步。与 `nothing_to_pick` 同一条规则,按模板算。"""
    from apps.workflow.node_shape import normalize_template_node

    nodes = [normalize_template_node(raw, i) for i, raw in enumerate(template["nodes"], start=1)]
    manual = [n for n in nodes if (n.get("kind") or NodeKind.APPROVAL) not in AUTOMATIC_KINDS]
    finals = [n for n in manual if n.get("node_type") == NodeType.FINAL]
    fixed = {n["node_order"] for n in nodes if (n.get("kind") or NodeKind.APPROVAL) in AUTOMATIC_KINDS}
    required = (finals or manual or [None])[-1]
    if required is not None:
        fixed.add(required["node_order"])
    sources = _template_sources(nodes)
    locked = _unskippable([n["node_order"] for n in nodes], fixed,
                          {order: [int(s["key"]) for s in srcs] for order, srcs in sources.items()})
    return all(n["node_order"] in locked for n in manual)


def add_foreign(workflow, cross):
    """每个参与域一段,接在本域之后(顺序与去重见 `foreign_realms`)。"""
    order = 1
    for realm, _civilization, _template in foreign_realms(cross, workflow.tenant_id, workflow.case_type):
        order += 1
        _foreign_segment(workflow, realm, order)


def _foreign_segment(workflow, realm, order):
    """一个外域段:那个域的默认流程,节点接在流程现有各站之后,等那个域选站。"""
    from apps.workflow.services import WorkflowService

    civilization = realm.known_civilization or realm.code
    template, _priority = WorkflowService._resolve_template(
        civilization, case_type_for(civilization, workflow.case_type), realm)
    segment = WorkflowSegment.objects.create(
        workflow=workflow, order=order, tenant=realm, civilization=civilization, name=template["name"],
        state=SegmentState.AWAITING_PICK, default_node_count=station_count(template["nodes"]),
    )
    offset = max(workflow.nodes.values_list("node_order", flat=True), default=0)
    WorkflowService._create_nodes(workflow, template, civilization, segment=segment, enter=False,
                                  order_offset=offset, tenant_id=realm.pk)
    mark_required(segment)
    # 没有可选的站(Design 第四十五批):建好就是 PICKED,不发选站待办(`notify_pick_tasks` / `notify_segment` 只认
    # AWAITING_PICK),流程也不在门口停(`_unpicked_segment` 同)。picked_by / picked_at 留空:没有人选过,也没有可选的,
    # 「谁在何时选的」写任何值都是假记录;段的状态本身已经说明它不用等。
    if nothing_to_pick(list(segment.nodes.all())):
        segment.state = SegmentState.PICKED
        segment.save(update_fields=["state"])
    return segment


def append_foreign(workflow, realm):
    """流程进行中新入席的域(2026-10-18 用户决定):接在最后一段之后(序号 = 最大 + 1),节点序号也排在所有站之后,
    所以前一段的最后一站通过时 `_pass_successor` 取到的「第一个 PENDING」就是这一段的第一站,`_enter` 停在它门口
    (`_unpicked_segment`),不会越过它结束流程。调用方已锁流程行(`lock_workflow_of`),与流程走完互斥。
    该域已有一段(同一域入席两次)或就是本域:不另起一段,返回 None。选站待办提交之后发给这一个域。"""
    if realm.pk == workflow.tenant_id or workflow.segments.filter(tenant=realm).exists():
        return None
    order = max(workflow.segments.values_list("order", flat=True), default=1) + 1
    segment = _foreign_segment(workflow, realm, order)
    transaction.on_commit(lambda: notify_segment(workflow.pk, segment.pk))
    return segment


# ── 谁 ──────────────────────────────────────────────────────────────────


def pickers(tenant_id):
    """这个域能选站的人:在职、JUDGE / ADMIN、有 `workflow.approve`。"""
    from apps.authentication.models import User
    from apps.perm.checker import check_permission

    candidates = User.objects.filter(tenant_id=tenant_id, is_active=True, role__in=PICKER_ROLES).order_by("pk")
    return [u for u in candidates if check_permission(u, "workflow.approve")]


def hall_admins(tenant_id):
    from apps.authentication.models import User

    return list(User.objects.filter(tenant_id=tenant_id, is_active=True, role__in=HALL_ADMIN_ROLES).order_by("pk"))


def pick_recipients(tenant_id):
    """选站待办与提醒给谁:能选站的人;一个都没有时转给该域的殿管理员(第 6 条规则)。"""
    return pickers(tenant_id) or hall_admins(tenant_id)


def _user_tenant_id(user, request=None):
    tenant = getattr(request, "tenant", None) if request is not None else None
    return tenant.pk if tenant is not None else getattr(user, "tenant_id", None)


def can_pick(user, segment, request=None):
    if not getattr(user, "is_authenticated", False) or _user_tenant_id(user, request) != segment.tenant_id:
        return False
    if user.role in HALL_ADMIN_ROLES:
        return True
    from apps.perm.checker import check_permission

    return user.role in PICKER_ROLES and check_permission(user, "workflow.approve")


def is_convener_admin(user, workflow, request=None):
    """召集殿(流程所属殿)的管理员;没有租户的全局 ADMIN 也算(同 `can_end`)。"""
    if not getattr(user, "is_authenticated", False) or user.role not in HALL_ADMIN_ROLES:
        return False
    tenant_id = _user_tenant_id(user, request)
    if tenant_id is None:
        return user.role == "ADMIN"
    return tenant_id == workflow.tenant_id


def can_adjust(user, workflow, segment, request=None):
    """当前站的审批人(当前站在这一段里),或这一段所属域的殿管理员。"""
    if not getattr(user, "is_authenticated", False) or _user_tenant_id(user, request) != segment.tenant_id:
        return False
    if user.role in HALL_ADMIN_ROLES:
        return True
    current = workflow.current_node
    return current is not None and current.segment_id == segment.pk and current.can_approve(user)


def started(segment, workflow):
    """这一段开始了没有:流程站在它里面,或它有一站已经被决定 / 经过 / 被路由跳过(选站与加减站的跳过不算)。"""
    current = workflow.current_node
    if current is not None and current.segment_id == segment.pk:
        return True
    return segment.nodes.exclude(status=NodeStatus.PENDING).exclude(skip_kind__isnull=False).exists()


def phase(segment, workflow):
    """给人看的状态:AWAITING_PICK / PICKED(还没开始)/ RUNNING / DONE / SKIPPED。"""
    if segment.state in (SegmentState.SKIPPED, SegmentState.AWAITING_PICK):
        return segment.state
    if not started(segment, workflow):
        return SegmentState.PICKED
    current = workflow.current_node
    return "RUNNING" if current is not None and current.segment_id == segment.pk else "DONE"


def at_gate(segment, workflow):
    return (segment.state == SegmentState.AWAITING_PICK and segment.gate_reached_at is not None
            and workflow.current_node_id is None and workflow.status == ApprovalWorkflowStatus.IN_PROGRESS)


def gate_days(segment, now=None):
    """「第 N 天」:到门口那天是第 1 天。"""
    if segment.gate_reached_at is None:
        return None
    return ((now or timezone.now()) - segment.gate_reached_at).days + 1


# ── 改 ──────────────────────────────────────────────────────────────────


def _locked(workflow_id, order=None):
    workflow = ApprovalWorkflow._base_manager.select_for_update().get(pk=workflow_id)
    if workflow.status in TERMINAL_WORKFLOW_STATUSES:
        raise SegmentRefusedError("This approval flow has ended", "workflow_closed", status=409)
    if order is None:
        return workflow, None
    segment = WorkflowSegment.objects.select_for_update().filter(workflow=workflow, order=order).first()
    if segment is None:
        raise SegmentRefusedError("No such segment", "segment_not_found", status=404)
    return workflow, segment


def _check_version(segment, version):
    if version is not None and version != segment.version:
        raise SegmentRefusedError("This segment was changed since you loaded it", "segment_changed", status=409,
                             version=segment.version,
                             changed_by=_name(segment.picked_by) if segment.picked_by_id else None,
                             changed_at=segment.picked_at.isoformat() if segment.picked_at else None)


def _name(user):
    return (user.display_name or user.username) if user is not None else None


def _audit(tenant_id, user, resource, workflow, description, changes):
    from apps.audit.models import AuditAction, AuditLog

    AuditLog.objects.create(
        tenant_id=tenant_id, user=user if getattr(user, "is_authenticated", False) else None,
        action=AuditAction.UPDATE, resource=resource, resource_id=str(workflow.pk),
        description=description[:500], changes=changes,
    )


def _resume(workflow, segment, now):
    """流程刚才站在这一段的门口(调用方在改状态之前问过 `at_gate`):从这一段第一个要走的站继续。"""
    entry = segment.nodes.filter(status=NodeStatus.PENDING).order_by("node_order").first()
    if entry is None:  # 不会发生:终审不能被选掉。防一手,让流程往下一段走而不是卡住
        entry = workflow.get_next_node()
        if entry is None:
            workflow._finish(ApprovalWorkflowStatus.COMPLETED, now)
            return True
    workflow._enter(entry, now)
    return True


def _apply_pick(workflow, segment, user, skip_ids, reason, now, *, default):
    gate = at_gate(segment, workflow)  # before the state below changes
    nodes = {str(n.pk): n for n in segment.nodes.select_for_update()}
    unknown = sorted(skip_ids - set(nodes))
    if unknown:
        raise SegmentRefusedError("Not a station of this segment", "unknown_node", node_ids=unknown)
    required = sorted(i for i in skip_ids if nodes[i].is_required)
    if required:
        raise SegmentRefusedError("The final review cannot be skipped", "final_required", node_ids=required)
    skipped = {nodes[i].pk for i in skip_ids} | {
        n.pk for n in nodes.values() if n.status == NodeStatus.SKIPPED and n.skip_kind != SkipKind.AT_PICK}
    _refuse_skipped_jump_targets(list(nodes.values()), skipped, {nodes[i].pk for i in skip_ids})
    # 改选:先把上一次选掉的全部放回,再按这一次的选。
    segment.nodes.filter(status=NodeStatus.SKIPPED, skip_kind=SkipKind.AT_PICK).update(
        status=NodeStatus.PENDING, skip_kind=None, skipped_by=None, skip_reason="", decided_at=None)
    if skip_ids:
        ApprovalNode.objects.filter(pk__in=skip_ids).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.AT_PICK, skipped_by=user, skip_reason=reason or "",
            decided_at=now)
    first_pick = segment.state == SegmentState.AWAITING_PICK
    segment.state = SegmentState.PICKED
    segment.picked_by = user if getattr(user, "is_authenticated", False) else None
    segment.picked_at = now
    segment.version += 1
    segment.save(update_fields=["state", "picked_by", "picked_at", "version"])
    skipped_names = [nodes[i].node_name for i in sorted(skip_ids, key=lambda i: nodes[i].node_order)]
    _audit(
        workflow.tenant_id if default else segment.tenant_id, user,
        "workflow.use_default" if default else "workflow.pick", workflow,
        f"{'按默认流程走' if default else '选站'}:{segment.tenant.display_name} 第 {segment.order} 段 — {reason or '-'}",
        {"kind": "default" if default else "picked", "segment": segment.order, "realm": segment.tenant.code,
         "skipped": skipped_names, "restored": [], "reason": reason or "", "first_pick": first_pick},
    )
    resumed = _resume(workflow, segment, now) if gate else False
    workflow.save()
    return resumed


def pick(workflow_id, order, user, *, skip_node_ids, version, reason="", request=None):
    """该段所属域的人为它选站(或在开始之前改选)。返回 (workflow, segment)。"""
    now = timezone.now()
    with transaction.atomic():
        workflow, segment = _locked(workflow_id, order)
        if segment.order == 1:
            raise SegmentRefusedError("This realm's own stations are picked when the flow is generated", "not_foreign")
        if not can_pick(user, segment, request):
            raise SegmentRefusedError("Only this realm's judges or hall admins pick its stations", "not_allowed", status=403)
        if segment.state == SegmentState.SKIPPED:
            raise SegmentRefusedError("This segment was skipped", "segment_closed", status=409)
        _check_version(segment, version)
        if segment.state == SegmentState.PICKED and started(segment, workflow):
            raise SegmentRefusedError("This segment has started; change stations instead", "segment_started", status=409)
        resumed = _apply_pick(workflow, segment, user, {str(i) for i in skip_node_ids}, reason, now, default=False)
        transaction.on_commit(lambda: _after_pick(workflow.pk, resumed))
    return workflow, segment


def use_default(workflow_id, order, user, reason, request=None):
    """召集殿管理员替一个外域选全部站并继续(第 6 条规则)。理由必填、记审计、通知那个域。"""
    if not (reason or "").strip():
        raise SegmentRefusedError("A reason is required", "reason_required")
    now = timezone.now()
    with transaction.atomic():
        workflow, segment = _locked(workflow_id, order)
        if not is_convener_admin(user, workflow, request):
            raise SegmentRefusedError("Only the convening hall's admins may do this", "not_allowed", status=403)
        if segment.state != SegmentState.AWAITING_PICK:
            raise SegmentRefusedError("This segment is not waiting for a pick", "not_awaiting", status=409)
        overdue = segment.gate_reached_at is not None and now - segment.gate_reached_at >= timedelta(days=OVERDUE_DAYS)
        if not overdue and pickers(segment.tenant_id):
            raise SegmentRefusedError(f"Allowed after {OVERDUE_DAYS} days at the gate, or when the realm has no picker",
                                 "too_early", status=409)
        resumed = _apply_pick(workflow, segment, user, set(), reason.strip(), now, default=True)
        recipients, params = pick_recipients(segment.tenant_id), {
            "soul": workflow.soul.name, "by": _name(user) or "-", "added": segment.nodes.count(), "skipped": 0,
            "reason": reason.strip()}

        def after():
            _tell(recipients, "workflow_nodes_adjusted", params, workflow, push=False)
            _after_pick(workflow.pk, resumed)

        transaction.on_commit(after)
    return workflow, segment


def adjust(workflow_id, user, *, restore_node_ids, skip_node_ids, reason, version, request=None):
    """加减站(第 5 条规则):只改一段、只改当前站之后的站;终审锁定;理由必填;记审计;通知被改到的站的审批人。"""
    restore, skip = {str(i) for i in restore_node_ids}, {str(i) for i in skip_node_ids}
    if not (reason or "").strip():
        raise SegmentRefusedError("A reason is required", "reason_required")
    if not restore and not skip:
        raise SegmentRefusedError("Nothing to change", "nothing_to_change")
    if restore & skip:
        raise SegmentRefusedError("A station cannot be both restored and skipped", "conflicting_change")
    now = timezone.now()
    with transaction.atomic():
        workflow, _ = _locked(workflow_id)
        nodes = {str(n.pk): n for n in ApprovalNode.objects.select_for_update().filter(
            workflow=workflow, pk__in=restore | skip)}
        if len(nodes) != len(restore | skip):
            raise SegmentRefusedError("Not a station of this flow", "unknown_node",
                                 node_ids=sorted((restore | skip) - set(nodes)))
        segment_ids = {n.segment_id for n in nodes.values()}
        if len(segment_ids) != 1 or None in segment_ids:
            raise SegmentRefusedError("Change one realm's stations at a time", "one_segment")
        segment = WorkflowSegment.objects.select_for_update(of=("self",)).select_related("tenant").get(pk=segment_ids.pop())
        if not can_adjust(user, workflow, segment, request):
            raise SegmentRefusedError("Only the current approver or this realm's hall admins change stations",
                                 "not_allowed", status=403)
        _check_version(segment, version)
        if segment.state == SegmentState.AWAITING_PICK:
            raise SegmentRefusedError("This realm has not picked its stations yet", "not_picked", status=409)
        if segment.state == SegmentState.SKIPPED:
            raise SegmentRefusedError("This segment was skipped", "segment_closed", status=409)
        current = workflow.current_node
        here = current is not None and current.segment_id == segment.pk
        if not here and started(segment, workflow):
            raise SegmentRefusedError("This segment is done", "segment_done", status=409)
        locked = sorted(i for i in nodes if here and nodes[i].node_order <= current.node_order)
        if locked:
            raise SegmentRefusedError("Only stations after the current one can change", "node_locked", status=409,
                                 node_ids=locked)
        not_skipped = sorted(i for i in restore if nodes[i].status != NodeStatus.SKIPPED
                             or nodes[i].skip_kind not in RESTORABLE_SKIPS)
        not_pending = sorted(i for i in skip if nodes[i].status != NodeStatus.PENDING)
        if not_skipped or not_pending:
            raise SegmentRefusedError("A station is no longer in the state you saw", "node_changed", status=409,
                                 node_ids=not_skipped + not_pending)
        required = sorted(i for i in skip if nodes[i].is_required)
        if required:
            raise SegmentRefusedError("The final review cannot be skipped", "final_required", node_ids=required)
        # 加回一个来源而它的目标还跳过着:拒,不顺手加回目标(2026-10-19)。客户端勾回来源时自己把目标一并加回。
        everyone = list(segment.nodes.all())
        skipped = {n.pk for n in everyone if n.status == NodeStatus.SKIPPED and str(n.pk) not in restore} | {
            nodes[i].pk for i in skip}
        _refuse_skipped_jump_targets(everyone, skipped, {n.pk for n in nodes.values()})

        ApprovalNode.objects.filter(pk__in=restore).update(
            status=NodeStatus.PENDING, skip_kind=None, skipped_by=None, skip_reason="", decided_at=None)
        ApprovalNode.objects.filter(pk__in=skip).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.LATER, skipped_by=user, skip_reason=reason.strip(),
            decided_at=now)
        segment.version += 1
        segment.save(update_fields=["version"])
        ordered = sorted(nodes.values(), key=lambda n: n.node_order)
        added = [n.node_name for n in ordered if str(n.pk) in restore]
        skipped = [n.node_name for n in ordered if str(n.pk) in skip]
        _audit(segment.tenant_id, user, "workflow.adjust", workflow,
               f"加减站:{segment.tenant.display_name} 第 {segment.order} 段 — {reason.strip()}",
               {"kind": "adjusted", "segment": segment.order, "realm": segment.tenant.code,
                "restored": added, "skipped": skipped, "reason": reason.strip()})
        workflow.save(update_fields=["updated_at"])

        from apps.workflow.services import WorkflowService

        told = {u.pk: u for n in ordered for u in WorkflowService.designated_users(n, workflow.tenant_id)}
        params = {"soul": workflow.soul.name, "by": _name(user) or "-", "added": ", ".join(added) or "-",
                  "skipped": ", ".join(skipped) or "-", "reason": reason.strip()}
        transaction.on_commit(lambda: _tell(told.values(), "workflow_nodes_adjusted", params, workflow, push=False))
    return workflow, segment


def remind(workflow_id, order, user, request=None):
    """「再提醒一次」:召集殿的人,每段每小时一次。"""
    from apps.core.tenant import is_tenant_exempt

    now = timezone.now()
    with transaction.atomic():
        workflow, segment = _locked(workflow_id, order)
        if not (is_tenant_exempt(user) or _user_tenant_id(user, request) == workflow.tenant_id):
            raise SegmentRefusedError("Only the convening hall sends reminders", "not_allowed", status=403)
        if segment.state != SegmentState.AWAITING_PICK:
            raise SegmentRefusedError("This segment is not waiting for a pick", "not_awaiting", status=409)
        if segment.last_reminded_at is not None and now - segment.last_reminded_at < REMIND_INTERVAL:
            wait = REMIND_INTERVAL - (now - segment.last_reminded_at)
            raise SegmentRefusedError("Reminded less than an hour ago", "remind_too_soon", status=429,
                                 retry_after=int(wait.total_seconds()) + 1)
        segment.last_reminded_at = now
        segment.save(update_fields=["last_reminded_at"])
        transaction.on_commit(lambda: notify_segment(workflow.pk, segment.pk))
    return segment


# ── 跨域审判的两头 ───────────────────────────────────────────────────────


def on_workflow_finished(workflow, status, end_reason=""):
    """`ApprovalWorkflow._finish` 调:并入了跨域审判的流程走完 = 审判以 PASS 结束,被驳回 = FAIL(第 7 条规则)。
    同一事务。PASS 照跑参与方的站的校验(没填完就拒,决定回滚);FAIL 不查 —— 否决用不到那些站。"""
    if status not in (ApprovalWorkflowStatus.COMPLETED, ApprovalWorkflowStatus.REJECTED):
        return
    if end_reason == END_REASON_CANCELLED or workflow.judgment_id is None:
        return
    if not workflow.segments.filter(order__gt=1).exists():
        return
    from apps.dispatch.models import JudgmentStatus
    from apps.dispatch.services import CrossTenantJudgmentService

    cross = cross_of(workflow)
    if cross is None or cross.status not in (JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE):
        return
    passed = status == ApprovalWorkflowStatus.COMPLETED
    try:
        if cross.status == JudgmentStatus.PROPOSED:
            CrossTenantJudgmentService.activate(cross)
        CrossTenantJudgmentService.conclude(cross, "PASS" if passed else "FAIL", None, check=passed,
                                            by_workflow=True)
    except ValueError as exc:
        raise CrossConclusionRefusedError(str(exc)) from exc


def lock_workflow_of(cross):
    """跨域审判这一头先锁流程行(锁序:流程 → 跨域审判,与审批那一头相同)。"""
    if cross.judgment_id is None:
        return None
    return ApprovalWorkflow._base_manager.select_for_update().filter(judgment_id=cross.judgment_id).first()


def on_cross_cancelled(workflow, cross, user, reason):
    """跨域审判取消(第 7 条规则):还没开始的外域段全部跳过(CANCELLED),撤回未选站的待办;流程正在某个外域段里时,
    那一段当前站与之后的站(含终审)也跳过,流程随即结束。在取消的事务里,调用方已锁流程行。
    这样结束的流程是 CANCELLED(用户 2026-10-29,审查 C):不算走完、不算通过,不触发完成钩子(`_finish`);
    原审的处置照旧等着(`weighing.unfinished_flow` 的 `approval_cancelled`)。本域还没走完时取消,外域段跳过,
    本域照常走到底 —— 那是一次真的走完(COMPLETED,`end_reason` 为空)。"""
    if workflow is None or workflow.status in TERMINAL_WORKFLOW_STATUSES:
        return
    now = timezone.now()
    current = workflow.current_node
    end_now = False
    withdrawn = []
    for segment in workflow.segments.select_for_update().filter(order__gt=1).order_by("order"):
        if current is not None and current.segment_id == segment.pk:
            end_now = True
        elif started(segment, workflow):
            continue
        if segment.state == SegmentState.AWAITING_PICK:
            withdrawn.append(segment.tenant_id)
        segment.nodes.filter(status=NodeStatus.PENDING).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.CANCELLED, skipped_by=user if getattr(
                user, "is_authenticated", False) else None, skip_reason=reason or "", decided_at=now)
        segment.state = SegmentState.SKIPPED
        segment.version += 1
        segment.save(update_fields=["state", "version"])
    if end_now:
        workflow._finish(ApprovalWorkflowStatus.CANCELLED, now, end_reason=END_REASON_CANCELLED)
    elif workflow.current_node_id is None:
        # 正站在某个外域段门口(已跳过):往下走;后面没有了就结束。
        nxt = workflow.get_next_node()
        if nxt is None:
            workflow._finish(ApprovalWorkflowStatus.CANCELLED, now, end_reason=END_REASON_CANCELLED)
        else:
            workflow._enter(nxt, now)
    workflow.save()
    if withdrawn:
        params = {"soul": workflow.soul.name, "title": cross.title}

        def after():
            for tenant_id in withdrawn:
                _tell(pick_recipients(tenant_id), "workflow_pick_withdrawn", params, workflow, push=False)

        transaction.on_commit(after)


# ── 通知 ────────────────────────────────────────────────────────────────


def _tell(users, kind, params, workflow, push=True):
    """站内通知(WORKFLOW_ASSIGNED 的一个变体,读时按语言重渲染)+ 官员端推送(落到「待我选站」)。提交之后调。"""
    from apps.events.services import EventService
    from apps.notifications import messages

    users = list(users)
    params = {**params, "kind": kind}
    title, body = messages.render(messages.DEFAULT_LOCALE, kind, params)
    for user in users:
        EventService.notify_user(user, title=title, message=body, notification_type="WORKFLOW_ASSIGNED",
                                 related_resource="workflow", related_id=str(workflow.pk), params=params)
    if push and users:
        from apps.officer_app.push import notify_users

        notify_users(users, target={"kind": "pick", "id": str(workflow.pk)})


def _realm(tenant):
    return tenant.display_name or tenant.code


def _realm_params(tenant):
    """通知里的域:`realm_civ` 让 `messages.render` 按收件人的语言换成文明名(中国 / 埃及 …,同客户端的分段头);
    `realm` 是租户展示名(库里的英文),只给认不出文明的租户作退路。"""

    civ = tenant.known_civilization
    return {"realm": _realm(tenant), **({"realm_civ": str(civ)} if civ else {})}


def notify_pick_tasks(workflow_id):
    """流程发起:每个外域同时收到「选站」待办(`workflow_pick_nodes`)。"""
    workflow = ApprovalWorkflow._base_manager.select_related("soul", "tenant").get(pk=workflow_id)
    for segment in workflow.segments.filter(state=SegmentState.AWAITING_PICK).select_related("tenant"):
        _tell(pick_recipients(segment.tenant_id), "workflow_pick_nodes",
              {"soul": workflow.soul.name, **_realm_params(workflow.tenant), "order": segment.order}, workflow)


def notify_segment(workflow_id, segment_id):
    """提醒一个外域:流程已在它门口时用 `workflow_pick_waiting`(走完的是前一段的域),还没到时重发 `workflow_pick_nodes`。"""
    workflow = ApprovalWorkflow._base_manager.select_related("soul", "tenant").get(pk=workflow_id)
    segment = WorkflowSegment.objects.select_related("tenant").get(pk=segment_id)
    if segment.state != SegmentState.AWAITING_PICK:
        return
    if segment.gate_reached_at is None:
        _tell(pick_recipients(segment.tenant_id), "workflow_pick_nodes",
              {"soul": workflow.soul.name, **_realm_params(workflow.tenant), "order": segment.order}, workflow)
        return
    before = workflow.segments.filter(order__lt=segment.order).select_related("tenant").order_by("-order").first()
    _tell(pick_recipients(segment.tenant_id), "workflow_pick_waiting",
          {"soul": workflow.soul.name, **_realm_params(before.tenant if before else workflow.tenant)}, workflow)


def notify_waiting(workflow_id, segment_id):
    """到门口时提醒一次(`ApprovalWorkflow._stop_at_gate`,提交之后)。"""
    notify_segment(workflow_id, segment_id)


def _after_pick(workflow_id, resumed):
    """选站之后:流程若因此从门口继续,告诉新的当前站的审批人。"""
    if not resumed:
        return
    from apps.workflow.services import WorkflowService

    WorkflowService.announce(ApprovalWorkflow._base_manager.get(pk=workflow_id))


def remind_due(tenant, now=None):
    """定时任务(每天):本殿发起、停在外域门口的流程 —— 每天提醒那个域一次;满 `OVERDUE_DAYS` 天告诉本殿管理员一次。
    条件写在 UPDATE 里,两次运行重叠也只发一次。返回 {reminded, overdue}。"""
    now = now or timezone.now()
    counts = {"reminded": 0, "overdue": 0}
    rows = (WorkflowSegment.objects.filter(
        workflow__tenant=tenant, workflow__status=ApprovalWorkflowStatus.IN_PROGRESS,
        workflow__current_node__isnull=True, state=SegmentState.AWAITING_PICK, gate_reached_at__isnull=False,
    ).select_related("workflow__soul", "tenant"))
    for segment in rows:
        if segment.last_reminded_at is None or now - segment.last_reminded_at >= DAILY_REMINDER:
            if WorkflowSegment.objects.filter(pk=segment.pk, last_reminded_at=segment.last_reminded_at).update(
                    last_reminded_at=now):
                notify_segment(segment.workflow_id, segment.pk)
                counts["reminded"] += 1
        if segment.overdue_notified_at is None and now - segment.gate_reached_at >= timedelta(days=OVERDUE_DAYS):
            if WorkflowSegment.objects.filter(pk=segment.pk, overdue_notified_at__isnull=True).update(
                    overdue_notified_at=now):
                workflow = segment.workflow
                _tell(hall_admins(workflow.tenant_id), "workflow_pick_overdue",
                      {"soul": workflow.soul.name, **_realm_params(segment.tenant), "n": gate_days(segment, now)},
                      workflow, push=False)
                counts["overdue"] += 1
    return counts


# ── 读 ──────────────────────────────────────────────────────────────────


def foreign_workflows(qs, scope):
    """`qs` 里本租户作为参与域有一段的流程。**跨租户读审批流只经这里**:成员关系就是 `WorkflowSegment.tenant`,
    而外域段只由 `add_foreign` 按跨域审判的参与方建。全局 ADMIN 本来就看得到全部,这里给空集。"""
    from apps.core.tenant import is_tenant_exempt

    user = getattr(scope, "user", None)
    tenant = getattr(scope, "tenant", None)
    if user is None or not getattr(user, "is_authenticated", False) or is_tenant_exempt(user) or tenant is None:
        return qs.none()
    return qs.filter(pk__in=WorkflowSegment.objects.filter(tenant=tenant).values("workflow_id"))


def is_party(workflow, tenant):
    return tenant is not None and WorkflowSegment.objects.filter(workflow=workflow, tenant=tenant).exists()


def viewer_tenant_id(request, workflow):
    """读详情的人属于哪个域:None = 全局 ADMIN(都看得到)。没有请求(服务内部序列化)按流程所属殿看。"""
    from apps.core.tenant import is_tenant_exempt

    if request is None:
        return workflow.tenant_id
    user = getattr(request, "user", None)
    if is_tenant_exempt(user):
        return None
    return _user_tenant_id(user, request)


def segment_row(segment, workflow, request=None, now=None):
    """`WorkflowSegmentSerializer` 的那一行。别的域的选站人名字不给(外域人员信息不外露)。"""
    now = now or timezone.now()
    viewer = viewer_tenant_id(request, workflow)
    user = getattr(request, "user", None)
    nodes = list(segment.nodes.all())
    gate = at_gate(segment, workflow)
    no_picker = segment.state == SegmentState.AWAITING_PICK and not pickers(segment.tenant_id)
    overdue = gate and now - segment.gate_reached_at >= timedelta(days=OVERDUE_DAYS)
    current = workflow.current_node
    return {
        "order": segment.order,
        "is_local": segment.order == 1,
        "tenant_code": segment.tenant.code,
        "realm_name": _realm(segment.tenant),
        "civilization": segment.civilization,
        "name": segment.name,
        "state": phase(segment, workflow),
        "go": sum(1 for n in nodes if n.status != NodeStatus.SKIPPED),
        "total": len(nodes),
        "default_node_count": segment.default_node_count,
        "version": segment.version,
        "picked_at": segment.picked_at,
        "picked_by_name": (_name(segment.picked_by)
                           if segment.picked_by_id and (viewer is None or viewer == segment.tenant_id) else None),
        "at_gate": gate,
        "gate_days": gate_days(segment, now) if gate else None,
        "no_picker": no_picker,
        "current_order_in_segment": (
            sum(1 for n in nodes if n.node_order <= current.node_order)
            if current is not None and current.segment_id == segment.pk else None),
        "can_pick": bool(user) and segment.order > 1 and segment.state != SegmentState.SKIPPED
        and workflow.status not in TERMINAL_WORKFLOW_STATUSES and can_pick(user, segment, request)
        and (segment.state == SegmentState.AWAITING_PICK or not started(segment, workflow)),
        "can_use_default": bool(user) and segment.state == SegmentState.AWAITING_PICK
        and is_convener_admin(user, workflow, request) and (no_picker or overdue),
        "can_remind": bool(user) and segment.state == SegmentState.AWAITING_PICK
        and viewer in (None, workflow.tenant_id),
    }


def segment_rows(workflow, request=None):
    now = timezone.now()
    return [segment_row(s, workflow, request, now)
            for s in workflow.segments.select_related("tenant", "picked_by").prefetch_related("nodes").order_by("order")]


def can_adjust_any(workflow, request):
    """详情页「加减站」入口:请求者能改某一段、且那一段还有可改的站。"""
    user = getattr(request, "user", None)
    if user is None or workflow.status in TERMINAL_WORKFLOW_STATUSES:
        return False
    for segment in workflow.segments.exclude(state__in=(SegmentState.AWAITING_PICK, SegmentState.SKIPPED)):
        current = workflow.current_node
        here = current is not None and current.segment_id == segment.pk
        if (here or not started(segment, workflow)) and can_adjust(user, workflow, segment, request):
            return True
    return False


def history(workflow, request=None):
    """「选站」「加减站」两类记录(审计行),时间顺序。别的域的人名不给。"""
    from apps.audit.models import AuditLog

    viewer = viewer_tenant_id(request, workflow)
    rows = (AuditLog.objects.filter(resource__in=("workflow.pick", "workflow.adjust", "workflow.use_default"),
                                    resource_id=str(workflow.pk))
            .select_related("user").order_by("timestamp"))
    out = []
    for row in rows:
        changes = row.changes or {}
        out.append({
            "kind": changes.get("kind", ""),
            "segment": changes.get("segment"),
            "realm": changes.get("realm", ""),
            "actor": _name(row.user) if viewer is None or viewer == row.tenant_id else None,
            "at": row.timestamp,
            "restored": changes.get("restored", []),
            "skipped": changes.get("skipped", []),
            "reason": changes.get("reason", ""),
        })
    return out


def cross_summary(workflow, request=None):
    """跨域审判页顶部那一条(W-4):走到哪一域哪一站、已定 / 已走几站、哪些域还没选站。"""
    current = workflow.current_node
    segments = list(workflow.segments.select_related("tenant").order_by("order"))
    nodes = list(workflow.nodes.all())
    picked = {s.pk for s in segments if s.state in (SegmentState.LOCAL_PICKED, SegmentState.PICKED)}
    by_pk = {s.pk: s for s in segments}
    gate = next((s for s in segments if at_gate(s, workflow)), None)
    at = None
    if current is not None and current.segment_id in by_pk:
        seg = by_pk[current.segment_id]
        at = {"segment": seg.order, "realm_name": _realm(seg.tenant), "node_name": current.node_name,
              "hall": current.court_code}
    return {
        "id": str(workflow.pk),
        "number": workflow.number,
        "status": workflow.status,
        "at": at,
        "at_gate": {"segment": gate.order, "realm_name": _realm(gate.tenant), "days": gate_days(gate)} if gate else None,
        "fixed": sum(1 for n in nodes if n.segment_id in picked and n.status != NodeStatus.SKIPPED),
        "done": sum(1 for n in nodes if n.status in (NodeStatus.APPROVED, NodeStatus.TRAVERSED, NodeStatus.ESCALATED)),
        "pending_realms": [_realm(s.tenant) for s in segments if s.state == SegmentState.AWAITING_PICK],
        "segments": [segment_row(s, workflow, request) for s in segments],
    }


def pick_tasks(scope, now=None):
    """「待我选站」:本域还没选站的外域段(流程没结束),给能选站的人(没有时给殿管理员)。在门口等的排最前。"""
    tenant, user = getattr(scope, "tenant", None), scope.user
    if tenant is None or user.pk not in {u.pk for u in pick_recipients(tenant.pk)}:
        return []
    now = now or timezone.now()
    rows = (WorkflowSegment.objects.filter(
        tenant=tenant, state=SegmentState.AWAITING_PICK,
        workflow__status__in=(ApprovalWorkflowStatus.PENDING, ApprovalWorkflowStatus.IN_PROGRESS),
    ).select_related("workflow__soul", "workflow__tenant", "workflow__judgment").prefetch_related("nodes")
        .order_by(F("gate_reached_at").asc(nulls_last=True), "created_at"))
    out = []
    for segment in rows:
        workflow = segment.workflow
        gate = at_gate(segment, workflow)
        out.append({
            "segment": segment,
            "workflow": workflow,
            "go": sum(1 for n in segment.nodes.all() if n.status != NodeStatus.SKIPPED),
            "total": len(segment.nodes.all()),
            "gate_days": gate_days(segment, now) if gate else None,
            "stations_ahead": None if gate else workflow.nodes.filter(
                status=NodeStatus.PENDING, segment__order__lt=segment.order).count(),
        })
    return out
