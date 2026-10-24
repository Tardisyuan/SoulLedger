"""城隍初审(2026-10-24 用户决定,只在地府):登记与拘拿的前站。`Judgment.city_god*` 只在这里写。

流程
* 收案:`Soul.die` 开审判时问 `initial_fields`,按灵魂的出身地(`origin_location`)交给本殿匹配的城隍,
  状态 PENDING;没有匹配就交本殿的兜底城隍(`is_default`);连兜底也没有就没有这一站,直接进十殿(与过去一样)。
  别的文明不经城隍。官员手开的审判(`POST /judgment/`)也不经城隍:那是已经在十殿立的案。
* 初审:分在这位城隍名下的官员(或持 `judgment.assign` 的殿管理员)
  - 解送(SENT_ON,批语可空):案子进十殿的队列,此后照常认领、结案。横死的仍按 `held_until` 押在枉死城。
  - 退回补正(RETURNED,批语必填):缺资料,案子留在城隍处;通知本殿管理员。补好之后同一位城隍解送。
  - 改交(管理员):出身地写错、分错了城隍时,改交另一位,状态回到 PENDING。
* PENDING / RETURNED 时十殿不能认领、改派、暂缓、结案(`claims._assert_pending` / `lock_for_conclude` 409
  `at_city_god`),十殿的队列(`views.PENDING`)也不列它。

匹配:城隍的每个地名与出身地按「包含」比(不分大小写);命中多个时取**在出身地里结束得最靠后**的那个,
再取更长的 —— 中文地址从大到小写(「浙江省杭州市临安县」),最后命中的就是最小的一级(县城隍先于府、省)。
同一殿里一个地名只能属于一位城隍(序列化器校验),所以不会有平局。

事件写在同一事务里(CLAUDE.md 事件日志一节);通知在提交之后发。拒绝一律 `CityGodRefusedError`,
与认领同一形状(`code`、`status`、`as_payload`),在任何写入之前抛出。
"""
from django.db import transaction
from django.utils import timezone

from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import AT_CITY_GOD, CityGod, CityGodStatus, Judgment

_BOOKKEEPING = ("version", "update_user", "update_time")


class CityGodRefusedError(ClaimRefusedError):
    """初审此刻不接受这个动作。"""


# ── 收案 ────────────────────────────────────────────────────────────────


def _best(gods, location):
    """(城隍, 命中的那个地名):在出身地里结束得最靠后的,再取更长的;一个都没命中是 (None, None)。"""
    place = (location or "").strip().casefold()
    best, best_region, best_key = None, None, None
    for god in gods:
        for region in god.regions or ():
            needle = str(region).strip().casefold()
            at = place.rfind(needle) if needle else -1
            if at < 0:
                continue
            key = (at + len(needle), len(needle))
            if best_key is None or key > best_key:
                best, best_region, best_key = god, str(region).strip(), key
    return best, best_region


def match(tenant_id, location):
    """出身地 `location` 归本殿哪位城隍;都不匹配时是兜底城隍;本殿没有兜底时是 None。"""
    gods = list(CityGod.objects.filter(tenant_id=tenant_id).order_by("name"))
    best, _ = _best(gods, location)
    return best or next((god for god in gods if god.is_default), None)


def matched_region(judgment):
    """决定归属的那个地名(按这件案子现在的城隍算):兜底收的、改交到没写中的城隍时为 None。
    界面据此把出身地里的那一段标出来(第五十三批「要你们确认」1)。"""
    if judgment.city_god_id is None:
        return None
    return _best([judgment.city_god], judgment.soul.origin_location)[1]


def initial_fields(soul) -> dict:
    """`Soul.die` 开审判时一并写下的列:地府的灵魂交给匹配的城隍;其余返回空(没有初审这一站)。"""
    from apps.souls.models import Civilization

    if soul.civilization != Civilization.CHINESE:
        return {}
    god = match(soul.tenant_id, soul.origin_location)
    if god is None:
        return {}
    return {"city_god": god, "city_god_status": CityGodStatus.PENDING}


def received(judgment, transferred_from=None, transferred_from_name="") -> None:
    """记一笔 CITY_GOD_RECEIVED(在调用方的事务里),提交后通知这位城隍名下的官员;名下没有官员时通知本殿管理员
    (只有他们能办,2026-10-24 用户决定)。没交城隍的不做事。"""
    if judgment.city_god_id is None or judgment.city_god_status != CityGodStatus.PENDING:
        return
    extra = ({"transferred_from": str(transferred_from), "transferred_from_name": transferred_from_name}
             if transferred_from else {})
    _event(judgment, "CITY_GOD_RECEIVED", **extra)
    god = judgment.city_god
    officers = list(god.officers.filter(is_active=True).values_list("pk", flat=True))
    _notify_after_commit(officers or _hall_admins(judgment.tenant_id), "CITY_GOD_CASE_RECEIVED", judgment,
                         city_god=god.name)


# ── 初审 ────────────────────────────────────────────────────────────────


def may_act(user, judgment) -> bool:
    """分在这位城隍名下的官员,或持 `judgment.assign` 的人(殿管理员、殿主)。"""
    from apps.perm.checker import check_permission

    if judgment.city_god_id is None:
        return False
    if check_permission(user, "judgment.assign"):
        return True
    return judgment.city_god.officers.filter(pk=user.pk).exists()


