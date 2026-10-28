"""勾魂(2026-10-28,只在地府):阳寿尽 → 发牒 → 拘到 → 交接。`CaptureWarrant` 只在这里写。

依据:docs/01 §二 第五层(黑白无常「听从城隍指示,来阳间勾魂」,牛头马面「押解人犯前去审判」)、
02「黑白无常」「牛头马面」、08 §4.1(城隍「缉拿鬼魂:派遣黑白无常等勾魂」)。

* 发牒(`issue`):地府、在世、阳寿(`Soul.fated_death_*`)已到、手上没有未了结的牒。发牒的城隍按出身地配
  (`city_gods.match`,与收案同一条规则)。鬼差不指定时按功过建议:过多于功(功过余额 < 0)
  派牛头马面,其余黑白无常(用户 2026-10-29 定,与界面文案 `souls.capture.escort_hint` 同一句话;
  此前用 05 §3.2「≤ -500 大恶」那条线,与文案对不上)。
* 拘到(`capture`):ISSUED → CAPTURED。
* 交接(`hand_over`):CAPTURED → HANDED_OVER,并在同一事务里登记死亡(`Soul.die`,死亡日 = 拘到那天),
  案子交给发牒的城隍初审 —— 与死亡同步走的是同一个入口,不另开一套。`die()` 拒绝(灵魂已不在世)则整笔回滚。
* 撤销(`cancel`):ISSUED / CAPTURED → CANCELLED,理由必填。
* 别的路(死亡同步、土地公、官员手点)先登记了死亡:还开着的牒作废(`void_on_death`,由 `Soul.transition_to` 调)。

没有定时任务自动发牒:celery beat 还没部署。`due_souls` 列出阳寿已到而没有牒的灵魂,由官员发。
事件与那一笔同一事务(CAPTURE_WARRANT_ISSUED / SOUL_CAPTURED / CAPTURE_HANDED_OVER / CAPTURE_WARRANT_CANCELLED),
payload 不带经办官员与理由。
"""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.dispatch.models import OPEN_CAPTURE, CaptureEscort, CaptureStatus, CaptureWarrant
from apps.souls.models import Civilization, Soul, SoulState

class CaptureRefused(APIException):
    status_code = 409
    default_code = "capture_refused"

    def __init__(self, code, detail, status=409):
        super().__init__({"code": code, "detail": detail})
        self.status_code = status


def suggested_escort(soul) -> str:
    return CaptureEscort.NIUTOU_MAMIAN if soul.karmic_balance < 0 else CaptureEscort.WUCHANG


def lifespan_ended_q(today=None) -> Q:
    """阳寿(完整的公元日期)已到:≤ 今天。没登记阳寿的不算。"""
    today = today or timezone.localdate()
    y, m, d = today.year, today.month, today.day
    return (Q(fated_death_year__isnull=False, fated_death_month__isnull=False, fated_death_day__isnull=False)
            & (Q(fated_death_year__lt=y) | Q(fated_death_year=y, fated_death_month__lt=m)
               | Q(fated_death_year=y, fated_death_month=m, fated_death_day__lte=d)))


def due_souls(souls):
    """`souls`(调用方已按租户过滤)里阳寿已到、还在世、没有未了结勾魂牒的地府灵魂。"""
    open_ids = CaptureWarrant.objects.filter(status__in=OPEN_CAPTURE).values("soul_id")
    return (souls.filter(lifespan_ended_q(), _diyu_q(), current_state=SoulState.ALIVE).exclude(pk__in=open_ids)
            .order_by("fated_death_year", "fated_death_month", "fated_death_day", "name"))


def _diyu_q() -> Q:
    """灵魂此刻归地府管辖:与 `Tenant.civilization` 同一个读法(先认种子表,再认新殿登记的文明)。"""
    from apps.souls.models import TENANT_CIVILIZATION

    seeded = [code for code, civ in TENANT_CIVILIZATION.items() if civ == Civilization.CHINESE]
    return Q(tenant__code__in=seeded) | (Q(tenant__declared_civilization=Civilization.CHINESE)
                                         & ~Q(tenant__code__in=list(TENANT_CIVILIZATION)))


