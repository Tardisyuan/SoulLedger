"""数据范围求解器(数据范围设计 B2,数据范围设计稿(不在仓库里)「注册表」「执行点」)。

一行可见 = 殿级隔离之后(`scope_to_tenant` 先跑),再满足下面任一条:
  * 持有的某个角色对这项业务配成了「全部」;或者**所有**角色对这项业务都没有配置行(都没配 = 全部,上线行为不变)。
    只要有一个角色配了,没配的那个角色不贡献「全部」(审计 P-12,用户 2026-11-11,见 `org_ids`);
  * 行的归属机构落在各角色机构集合的并集里(ORG = 本机构;ORG_CHILD = 本机构及下级;
    DEFINE = 所列机构**及其下级**;SELF = 空集);
  * 本人创建或被指派(`user_paths`)—— 任何范围下都可见,防流程卡死;
  * 业务自带的额外条件(`extra_q`,如流程的「待我审批」)。

角色 = 主角色 + 兼任(`live_extra_roles` 已去掉回收站里的);某角色在回收站时,它的配置行不算。
按业务覆盖(`resource=<key>`)优先于角色默认(`resource=""`)。ADMIN 跳过:绑殿 = 本殿全部,
无殿 = 全局,那是殿级隔离(`is_tenant_exempt`)的事。

注册表按 `app_label.Model` 键,不 import 模型 —— 这个模块被 serializers / views 在模块级间接引入。
"""
from collections.abc import Callable
from dataclasses import dataclass
from typing import NamedTuple

from django.db.models import Q

from apps.core.tenant import ADMIN_ROLES
from apps.core.versioned import VersionedMemo

ALL, ORG_CHILD, ORG, SELF, DEFINE = "ALL", "ORG_CHILD", "ORG", "SELF", "DEFINE"


def _awaiting_me(user) -> Q:
    """「待我审批」:进行中、当前节点待决、按角色或按实体指定给我(与 `officer_app/todo.py::_waiting_workflows` 同一条)。"""
    from apps.perm.checker import live_extra_roles

    roles = [r for r in (getattr(user, "role", None), *live_extra_roles(user)) if r]
    mine = Q(current_node__approver_type="ROLE", current_node__approver_role__in=roles)
    if getattr(user, "actor_id", None):
        mine |= Q(current_node__approver_type="ACTOR", current_node__approver_actor_id=user.actor_id)
    waiting = Q(status="IN_PROGRESS", current_node__status="PENDING")
    return (mine & waiting) | Q(pk__in=_cosigning_me(user, waiting))


def _cosigning_me(user, waiting) -> list:
    """加签人(还没签)与会签候选人(还有一格可签)也算「待我审批」(用户 2026-10-29),与 todo 同一个口径:
    候选 = 当前节点是会签或带加签,再逐条问 `can_approve`。槽位在 JSON 里,SQLite 不支持 JSON 包含查询,
    所以在 Python 里判。只看本殿召集或当前站在本殿的流程。"""
    from apps.workflow.models import ApprovalWorkflow, NodeKind

    candidates = ApprovalWorkflow.objects.filter(
        waiting, Q(current_node__kind=NodeKind.COUNTERSIGN) | ~Q(current_node__cosigners_json=[]))
    tenant_id = getattr(user, "tenant_id", None)
    if tenant_id is not None:
        from apps.core.shard_reads import crossing_q

        # The segment through the crossing key ApprovalNode.segment, read by ids (`crossing_q`).
        candidates = candidates.filter(Q(tenant_id=tenant_id) | crossing_q(
            ApprovalWorkflow, "current_node__segment__tenant_id", tenant_id))
    # ponytail: 逐条 can_approve,候选只限进行中的会签 / 加签节点;量大时把槽位拆成表再写成 SQL。
    return [wf.pk for wf in candidates.select_related("current_node__segment") if wf.current_node.can_approve(user)]


