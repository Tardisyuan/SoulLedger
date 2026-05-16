"""
Authentication and User model tests for M7 - User & Organization Refactoring
"""
from django.test import TestCase
from django.db import IntegrityError
from apps.authentication.models import User
from apps.org.models import Organization


class UserModelTest(TestCase):
    """用户模型测试"""

    @classmethod
    def setUpTestData(cls):
        """设置测试数据"""
        # 创建组织
        cls.diyu = Organization.objects.create(
            name="中国地府",
            code="DIYU",
            category="CHINESE",
            level=0,
        )
        cls.diyu_01 = Organization.objects.create(
            name="第一殿-秦广王",
            code="DIYU_01",
            category="CHINESE",
            parent=cls.diyu,
            level=1,
        )

    def test_user_creation_with_organization(self):
        """测试用户创建并关联组织"""
        user = User.objects.create_user(
            username="qinguang",
            password="soul123456",
            email="qinguang@diyu.com",
            organization=self.diyu_01,
            position="秦广王",
        )
        self.assertEqual(user.username, "qinguang")
        self.assertEqual(user.organization, self.diyu_01)
        self.assertEqual(user.position, "秦广王")

    def test_user_unique_username(self):
        """测试用户名唯一性"""
        User.objects.create_user(
            username="testuser",
            password="soul123456",
        )
        with self.assertRaises(IntegrityError):
            User.objects.create_user(
                username="testuser",
                password="soul123456",
            )

    def test_user_organization_cascade_protection(self):
        """测试用户与组织的关系保护"""
        user = User.objects.create_user(
            username="testuser2",
            password="soul123456",
            organization=self.diyu,
        )
        # 删除组织后，用户organization变为null
        self.diyu.delete()
        user.refresh_from_db()
        self.assertIsNone(user.organization)

    def test_user_str_representation(self):
        """测试用户的字符串表示"""
        user = User.objects.create_user(
            username="qinguang",
            password="soul123456",
        )
        # __str__ 返回 "username (role)"
        self.assertEqual(str(user), "qinguang (VIEWER)")

    def test_user_has_module_perms(self):
        """测试用户权限检查方法"""
        user = User.objects.create_user(
            username="testuser3",
            password="soul123456",
        )
        # 普通用户没有 auth 模块权限
        self.assertFalse(user.has_module_perms("auth"))
        # 超级用户有所有权限
        admin = User.objects.create_superuser(
            username="admin2",
            password="admin123",
        )
        self.assertTrue(admin.has_module_perms("auth"))
        self.assertTrue(admin.has_module_perms("org"))

    def test_user_default_is_active(self):
        """测试用户默认启用状态"""
        user = User.objects.create_user(
            username="inactive",
            password="soul123456",
        )
        self.assertTrue(user.is_active)

    def test_user_role_assignment_via_actor_migration(self):
        """测试通过Actor迁移后的用户角色分配"""
        # 模拟迁移后的用户
        user = User.objects.create_user(
            username="yanluowang",
            password="soul123456",
            organization=self.diyu_01,
            position="阎罗王",
        )
        # 验证用户可以登录
        self.assertTrue(user.check_password("soul123456"))
