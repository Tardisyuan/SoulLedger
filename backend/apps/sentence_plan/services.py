"""受刑计划的写路径。阶段 1 只有两条:结案时建计划,处置执行时标节点。

两条都由调用方在**它自己的事务与灵魂行锁之下**调用(`JudgmentConclusionService.conclude_judgment`、
`DispositionService.execute`),这里不再开事务、不再取灵魂行锁。推进(`advance`)是阶段 2。
"""
import logging

from django.utils import timezone

from apps.sentence_plan.models import (
    IN_PROGRESS_PLAN_STATUSES,
    LIVE_NODE_STATUSES,
    SentenceNode,
    SentenceNodeStatus,
    SentencePlan,
    SentencePlanStatus,
)

logger = logging.getLogger(__name__)


class SentencePlanService:
    @staticmethod
    def create_from_conclusion(judgment, disposition):
        """原属审判(ORIGINAL)结案 → 一份计划 + 原属节点(ACTIVE,挂着刚建的处置)。

        `judgment.kind != ORIGINAL` 不建(加减项 / 重开审判改计划,不建计划;阶段 3)。
        灵魂已有进行中的计划则**不建、记 warning、返回 None** —— 而不是让部分唯一约束
        把结案整体回滚:阶段 1 的承诺是行为不变,一份记录不能拒绝一次审判。正常流程
        到不了这里(一个灵魂同时只有一个未结案审判,且计划在处置执行时完成);到了就是
        存量数据或 ADMIN 修数据留下的形状,warning 里带两个 id 让人去看。
        """
        from apps.judgment.models import JudgmentKind

        if judgment.kind != JudgmentKind.ORIGINAL:
            return None
        soul = judgment.soul
        existing = SentencePlan.all_objects.filter(
            soul=soul, is_deleted=False, status__in=IN_PROGRESS_PLAN_STATUSES,
        ).values_list("pk", flat=True).first()
        if existing is not None:
            logger.warning(
                "sentence_plan: soul %s already has in-progress plan %s; judgment %s creates none",
                soul.pk, existing, judgment.pk,
            )
            return None
        home = soul.home_tenant if soul.home_tenant_id is not None else soul.tenant
        from apps.dispatch.models import CrossTenantJudgment

        cross_id = CrossTenantJudgment._base_manager.filter(
            judgment_id=judgment.pk, is_deleted=False,
        ).values_list("pk", flat=True).first()
        plan = SentencePlan.objects.create(
            soul=soul, tenant=home, cycle=judgment.cycle, status=SentencePlanStatus.ACTIVE,
            origin_judgment_id=judgment.pk, cross_judgment_id=cross_id,
        )
        SentenceNode.objects.create(
            plan=plan, order=1, tenant_code=home.code, is_home=True, status=SentenceNodeStatus.ACTIVE,
            realm_code=disposition.destination_realm.realm_code if disposition.destination_realm_id else "",
            sentence_years=disposition.sentence_years, is_eternal=disposition.is_eternal,
            memory_reset=disposition.memory_reset, disposition_id=disposition.pk,
            added_by_judgment_id=judgment.pk, activated_at=timezone.now(),
        )
        return plan

    @staticmethod
    def note_disposition_executed(disposition):
        """处置执行完毕 → 挂着它的 ACTIVE 节点结束;没有别的活节点时计划完成。

        原属节点:一律 COMPLETED。今天原属处置执行不看 `is_eternal`,灵魂照样进
        REINCARNATING / SETTLED(`DispositionService.execute` 原属分支),节点跟着那个事实走,
        永久与否留在 `is_eternal` 列上。外地节点:`is_eternal` → ETERNAL(计划 HELD),否则 COMPLETED。
        WAITING(刑满暂留)要看 `open_judgments`,由阶段 2 的 `advance` 一并接管,这里不判。

        调用方持有灵魂行锁;这里只锁节点行。没有节点挂着这份处置(存量、或阶段 1 之前
        执行过的)就什么都不做。
        """
        node = (
            SentenceNode.objects.select_for_update(of=("self",))
            .filter(disposition_id=disposition.pk, status=SentenceNodeStatus.ACTIVE)
            .first()
        )
        if node is None:
            return None
        node.status = (
            SentenceNodeStatus.ETERNAL if (disposition.is_eternal and not node.is_home) else SentenceNodeStatus.COMPLETED
        )
        node.completed_at = timezone.now()
        node.save(update_fields=["status", "completed_at", "update_time", "update_user", "version"])

        plan = SentencePlan.all_objects.select_for_update(of=("self",)).get(pk=node.plan_id)
        live = list(plan.nodes.filter(is_deleted=False, status__in=LIVE_NODE_STATUSES).values_list("status", flat=True))
        if not live:
            plan.status = SentencePlanStatus.COMPLETED
            plan.completed_at = timezone.now()
        elif set(live) == {SentenceNodeStatus.ETERNAL}:
            plan.status = SentencePlanStatus.HELD
        else:
            return node
        plan.save(update_fields=["status", "completed_at", "update_time", "update_user", "version"])
        return node