@dataclass(frozen=True)
class Entry:
    resource: str
    org_path: str
    user_paths: tuple = ()
    extra_q: Callable | None = None


REGISTRY = {
    "souls.Soul": Entry("soul", "owner_org", ("create_user",)),
    "judgment.Judgment": Entry("judgment", "owner_org", ("create_user", "claimed_by", "concluded_by", "city_god__officers")),
    "disposition.Disposition": Entry("disposition", "judgment__owner_org", ("create_user", "judgment__claimed_by")),
    "reincarnation.Reincarnation": Entry("reincarnation", "soul__owner_org"),
    "events.SoulEvent": Entry("soul_event", "soul__owner_org"),
    "dispatch.CaptureWarrant": Entry("capture", "soul__owner_org", ("create_user", "city_god__officers")),
    "judgment.JudgmentAppeal": Entry("appeal", "judgment__owner_org", ("create_user", "reviewer")),
    "workflow.ApprovalWorkflow": Entry("workflow", "soul__owner_org", ("create_user",), _awaiting_me),
    "workflow.ApprovalNode": Entry("workflow", "workflow__soul__owner_org", ("approver",)),
    "authentication.User": Entry("user", "organization", ("pk",)),
    "org.Organization": Entry("org", "pk"),
}


def entry_for(model):
    return REGISTRY.get(model._meta.label)


def _multi_valued(model, path) -> bool:
    """路径上有没有多值关系(M2M / 反向外键)。有就得写成 `pk__in` 子查询,否则 join 会让行重复。"""
    for name in path.split("__"):
        if name == "pk":
            return False
        field = model._meta.get_field(name)
        if field.many_to_many or field.one_to_many:
            return True
        if not field.is_relation:
            return False
        model = field.related_model
    return False


def _single_valued_prefix(model, path):
    """路径开头那段单值外键(`city_god__officers` → `("city_god", CityGod)`);第一跳就多值 → `("", model)`。"""
    parts = []
    for name in path.split("__"):
        field = model._meta.get_field(name)
        if field.many_to_many or field.one_to_many or not field.is_relation:
            break
        parts.append(name)
        model = field.related_model
    return "__".join(parts), model


def _user_q(model, path, user, cache=None) -> Q:
    if not _multi_valued(model, path):
        return _q(model, path, user.pk)
    prefix, related = _single_valued_prefix(model, path)
    if not prefix:
        return Q(pk__in=model._base_manager.filter(**{path: user.pk}).values("pk"))
    # 多值关系前面有单值外键(城隍 officers):先取出「我在其中」的那几个外键 id(通常 0–2 个),写成
    # `city_god__in=[…]`。主表上那就是 `= ANY(数组)`,和本机构条件一起走 BitmapOr。写成 `pk__in=(子查询)` 时,
    # 它是 OR 里的 hashed SubPlan,规划器只能整表扫审判(B8 实测,1 万审判)。
    rest = path[len(prefix) + 2:]
    key = ("user_q", related._meta.label, rest, user.pk)
    cache = {} if cache is None else cache
    if key not in cache:
        cache[key] = list(related._base_manager.filter(**{rest: user.pk}).values_list("pk", flat=True))
    return Q(**{f"{prefix}__in": cache[key]})


#: Every live role's rules and each hall's org tree, one copy per process, current while the state cache's version
#: `v:datascope` is unchanged (apps/core/versioned.py; review 2026-11-16). Any save / delete of a RoleDataScope (and
#: its orgs), a Role or an Organization bumps it (`_bump` below, connected in apps/perm/apps.py). Before: 3 queries
#: per officer request under a configured scope (rules, their orgs, the hall's whole org table).
_shared = VersionedMemo("datascope")


class Rule(NamedTuple):
    scope: str
    org_ids: tuple


def _bump(sender=None, using=None, **_kwargs):
    _shared.bump(using=using)


