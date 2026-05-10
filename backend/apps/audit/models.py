"""
Audit log models - 操作审计追溯
"""
from django.db import models
from apps.tenants.managers import TenantManager


class AuditAction(models.TextChoices):
    CREATE = "CREATE", "创建"
    UPDATE = "UPDATE", "更新"
    DELETE = "DELETE", "删除"
    EXECUTE = "EXECUTE", "执行"
    READ = "READ", "读取"
    LOGIN = "LOGIN", "登录"
    LOGOUT = "LOGOUT", "登出"


class AuditLog(models.Model):
    """
    审计日志 - 记录所有操作
    """
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="audit_logs",
        null=True,
    )
    user = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        related_name="audit_logs",
        null=True,
    )
    action = models.CharField(max_length=20, choices=AuditAction.choices)
    resource = models.CharField(max_length=100)  # soul, judgment, karma, etc.
    resource_id = models.CharField(max_length=100, blank=True)
    changes = models.JSONField(null=True, blank=True)  # {"field": ["old_value", "new_value"]}
    ip_address = models.GenericIPAddressField(null=True)
    user_agent = models.CharField(max_length=500, blank=True)
    description = models.CharField(max_length=500, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]
        verbose_name = "Audit Log"
        verbose_name_plural = "Audit Logs"
        indexes = [
            models.Index(fields=["tenant", "timestamp"]),
            models.Index(fields=["user", "timestamp"]),
            models.Index(fields=["resource", "resource_id"]),
            models.Index(fields=["action"]),
        ]

    def __str__(self):
        return f"{self.user} {self.action} {self.resource} at {self.timestamp}"
