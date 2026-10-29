"""数据归属:灵魂 / 审判挂在哪个机构下(数据范围设计 B1,local-gates/rbac-2026-10-29/datascope-design.md「取值」)。

每殿恰好一个活根(`organizations_one_live_root_per_tenant`),根就是本殿唯一没有上级的活机构;
种子殿的根叫 `ROOT_<殿码>`(org/0010 建),还没有根的殿在第一次要用时建一个同名的。
"""
from django.db import IntegrityError, transaction

from apps.org.models import Organization


def root_code(tenant) -> str:
    return f"ROOT_{tenant.code}"[:50]


def tenant_root(tenant):
    """本殿的根机构;没有就建(名称用殿名)。"""
    root = Organization.objects.filter(tenant=tenant, parent__isnull=True).first()
    if root is not None:
        return root
    # 根被删过(只有空机构删得掉):把它还原,而不是撞上 code 的唯一约束。
    dead = Organization.all_objects.filter(code=root_code(tenant), tenant=tenant, parent__isnull=True).first()
    if dead is not None:
        dead.restore()
        return dead
    try:
        with transaction.atomic():
            return Organization.objects.create(
                name=(tenant.hall_name or tenant.display_name or tenant.code)[:100],
                code=root_code(tenant),
                category=tenant.known_civilization or "",
                tenant=tenant,
            )
    except IntegrityError:
        # 并发的另一笔先建了根(每殿一个活根的约束拦下这一笔)。
        return Organization.objects.get(tenant=tenant, parent__isnull=True)


def default_owner_org(tenant, user, court=""):
    """新数据的归属机构:审判 court 匹配本殿机构名前缀 > 创建人机构(同殿)> 殿根。无殿返回 None。

    显式给的 owner_org 由调用者自己优先(B3a 才开放写);建后不自动变。
    """
    if tenant is None:
        return None
    if court:
        hit = (
            Organization.objects.filter(tenant=tenant, name__startswith=court)
            .order_by("level", "sort", "pk").first()
        )
        if hit is not None:
            return hit
    org = getattr(user, "organization", None) if user is not None else None
    if org is not None and org.tenant_id == tenant.pk and not org.is_deleted:
        return org
    return tenant_root(tenant)


def owner_org_field():
    """序列化器上的 `owner_org`:可选、不可为空(要变就换一个机构,不能挂空)。"""
    from rest_framework import serializers

    return serializers.PrimaryKeyRelatedField(queryset=Organization.objects.all(), required=False, allow_null=False)


def check_owner_org(value, context, resource, instance=None, codename=None):
    """显式给的归属机构(数据范围 B3a):与行同殿(新建时 = 请求的殿),且在调用者对 `resource` 的机构范围内。
    改已有行的归属还要持 `codename`(灵魂 soul.update、审判 judgment.assign)。审计由行的 UPDATE 记下。"""
    from rest_framework import exceptions, serializers

    from apps.perm import data_scope
    from apps.perm.checker import check_permission

    request = context.get("request")
    user = getattr(request, "user", None)
    if instance is not None and value.pk == instance.owner_org_id:
        return value  # 原样回传的 PUT
    if instance is not None and codename and not check_permission(user, codename):
        raise exceptions.PermissionDenied(f"Changing the owning unit needs {codename}.")
    tenant_id = instance.tenant_id if instance is not None else getattr(
        getattr(request, "tenant", None) or getattr(user, "tenant", None), "pk", None)
    if tenant_id is None or value.tenant_id != tenant_id:
        raise serializers.ValidationError("No such organization in this hall.")
    ids = data_scope.org_ids(user, resource, data_scope.request_cache(request))
    if ids is not None and value.pk not in ids:
        raise serializers.ValidationError("This organization is outside your data scope.")
    return value
