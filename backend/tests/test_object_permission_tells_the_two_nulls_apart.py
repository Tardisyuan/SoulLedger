"""「这个模型没有 tenant 列」与「这一行的可空 tenant 是 NULL」不是同一件事。

`TenantPermission.has_object_permission` 曾经写 `if obj_tenant is None:
return True  # 无 tenant 字段,放行`。它读的是**实例上的属性值**,而它声称
判断的是**模型有没有这一列**。

**全项目 25 个 tenant FK 里 18 个是 `null=True`**,所以第二种情况一点也不罕见。

今天没有可利用路径:`scope_to_tenant` 会先把 tenantless 的行滤掉,所以带 NULL
tenant 的对象到不了这里。但这个类读起来像是那道过滤后面的对象层后备防线 ——
**而它不是**。这个文件把两种情况分开钉住。
"""
import pytest

from apps.authentication.models import User, UserRole
from apps.core.permissions import TenantPermission
from apps.souls.models import Soul
from apps.tenants.models import Tenant


class _Request:
    def __init__(self, user, tenant):
        self.user = user
        self.tenant = tenant


@pytest.fixture
def setup(db):
    a, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "A"})
    b, _ = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "B"}
    )
    user = User.objects.create_user(
        username="viewer-obj", password="x", role=UserRole.VIEWER, tenant=a
    )
    return TenantPermission(), _Request(user, a), a, b


@pytest.mark.django_db
def test_a_row_whose_nullable_tenant_is_null_is_refused(setup):
    """**这是修复的那一条。** 旧代码在这里放行。"""
    permission, request, a, _b = setup
    orphan = Soul(name="无主", tenant=None)
    assert permission.has_object_permission(request, None, orphan) is False, (
        "一行没有租户的记录被当成了「所有人的记录」"
    )


@pytest.mark.django_db
def test_a_model_without_a_tenant_column_is_still_allowed(setup):
    """**断存在。** 只断「NULL 被拒」的实现,可以简单地拒绝一切。"""
    permission, request, _a, _b = setup

    class _NoTenant:
        pass

    assert permission.has_object_permission(request, None, _NoTenant()) is True


@pytest.mark.django_db
def test_the_ordinary_comparison_still_works(setup):
    permission, request, a, b = setup
    mine = Soul(name="本租户", tenant=a)
    theirs = Soul(name="别人的", tenant=b)
    assert permission.has_object_permission(request, None, mine) is True
    assert permission.has_object_permission(request, None, theirs) is False


@pytest.mark.django_db
def test_a_plain_object_carrying_a_tenant_is_still_compared(setup):
    """没有 `_meta` 不等于没有归属主张 —— 只看 `_meta` 会在另一个方向上犯同一个错。"""
    permission, request, _a, b = setup

    class _Obj:
        pass

    obj = _Obj()
    obj.tenant = b
    assert permission.has_object_permission(request, None, obj) is False
