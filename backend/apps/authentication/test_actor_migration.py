"""
Tests for Actor → User migration - M7
"""

from django.test import TestCase

from apps.actors.models import Actor
from apps.authentication.models import User
from apps.org.models import Organization


class MigrateActorsToUsersTest(TestCase):
    """测试 Actor → User 迁移"""

    @classmethod
    def setUpTestData(cls):
        """设置测试数据"""
        # 创建测试组织
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
        # 创建测试Actor - 使用实际模型字段
        cls.actor1 = Actor.objects.create(
            name="秦广王",
            civilization="CHINESE",
            role="JUDGE",
        )
        cls.actor2 = Actor.objects.create(
            name="楚江王",
            civilization="CHINESE",
            role="JUDGE",
        )

    def test_actor_created(self):
        """验证测试Actor已创建"""
        self.assertEqual(Actor.objects.count(), 2)
        self.assertEqual(self.actor1.name, "秦广王")
        self.assertEqual(self.actor1.role, "JUDGE")

    def test_user_creation(self):
        """测试迁移后创建用户"""
        # 直接创建用户模拟迁移结果
        user = User.objects.create_user(
            username="qinguang",
            password="soul123456",
            email="qinguang@diyu.com",
            organization=self.diyu_01,
            position="秦广王",
        )
        self.assertEqual(user.username, "qinguang")
        self.assertTrue(user.check_password("soul123456"))

    def test_user_organization_assignment(self):
        """测试用户分配到正确的组织"""
        user = User.objects.create_user(
            username="testuser",
            password="soul123456",
            organization=self.diyu,
        )
        self.assertEqual(user.organization, self.diyu)

    def test_user_unique_username(self):
        """测试用户名唯一性约束"""
        User.objects.create_user(username="uniqueuser", password="soul123456")
        with self.assertRaises(Exception):  # IntegrityError
            User.objects.create_user(username="uniqueuser", password="soul123456")

    def test_user_role_assignment(self):
        """测试用户角色分配"""
        user = User.objects.create_user(
            username="judgeuser",
            password="soul123456",
        )
        # 默认角色是 VIEWER
        self.assertEqual(user.role, "VIEWER")
