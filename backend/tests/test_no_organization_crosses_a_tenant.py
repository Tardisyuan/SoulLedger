"""没有哪个组织的 parent 属于另一个租户。

`Organization.get_ancestors()` 沿 `parent` 一路往上走,**不过滤租户** —— 所以一条
跨租户的 parent FK 意味着从某个节点往上爬会走进别人的树里。

115 上实测恰好一条:`HADES_NORSE`(EU_HEAVEN_HELL)的 parent 是 `HADES`,而后者被
`org/0007` 移到了 GR_HADES。**那次迁移的 docstring 写着「任何时刻都没有节点跨文明
孤立」,而它迁的那个库反驳了它** —— 它只移了 `HADES` 与 `HADES_GREEK` 两行,
从没枚举 `HADES` 的其它子节点。

一句写在迁移 docstring 里的不变式,是一次**未经执行的全库查询**。这个文件把它
变成断言。
"""
import pytest

from apps.org.models import Organization
from apps.tenants.models import Tenant


@pytest.mark.django_db
def test_no_parent_belongs_to_another_tenant():
    crossing = [
        f"{o.code}(tenant {o.tenant_id}) -> {o.parent.code}(tenant {o.parent.tenant_id})"
        for o in Organization.objects.select_related("parent").filter(parent__isnull=False)
        if o.tenant_id != o.parent.tenant_id
    ]
    assert crossing == [], (
        f"这些组织的 parent 在别的租户里:{crossing}。"
        f"`get_ancestors()` 沿 parent 走且不过滤租户,所以从它们往上爬会走进"
        f"另一个租户的树。"
    )


@pytest.mark.django_db
def test_the_check_runs_against_a_non_trivial_tree(db):
    """守卫的守卫。

    上面那条是 `assert <collection> == []` —— **集合为空时它最干净**,而
    「一行都没查到」和「一行都没问题」输出一模一样。这条要求确实有带 parent 的行
    存在,否则上面那句什么都没证明。
    """
    from io import StringIO

    from django.core.management import call_command

    call_command("init_organizations", stdout=StringIO())
    with_parent = Organization.objects.filter(parent__isnull=False).count()
    assert with_parent > 5, f"只有 {with_parent} 个带 parent 的组织,上面那条查不到东西"


@pytest.mark.django_db
def test_a_planted_crossing_is_caught():
    """把缺陷造出来,看守卫是否报红 —— 而不是只信它在干净数据上通过。"""
    a, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "A"})
    b, _ = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "B"})
    parent = Organization.objects.create(name="A 根", code="X_ROOT", category="CHINESE", level=0, tenant=a)
    Organization.objects.create(
        name="B 子", code="X_CHILD", category="EUROPEAN", level=1, tenant=b, parent=parent
    )
    crossing = [
        o.code
        for o in Organization.objects.select_related("parent").filter(parent__isnull=False)
        if o.tenant_id != o.parent.tenant_id
    ]
    assert crossing == ["X_CHILD"], crossing
