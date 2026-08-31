"""`Organization.level` 必须等于它在树里的真实深度。

共享库 2026-08-29 实测:`select level, count(*) from organizations group by 1`
→ `0 | 35`。**整张表**都在深度 0,包括 `DIYU_01..10` 这些明摆着有父节点的行。
成因是 `init_organizations.py` 的 `org.save(update_fields=["parent"])`:
`save()` 算了 level,而 UPDATE 语句里没有这一列。

`apps/org/tests.py:47` 早就断言过 `level == 1` —— 但它走 `objects.create(parent=...)`,
是**唯一那条能工作的路径**。审计代理第一次也用这个方法测,得到通过,
差点把这条记成「无法复现」。**一个只覆盖了可用路径的测试,证明的是那条路径可用。**
"""
import io

import pytest
from django.core.management import call_command

from apps.org.models import Organization


@pytest.fixture
def initialised(db):
    out = io.StringIO()
    call_command("init_organizations", stdout=out, stderr=out)
    return out.getvalue()


def _real_depth(org):
    depth, current = 0, org.parent
    while current is not None:
        depth += 1
        current = current.parent
    return depth


@pytest.mark.django_db
def test_every_row_stores_the_depth_it_actually_has(initialised):
    wrong = {
        org.code: (org.level, _real_depth(org))
        for org in Organization.objects.select_related(
            "parent__parent__parent"
        ).all()
        if org.level != _real_depth(org)
    }
    assert wrong == {}, f"这些行存的深度不是它们的真实深度 (存的, 真实): {wrong}"


@pytest.mark.django_db
def test_the_tree_is_not_flat(initialised):
    """守卫的守卫。上面那条在**每一行都真的是根**时也全绿 —— 而「全表 level=0」
    这个缺陷的观感恰好就是那样。"""
    depths = {org.level for org in Organization.objects.all()}
    assert max(depths) >= 1, (
        f"init_organizations 建出来的树最深只有 {max(depths)} 层;"
        f"上面那条断言因此几乎什么都没检查"
    )
    at_depth_zero = Organization.objects.filter(level=0).count()
    total = Organization.objects.count()
    assert at_depth_zero < total, (
        f"{total} 行里 {at_depth_zero} 行在深度 0 —— 这正是缺陷的观感"
    )


@pytest.mark.django_db
def test_running_it_twice_does_not_disturb_the_depths(initialised):
    """幂等。第二次跑走的是 `update_fields` 那条分支,也就是缺陷所在的那条。"""
    out = io.StringIO()
    call_command("init_organizations", stdout=out, stderr=out)
    wrong = [
        org.code
        for org in Organization.objects.select_related("parent__parent__parent").all()
        if org.level != _real_depth(org)
    ]
    assert wrong == [], wrong
