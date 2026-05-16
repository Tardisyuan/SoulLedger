"""
Organization models - 组织架构
替代 civilization 作为多租户隔离的基础
"""
from django.db import models
from apps.core.models import AuditUserFields


class Organization(AuditUserFields):
    """
    组织架构 - 对应各文明/公司/部门

    设计参考 Snowy 的 SysOrg：
    - 自引用树形结构实现层级
    - category 区分文明体系
    - code 用于权限计算
    """
    name = models.CharField(
        max_length=100,
        help_text="组织名称：如 第一殿、冥王厅"
    )
    code = models.CharField(
        max_length=50,
        unique=True,
        help_text="唯一编码：如 DIYU_01、HEAVEN_01"
    )
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
        help_text="父组织（平行部门）"
    )
    # 分类：对应原来的 civilization
    CATEGORY_CHOICES = [
        ('CHINESE', '中国地府'),
        ('EUROPEAN', '欧洲天堂地狱'),
        ('EGYPTIAN', '埃及冥界'),
    ]
    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
        help_text="所属文明体系"
    )
    # 层级深度（用于权限计算）
    level = models.IntegerField(
        default=0,
        help_text="层级深度：0=根组织"
    )
    # 排序
    sort = models.IntegerField(
        default=0,
        help_text="同级别排序"
    )
    # 扩展信息
    ext = models.JSONField(
        default=dict,
        blank=True,
        help_text="扩展信息JSON"
    )

    class Meta:
        db_table = 'organizations'
        verbose_name = 'Organization'
        verbose_name_plural = 'Organizations'
        ordering = ['category', 'level', 'sort']
        indexes = [
            models.Index(fields=['category']),
            models.Index(fields=['parent', 'sort']),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        # 自动计算层级深度
        if self.parent:
            self.level = self.parent.level + 1
        else:
            self.level = 0
        super().save(*args, **kwargs)

    def get_ancestors(self):
        """获取所有祖先组织"""
        ancestors = []
        current = self.parent
        while current:
            ancestors.append(current)
            current = current.parent
        return ancestors

    def get_children_recursive(self):
        """获取所有后代组织（包括自己）"""
        result = [self]
        children = list(self.children.all())
        while children:
            child = children.pop(0)
            result.append(child)
            children.extend(list(child.children.all()))
        return result


# 预定义的组织架构数据
INITIAL_ORGANIZATIONS = [
    # 中国地府
    {
        "name": "中国地府",
        "code": "DIYU",
        "category": "CHINESE",
        "parent": None,
        "level": 0,
    },
    # 十殿（平行）
    {
        "name": "第一殿-秦广王",
        "code": "DIYU_01",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第二殿-楚江王",
        "code": "DIYU_02",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第三殿-宋帝王",
        "code": "DIYU_03",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第四殿-五官王",
        "code": "DIYU_04",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第五殿-阎罗王",
        "code": "DIYU_05",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第六殿-卞城王",
        "code": "DIYU_06",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第七殿-泰山王",
        "code": "DIYU_07",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第八殿-都市王",
        "code": "DIYU_08",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第九殿-平等王",
        "code": "DIYU_09",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "第十殿-转轮王",
        "code": "DIYU_10",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    # 四大判官
    {
        "name": "崔珏（崔府君）",
        "code": "DIYU_PAN_GUAN_01",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "钟馗",
        "code": "DIYU_PAN_GUAN_02",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "魏征",
        "code": "DIYU_PAN_GUAN_03",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    {
        "name": "陆之道",
        "code": "DIYU_PAN_GUAN_04",
        "category": "CHINESE",
        "parent_code": "DIYU",
    },
    # 欧洲天堂地狱
    {
        "name": "天堂",
        "code": "HEAVEN",
        "category": "EUROPEAN",
        "parent": None,
        "level": 0,
    },
    {
        "name": "大天使团",
        "code": "HEAVEN_ANGEL",
        "category": "EUROPEAN",
        "parent_code": "HEAVEN",
    },
    {
        "name": "冥界",
        "code": "HADES",
        "category": "EUROPEAN",
        "parent": None,
        "level": 0,
    },
    {
        "name": "希腊冥界",
        "code": "HADES_GREEK",
        "category": "EUROPEAN",
        "parent_code": "HADES",
    },
    # 埃及冥界
    {
        "name": "埃及冥界",
        "code": "DUAT",
        "category": "EGYPTIAN",
        "parent": None,
        "level": 0,
    },
    {
        "name": "真理大厅",
        "code": "DUAT_HALL",
        "category": "EGYPTIAN",
        "parent_code": "DUAT",
    },
    {
        "name": "十二门",
        "code": "DUAT_GATES",
        "category": "EGYPTIAN",
        "parent_code": "DUAT",
    },
]
