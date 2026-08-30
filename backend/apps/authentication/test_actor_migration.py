"""`manage.py migrate_actors_to_users` —— 这次真的调用它。

这个文件此前 85 行、5 条测试,标题声称保护「Actor → User 迁移 (M7)」,而
**没有一行调用过那条命令**。`test_user_creation` 的注释自己写着「直接创建用户
**模拟**迁移结果」,然后断言刚刚创建的那个字面量。5 条里 4 条测的是 Django 框架
自身的行为(`create_user`、unique 约束、外键赋值),1 条测 `role` 的默认值。

**把 `apps/authentication/management/commands/migrate_actors_to_users.py` 整个
删掉,那 5 条照样绿。**

下面每一条都 `call_command`,断言的是那条命令自己的映射与分支。
"""
from io import StringIO

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.authentication.models import User, UserRole
from apps.org.models import Organization


def run(**kwargs):
    out = StringIO()
    call_command("migrate_actors_to_users", stdout=out, **kwargs)
    return out.getvalue()


@pytest.fixture
def orgs(db):
    return {
        code: Organization.objects.create(name=code, code=code, category="CHINESE", level=0)
        for code in ("DIYU", "HEAVEN", "DUAT")
    }


def make_actor(**kwargs):
    return Actor.objects.create(
        **{"name": "秦广王", "civilization": "CHINESE", "role": "JUDGE", **kwargs}
    )


@pytest.mark.django_db
def test_it_creates_a_user_per_actor_with_the_mapped_role_and_org(orgs):
    actor = make_actor(name="秦广王", name_zh="秦广王", title="第一殿")

    run()

    user = User.objects.get(username="秦广王")
    assert user.role == UserRole.JUDGE          # ACTOR_ROLE_MAP["JUDGE"]
    assert user.organization == orgs["DIYU"]     # CIVILIZATION_ORG_MAP["CHINESE"]
    assert user.position == "第一殿"
    assert user.display_name == "秦广王"
    assert user.actor == actor
    assert user.check_password("soul123456")


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("actor_role", "expected"),
    [
        ("EXECUTOR", UserRole.JUDGE),
        ("JUDGE", UserRole.JUDGE),
        ("OVERSEER", UserRole.ADMIN),
        ("CONDUIT", UserRole.GUARDIAN),
        ("GUARDIAN", UserRole.GUARDIAN),
    ],
)
def test_every_row_of_the_role_map_is_exercised(orgs, actor_role, expected):
    """整张表,不是抽一行。

    `OVERSEER → ADMIN` 是这里唯一发放管理员权限的一条 —— 它被改错了不该只在
    某次抽样里才可能被发现。
    """
    make_actor(name=f"actor_{actor_role}", role=actor_role)
    run()
    assert User.objects.get(username=f"actor_{actor_role}").role == expected


@pytest.mark.django_db
def test_an_unmapped_actor_role_falls_back_to_viewer_not_to_something_higher(orgs):
    """降级的方向。映射缺一项时,错误的默认值会是一次静默提权。"""
    make_actor(name="无名者", role="SOMETHING_NEW")
    run()
    assert User.objects.get(username="无名者").role == UserRole.VIEWER


@pytest.mark.django_db
def test_greek_actors_get_no_organization_because_the_map_has_no_greek_row(orgs):
    """钉住的是**现状**,并且说明它是个缺口。

    `CIVILIZATION_ORG_MAP` 只有 CHINESE/EUROPEAN/EGYPTIAN 三行,而这个项目有
    **四个**文明。希腊 Actor 因此拿到 `organization=None`,命令不报错、汇总里
    也不体现 —— 它算「创建成功」。

    这条断言写成「等于 None」而不是「不等于某个组织」,是因为前者会在有人补上
    GREEK 那一行时**红**,把这个决定推到台面上;后者会一直绿。
    """
    make_actor(name="弥诺斯", civilization="GREEK", role="JUDGE")
    run()
    user = User.objects.get(username="弥诺斯")
    assert user.organization is None
    assert user.role == UserRole.JUDGE, "角色映射与文明无关,不该跟着一起丢"


@pytest.mark.django_db
def test_dry_run_writes_nothing(orgs):
    make_actor(name="楚江王")
    output = run(dry_run=True)
    assert "DRY RUN" in output
    assert not User.objects.filter(username="楚江王").exists()


@pytest.mark.django_db
def test_an_existing_username_is_skipped_and_left_untouched(orgs):
    """默认分支:跳过。断言的是那个用户**没有被改**,不只是命令没报错。"""
    make_actor(name="秦广王", title="第一殿")
    existing = User.objects.create_user(
        username="秦广王", password="somethingelse", role=UserRole.VIEWER, position="旧职位"
    )

    run()

    existing.refresh_from_db()
    assert existing.role == UserRole.VIEWER
    assert existing.position == "旧职位"
    assert existing.actor is None
    assert existing.check_password("somethingelse")


@pytest.mark.django_db
def test_force_overwrites_the_existing_user(orgs):
    """`--force` 的另一半。没有这一条,一个「force 也跳过」的实现同样满足上一条。"""
    make_actor(name="秦广王", title="第一殿", role="OVERSEER")
    User.objects.create_user(
        username="秦广王", password="somethingelse", role=UserRole.VIEWER, position="旧职位"
    )

    run(force=True)

    user = User.objects.get(username="秦广王")
    assert user.role == UserRole.ADMIN
    assert user.position == "第一殿"
    assert user.organization is not None


@pytest.mark.django_db
def test_an_inactive_actor_produces_an_inactive_user(orgs):
    """停用状态要跟着过去 —— 否则一次迁移会把已停用的身份重新放出来。"""
    make_actor(name="已停用者", is_active=False)
    run()
    assert User.objects.get(username="已停用者").is_active is False


@pytest.mark.django_db
def test_the_summary_counts_match_what_actually_happened(orgs):
    """汇总里的数字是这条命令唯一的输出。没有人核过它。"""
    make_actor(name="甲")
    make_actor(name="乙")
    User.objects.create_user(username="乙", password="x")  # 这一个会被跳过

    output = run()

    assert "创建: 1" in output
    assert "跳过: 1" in output
    assert "错误: 0" in output
    assert User.objects.filter(username="甲").exists()


# 这里本来还应有一条「一个 Actor 失败不会让整批停下」—— 那个 try/except 的全部
# 意义就在于此。写不出来:命令里唯一可触发的失败是字段长度超限,而**SQLite 不
# 强制 varchar(n)**(见 CLAUDE.md)。用 200 字符的 username 试过,SQLite 上照样
# 建成功,「错误: 0」。在 SQLite 上写这条,得到的会是一条永远不会红的断言 ——
# 正是这个文件原本的毛病。要么把它放进一个 PostgreSQL-only 的套件,要么不写。
