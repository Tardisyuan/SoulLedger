"""数据范围求解器(数据范围设计 B2,local-gates/rbac-2026-10-29/datascope-design.md「注册表」「执行点」)。

一行可见 = 殿级隔离之后(`scope_to_tenant` 先跑),再满足下面任一条:
  * 持有的某个角色对这项业务是「全部」—— 包括这个角色**没有任何配置行**(没配 = 全部,上线行为不变);
  * 行的归属机构落在各角色机构集合的并集里(ORG = 本机构;ORG_CHILD = 本机构及下级;
    DEFINE = 所列机构**及其下级**;SELF = 空集);
  * 本人创建或被指派(`user_paths`)—— 任何范围下都可见,防流程卡死;
  * 业务自带的额外条件(`extra_q`,如流程的「待我审批」)。

角色 = 主角色 + 兼任(`_live_extra_roles` 已去掉回收站里的);某角色在回收站时,它的配置行不算。
按业务覆盖(`resource=<key>`)优先于角色默认(`resource=""`)。ADMIN 跳过:绑殿 = 本殿全部,
无殿 = 全局,那是殿级隔离(`is_tenant_exempt`)的事。

注册表按 `app_label.Model` 键,不 import 模型 —— 这个模块被 serializers / views 在模块级间接引入。
"""
from collections.abc import Callable
from dataclasses import dataclass

from django.db.models import Q

ALL, ORG_CHILD, ORG, SELF, DEFINE = "ALL", "ORG_CHILD", "ORG", "SELF", "DEFINE"


def _awaiting_me(user) -> Q:
    """「待我审批」:进行中、当前节点待决、按角色或按实体指定给我(与 `officer_app/todo.py::_waiting_workflows` 同一条)。"""
    from apps.perm.checker import _live_extra_roles

    roles = [r for r in (getattr(user, "role", None), *_live_extra_roles(user)) if r]
    mine = Q(current_node__approver_type="ROLE", current_node__approver_role__in=roles)
    if getattr(user, "actor_id", None):
        mine |= Q(current_node__approver_type="ACTOR", current_node__approver_actor_id=user.actor_id)
    return mine & Q(status="IN_PROGRESS", current_node__status="PENDING")


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


def _user_q(model, path, user) -> Q:
    if _multi_valued(model, path):
        return Q(pk__in=model._base_manager.filter(**{path: user.pk}).values("pk"))
    return Q(**{path: user.pk})


def _children(user, cache) -> dict:
    """本殿机构 parent → [子] 表,一次查询,存在 cache(请求上)。
    # ponytail: 每请求一次整殿 (id, parent_id) 广搜;机构上千再给 Organization 加 path 列改前缀查询。
    """
    key = ("children", getattr(user, "tenant_id", None))
    if key not in cache:
        from apps.org.models import Organization

        rows = Organization._base_manager.filter(is_deleted=False)
        if key[1] is not None:
            rows = rows.filter(tenant_id=key[1])
        children = {}
        for pk, parent in rows.values_list("id", "parent_id"):
            children.setdefault(parent, []).append(pk)
        cache[key] = children
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


def _rows(user, cache) -> dict:
    """{角色名: {resource: RoleDataScope}},只含活角色的活配置行。一次查询,按人存在 cache
    (`visible_to(目标用户, 行)` 与请求人共用一份 cache)。"""
    key = ("rows", user.pk)
    if key not in cache:
        from apps.perm.checker import _live_extra_roles
        from apps.perm.models import RoleDataScope

        names = [r for r in (getattr(user, "role", None), *_live_extra_roles(user)) if r]
        by_role = {name: {} for name in names}
        for row in (RoleDataScope.objects.filter(role__name__in=names, role__is_deleted=False)
                    .select_related("role").prefetch_related("orgs")):
            by_role[row.role.name][row.resource] = row
        cache[key] = by_role
    return cache[key]


def org_ids(user, resource, cache=None):
    """这个人对 `resource` 能看的机构 id 集合;None = 不限。"""
    cache = {} if cache is None else cache
    if getattr(user, "role", None) == "ADMIN":
        return None
    by_role = _rows(user, cache)
    if not by_role:
        return None  # 没有角色 = 没有配置行 = 全部(与旧的 RowLevelDataScope 一样;权限检查另管)
    ids = set()
    for rows in by_role.values():
        row = rows.get(resource) or rows.get("")
        if row is None or row.scope == ALL:
            return None
        own = getattr(user, "organization_id", None)
        if row.scope in (ORG, ORG_CHILD) and own:
            ids |= {own} if row.scope == ORG else _with_descendants([own], user, cache)
        elif row.scope == DEFINE:
            ids |= _with_descendants([o.pk for o in row.orgs.all()], user, cache)
    return ids


def visible_q(user, resource, org_path, user_paths=(), extra_q=None, *, model=None, cache=None):
    """`user` 对这项业务可见行的 Q;None = 不限(调用方原样返回 queryset)。
    `user_paths` 里有多值关系时要给 `model`(写成 `pk__in` 子查询)。"""
    ids = org_ids(user, resource, cache)
    if ids is None:
        return None
    q = Q(**{f"{org_path}__in": ids})
    for path in user_paths:
        q |= _user_q(model, path, user) if model is not None else Q(**{path: user.pk})
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
