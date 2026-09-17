"""跨文明调拨是暂居,不是迁籍(2026-09-17 用户决定)。

`tenant` = 此刻管辖;`home_tenant` = 原属。调拨执行切 `tenant`、不动 `home_tenant`;
暂居租户的处置执行完毕自动回归;原租户或 ADMIN 可以手动结束暂居。
转生资格、转生申请、申诉、灵魂账号按原属。
"""
import pytest

from apps.souls.models import Soul
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]


@pytest.fixture
def cn():
    return _tenant("CN_DIYU")


@pytest.fixture
def eg():
    return _tenant("EG_DUAT")


@pytest.fixture
def eu():
    return _tenant("EU_HEAVEN_HELL")


def test_a_new_soul_belongs_to_the_tenant_it_is_created_in(cn):
    soul = Soul.objects.create(name="本土", tenant=cn)
    soul.refresh_from_db()
    assert soul.home_tenant_id == cn.pk
    assert soul.is_residing is False
    assert soul.home_civilization == "CHINESE"
