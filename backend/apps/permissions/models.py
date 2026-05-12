"""
Cross-tenant permission models for inter-civilization dispatch authorization.
"""
import uuid
from django.db import models


class CrossTenantPermission(models.Model):
    """
    跨租户调度授权
    例如：中国十殿阎王可处理欧洲转交的枉死灵魂
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # 授权源（哪个租户可以发起）
    source_tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='cross_grants'
    )

    # 授权目标（哪个租户可以接收）
    target_tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='cross_received'
    )

    # 权限类型
    PERMISSION_TYPES = [
        ('JUDGMENT_TRANSFER', '审判移交'),
        ('SOUL_VIEW', '灵魂查阅'),
        ('SOUL_TRANSFER', '灵魂转移'),
        ('ACT_ACTOR', '代理审判'),
    ]
    permission_type = models.CharField(max_length=30, choices=PERMISSION_TYPES)

    # 生效条件（可选）- 如特定灵魂类别
    soul_category = models.CharField(max_length=50, blank=True, default='')

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'permissions_cross_tenant'
        unique_together = [
            ('source_tenant', 'target_tenant', 'permission_type')
        ]
        indexes = [
            models.Index(fields=['source_tenant', 'target_tenant']),
        ]
        verbose_name = 'Cross-Tenant Permission'
        verbose_name_plural = 'Cross-Tenant Permissions'

    def __str__(self):
        return f"{self.source_tenant_id} -> {self.target_tenant_id}: {self.permission_type}"
