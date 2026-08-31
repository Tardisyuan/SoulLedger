"""`seed_mythology` 覆盖哪些列,必须是**写下来的**,不是省略出来的。

`--update` 只比对 `*_FIELDS` 那几个元组,所以元组外的列**漂移完全不可见**:
seeder 对一个被手改过的行报 `unchanged`,而不带 `--update` 的普通跑对它零输出。
2026-08-29 实测:手改一个 actor 的 `icon_url`,`--update` 把每个被比对的字段都
恢复了,`icon_url` 原样留着,汇总里报 `unchanged`。

**「不归 seed 管」和「忘了加进去」在输出里长得一模一样。** 这个文件要求每一个
具体字段要么在比对集合里,要么在 `NOT_SEEDED` 里带着理由 —— 于是以后新加一列,
是这里报红,而不是几年后某次 `--update` 悄悄不管它。
"""
import pytest

from apps.actors.models import Actor
from apps.actors.mythology.seeding import (
    ACTOR_FIELDS,
    INFRASTRUCTURE_FIELDS,
    NOT_SEEDED,
    REALM_FIELDS,
)
from apps.realms.models import Realm

CASES = [
    (Actor, ACTOR_FIELDS),
    (Realm, REALM_FIELDS),
]


def _unaccounted(model, compared):
    declared = set(compared) | INFRASTRUCTURE_FIELDS | NOT_SEEDED.get(model.__name__, set())
    return sorted(f.name for f in model._meta.concrete_fields if f.name not in declared)


@pytest.mark.parametrize("model,compared", CASES, ids=lambda x: getattr(x, "__name__", ""))
def test_every_column_is_either_seeded_or_declared_unseeded(model, compared):
    missing = _unaccounted(model, compared)
    assert missing == [], (
        f"{model.__name__} 上这些列既不在比对集合里,也没在 NOT_SEEDED 里声明:"
        f"{missing}。`--update` 对它们视而不见,而 seeder 会把那样的行报成 "
        f"unchanged —— 请把它加进比对集合,或加进 NOT_SEEDED 并写下理由。"
    )


@pytest.mark.parametrize("model,compared", CASES, ids=lambda x: getattr(x, "__name__", ""))
def test_the_detector_would_notice_a_new_column(model, compared):
    """守卫的守卫。

    上面那条是 `assert missing == []`。**内省一个字段都拿不到时它最干净** ——
    这条要求内省确实在返回东西,并且确实在拿它跟名单比。
    """
    concrete = {f.name for f in model._meta.concrete_fields}
    assert len(concrete) > 10, concrete
    assert set(compared) <= concrete, (
        f"比对集合里有 {model.__name__} 根本没有的列:"
        f"{sorted(set(compared) - concrete)}"
    )


def test_not_seeded_does_not_name_a_column_that_is_gone():
    """一份指向已删列的豁免名单,是一条永远不会红的规则。"""
    by_name = {Actor.__name__: Actor, Realm.__name__: Realm}
    stale = {}
    for model_name, fields in NOT_SEEDED.items():
        model = by_name.get(model_name)
        assert model is not None, f"NOT_SEEDED 里的 {model_name} 不是这里的模型之一"
        concrete = {f.name for f in model._meta.concrete_fields}
        gone = sorted(fields - concrete)
        if gone:
            stale[model_name] = gone
    assert stale == {}, f"NOT_SEEDED 里这些列已经不存在了:{stale}"


def test_not_seeded_does_not_overlap_the_compared_set():
    """同一列不能既声明「不管」又实际在比对 —— 那样其中一句是假的。"""
    overlaps = {
        model.__name__: sorted(set(compared) & NOT_SEEDED.get(model.__name__, set()))
        for model, compared in CASES
    }
    overlaps = {k: v for k, v in overlaps.items() if v}
    assert overlaps == {}, overlaps
