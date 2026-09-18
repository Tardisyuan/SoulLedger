"""为存量灵魂补建受刑计划(docs/ARCHITECTURE-sentence-plan.md §7.2)。幂等。

只描述**已经发生的事**:不跑推进、不发事件、不动灵魂 / 处置 / 调拨记录。
不放进 schema 迁移的数据步骤 —— PostgreSQL 上一条失败语句会中止整个迁移事务。

规则(设计稿 §7.2,偏差在行内注明):

1. 每个灵魂、每个 `cycle`,有 `verdict IS NOT NULL` 的审判而没有计划 → 建计划,
   `origin_judgment_id` = 该世最早结案的那份。**只看原属租户的审判**:暂居地的审判
   不是原审判(G1),拿它当原属节点会把别处的处置记成原属的。
2. 原属节点:order=1,抄那份审判的处置;已执行且永久 → ETERNAL,已执行 → COMPLETED,否则 ACTIVE。
3. 该世里每条 EXECUTED / RETURNED 的调拨记录(按 executed_at)追加一个执行地节点,
   处置取执行地 `created_at >= executed_at` 的首条;RETURNED → COMPLETED(手动回归 → ABORTED);
   EXECUTED 且处置已执行 → ETERNAL / COMPLETED;否则 ACTIVE。
4. 计划:这一世早已过去 → COMPLETED;有 ETERNAL 节点且灵魂在外 → HELD;灵魂已离开
   DISPOSED / JUDGING(REINCARNATING、SETTLED、ALIVE 等)→ COMPLETED;否则 ACTIVE。
   `completed_at` 取原属处置的 `executed_at`(设计稿写「状态变化事件时间」,两者由同一次
   `DispositionService.execute` 写出;没有执行时间的留空)。
5. **会违反约束的形状不建,只报告**:最常见的是「原属处置还没执行、灵魂已被调去外地受刑」,
   那是两个同时 ACTIVE 的节点,而「一份计划至多一个在路上或受刑中的节点」不允许。
   这类灵魂打印 id,等人决定(设计稿没有写这种存量怎么描述)。

第二次运行,「建了」的计数必须全为 0。
"""
from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from apps.sentence_plan.models import (
    OCCUPYING_NODE_STATUSES,
    SentenceNode,
    SentenceNodeStatus,
    SentencePlan,
    SentencePlanStatus,
)
from apps.souls.models import Soul, SoulState

#: 灵魂还在「受刑」这一段里的状态;其余状态说明这一世的受刑已经结束。
_IN_SENTENCE = (SoulState.JUDGING, SoulState.DISPOSED)


def _executed_status(disposition):
    if disposition is None or not disposition.is_executed:
        return SentenceNodeStatus.ACTIVE
    return SentenceNodeStatus.ETERNAL if disposition.is_eternal else SentenceNodeStatus.COMPLETED


def _content(disposition):
    if disposition is None:
        return {}
    return {
        "realm_code": disposition.destination_realm.realm_code if disposition.destination_realm_id else "",
        "sentence_years": disposition.sentence_years,
        "is_eternal": disposition.is_eternal,
        "memory_reset": disposition.memory_reset,
        "disposition_id": disposition.pk,
    }


def _manual_return(record):
    return SoulEvent.objects.filter(
        soul_id=record.soul_id,
        payload__action="DISPATCH_RETURNED",
        payload__dispatch_id=str(record.pk),
        payload__trigger=DispatchService.RETURN_MANUAL,
    ).exists()


