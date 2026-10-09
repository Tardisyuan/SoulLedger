"""转生申请状态跟着它的工作流走。

挂在 `ApprovalWorkflow` 的 post_save 上,而不是挂在某个视图里:工作流的状态有
好几条写路径(`approve_node`、`escalate`、工作流 / 节点的 CRUD),只挂视图会漏。
`on_commit`:这是**兜底**。决定工作流的两条路(`approve_node`、超时自动驳回)已在同一事务里
直接调 `rebirth.sync_from_workflow`(审批与申请状态一起提交或回滚);其余写路径(后台 CRUD 等)
走到这里,提交后再对齐,已对齐时什么也不做。
"""
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.workflow.models import ApprovalWorkflow, CaseType


@receiver(post_save, sender=ApprovalWorkflow, dispatch_uid="soul_accounts_rebirth_sync")
def _sync_rebirth_application(sender, instance, **kwargs):
    if instance.case_type != CaseType.REBIRTH_APPLICATION:
        return
    from apps.soul_accounts.rebirth import sync_from_workflow

    workflow_id = instance.pk
    transaction.on_commit(lambda: sync_from_workflow(workflow_id))
