"""`SoulRecord.civilization` 必须由灵魂派生,而不是由 `default=` 决定。

这一列的 help_text 说「Derived from soul's tenant」。**在 2026-08-31 之前
没有任何代码派生它** —— `save()` 只补 `tenant`,`default=Civilization.CHINESE`
于是把希腊/埃及/欧洲灵魂的每一条记录都盖成中国,而且这列上有索引
(`idx_soulrecord_civ`),索引的是一个错误答案。

减轻情节是:没有任何决策路径读它(路由和账目读 `soul.civilization` 属性)。
所以它是显示层的谎,不是路由缺陷 —— 但**一个 help_text 就是一次没被执行的断言**,
这个文件把它执行了。
"""
import pytest

from apps.souls.models import TENANT_CIVILIZATION, Civilization, Soul
from apps.souls.record_models import RecordType, SoulRecord
from apps.tenants.models import Tenant


def _soul(code):
    tenant, _ = Tenant.objects.get_or_create(
        code=code, defaults={"display_name": code}
    )
    return Soul.objects.create(name=f"soul-{code}", tenant=tenant)


@pytest.mark.django_db
@pytest.mark.parametrize("code,expected", sorted(TENANT_CIVILIZATION.items()))
def test_a_new_record_takes_its_civilization_from_the_soul(code, expected):
    soul = _soul(code)
    record = SoulRecord.objects.create(
        soul=soul, record_type=RecordType.MERIT, description="x", weight=1
    )
    record.refresh_from_db()
    assert record.civilization == expected, (
        f"{code} 下的记录被记成 {record.civilization};灵魂自己说的是 "
        f"{soul.civilization}"
    )


@pytest.mark.django_db
def test_a_client_supplied_civilization_does_not_win():
    """唯一写它的地方曾经是序列化器的可写字段 —— 也就是客户端。"""
    soul = _soul("GR_HADES")
    record = SoulRecord.objects.create(
        soul=soul,
        record_type=RecordType.MERIT,
        description="x",
        weight=1,
        civilization=Civilization.CHINESE,  # 客户端说了算的旧世界
    )
    record.refresh_from_db()
    assert record.civilization == Civilization.GREEK


@pytest.mark.django_db
def test_moving_a_soul_to_another_tenant_re_derives_on_next_save():
    soul = _soul("CN_DIYU")
    record = SoulRecord.objects.create(
        soul=soul, record_type=RecordType.MERIT, description="x", weight=1
    )
    assert record.civilization == Civilization.CHINESE
    soul.tenant = Tenant.objects.get_or_create(
        code="EG_DUAT", defaults={"display_name": "EG_DUAT"}
    )[0]
    soul.save()
    record.soul.refresh_from_db()
    record.save()
    record.refresh_from_db()
    assert record.civilization == Civilization.EGYPTIAN


def test_the_migrations_copy_of_the_map_matches_the_runtime_one():
    """回填迁移抄了一份 `TENANT_CIVILIZATION`(迁移不该 import 运行时常量)。

    **抄一份就会漂。** 这条把两份钉在一起 —— 加第五个文明时,是这里报红,
    而不是几年后某张报表里少一个租户。
    """
    import importlib

    module = importlib.import_module(
        "apps.souls.migrations.0031_backfill_soulrecord_civilization"
    )
    assert module.TENANT_CIVILIZATION == TENANT_CIVILIZATION, (
        f"迁移里那份是 {module.TENANT_CIVILIZATION},运行时是 {TENANT_CIVILIZATION}"
    )