def _lock(pk) -> Judgment:
    return Judgment.all_objects.select_for_update(of=("self",)).get(pk=pk)


def _assert_at_city_god(judgment, *statuses) -> None:
    if judgment.verdict is not None or judgment.is_final or judgment.is_deleted:
        raise CityGodRefusedError("This judgment is no longer pending.", "not_pending")
    if judgment.city_god_status not in statuses:
        raise CityGodRefusedError(
            f"This case is not awaiting the city god ({judgment.city_god_status or 'no preliminary review'}).",
            "not_at_city_god", city_god_status=judgment.city_god_status,
        )


def _assert_may_act(user, judgment) -> None:
    if not may_act(user, judgment):
        raise CityGodRefusedError(
            "Only officers assigned to this city god, or a hall administrator, can review its cases.",
            "not_city_god_officer", status=403, city_god=str(judgment.city_god_id),
        )


def _save(judgment, *fields) -> None:
    judgment.save(update_fields=[*fields, *_BOOKKEEPING])


def send_on(pk, user, note: str = "") -> Judgment:
    """解送:案子进十殿的队列。PENDING 与 RETURNED 都可以解送(补好资料之后)。"""
    with transaction.atomic():
        judgment = _lock(pk)
        _assert_at_city_god(judgment, *AT_CITY_GOD)
        _assert_may_act(user, judgment)
        judgment.city_god_status = CityGodStatus.SENT_ON
        judgment.city_god_note = note
        judgment.sent_on_at = timezone.now()
        judgment.sent_on_by = user
        _save(judgment, "city_god_status", "city_god_note", "sent_on_at", "sent_on_by")
        _event(judgment, "CITY_GOD_SENT_ON")
    return judgment


def return_case(pk, user, note: str) -> Judgment:
    """退回补正:缺资料,案子留在城隍处。已经退回的再退 → 409 `not_at_city_god`。"""
    with transaction.atomic():
        judgment = _lock(pk)
        _assert_at_city_god(judgment, CityGodStatus.PENDING)
        _assert_may_act(user, judgment)
        judgment.city_god_status = CityGodStatus.RETURNED
        judgment.city_god_note = note
        _save(judgment, "city_god_status", "city_god_note")
        _event(judgment, "CITY_GOD_RETURNED")
        _notify_after_commit(_hall_admins(judgment.tenant_id, exclude=user.pk), "CITY_GOD_CASE_RETURNED", judgment,
                             city_god=judgment.city_god.name, by=user.display_name or user.username, reason=note)
    return judgment


def transfer(pk, user, target: CityGod) -> Judgment:
    """改交另一位城隍(视图要 `judgment.assign`)。目标必须是同一殿、未删除的城隍。"""
    with transaction.atomic():
        judgment = _lock(pk)
        _assert_at_city_god(judgment, *AT_CITY_GOD)
        if target is None or target.is_deleted or target.tenant_id != judgment.tenant_id:
            raise CityGodRefusedError("No such city god in this case's hall.", "invalid_city_god", status=400)
        if target.pk == judgment.city_god_id:
            return judgment
        previous, previous_name = judgment.city_god_id, judgment.city_god.name
        judgment.city_god = target
        judgment.city_god_status = CityGodStatus.PENDING
        _save(judgment, "city_god", "city_god_status")
        received(judgment, transferred_from=previous, transferred_from_name=previous_name)
    return judgment


# ── 事件与通知 ──────────────────────────────────────────────────────────


def _event(judgment, event_type, **extra) -> None:
    """记在灵魂的时间线上。不带批语与经办官员(与申诉的事件一样不说是谁)。"""
    from apps.events.services import EventService

    EventService.log(judgment.soul, event_type, {
        "judgment_id": str(judgment.pk), "case_number": judgment.case_number,
        "city_god_id": str(judgment.city_god_id), "city_god_name": judgment.city_god.name,
        "status": judgment.city_god_status, **extra,
    })


def _hall_admins(tenant_id, exclude=None) -> list:
    """本殿在职的 ADMIN 与殿主;本殿一个都没有时退到全局 ADMIN(与「请管理员改派」同一条退路)。"""
    from apps.authentication.models import User

    people = User.objects.filter(is_active=True).exclude(pk=exclude)
    mine = list(people.filter(tenant_id=tenant_id, role__in=("ADMIN", "MODERATOR")).values_list("pk", flat=True))
    return mine or list(people.filter(role="ADMIN", tenant__isnull=True).values_list("pk", flat=True))


def _notify_after_commit(user_ids, notification_type, judgment, **params) -> None:
    """两种通知各有自己的类型(个人中心「城隍初审」一类,可关);文案键见 `messages.KIND_BY_TYPE`。"""
    if not user_ids:
        return
    params = {"soul": judgment.soul.name, **params}
    judgment_id = str(judgment.pk)

    def send():
        from apps.authentication.models import User
        from apps.events.services import EventService
        from apps.notifications import messages

        title, body = messages.render(messages.DEFAULT_LOCALE, messages.KIND_BY_TYPE[notification_type], params)
        for user in User.objects.filter(pk__in=user_ids, is_active=True):
            EventService.notify_user(user, title=title, message=body, notification_type=notification_type,
                                     related_resource="judgment", related_id=judgment_id, params=params)

    transaction.on_commit(send)
