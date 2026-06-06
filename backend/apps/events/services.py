"""
Event logging service — delegates to EventBus.

All methods maintain their original signatures for backward compatibility.
New code should use ``event_bus.publish_soul_event()`` directly.
"""
from apps.souls.models import Soul
from apps.events.event_bus import event_bus


class EventService:
    """
    Centralised audit logging for all soul-related events.

    Now delegates to the unified EventBus.  The AuditHandler writes
    to the SoulEvent model; WebSocket/Notification/Webhook handlers
    also fire automatically.
    """

    @staticmethod
    def log(soul: Soul, event_type: str, payload: dict, actor: str = "system") -> None:
        event_bus.publish_soul_event(soul, event_type, payload, actor=actor)

    @staticmethod
    def log_soul_created(soul: Soul, actor: str = "system") -> None:
        EventService.log(soul, "SOUL_CREATED", {
            "name": soul.name,
            "civilization": soul.civilization,
            "birth_date": str(soul.birth_date) if soul.birth_date else None,
        }, actor)

    @staticmethod
    def log_soul_state_change(
        soul: Soul, old_state: str, new_state: str, reason: str, actor: str = "system"
    ) -> None:
        EventService.log(soul, "STATE_CHANGED", {
            "old_state": old_state,
            "new_state": new_state,
            "reason": reason,
        }, actor)

    @staticmethod
    def log_disposition_created(disposition, actor: str = "system") -> None:
        EventService.log(disposition.soul, "DISPOSITION_CREATED", {
            "disposition_id": str(disposition.id),
            "realm": disposition.destination_realm.realm_code if disposition.destination_realm else None,
            "is_eternal": disposition.is_eternal,
        }, actor)

    @staticmethod
    def log_judgment_concluded(judgment, actor: str = "system") -> None:
        court_code = None
        if hasattr(judgment, "court") and judgment.court:
            court_code = judgment.court.code if hasattr(judgment.court, "code") else str(judgment.court)
        EventService.log(judgment.soul, "JUDGMENT_CONCLUDED", {
            "judgment_id": str(judgment.id),
            "verdict": judgment.verdict,
            "court": court_code,
        }, actor)

    @staticmethod
    def log_karma_recalculated(soul, old_score: int, new_score: int, actor: str = "system") -> None:
        EventService.log(soul, "KARMA_RECALCULATED", {
            "old_score": old_score,
            "new_score": new_score,
            "delta": new_score - old_score,
        }, actor)

    @staticmethod
    def log_reincarnation_triggered(reincarnation, actor: str = "system") -> None:
        EventService.log(reincarnation.soul, "REINCARNATION_TRIGGERED", {
            "reincarnation_id": str(reincarnation.id),
            "new_identity": reincarnation.new_identity if hasattr(reincarnation, "new_identity") else None,
        }, actor)

    # ------------------------------------------------------------------
    # Workflow events (M12 Phase 2)
    # ------------------------------------------------------------------

    @staticmethod
    def log_workflow_created(workflow, actor: str = "system") -> None:
        """Log workflow creation and publish realtime event."""
        from apps.events.models import EventType
        EventService.log(workflow.soul, EventType.WORKFLOW_CREATED, {
            "workflow_id": str(workflow.id),
            "workflow_name": workflow.workflow_name,
            "status": workflow.status,
        }, actor)

    @staticmethod
    def log_workflow_approved(workflow, node=None, actor: str = "system") -> None:
        """Log workflow approval and publish realtime event."""
        from apps.events.models import EventType
        payload = {
            "workflow_id": str(workflow.id),
            "workflow_name": workflow.workflow_name,
            "status": workflow.status,
        }
        if node:
            payload["node_id"] = str(node.id)
            payload["node_name"] = node.node_name
            payload["verdict"] = node.verdict
        EventService.log(workflow.soul, EventType.WORKFLOW_APPROVED, payload, actor)

    @staticmethod
    def log_workflow_rejected(workflow, node=None, actor: str = "system") -> None:
        """Log workflow rejection and publish realtime event."""
        from apps.events.models import EventType
        payload = {
            "workflow_id": str(workflow.id),
            "workflow_name": workflow.workflow_name,
            "status": workflow.status,
        }
        if node:
            payload["node_id"] = str(node.id)
            payload["node_name"] = node.node_name
            payload["verdict"] = node.verdict
            payload["reason"] = node.notes or ""
        EventService.log(workflow.soul, EventType.WORKFLOW_REJECTED, payload, actor)

    # ------------------------------------------------------------------
    # Notification publishing via EventBus
    # ------------------------------------------------------------------

    @staticmethod
    def notify_user(
        user,
        title: str,
        message: str,
        notification_type: str = "SYSTEM",
        related_resource: str = None,
        related_id: str = None,
    ) -> None:
        """
        Publish a notification event via EventBus.

        Business modules should call this instead of notify_user() directly.
        The EventBus routes to NotificationHandler which creates the record,
        and WebSocketHandler which pushes to the channel layer.
        """
        from apps.events.event_bus import event_bus

        tenant_code = None
        if hasattr(user, "tenant") and user.tenant:
            tenant_code = user.tenant.code

        event_bus.publish(
            event_type="NOTIFICATION_CREATED",
            payload={
                "user_id": user.id,
                "title": title,
                "message": message,
                "notification_type": notification_type,
                "related_resource": related_resource,
                "related_id": related_id,
            },
            domain="notification",
            tenant_code=tenant_code,
            user_ids=[user.id],
            permission="notification.read",
        )

    @staticmethod
    def notify_workflow_assigned(user, workflow, actor: str = "system") -> None:
        """Publish a workflow-assigned notification via EventBus."""
        EventService.notify_user(
            user=user,
            title=f"Workflow Assigned: {workflow.workflow_name}",
            message=f"You have been assigned to workflow '{workflow.workflow_name}'.",
            notification_type="WORKFLOW_ASSIGNED",
            related_resource="workflow",
            related_id=str(workflow.id),
        )

    @staticmethod
    def notify_judgment_completed(user, judgment, actor: str = "system") -> None:
        """Publish a judgment-completed notification via EventBus."""
        EventService.notify_user(
            user=user,
            title=f"Judgment Completed: {judgment.verdict}",
            message=f"Judgment has concluded with verdict: {judgment.verdict}.",
            notification_type="JUDGMENT_COMPLETED",
            related_resource="judgment",
            related_id=str(judgment.id),
        )


# Alias for backward compatibility
log_soul_state_change = EventService.log_soul_state_change
log_disposition_created = EventService.log_disposition_created