class Command(BaseCommand):
    help = "为存量灵魂补建受刑计划(幂等;只描述已发生的事,不推进)。"

    def handle(self, *args, **options):
        counts = Counter()
        conflicts = []
        souls = Soul.all_objects.filter(is_deleted=False).select_related("tenant", "home_tenant").order_by("pk")
        for soul in souls.iterator():
            home = soul.home_tenant or soul.tenant
            if home is None:
                continue
            judgments = (
                Judgment.all_objects.filter(soul=soul, tenant=home, is_deleted=False, verdict__isnull=False)
                .order_by("cycle", "concluded_at", "created_at")
            )
            first_by_cycle = {}
            for judgment in judgments:
                first_by_cycle.setdefault(judgment.cycle, judgment)
            cycles = sorted(first_by_cycle)
            for i, cycle in enumerate(cycles):
                if SentencePlan.all_objects.filter(soul=soul, cycle=cycle).exists():
                    counts["already_planned"] += 1
                    continue
                next_start = first_by_cycle[cycles[i + 1]].concluded_at if i + 1 < len(cycles) else None
                built = self._build(soul, home, first_by_cycle[cycle], next_start)
                if built is None:
                    conflicts.append(f"{soul.pk} cycle {cycle}")
                    counts["skipped_conflict"] += 1
                    continue
                with transaction.atomic():
                    plan, nodes = built
                    plan.save()
                    for node in nodes:
                        node.plan = plan
                        node.save()
                counts["plans_created"] += 1
                counts["nodes_created"] += len(nodes)

        for key in ("plans_created", "nodes_created", "already_planned", "skipped_conflict"):
            self.stdout.write(f"{key}: {counts[key]}")
        for line in conflicts:
            self.stdout.write(f"conflict (not written): soul {line}")

    @staticmethod
    def _build(soul, home, judgment, next_start):
        """算出一份计划及其节点(不写库)。会违反节点约束时返回 None。"""
        home_disposition = Disposition.all_objects.filter(judgment=judgment).first()
        nodes = [SentenceNode(
            order=1, tenant_code=home.code, is_home=True, status=_executed_status(home_disposition),
            added_by_judgment_id=judgment.pk, activated_at=judgment.concluded_at,
            completed_at=home_disposition.executed_at if home_disposition else None,
            **_content(home_disposition),
        )]

        records = DispatchRecord._base_manager.filter(
            soul=soul, is_deleted=False, status__in=[DispatchStatus.EXECUTED, DispatchStatus.RETURNED],
            executed_at__isnull=False,
        ).select_related("target_tenant").order_by("executed_at")
        if judgment.concluded_at is not None:
            records = records.filter(executed_at__gte=judgment.concluded_at)
        if next_start is not None:
            records = records.filter(executed_at__lt=next_start)
        for order, record in enumerate(records, start=2):
            disposition = (
                Disposition.all_objects.filter(
                    soul=soul, tenant=record.target_tenant, is_deleted=False, created_at__gte=record.executed_at,
                ).order_by("created_at").first()
            )
            if record.status == DispatchStatus.RETURNED:
                status = SentenceNodeStatus.ABORTED if _manual_return(record) else SentenceNodeStatus.COMPLETED
            else:
                status = _executed_status(disposition)
            nodes.append(SentenceNode(
                order=order, tenant_code=record.target_tenant.code, is_home=False, status=status,
                dispatch_record_id=record.pk, activated_at=record.executed_at,
                completed_at=record.returned_at or (disposition.executed_at if disposition else None),
                **_content(disposition),
            ))
        if sum(1 for n in nodes if n.status in OCCUPYING_NODE_STATUSES) > 1:
            return None

        has_eternal = any(n.status == SentenceNodeStatus.ETERNAL for n in nodes)
        if judgment.cycle < soul.life_index:
            # 已经过去的一世:不论当时停在哪,都不再是「进行中」(一个灵魂至多一份进行中的计划)。
            status = SentencePlanStatus.COMPLETED
        elif has_eternal and soul.is_residing:
            status = SentencePlanStatus.HELD
        elif soul.current_state not in _IN_SENTENCE:
            status = SentencePlanStatus.COMPLETED
        else:
            status = SentencePlanStatus.ACTIVE
        plan = SentencePlan(
            soul=soul, tenant=home, cycle=judgment.cycle, status=status, origin_judgment_id=judgment.pk,
            completed_at=(
                home_disposition.executed_at
                if status == SentencePlanStatus.COMPLETED and home_disposition else None
            ),
        )
        return plan, nodes
