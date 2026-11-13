"""案卷台的「来源」(Design 第三十批):一件未结案件从哪里来,与别处等着办的几样东西有几件。

**队列行的来源**(`source`,三选一,互斥且穷尽,按下面的先后取第一个成立的):

* ``city_god`` —— 经城隍初审解送来的(`city_god_status == SENT_ON`,只在地府)。还在城隍那里的
  (PENDING / RETURNED)不在十殿的队列里,数在 ``elsewhere.city_god_review``。
* ``cross`` —— 跨域:灵魂此刻不在原属的殿(`soul.home_tenant != judgment.tenant`,暂居地的加减项审判、
  原属看暂居地的只读行),或这件案子挂着一场还没了结的跨殿联审(PROPOSED / ACTIVE)。
* ``queue`` —— 其余的,普通审判队列。

「分诊」不是来源:它是同一个未结队列一件一件过的模式(`/judgment/queue`,`GET /judgment/next/`,
默认不含暂缓),件数 = `mine + unclaimed + others`。

**别处的数**(`elsewhere`,不是十殿队列里的行,不随队列的筛选走;调用者不持对应读码时是 null):

==================  ========================  ==========================================  =================
键                  是什么                     范围(与那个列表同一个 get_queryset)          网页 / 官员端去处
==================  ========================  ==========================================  =================
``appeal``          还没结论的申诉               `JudgmentAppealViewSet`,PENDING / IN_REVIEW    /judgment/appeals
``city_god_review`` 还在城隍处初审的案子          `CityGodCaseViewSet`,PENDING / RETURNED        /city-god-cases
``cross_judgment``  还没了结的跨殿联审            `CrossTenantJudgmentViewSet`,PROPOSED / ACTIVE /cross-judgments
``capture_due``     阳寿已到、待发勾魂牒的灵魂     `capture_views._souls` + `capture.due_souls`    /judgment/capture-due
``rebirth_application`` 还没结论的转生申请     `OfficerRebirthApplicationViewSet`,审核中 / 申诉中 /rebirth-applications
==================  ========================  ==========================================  =================

转生申请是第七个来源(用户 2026-11-13 决定):它要人批,所以进「审」,而不是册 · 卷宗「轮回」分页的筛选。
"""
from django.db.models import Case, CharField, Exists, F, OuterRef, Q, Value, When

QUEUE = "queue"
CITY_GOD = "city_god"
CROSS = "cross"
CHOICES = [(QUEUE, "审判队列"), (CITY_GOD, "城隍初审"), (CROSS, "跨域")]
VALUES = [value for value, _label in CHOICES]

#: `elsewhere` 的键 → 所需读码。
ELSEWHERE = {
    "appeal": "judgment.read",
    "city_god_review": "city_god.read",
    "cross_judgment": "cross_judgment.read",
    "capture_due": "capture.read",
    "rebirth_application": "workflow.read",
}


def _open_cross_statuses():
    from apps.dispatch.models import JudgmentStatus

    return (JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE)


def _away_q() -> Q:
    """灵魂不在原属的殿审:两列都非空且不相等(空的不算跨域)。"""
    return Q(soul__home_tenant__isnull=False, tenant__isnull=False) & ~Q(soul__home_tenant=F("tenant"))


def annotate(queryset):
    """给每行加 `queue_source`。`queryset` 已经按调用者划好范围;子查询只按外键挂在这一行上。"""
    from apps.dispatch.models import CrossTenantJudgment
    from apps.judgment.models import CityGodStatus

    if "queue_source" in queryset.query.annotations:  # 列表已经加过,`?source=` 与计数再来一次时不重复
        return queryset
    open_cross = Exists(CrossTenantJudgment.objects.filter(judgment=OuterRef("pk"), status__in=_open_cross_statuses()))
    return queryset.annotate(queue_source=Case(
        When(city_god_status=CityGodStatus.SENT_ON, then=Value(CITY_GOD)),
        When(Q(open_cross) | _away_q(), then=Value(CROSS)),
        default=Value(QUEUE),
        output_field=CharField(),
    ))


