"""
Actor -> User 迁移脚本
用法: python manage.py migrate_actors_to_users

功能：
- 遍历 Actor 表所有记录
- 为每个 Actor 创建或更新对应的 User 记录
- username = Actor.name（如果冲突则跳过）
- display_name = Actor.name_zh 或 name
- organization 根据 Actor.civilization 映射到 Organization
- position = Actor.title 或 ""
- 设置默认密码：PBKDF2(soul123456)
- 根据 Actor.role 自动分配权限角色
"""
from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from apps.actors.models import Actor
from apps.authentication.models import User, UserRole
from apps.org.models import Organization


# Actor.civilization -> Organization.code 映射
CIVILIZATION_ORG_MAP = {
    "CHINESE": "DIYU",
    "EUROPEAN": "HEAVEN",  # 欧洲优先天堂组织
    "EGYPTIAN": "DUAT",
}

# Actor.role -> User.role 映射
ACTOR_ROLE_MAP = {
    "EXECUTOR": UserRole.JUDGE,
    "JUDGE": UserRole.JUDGE,
    "OVERSEER": UserRole.ADMIN,
    "CONDUIT": UserRole.GUARDIAN,
    "GUARDIAN": UserRole.GUARDIAN,
}

DEFAULT_PASSWORD = "soul123456"


class Command(BaseCommand):
    help = "将 Actor 表迁移到 User 表"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="仅预览，不实际创建用户",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="强制更新已存在的用户（默认跳过）",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        force = options["force"]

        if dry_run:
            self.stdout.write(self.style.WARNING("=== DRY RUN 模式 ==="))

        # 预加载组织数据
        org_map = {org.code: org for org in Organization.objects.all()}
        self.stdout.write(f"已加载 {len(org_map)} 个组织")

        # 遍历所有 Actor
        actors = Actor.objects.all()
        total_actors = actors.count()
        self.stdout.write(f"找到 {total_actors} 个 Actor")

        created_count = 0
        updated_count = 0
        skipped_count = 0
        error_count = 0

        for actor in actors:
            try:
                result = self._process_actor(actor, org_map, dry_run, force)
                if result == "created":
                    created_count += 1
                elif result == "updated":
                    updated_count += 1
                elif result == "skipped":
                    skipped_count += 1
            except Exception as e:
                error_count += 1
                self.stdout.write(
                    self.style.ERROR(f"  处理 Actor {actor.name} 时出错: {e}")
                )

        # 汇总
        self.stdout.write("")
        if dry_run:
            self.stdout.write(self.style.WARNING("=== DRY RUN 完成 ==="))
        self.stdout.write(
            self.style.SUCCESS(
                f"\n完成！创建: {created_count}, 更新: {updated_count}, "
                f"跳过: {skipped_count}, 错误: {error_count}"
            )
        )

    def _process_actor(self, actor, org_map, dry_run=False, force=False):
        """处理单个 Actor，返回操作结果"""
        username = actor.name

        # 检查用户是否已存在
        existing_user = User.objects.filter(username=username).first()

        if existing_user:
            if not force:
                self.stdout.write(f"  跳过（已存在）: {username}")
                return "skipped"
            # 更新现有用户
            self._update_user(existing_user, actor, org_map)
            self.stdout.write(f"  更新: {username}")
            return "updated"

        if dry_run:
            self.stdout.write(f"  [DRY RUN] 将创建: {username}")
            return "created"

        # 创建新用户
        user = self._create_user(actor, org_map)
        self.stdout.write(f"  创建: {username} (role={user.role})")
        return "created"

    def _create_user(self, actor, org_map):
        """创建用户"""
        # 获取组织
        org_code = CIVILIZATION_ORG_MAP.get(actor.civilization)
        organization = org_map.get(org_code) if org_code else None

        # 获取显示名称
        display_name = actor.name_zh or actor.name

        # 获取职位
        position = actor.title or ""

        # 获取用户角色
        user_role = ACTOR_ROLE_MAP.get(actor.role, UserRole.VIEWER)

        # 创建用户
        user = User.objects.create(
            username=actor.name,
            display_name=display_name,
            role=user_role,
            organization=organization,
            position=position,
            actor=actor,
            password=make_password(DEFAULT_PASSWORD),
            is_active=actor.is_active,
        )
        return user

    def _update_user(self, user, actor, org_map):
        """更新现有用户"""
        # 获取组织
        org_code = CIVILIZATION_ORG_MAP.get(actor.civilization)
        organization = org_map.get(org_code) if org_code else None

        # 更新字段
        user.display_name = actor.name_zh or actor.name
        user.role = ACTOR_ROLE_MAP.get(actor.role, UserRole.VIEWER)
        user.organization = organization
        user.position = actor.title or ""
        user.actor = actor
        user.is_active = actor.is_active
        user.save()

    def print_summary(self):
        """打印迁移汇总"""
        self.stdout.write("\n=== Actor -> User 迁移汇总 ===")
        self.stdout.write(f"总 Actor 数: {Actor.objects.count()}")
        self.stdout.write(f"总 User 数: {User.objects.count()}")
        self.stdout.write(f"已关联 User 的 Actor 数: {Actor.objects.filter(users__isnull=False).count()}")
