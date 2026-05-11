"""
Menu models for dynamic navigation based on user roles
"""
from django.db import models
from apps.core.models import AuditUserFields
from apps.tenants.managers import TenantManager


class Menu(AuditUserFields, models.Model):
    """
    菜单模型 - 参考 Snowy 的动态菜单设计
    """
    name = models.CharField(max_length=100)
    path = models.CharField(max_length=200)
    icon = models.CharField(max_length=50, blank=True)
    order = models.IntegerField(default=0)
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="children"
    )
    roles = models.JSONField(default=list)  # ["ADMIN", "GUARDIAN"]
    is_active = models.BooleanField(default=True)
    component = models.CharField(max_length=200, blank=True)  # 前端组件路径

    class Meta:
        ordering = ["order", "id"]
        verbose_name = "Menu"
        verbose_name_plural = "Menus"

    def __str__(self):
        return self.name

    def get_codename(self):
        """获取菜单对应的权限 codename"""
        path = self.path.strip("/")
        if not path:
            return None
        parts = path.split("/")
        if len(parts) >= 1:
            return f"{parts[0].lower()}.read"
        return None
