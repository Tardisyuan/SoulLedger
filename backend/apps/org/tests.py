"""
Organization model tests for M7 - User & Organization Refactoring
"""
from django.db import IntegrityError
from django.test import TestCase

from apps.org.models import Organization


class OrganizationModelTest(TestCase):
    """组织架构模型测试"""

    @classmethod
    def setUpTestData(cls):
        """设置测试数据"""
        # 创建根组织
        cls.diyu = Organization.objects.create(
            name="中国地府",
            code="DIYU",
            category="CHINESE",
            level=0,
        )
        cls.heaven = Organization.objects.create(
            name="天堂",
            code="HEAVEN",
            category="EUROPEAN",
            level=0,
        )

    def test_organization_creation(self):
        """测试组织创建"""
        org = Organization.objects.create(
            name="第一殿",
            code="DIYU_01",
            category="CHINESE",
            parent=self.diyu,
            level=1,
        )
        self.assertEqual(org.name, "中国地府" if org.code == "DIYU" else "第一殿")
        self.assertEqual(org.level, 0 if org.code == "DIYU" else 1)

    def test_organization_tree_structure(self):
        """测试组织树形结构"""
        # 创建子组织
        first_hall = Organization.objects.create(
            name="第一殿-秦广王",
            code="DIYU_01",
            category="CHINESE",
            parent=self.diyu,
            level=1,
        )
        # 验证父子关系
        self.assertEqual(first_hall.parent, self.diyu)
        self.assertIn(first_hall, self.diyu.children.all())

    def test_organization_unique_code(self):
        """测试组织代码唯一性"""
        with self.assertRaises(IntegrityError):
            Organization.objects.create(
                name="重复代码",
                code="DIYU",  # 与已存在的DIYU重复
                category="CHINESE",
            )

    def test_organization_category_choices(self):
        """测试组织类别选项"""
        self.assertIn(self.diyu.category, dict(Organization.CATEGORY_CHOICES).keys())
        self.assertIn(self.heaven.category, dict(Organization.CATEGORY_CHOICES).keys())

    def test_organization_str_representation(self):
        """测试组织的字符串表示"""
        self.assertEqual(str(self.diyu), "DIYU - 中国地府")

    def test_organization_ordering(self):
        """测试组织排序"""
        Organization.objects.create(
            name="第二殿",
            code="DIYU_02",
            category="CHINESE",
            level=1,
        )
        Organization.objects.create(
            name="第一殿",
            code="DIYU_01",
            category="CHINESE",
            level=1,
        )
        orgs = list(Organization.objects.filter(category="CHINESE").order_by("code"))
        self.assertEqual(orgs[0].code, "DIYU")
        self.assertEqual(orgs[1].code, "DIYU_01")
        self.assertEqual(orgs[2].code, "DIYU_02")
