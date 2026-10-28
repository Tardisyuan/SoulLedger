"""地府开案要有城隍收案(用户 2026-10-29):本殿没有匹配、也没有兜底城隍时,死亡登记、手开审判、勾魂交接、
死亡同步与土地公登记一律 409 `no_city_god`(`apps/judgment/city_gods.py::NoCityGodError`)。

测试里的地府殿先 `default_city_god(tenant)`;案子收到城隍那里是 PENDING,十殿认领 / 结案前要解送:
`sent_on(judgment)` 直接把状态写成 SENT_ON(初审本身由 `tests/test_city_gods.py` 测,这里只是让后面的步骤走得到)。
"""
from apps.judgment.models import CityGod, CityGodStatus, Judgment


def default_city_god(tenant, name="兜底城隍"):
    return CityGod.all_objects.get_or_create(tenant=tenant, name=name, defaults={"is_default": True})[0]


def sent_on(judgment):
    """城隍解送十殿(只写状态)。返回刷新过的 judgment;没交城隍的原样返回。"""
    Judgment.all_objects.filter(pk=judgment.pk, city_god_status=CityGodStatus.PENDING).update(
        city_god_status=CityGodStatus.SENT_ON)
    judgment.refresh_from_db()
    return judgment


def die_and_send_on(soul, **kwargs):
    """`soul.die(...)` 再解送;返回那件案子(die 返回 None 时是 None)。"""
    judgment = soul.die(**kwargs)
    return sent_on(judgment) if judgment is not None else None
