"""参与算术或路由决策的字段必须有下界 —— 两道,不是一道。

`full_clean()` 实跑(2026-08-29)证实这三个字段一个约束都没有:
`merit_score` 接受 −999999、`sentence_years` 接受 −5000(且能从 API 写进去)、
`cycle_count` 接受 −7。

**对照最刺眼的地方在同一批模型里**:birth/death/event/term_start 的 month/day
**都**带 Min/Max,`occurrence_count` 是 `PositiveIntegerField` ——
**带约束的都是日期,参与算术的一个都没有。**

`_route_european` 的注释断言「culpa 是过失总额所以永不为负 —— 没有量要取、
没有符号会丢,这就是这里不再需要 abs() 的原因」。那句话此前是**替一个没有任何
约束的列做的保证**。

两道各守一条路:validator 被 DRF 抄进序列化器(API 路径),CheckConstraint 由
数据库执行(ORM 直写、shell、迁移的数据步骤)。只加 validator 会得到一条
`Model.save()` 不执行的规则 —— 与 `Statute.clean()` 同形。
"""
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.disposition.models import Disposition
from apps.reincarnation.models import Reincarnation
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.fixture
def tenant(db):
    row, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    return row


# ---------------------------------------------------------------- validators


@pytest.mark.django_db
@pytest.mark.parametrize("field", ["merit_score", "demerit_score"])
def test_full_clean_refuses_a_negative_score(tenant, field):
    soul = Soul(name="x", tenant=tenant, **{field: -999999})
    with pytest.raises(ValidationError) as caught:
        soul.full_clean()
    assert field in caught.value.error_dict


@pytest.mark.django_db
def test_full_clean_refuses_a_negative_sentence(tenant):
    soul = Soul.objects.create(name="x", tenant=tenant)
    disposition = Disposition(soul=soul, tenant=tenant, sentence_years=-5000)
    with pytest.raises(ValidationError) as caught:
        disposition.full_clean()
    assert "sentence_years" in caught.value.error_dict


@pytest.mark.django_db
def test_full_clean_refuses_a_zeroth_rebirth(tenant):
    soul = Soul.objects.create(name="x", tenant=tenant)
    row = Reincarnation(soul=soul, tenant=tenant, cycle_count=-7)
    with pytest.raises(ValidationError) as caught:
        row.full_clean()
    assert "cycle_count" in caught.value.error_dict


# ----------------------------------------------------- database constraints
# validator 只在 `full_clean()` 里跑,而 `Model.save()` 不调它。这几条走
# `objects.create()`,也就是 seeder、shell 与迁移走的那条路。


@pytest.mark.django_db
@pytest.mark.parametrize("field", ["merit_score", "demerit_score"])
def test_the_database_refuses_a_negative_score(tenant, field):
    with pytest.raises(IntegrityError), transaction.atomic():
        Soul.objects.create(name="x", tenant=tenant, **{field: -1})


@pytest.mark.django_db
def test_the_database_refuses_a_negative_sentence(tenant):
    soul = Soul.objects.create(name="x", tenant=tenant)
    with pytest.raises(IntegrityError), transaction.atomic():
        Disposition.objects.create(soul=soul, tenant=tenant, sentence_years=-1)


@pytest.mark.django_db
def test_the_database_refuses_a_zeroth_rebirth(tenant):
    soul = Soul.objects.create(name="x", tenant=tenant)
    with pytest.raises(IntegrityError), transaction.atomic():
        Reincarnation.objects.create(soul=soul, tenant=tenant, cycle_count=0)


# ------------------------------------------------------------ 断存在,不只断缺失


@pytest.mark.django_db
def test_the_legitimate_values_still_go_in(tenant):
    """一个把三张表全锁死的实现会让上面每一条都绿。"""
    soul = Soul.objects.create(name="x", tenant=tenant, merit_score=10, demerit_score=0)
    assert soul.pk
    # `sentence_years=None` 是「没有记录刑期」,与「刑期是 0」不同 —— 两个都要能写。
    for years in (None, 0, 1000):
        assert Disposition.objects.create(
            soul=soul, tenant=tenant, sentence_years=years
        ).pk
    assert Reincarnation.objects.create(soul=soul, tenant=tenant, cycle_count=1).pk