def q(value) -> Q:
    """`?source=value` 的 WHERE 条件:与 `annotate` 同一判定,但不进 SELECT —— 列表按它筛时不多一列逐行子查询。"""
    from apps.dispatch.models import CrossTenantJudgment
    from apps.judgment.models import CityGodStatus

    city_god = Q(city_god_status=CityGodStatus.SENT_ON)
    cross = Q(Exists(CrossTenantJudgment.objects.filter(
        judgment=OuterRef("pk"), status__in=_open_cross_statuses()))) | _away_q()
    return {CITY_GOD: city_god, CROSS: ~city_god & cross, QUEUE: ~city_god & ~cross}[value]


def attach(judgments) -> None:
    """给一页对象设好 `queue_source`,一条查询取「挂着未了结联审」的那几件。

    列表不用 `annotate`:SELECT 里的 EXISTS 在 PostgreSQL 上是一行执行一次的 SubPlan
    (`tests/test_datascope_b8_pg_performance.py` 钉住列表不许有),而这一页只有几十行。"""
    from apps.dispatch.models import CrossTenantJudgment

    pending = [j for j in judgments if not getattr(j, "queue_source", None)]
    open_cross = set(CrossTenantJudgment.objects.filter(
        judgment_id__in=[j.pk for j in pending], status__in=_open_cross_statuses()).values_list("judgment_id", flat=True))
    for judgment in pending:
        judgment.queue_source = _source(judgment, judgment.pk in open_cross)


def _source(judgment, has_open_cross) -> str:
    from apps.judgment.models import CityGodStatus

    if judgment.city_god_status == CityGodStatus.SENT_ON:
        return CITY_GOD
    home, here = judgment.soul.home_tenant_id, judgment.tenant_id
    if has_open_cross or (home is not None and here is not None and home != here):
        return CROSS
    return QUEUE


def source_of(judgment) -> str:
    """单个对象的同一个判定(不是从 `annotate` 过的查询集来的对象,如认领、`next/` 的回包)。"""
    from apps.dispatch.models import CrossTenantJudgment
    from apps.judgment.models import CityGodStatus

    annotated = getattr(judgment, "queue_source", None)
    if annotated:
        return annotated
    if judgment.city_god_status == CityGodStatus.SENT_ON:
        return CITY_GOD
    return _source(judgment, CrossTenantJudgment.objects.filter(
        judgment_id=judgment.pk, status__in=_open_cross_statuses()).exists())


def elsewhere_counts(request) -> dict:
    """别处等着办的几样(见文件头的表)。每样都跑那个列表自己的 `get_queryset`,不另写范围。"""
    from apps.core.permissions import user_has_permission
    from apps.dispatch import capture as capture_service
    from apps.dispatch.capture_views import _souls
    from apps.dispatch.views import CrossTenantJudgmentViewSet
    from apps.judgment.appeal_views import JudgmentAppealViewSet
    from apps.judgment.city_god_views import CityGodCaseViewSet
    from apps.judgment.models import AT_CITY_GOD, OPEN_APPEAL_STATUSES
    from apps.soul_accounts.models import OPEN_APPLICATION_STATUSES
    from apps.soul_accounts.views import OfficerRebirthApplicationViewSet

    def scoped(viewset, action="list"):
        return viewset(request=request, action=action, kwargs={}, format_kwarg=None).get_queryset()

    counters = {
        "appeal": lambda: scoped(JudgmentAppealViewSet).filter(status__in=OPEN_APPEAL_STATUSES).count(),
        # `retrieve` 而不是 `list`:列表的 get_queryset 还读 `?status=` / `?city_god=` / `?mine=`,这里不该跟着变。
        "city_god_review": lambda: scoped(CityGodCaseViewSet, "retrieve").filter(
            city_god_status__in=AT_CITY_GOD).count(),
        "cross_judgment": lambda: scoped(CrossTenantJudgmentViewSet).filter(
            status__in=_open_cross_statuses()).count(),
        "capture_due": lambda: capture_service.due_souls(_souls(request)).count(),
        "rebirth_application": lambda: scoped(OfficerRebirthApplicationViewSet).filter(
            status__in=OPEN_APPLICATION_STATUSES).count(),
    }
    return {key: counters[key]() if user_has_permission(request.user, codename) else None
            for key, codename in ELSEWHERE.items()}
