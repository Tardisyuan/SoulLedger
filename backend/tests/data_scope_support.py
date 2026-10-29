"""数据范围测试的两个小工具:建本殿机构(挂在殿根下)、给角色配一行范围。"""
from apps.org.models import Organization
from apps.org.ownership import tenant_root
from apps.perm.models import Role, RoleDataScope


def org(tenant, name, parent=None):
    return Organization.objects.create(name=name, code=f"DS_{tenant.code}_{name}"[:50], category="",
                                       tenant=tenant, parent=parent or tenant_root(tenant))


def scope(role_name, value, resource="", orgs=()):
    role = Role.objects.get_or_create(name=role_name)[0]
    row = RoleDataScope.objects.create(role=role, resource=resource, scope=value)
    row.orgs.set(orgs)
    return row