def issue(soul, escort=None) -> CaptureWarrant:
    from apps.judgment import city_gods

    if escort is not None and escort not in CaptureEscort.values:
        raise CaptureRefused("invalid_escort", f"{escort!r} is not an escort.", status=400)
    with transaction.atomic():
        locked = Soul.all_objects.select_for_update(of=("self",)).get(pk=soul.pk)
        if locked.civilization != Civilization.CHINESE:
            raise CaptureRefused("not_diyu", "Only a soul of Diyu is fetched by the ghost escorts.")
        if locked.current_state != SoulState.ALIVE:
            raise CaptureRefused("not_alive", f"The soul is {locked.current_state}, not alive.")
        if not Soul.all_objects.filter(lifespan_ended_q(), pk=locked.pk).exists():
            raise CaptureRefused("lifespan_not_ended", "The soul's fated date has not come (or is not recorded).")
        if CaptureWarrant.objects.filter(soul=locked, status__in=OPEN_CAPTURE).exists():
            raise CaptureRefused("warrant_open", "This soul already has an open capture warrant.")
        warrant = CaptureWarrant.objects.create(
            tenant_id=locked.tenant_id, soul=locked, city_god=city_gods.match(locked.tenant_id, locked.origin_location),
            escort=escort or suggested_escort(locked))
        _event(warrant, "CAPTURE_WARRANT_ISSUED")
    return warrant


def _lock(pk) -> CaptureWarrant:
    return CaptureWarrant.all_objects.select_for_update(of=("self",)).get(pk=pk)


def _assert_status(warrant, *statuses):
    if warrant.status not in statuses:
        raise CaptureRefused("wrong_status", f"The warrant is {warrant.status}.")


def capture(pk) -> CaptureWarrant:
    with transaction.atomic():
        warrant = _lock(pk)
        _assert_status(warrant, CaptureStatus.ISSUED)
        warrant.status = CaptureStatus.CAPTURED
        warrant.captured_at = timezone.now()
        warrant.save(update_fields=["status", "captured_at", "version", "update_user", "update_time"])
        _event(warrant, "SOUL_CAPTURED")
    return warrant


def hand_over(pk, location: str = "") -> CaptureWarrant:
    with transaction.atomic():
        warrant = _lock(pk)
        _assert_status(warrant, CaptureStatus.CAPTURED)
        # 先写成 HANDED_OVER:`die()` 里的 `void_on_death` 只作废还开着的牒。
        warrant.status = CaptureStatus.HANDED_OVER
        warrant.handed_over_at = timezone.now()
        warrant.save(update_fields=["status", "handed_over_at", "version", "update_user", "update_time"])
        soul = Soul.all_objects.get(pk=warrant.soul_id)
        judgment = soul.die(death_date=timezone.localdate(warrant.captured_at), location=location,
                            account_origin="OFFICER", city_god=warrant.city_god)
        if judgment is None:
            raise CaptureRefused("not_alive", f"The soul is {soul.current_state}, not alive.")
        warrant.judgment = judgment
        warrant.save(update_fields=["judgment"])
        _event(warrant, "CAPTURE_HANDED_OVER", judgment_id=str(judgment.pk))
    return warrant


def cancel(pk, reason: str) -> CaptureWarrant:
    if not (reason or "").strip():
        raise CaptureRefused("reason_required", "A reason is required to cancel a warrant.", status=400)
    with transaction.atomic():
        warrant = _lock(pk)
        _assert_status(warrant, *OPEN_CAPTURE)
        warrant.status = CaptureStatus.CANCELLED
        warrant.cancel_reason = reason.strip()
        warrant.save(update_fields=["status", "cancel_reason", "version", "update_user", "update_time"])
        _event(warrant, "CAPTURE_WARRANT_CANCELLED", via="officer")
    return warrant


def void_on_death(soul) -> None:
    """死亡已经由别的路登记:还开着的牒作废,在调用方(`Soul.transition_to`)的事务里。"""
    for warrant in CaptureWarrant.all_objects.select_for_update(of=("self",)).filter(
            soul_id=soul.pk, status__in=OPEN_CAPTURE, is_deleted=False):
        warrant.status = CaptureStatus.CANCELLED
        warrant.save(update_fields=["status", "version", "update_user", "update_time"])
        _event(warrant, "CAPTURE_WARRANT_CANCELLED", via="death")


def _event(warrant, event_type, **extra) -> None:
    from apps.events.services import EventService

    EventService.log(warrant.soul, event_type, {
        "warrant_id": str(warrant.pk), "escort": warrant.escort, "status": warrant.status,
        "city_god_name": warrant.city_god.name if warrant.city_god_id else None, **extra,
    })