def connect_invalidation():
    from django.db.models.signals import m2m_changed, post_delete, post_save

    for model in ("perm.RoleDataScope", "perm.Role", "org.Organization"):
        post_save.connect(_bump, sender=model, dispatch_uid=f"datascope-save-{model}")
        post_delete.connect(_bump, sender=model, dispatch_uid=f"datascope-delete-{model}")
    from apps.perm.models import RoleDataScope

    m2m_changed.connect(_bump, sender=RoleDataScope.orgs.through, dispatch_uid="datascope-orgs")
    _shared.watch("perm.RoleDataScope", "perm.Role", "org.Organization", RoleDataScope.orgs.through._meta.label)


def _tree(tenant_id) -> dict:
    """本殿机构 parent → [子] 表,一次查询。
    # ponytail: 整殿 (id, parent_id) 广搜,每版本每进程一次;机构上千再给 Organization 加 path 列改前缀查询。
    """
    from apps.org.models import Organization

    rows = Organization._base_manager.filter(is_deleted=False)
    if tenant_id is not None:
        rows = rows.filter(tenant_id=tenant_id)
    children = {}
    for pk, parent in rows.values_list("id", "parent_id"):
        children.setdefault(parent, []).append(pk)
    return children


def _children(user, cache) -> dict:
    """本殿机构 parent → [子] 表(按殿存在进程副本里,键带殿 id),请求上再备忘一份。"""
    key = ("children", getattr(user, "tenant_id", None))
    if key not in cache:
        cache[key] = _shared.get(("tree", key[1]), lambda: _tree(key[1]))
    return cache[key]


def _with_descendants(roots, user, cache) -> set:
    """`roots` 加上它们在本殿的全部下级。别殿的机构(DEFINE 可跨殿挑)原样留着,殿级隔离会滤掉。"""
    children = _children(user, cache)
    seen, todo = set(roots), list(roots)
    while todo:
        for child in children.get(todo.pop(), ()):
            if child not in seen:
                seen.add(child)
                todo.append(child)
    return seen


def _all_rules() -> dict:
    """{角色名: {resource: Rule}},全部活角色的活配置行(进程副本 `_shared` 的内容)。"""
    from apps.perm.models import RoleDataScope

    out = {}
    rows = list(RoleDataScope.objects.filter(role__is_deleted=False).select_related("role"))
    orgs = org_ids_of(rows)
    for row in rows:
        out.setdefault(row.role.name, {})[row.resource] = Rule(row.scope, tuple(orgs[row.pk]))
    return out


def org_ids_of(rows) -> dict:
    """{RoleDataScope pk: [organization ids, sorted]}, read from the through table alone (CONTROL, like the rows).

    Not `prefetch_related("orgs")`: that reads Organization -- a SHARD model -- joined to the through table, which no
    shard has; with civilizations write-cut it is NoShardContext ("a read across every shard through a path that
    cannot merge"), and `PUT roles/<pk>/data-scope/` was a 500 (tests/test_audit_rows_have_one_entry.py)."""
    from apps.perm.models import RoleDataScopeOrg

    out = {r.pk: [] for r in rows}
    for scope_id, org_id in (RoleDataScopeOrg.objects.filter(roledatascope_id__in=list(out))
                             .order_by("organization_id").values_list("roledatascope_id", "organization_id")):
        out[scope_id].append(org_id)
    return out


def _rows(user, cache) -> dict:
    """{角色名: {resource: Rule}},只含活角色的活配置行。按人存在 cache
    (`visible_to(目标用户, 行)` 与请求人共用一份 cache)。"""
    key = ("rows", user.pk)
    if key not in cache:
        from apps.perm.checker import live_extra_roles

        names = [r for r in (getattr(user, "role", None), *live_extra_roles(user)) if r]
        rules = _shared.get("rules", _all_rules)
        cache[key] = {name: dict(rules.get(name, {})) for name in names}
    return cache[key]


