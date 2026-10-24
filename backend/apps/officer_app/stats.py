"""「我的数」(2026-10-25 用户决定):官员 App 统计页。只数调用者自己的,不分殿(官员只属于一个殿)。

* `concluded_this_month` / `concluded_total` —— 我结的案(`Judgment.concluded_by`),本月从本地时间 1 日 0 点起。
* `open_claims` —— 我认领着、还没结的(与审判队列「我的」同一组列)。
* `appeals_reviewed` —— 我复核并已有结论的申诉(维持 / 改判);`appeals_in_review` —— 我认领着还没决定的。
"""
from apps.judgment.models import AppealStatus, Judgment, JudgmentAppeal
from apps.reincarnation.services import _month_start


def of(user) -> dict:
    concluded = Judgment.objects.filter(concluded_by=user)
    appeals = JudgmentAppeal.objects.filter(reviewer=user)
    return {
        "concluded_this_month": concluded.filter(concluded_at__gte=_month_start()).count(),
        "concluded_total": concluded.count(),
        "open_claims": Judgment.objects.filter(claimed_by=user, verdict__isnull=True, is_final=False,
                                               is_archived=False).count(),
        "appeals_reviewed": appeals.filter(status__in=(AppealStatus.UPHELD, AppealStatus.AMENDED)).count(),
        "appeals_in_review": appeals.filter(status=AppealStatus.IN_REVIEW).count(),
    }
