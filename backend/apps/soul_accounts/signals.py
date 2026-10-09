"""转生申请状态跟着它的工作流走。

挂在 `ApprovalWorkflow` 的 post_save 上,而不是挂在某个视图里:工作流的状态有
好几条写路径(`approve_node`、`escalate`、工作流 / 节点的 CRUD),只挂视图会漏。
**同一事务,同步执行**(用户 2026-10-10 决定):所有写路径(`approve_node`、超时、后台 CRUD、序列化器)
的工作流保存与申请状态对齐一起提交或一起回滚;对齐或事件写失败时工作流保存也回滚、调用方拿到原始错误。
`approve_node` / 超时仍直接调 `sync_from_workflow`,信号这次调用发现已对齐就什么也不做(幂等,不重复写事件)。
`sync_from_workflow` 自带 `transaction.atomic()`,调用方没开事务时它就是这次保存之后的独立事务。
锁序:工作流行(本次 save 已写)→ 申请行。
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.workflow.models import ApprovalWorkflow, CaseType


@receiver(post_save, sender=ApprovalWorkflow, dispatch_uid="soul_accounts_rebirth_sync")
def _sync_rebirth_application(sender, instance, **kwargs):
    if instance.case_type != CaseType.REBIRTH_APPLICATION:
        return
    from apps.soul_accounts.rebirth import sync_from_workflow

    sync_from_workflow(instance.pk)
