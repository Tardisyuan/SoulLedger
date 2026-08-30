"""种出来的 actor 能被**读它们的那两处代码**看见。

`_seed_actors` 的 values 与 `ACTOR_FIELDS` 此前都不含 `is_active`。13 个作用域测试
文件 grep `is_active` **零命中**。变异:往 values 注入 `"is_active": False` →
**92 passed,0 红**。

而这个字段有两个真实消费方(2026-08-30 全仓核实):

    apps/actors/views.py:31                        queryset = filter(is_active=True)
    .../commands/migrate_actors_to_users.py:152    is_active=actor.is_active

所以那个缺陷会让 **Actor 接口返回空**,并在 Actor→User 迁移里产出一个**被停用的
用户账号** —— 而测试全绿。

**审计账本 H45 写的第二个消费方是错的**:它说 `apps/workflow/services.py:704` 的
审批人解析同样过滤 `is_active=True`。704 行过滤的是 `WorkflowTemplate.is_active`;
`_resolve_approver` 用的是 `Actor._base_manager.filter(civilization, tenant_id,
is_deleted=False)`,**根本不看这个字段**。行号对、字段名对、模型不对 —— 一条
写着具体行号的断言,读起来比没有行号的更可信,而它指着另一个模型。
(是这个文件先按账本写、跑出来红,才发现的。)

这个文件不断言字段的值,断言的是**消费方看得见种出来的行** —— 值可以被改名、
被换成别的机制,消费方看不看得见不能。
"""
import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.tenants.models import Tenant


@pytest.fixture
def seeded(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "中国地府"}
    )
    call_command("seed_mythology", civilization="chinese", verbosity=0)
    return tenant


@pytest.mark.django_db
def test_every_seeded_actor_is_visible_to_the_actors_queryset(seeded):
    total = Actor.all_objects.filter(civilization="CHINESE", deleted_at__isnull=True).count()
    assert total > 0, "前置条件:种子确实写了 actor 行"

    # 逐字复制 `apps/actors/views.py:27` 的那一句 —— 复制而不是 import,因为要守的
    # 是「种子写出来的行满足那个条件」,不是「两处代码碰巧同源」。
    visible = Actor.objects.filter(is_active=True).filter(civilization="CHINESE").count()
    assert visible == total, (
        f"{total} 个种子 actor 里只有 {visible} 个能被 /api/v1/actors/ 看到。"
        f"那个接口的 queryset 是 filter(is_active=True)。"
    )


@pytest.mark.django_db
def test_seeded_actors_migrate_into_enabled_user_accounts(seeded):
    """第二个消费方。两处用同一个字段,坏起来的样子不一样:一个是接口返回空列表,
    一个是**迁移出来的用户登不进去**,而迁移命令报告「创建成功」。"""
    from apps.authentication.models import User

    someone = Actor.all_objects.filter(civilization="CHINESE", deleted_at__isnull=True).first()
    assert someone is not None

    call_command("migrate_actors_to_users", verbosity=0)

    user = User.objects.filter(username=someone.name).first()
    assert user is not None, f"迁移没有为 {someone.name!r} 建用户"
    assert user.is_active is True, (
        f"{someone.name!r} 迁移出来的账号是停用的 —— "
        f"migrate_actors_to_users.py:152 直接抄 actor.is_active"
    )


@pytest.mark.django_db
def test_update_reactivates_a_row_someone_switched_off(seeded):
    """`--update` 修得了这个字段。

    这是 M32 的另一面:字段不在 `compare_fields` 里时,`--update` 把改动过的行判为
    `unchanged`,于是**修不了**。断言的是它现在修得了。
    """
    victim = Actor.all_objects.filter(civilization="CHINESE", deleted_at__isnull=True).first()
    Actor.all_objects.filter(pk=victim.pk).update(is_active=False)

    call_command("seed_mythology", civilization="chinese", update=True, verbosity=0)

    victim.refresh_from_db()
    assert victim.is_active is True, (
        "--update 没有把它启用回来 —— 检查 is_active 在不在 ACTOR_FIELDS 里"
    )