def org_ids(user, resource, cache=None):
    """这个人对 `resource` 能看的机构 id 集合;None = 不限。"""
    cache = {} if cache is None else cache
    if getattr(user, "role", None) in ADMIN_ROLES:
        return None
    by_role = _rows(user, cache)
    if not by_role:
        return None  # 没有角色 = 没有配置行 = 全部(权限检查另管)
    # 兼任的合并规则(审计 P-12,用户 2026-11-11):只有**所有**角色(主角色 + 兼任)对这项业务都没配,才是「全部」。
    # 只要有一个角色配了范围,没配的角色不贡献「全部」,结果是配了的那些角色的并集 —— 否则给本机构的判官
    # 兼一个没配范围的访客,他就看到全殿。配成 ALL 的(按业务覆盖的 ALL 行)仍然是全部。
    # 显式设成「全部」的默认范围 2026-11-12 起存一行 ALL(`data_scope_api.replace_role_config`),所以它算全部;
    # 此前设的「默认 ALL」没有行,与「没配」分不出,按没配算(不做迁移补行)。
    ids, configured = set(), False
    for rows in by_role.values():
        row = rows.get(resource) or rows.get("")
        if row is None:
            continue
        configured = True
        if row.scope == ALL:
            return None
        own = getattr(user, "organization_id", None)
        if row.scope in (ORG, ORG_CHILD) and own:
            ids |= {own} if row.scope == ORG else _with_descendants([own], user, cache)
        elif row.scope == DEFINE:
            ids |= _with_descendants(row.org_ids, user, cache)
    return ids if configured else None


def _q(model, lookup, value) -> Q:
    """`Q(**{lookup: value})`; with `model`, a crossing key on the path (`soul__owner_org` on a reincarnation) is
    read by ids instead of joined -- a shard refuses that join (apps/core/shard_reads.py `crossing_q`).
    ponytail: sharded, the souls of the scoped organizations go into the SQL as ids; a big organization wants
    the owner organization denormalized onto the row."""
    if model is None:
        return Q(**{lookup: value})
    from apps.core.shard_reads import crossing_q

    return crossing_q(model, lookup, value)


def visible_q(user, resource, org_path, user_paths=(), extra_q=None, *, model=None, cache=None):
    """`user` 对这项业务可见行的 Q;None = 不限(调用方原样返回 queryset)。
    `user_paths` 里有多值关系时要给 `model`(写成 `pk__in` 子查询);给了 `model`,跨库键上的路径按 id 读(`_q`)。"""
    ids = org_ids(user, resource, cache)
    if ids is None:
        return None
    q = _q(model, f"{org_path}__in", ids)
    for path in user_paths:
        q |= _user_q(model, path, user, cache) if model is not None else Q(**{path: user.pk})
    if extra_q is not None:
        q |= extra_q(user)
    return q


def q_for(user, model, cache=None):
    """注册表里的模型 → 它的 Q;不在注册表或不限 → None。"""
    entry = entry_for(model)
    if entry is None:
        return None
    return visible_q(user, entry.resource, entry.org_path, entry.user_paths, entry.extra_q, model=model, cache=cache)


def visible_to(user, obj, cache=None) -> bool:
    """单行判定(改派 / 交接 / 选审批人、序列化器外键)。不在注册表 = 可见。"""
    q = q_for(user, type(obj), cache)
    if q is None:
        return True
    return type(obj)._base_manager.filter(q, pk=obj.pk).exists()


def request_cache(request) -> dict:
    """一个请求一份缓存(机构树、配置行)。`request` 可以是 DRF Request、Django HttpRequest 或 todo 的 SimpleNamespace。"""
    if request is None:
        return {}
    cache = getattr(request, "_data_scope_cache", None)
    if cache is None:
        cache = {}
        try:
            request._data_scope_cache = cache
        except AttributeError:
            pass
    return cache
