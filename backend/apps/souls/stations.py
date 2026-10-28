"""地府十三站(2026-10-28,docs/06_地府十三站详解.md §一):`Soul.diyu_station` 只在这里写。

自动走的三处(都只往前走,不会把官员挪到后面的亡魂拉回来):
* 死亡(`Soul.transition_to` 的 ALIVE -> JUDGING)→ 土地庙。06 §二 第一站:「通报当地城隍,记录亡魂基本信息」。
* 进十殿任一殿(`SoulPathService.enter` 到 `DY_COURT_*`)→ 酆都城。06 §二:「十殿阎罗在此处理政务」。
* 饮孟婆汤(`reincarnation.services.drink_soup`)→ 还魂崖。06 §二 第十三站流程第 1 步就是喝孟婆汤。
转世完成时清空(新的一世不在路上,`complete_rebirth`)。

其余各站(黄泉路、望乡台……莲花台)没有业务事件对应,由官员在灵魂详情里挪(`move`,要 `soul.transition`),
可以往回挪(记错了要能改)。每次变动一条 DIYU_STATION_CHANGED,与那一笔同一事务;payload:from / to / via。
"""
from django.db.models import F
from django.utils import timezone

from apps.souls.models import Civilization, Soul, SoulState

STATIONS = tuple(Soul.DiyuStation)


def ordinal(station: str) -> int:
    """第几站(1-13);空是 0。"""
    return STATIONS.index(station) + 1 if station else 0


class StationRefusedError(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def arrive(soul, station: str, *, via: str, forward_only: bool = True, actor: str = "system") -> bool:
    """把灵魂记到 `station`,在调用方的事务里。不是地府的灵魂、已经在那一站、或(forward_only)不比现在靠前:不写。

    读写都按 pk 直接走库:调用方手上的 `soul` 可能是旧的(行程服务拿到的往往不是加锁的那一份),整行 save 会把
    别人刚写的列盖掉。
    """
    from apps.events.services import EventService

    if soul.civilization != Civilization.CHINESE:
        return False
    current = Soul.all_objects.filter(pk=soul.pk).values_list("diyu_station", flat=True).first() or ""
    if current == station or (forward_only and ordinal(station) <= ordinal(current)):
        return False
    Soul.all_objects.filter(pk=soul.pk).update(
        diyu_station=station, version=F("version") + 1, update_time=timezone.now())
    soul.diyu_station = station
    EventService.log(soul, "DIYU_STATION_CHANGED", {"from": current, "to": station, "via": via}, actor)
    return True


def move(soul, station: str, user) -> Soul:
    """官员挪站(`POST /souls/{id}/station/`)。拒绝:不是地府(`not_diyu`)、还在世(`alive`)、不是十三站之一。"""
    from django.db import transaction

    if station not in STATIONS:
        raise StationRefusedError("invalid_station", f"{station!r} is not one of the thirteen stations.")
    with transaction.atomic():
        locked = Soul.all_objects.select_for_update(of=("self",)).get(pk=soul.pk)
        if locked.civilization != Civilization.CHINESE:
            raise StationRefusedError("not_diyu", "Only a soul of Diyu walks the thirteen stations.")
        if locked.current_state == SoulState.ALIVE:
            raise StationRefusedError("alive", "A living soul is not on the road.")
        arrive(locked, station, via="officer", forward_only=False, actor=user.username if user else "system")
    soul.diyu_station = locked.diyu_station
    return locked
