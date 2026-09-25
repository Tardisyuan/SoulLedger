"""判官结案时亲自选的发落(审判台「戊 · 发落」):目的地与刑期。

不选 = 自动分派,与以前一字不差 —— 这里的东西只在调用方给了
`destination_realm_id` / `term_years` / `eternal` 之一时才被调用。

「这个裁决能去哪些门」不另立一张表。它就是自动分派那几个路由函数
(`DispositionService._route_chinese` / `_route_european` / `_route_egyptian` /
`_route_greek`)在裁决固定之后、严重度取遍所有值时能给出的全部答案:裁决决定
去哪一类地方,严重度只在那一类里挑深浅(见 `_route_chinese` 的 docstring)。
所以允许集合是路由函数的像,由 `allowed_realm_codes` 把严重度扫一遍求出来 ——
路由规则改了,这里跟着变,没有第二份要同步。
"""
from functools import cache

from django.db.models import Count, Q

from apps.judgment.models import JudgmentMethod
from apps.realms.models import Realm, SoulPathEntry
from apps.souls.models import Civilization

#: 刑期上界就是列的上界(`Disposition.sentence_years` 是 IntegerField;
#: 现有规则只有「非负整数或 null」,这里再要求正数)。
MAX_TERM_YEARS = 2**31 - 1

#: 路由函数的严重度输入要扫的范围。
# ponytail: 扫一段整数求像,前提是各路由的分档宽度(十殿 10、九圈 15、埃及阈值 50)
# 都远小于 1000。tests/test_conclude_destination.py 把十殿与九圈的像钉成完整的一套,
# 分档变宽到扫不全时那条会红。
_SEVERITY_SWEEP = range(-1000, 1001)


class DestinationRefusedError(Exception):
    """结案时选的发落不成立。在结案事务里抛出,裁决与处置随之回滚,什么都没写。"""

    def __init__(self, message, code, status=400):
        super().__init__(message)
        self.code = code
        self.status = status


@cache
def allowed_realm_codes(civilization, verdict, judgment_method=JudgmentMethod.STANDARD) -> frozenset:
    """这个文明、这个裁决(与审法)下,自动分派可能送去的全部 realm_code。"""
    from apps.disposition.services import DispositionService as D

    # soul=None:四个路由函数里只有欧洲的「引用过的最深一圈」读灵魂,None 时它不读,
    # 而那条路能到的圈,严重度阶梯本来就全部能到。
    routers = {
        Civilization.CHINESE: lambda s: D._route_chinese(None, verdict, s),
        Civilization.EUROPEAN: lambda s: D._route_european(None, verdict, s),
        Civilization.EGYPTIAN: lambda s: D._route_egyptian(None, verdict, judgment_method, s),
        Civilization.GREEK: lambda s: D._route_greek(None, verdict),
    }
    route = routers.get(civilization)
    if route is None:
        return frozenset()
    return frozenset(route(s) for s in _SEVERITY_SWEEP) - {""}


def _tenant_realms(judgment):
    """本案租户、本文明的全部界域,带 `occupancy`(此刻在那里的灵魂数:行程上未离开的一站)。"""
    return (
        Realm.all_objects.filter(
            tenant_id=judgment.tenant_id, civilization=judgment.soul.civilization, is_deleted=False,
        )
        .annotate(occupancy=Count("path_entries", filter=Q(path_entries__left_at__isnull=True)))
        .order_by("order", "tier", "realm_code")
    )


def destination_options(judgment, verdict):
    """这件案子、这个候选裁决下可选的目的地:本案租户、本文明、裁决路由得到的门。"""
    codes = allowed_realm_codes(judgment.soul.civilization, verdict, judgment.judgment_method)
    return _tenant_realms(judgment).filter(realm_code__in=codes)


def inapplicable_destinations(judgment, verdict):
    """同一租户、同一文明里这个裁决去不了的界域 —— 选单照样列出、禁用并写明「不适用」
    (第三类 F 组 2.5),与 `destination_options` 合起来正是本案租户、本文明的全部界域。"""
    codes = allowed_realm_codes(judgment.soul.civilization, verdict, judgment.judgment_method)
    return _tenant_realms(judgment).exclude(realm_code__in=codes)


def resolve_placement(judgment, verdict, *, realm_id=None, term_years=None, eternal=None):
    """校验判官选的发落,返回交给 `DispositionService.create_from_judgment` 的参数。

    必须在结案事务里调用:选中的门行被 `select_for_update` 锁到事务结束,容量
    检查与随后写入的行程一站之间没有别人能再占一个位子。
    """
    from apps.disposition.services import DispositionService
    from apps.judgment.models import JudgmentKind

    if judgment.kind != JudgmentKind.ORIGINAL:
        raise DestinationRefusedError(
            "Only an original judgment creates a disposition; destination and term do not apply",
            "destination_not_applicable")
    if eternal and term_years is not None:
        raise DestinationRefusedError("A sentence is either eternal or a term in years, not both",
                                      "term_conflict")

    placement = {}
    if realm_id is not None:
        soul = judgment.soul
        # 本案租户 + 本文明;别的租户的门与不存在的门同一个回答,不透露它存在。
        realm = (
            Realm.all_objects.select_for_update()
            .filter(pk=realm_id, tenant_id=judgment.tenant_id,
                    civilization=soul.civilization, is_deleted=False)
            .first()
        )
        if realm is None:
            raise DestinationRefusedError("No such realm in this judgment's tenant", "realm_not_found")
        if realm.realm_code not in allowed_realm_codes(soul.civilization, verdict, judgment.judgment_method):
            raise DestinationRefusedError(
                f"A {verdict} verdict cannot send a soul to {realm.realm_code}", "realm_not_allowed")
        if realm.capacity is not None:
            # 已经站在这扇门里的灵魂(例如待审所里判 PURGATORY)不占第二个位子。
            held = (
                SoulPathEntry.all_objects
                .filter(realm_id=realm.pk, left_at__isnull=True)
                .exclude(soul_id=soul.pk)
                .count()
            )
            if held >= realm.capacity:
                raise DestinationRefusedError(
                    f"{realm.realm_code} is full ({held}/{realm.capacity})", "realm_full", status=409)
        placement["realm"] = realm
    else:
        realm = DispositionService.route_realm(judgment.soul, verdict, judgment.judgment_method, judgment=judgment)

    if eternal and (realm is None or not realm.is_eternal):
        raise DestinationRefusedError("This destination cannot hold an eternal sentence",
                                      "eternal_not_allowed")
    if term_years is not None:
        placement.update(sentence_years=term_years, is_eternal=False)
    elif eternal is not None:
        placement["is_eternal"] = eternal
    return placement
