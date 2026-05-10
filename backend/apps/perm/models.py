"""
RBAC Permission models — 参考 Snowy SaToken 设计
"""
from django.db import models
from apps.tenants.managers import TenantManager


class Permission(models.Model):
    """
    权限定义，如 soul.read, judgment.execute
    """
    codename = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=50)  # soul, karma, judgment, system

    class Meta:
        verbose_name = "Permission"
        verbose_name_plural = "Permissions"
        ordering = ["category", "codename"]

    def __str__(self):
        return f"{self.codename} ({self.name})"


class RolePermission(models.Model):
    """
    角色-权限关联
    """
    role = models.CharField(max_length=20)  # ADMIN, JUDGE, GUARDIAN, VIEWER
    permission = models.ForeignKey(
        Permission,
        on_delete=models.CASCADE,
        related_name="role_permissions"
    )

    class Meta:
        unique_together = ["role", "permission"]
        verbose_name = "Role Permission"
        verbose_name_plural = "Role Permissions"

    def __str__(self):
        return f"{self.role} -> {self.permission.codename}"


# 默认权限矩阵
DEFAULT_PERMISSIONS = [
    # soul 权限
    ("soul.read", "查看灵魂", "soul"),
    ("soul.create", "创建灵魂", "soul"),
    ("soul.update", "编辑灵魂", "soul"),
    ("soul.delete", "删除灵魂", "soul"),
    # judgment 权限
    ("judgment.read", "查看审判", "judgment"),
    ("judgment.execute", "执行审判", "judgment"),
    # karma 权限
    ("karma.read", "查看功德", "karma"),
    ("karma.manage", "管理功德", "karma"),
    # reincarnation 权限
    ("reincarnation.read", "查看轮回", "reincarnation"),
    ("reincarnation.manage", "管理轮回", "reincarnation"),
    # system 权限
    ("system.settings", "系统设置", "system"),
    ("user.manage", "用户管理", "system"),
    ("menu.manage", "菜单管理", "system"),
]

# 默认角色权限矩阵
ROLE_PERMISSIONS = {
    "ADMIN": ["soul.read", "soul.create", "soul.update", "soul.delete",
              "judgment.read", "judgment.execute",
              "karma.read", "karma.manage",
              "reincarnation.read", "reincarnation.manage",
              "system.settings", "user.manage", "menu.manage"],
    "JUDGE": ["soul.read", "judgment.read", "judgment.execute",
               "reincarnation.read", "reincarnation.manage"],
    "GUARDIAN": ["soul.read", "soul.update", "reincarnation.read", "reincarnation.manage"],
    "VIEWER": ["soul.read", "reincarnation.read"],
}
