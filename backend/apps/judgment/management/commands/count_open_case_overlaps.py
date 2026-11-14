"""数「一魂同时只有一件未结案」被破例的灵魂(be-domain 1.5;架构审查决定 8,2026-11-14)。

只数,不改。这条规则今天是策略:`JudgmentService.open_case` 在灵魂行锁下检查,ADMIN 豁免(修卡住的案),
`weighing.open_retrial` 在原案结案的同一事务里另开一案。要不要把它升成部分唯一约束
(`UniqueConstraint(soul) WHERE verdict IS NULL AND NOT is_final AND NOT is_deleted AND kind='ORIGINAL'`)
由用户定,定之前先拿这里的数。

两种口径都给:
  * any kind —— `open_judgments` 的定义(`open_case` 检查的就是它);
  * ORIGINAL only —— be-domain 建议的那条约束会拒绝的行。
跨租户数(`all_objects`):这条规则本来就不分租户。
"""
from django.core.management.base import BaseCommand
from django.db.models import Count

from apps.judgment.models import Judgment, JudgmentKind


def overlaps(original_only=False):
    """{soul_id: 未结案件数},只列多于一件的。"""
    rows = Judgment.all_objects.filter(verdict__isnull=True, is_final=False, is_deleted=False)
    if original_only:
        rows = rows.filter(kind=JudgmentKind.ORIGINAL)
    return dict(rows.values("soul_id").annotate(n=Count("id")).filter(n__gt=1).values_list("soul_id", "n"))


class Command(BaseCommand):
    help = "Count souls with more than one open judgment (reports only; changes nothing)."

    def add_arguments(self, parser):
        parser.add_argument("--list", type=int, default=20, help="How many soul ids to print per measure (default 20).")

    def handle(self, *args, **options):
        for label, found in (("any kind", overlaps()), ("ORIGINAL only", overlaps(original_only=True))):
            self.stdout.write(f"{label}: {len(found)} soul(s) with more than one open case, "
                              f"{sum(found.values())} open case(s) among them")
            for soul_id, n in sorted(found.items(), key=lambda item: (-item[1], str(item[0])))[:options["list"]]:
                self.stdout.write(f"  {soul_id}  {n}")
