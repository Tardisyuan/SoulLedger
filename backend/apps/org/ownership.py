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
