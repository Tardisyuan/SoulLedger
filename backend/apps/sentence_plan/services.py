"""受刑计划的写路径。阶段 1 只有两条:结案时建计划,处置执行时标节点。

两条都由调用方在**它自己的事务与灵魂行锁之下**调用(`JudgmentConclusionService.conclude_judgment`、
`DispositionService.execute`),这里不再开事务、不再取灵魂行锁。推进(`advance`)是阶段 2。
"""
import logging

from django.utils import timezone

from apps.sentence_plan.models import (
    IN_PROGRESS_PLAN_STATUSES,
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
        home = soul.home_tenant if soul.home_tenant_id is not None else soul.tenant
        if home is None or judgment.tenant_id != home.pk:
            # 暂居地的审判不是原审判(那是阶段 3 的加减项审判)。今天它经 API 结不了案
            # (设计稿 G1),这里只是不让一条走得通的旁路把它记成原属计划。
            return None
        existing = SentencePlan.all_objects.filter(
            soul=soul, is_deleted=False, status__in=IN_PROGRESS_PLAN_STATUSES,
        ).values_list("pk", flat=True).first()
        if existing is not None:
            logger.warning(
                "sentence_plan: soul %s already has in-progress plan %s; judgment %s creates none",
                soul.pk, existing, judgment.pk,
            )
            return None
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
        """处置执行完毕 → 挂着它的 ACTIVE 节点结束。只记事实,不推进。

        节点:`is_eternal` → ETERNAL,否则 COMPLETED(与回填命令 §7.2 第 2、3 步同一规则)。
        计划:
        * 原属节点 → COMPLETED。今天原属处置执行就是灵魂离开 DISPOSED(进 REINCARNATING /
          SETTLED)的那一步,计划跟着这个事实走;永久与否留在节点的 ETERNAL 上。
        * 外地节点永久 → HELD(今天永久刑期不自动回归)。外地非永久:计划不动,推进是阶段 2。
        WAITING(刑满暂留)要看 `open_judgments`,阶段 2 的 `advance` 接管,这里不判。

        调用方持有它自己的事务;锁序 节点 → 计划 与设计稿 §8 的 Plan → Node 相反,但阶段 1
        没有别的路径同时锁这两张表,不会成环;阶段 2 引入 `advance` 时要按 §8 改回来。
        没有节点挂着这份处置(存量、或阶段 1 之前结案的)就什么都不做。
        """
        node = (
            SentenceNode.objects.select_for_update(of=("self",))
            .filter(disposition_id=disposition.pk, status=SentenceNodeStatus.ACTIVE)
            .first()
        )
        if node is None:
            return None
        now = timezone.now()
        node.status = SentenceNodeStatus.ETERNAL if disposition.is_eternal else SentenceNodeStatus.COMPLETED
        node.completed_at = now
        node.save(update_fields=["status", "completed_at", "update_time", "update_user", "version"])

        if node.is_home:
            new_status = SentencePlanStatus.COMPLETED
        elif node.status == SentenceNodeStatus.ETERNAL:
            new_status = SentencePlanStatus.HELD
        else:
            return node
        plan = SentencePlan.all_objects.select_for_update(of=("self",)).get(pk=node.plan_id)
        plan.status = new_status
        plan.completed_at = now if new_status == SentencePlanStatus.COMPLETED else None
        plan.save(update_fields=["status", "completed_at", "update_time", "update_user", "version"])
        return node
