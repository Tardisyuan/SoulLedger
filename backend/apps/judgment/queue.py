"""The judgment queue's selectors: what "pending" means, the four groups, the counts, the filterset.

Moved out of `views.py` (2026-11-26): the dossier and the officer assistant read them too, and should not import a
views module for a predicate. `views.py` re-exports every name.
"""
from django.db.models import Count, Q
from django.utils import timezone
from django_filters import rest_framework as filters

from apps.judgment import claims, sources
from apps.judgment.models import AT_CITY_GOD, OPEN_Q, Judgment
from apps.judgment.serializers import QueueGroup

#: 「未结案」在队列里的定义。与 `_pending_queue` 同一组列,写一次。
#: 还在城隍那里初审的不算 —— 解送之前十殿看不到它(apps/judgment/city_gods.py)。
PENDING = OPEN_Q & ~Q(city_god_status__in=AT_CITY_GOD)


#: 「退回重审」(v4 `queue.tab.returned`):判官判了 RETRY、另开的那一件(`weighing.open_retrial`)。
#: 天平摇摆的再称、审批流驳回后的重开不算 —— 那两种不是判官退回的。
RETURNED = Q(retrial_of__verdict="RETRY")


def group_q(group: str, user) -> Q:
    """一个队列组的谓词(不含 `PENDING`)。四个组互斥:暂缓优先,其余按认领人分。"""
    not_deferred = Q(deferred_at__isnull=True)
    if group == QueueGroup.MINE:
        return not_deferred & Q(claimed_by=user)
    if group == QueueGroup.UNCLAIMED:
        return not_deferred & Q(claimed_by__isnull=True)
    if group == QueueGroup.OTHERS:
        return not_deferred & Q(claimed_by__isnull=False) & ~Q(claimed_by=user)
    if group == QueueGroup.DEFERRED:
        return Q(deferred_at__isnull=False)
    raise ValueError(group)


class JudgmentFilter(filters.FilterSet):
    """Custom filter for Judgment - handles verdict=null for pending judgments."""
    has_verdict = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull", exclude=True)
    verdict_null = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull")
    # 队列分组。**隐含「未结案」**:「待认领」问的是还有谁没人办,一件已结案、认领人
    # 为空的旧案子不在其中。
    group = filters.ChoiceFilter(choices=QueueGroup.CHOICES, method="filter_group")
    # 殿。`court` 是自由文本列(「第一殿」),按原值精确匹配。
    court = filters.CharFilter(field_name="court", lookup_expr="exact")
    # 引用了这条律条的判决(语料页「被引用」清单)。与 `StatuteViewSet` 的
    # `citation_count` 同一口径:存活的引用行,落在调用者看得见的判决上。
    statute = filters.UUIDFilter(method="filter_statute")
    # 滞留(`stale_since` 非空,定时任务盖的章)。`?stale=true` 只要滞留的,`false` 排除它们。
    stale = filters.BooleanFilter(field_name="stale_since", lookup_expr="isnull", exclude=True)
    # v4 队列:「已过期限」(D10,`apps/judgment/deadline.py`,待定中的不算)与「退回重审」(`RETURNED`)。
    # 两者都隐含「未结案」。
    overdue = filters.BooleanFilter(method="filter_overdue")
    returned = filters.BooleanFilter(method="filter_returned")
    # 案卷台的来源(`apps/judgment/sources.py`)。不隐含「未结案」:来源是行本身的属性;案卷台总是同时带 `group`。
    source = filters.ChoiceFilter(choices=sources.CHOICES, method="filter_source")
    # 有人请求改派、还没批的(`reassign_requested_at` 非空;认领人一变服务端就清掉)。隐含「未结案」。
    # 网页待办条「改派请求」一格与它链到的队列同一个口径。
    reassign_requested = filters.BooleanFilter(method="filter_reassign_requested")

    class Meta:
        model = Judgment
        fields = ["soul", "civilization", "verdict", "is_final"]

    def filter_group(self, queryset, name, value):
        return queryset.filter(PENDING & group_q(value, self.request.user))

    def filter_overdue(self, queryset, name, value):
        from apps.judgment import deadline

        q = deadline.overdue_q(queryset)
        pending = deadline.with_due_base(queryset.filter(PENDING))
        return pending.filter(q) if value else pending.exclude(q)

    def filter_returned(self, queryset, name, value):
        pending = queryset.filter(PENDING)
        return pending.filter(RETURNED) if value else pending.exclude(RETURNED)

    def filter_reassign_requested(self, queryset, name, value):
        pending = queryset.filter(PENDING)
        asked = Q(reassign_requested_at__isnull=False)
        return pending.filter(asked) if value else pending.exclude(asked)

    def filter_source(self, queryset, name, value):
        return queryset.filter(sources.q(value, queryset))

    def filter_statute(self, queryset, name, value):
        return queryset.filter(pk__in=citing_judgments(value))


def citing_judgments(statute_id):
    """Judgment ids with a live citation of this article — the list side of the
    corpus's 「被引用 N 件」. `StatuteViewSet.get_queryset` counts the same rows."""
    from apps.judgment.models import JudgmentCitation

    return JudgmentCitation.all_objects.filter(statute_id=statute_id, is_deleted=False).values("judgment_id")


def queue_counts_of(queryset, user) -> dict:
    """`total` 加四个组各几件,加案卷台的三个来源(`sources`),一条查询。`queryset` 已收窄到未结案件与调用者的范围。
    `queue_counts` 与官员助手的 `judgment_queue_counts` 工具(apps/soul_assist/officer_tools.py)共用。"""
    from apps.judgment import deadline

    counts = sources.annotate(deadline.with_due_base(queryset)).aggregate(
        total=Count("pk"),
        **{group: Count("pk", filter=group_q(group, user)) for group, _label in QueueGroup.CHOICES},
        # v4 队列的两个标签(与 `?overdue=` / `?returned=` 同一谓词;与四个组不互斥)。
        overdue=Count("pk", filter=deadline.overdue_q(queryset)),
        returned=Count("pk", filter=RETURNED),
        # 第六十三批 二 f:「待认领」里此刻谁都认领不了的(`claims.held_q`,与认领的拒绝同一条规则)。
        # 组头读 `claimable_count`,组尾「候着的 · N」读 `held_count`;两者相加等于 `unclaimed`。
        held_count=Count("pk", filter=group_q(QueueGroup.UNCLAIMED, user) & claims.held_q(timezone.localdate(), queryset)),
        **_source_aggregates(),
    )
    counts["claimable_count"] = counts[QueueGroup.UNCLAIMED] - counts["held_count"]
    counts["sources"] = _pop_sources(counts)
    return counts


def source_counts_of(queryset) -> dict:
    """案卷台三个来源各几件(`apps/judgment/sources.py`);互斥,相加等于这个查询集的件数。"""
    return _pop_sources(sources.annotate(queryset).aggregate(**_source_aggregates()))


def _source_aggregates() -> dict:
    return {f"source_{value}": Count("pk", filter=Q(queue_source=value)) for value in sources.VALUES}


def _pop_sources(counts) -> dict:
    return {value: counts.pop(f"source_{value}") for value in sources.VALUES}


def visible_judgments(request):
    """The judgments this caller's judgment LIST would show — tenant scope,
    residence reads and row-level DataScope, by running the list's own
    `get_queryset` rather than restating it. `citation_count` counts inside
    this set so the count and `?statute=` list cannot disagree."""
    from apps.core.viewsets import scoped_queryset
    from apps.judgment.views import JudgmentViewSet

    return scoped_queryset(JudgmentViewSet, request).values("pk")
