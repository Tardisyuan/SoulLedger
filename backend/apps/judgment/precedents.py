"""「据 · 先例」:审判台上给一份审判找相似的已结案审判。

候选:同一租户、同一文明、已结案(`verdict` 非空)、未归档,且**不是同一个灵魂**
(同一灵魂的前案是它的履历,不是先例)。租户取这份审判自己的 `tenant`,不取请求者的
—— ADMIN 不分租户,但先例不跨租户。

排序,依次比较(前一项相同才看后一项):

1. 同一殿(`court` 字符串相同且非空)在前;
2. 业力余额与本案余额的差的绝对值,小的在前;
3. 与本案共同援引的法条数,多的在前;
4. 结案时间,新的在前;最后按 id,让结果稳定。

「余额」是结案时的快照 `Judgment.concluded_balance`(采信后的功 − 过);快照为 null 的
旧案退回灵魂**现在**的 merit − demerit。本案自己已结案且有快照时也用快照,否则用现在的。
整个排序是一条 SQL:没有逐行打分,也没有 N+1。
"""
from django.db.models import BooleanField, Case, Count, F, IntegerField, Q, Value, When
from django.db.models.functions import Abs, Coalesce

DEFAULT_LIMIT = 5
MAX_LIMIT = 20


def precedents_for(judgment, limit: int = DEFAULT_LIMIT):
    from apps.judgment.models import Judgment

    target_balance = (
        judgment.concluded_balance
        if judgment.concluded_balance is not None
        else judgment.soul.merit_score - judgment.soul.demerit_score
    )
    balance = Coalesce(F("concluded_balance"), F("soul__merit_score") - F("soul__demerit_score"))
    statute_ids = list(judgment.citations.values_list("statute_id", flat=True))

    same_court = (
        Case(When(court=judgment.court, then=Value(True)), default=Value(False), output_field=BooleanField())
        if judgment.court
        else Value(False, output_field=BooleanField())
    )
    shared = (
        Count("citations", filter=Q(citations__statute_id__in=statute_ids), distinct=True)
        if statute_ids
        else Value(0, output_field=IntegerField())
    )
    return list(
        Judgment.objects.filter(
            tenant_id=judgment.tenant_id,
            civilization=judgment.civilization,
            verdict__isnull=False,
            is_archived=False,
        )
        .exclude(pk=judgment.pk)
        .exclude(soul_id=judgment.soul_id)
        .select_related("soul", "disposition__destination_realm")
        .annotate(
            same_court=same_court,
            balance=balance,
            balance_distance=Abs(balance - target_balance),
            shared_statutes=shared,
        )
        .order_by("-same_court", "balance_distance", "-shared_statutes", F("concluded_at").desc(nulls_last=True), "pk")
        [:limit]
    )
