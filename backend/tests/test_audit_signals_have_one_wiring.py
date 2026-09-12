"""审计信号只有一套接线,而且 Role / RolePermission 的 UPDATE 行带 diff。

2026-09-12 审计 BP-10 / DB-01 / BP-20。修之前并存两套机制:

  * `apps/audit/apps.py::ready()` 对**所有** `AuditUserFields` 模型接 post_save /
    post_delete —— 不接 pre_save。
  * `apps/audit/signals.py` 另有一个挂在**全部** post_save 上的 `_auto_connect_signals`,
    在某模型第一次保存时才接 pre_save / post_save / post_delete,并排除
    SoulEvent / Role / RolePermission。

apps.py 那一套绕过了 signals.py 的排除:Role 已经被 apps.py 接上了 post_save,但
`_on_pre_save` 从未为它接过 —— 于是改名产生一条 `changes=None` 的 UPDATE 审计行。
同一处的 `_invalidate_permission_cache` RolePermission 更新分支在 post_save 里
`sender.objects.get(pk)` 读到的是**新**行,old == new(BP-20)。

`transaction=True`:`_create_audit_log` 走 `transaction.on_commit`。
"""
import pytest
from django.db.models.signals import post_delete, post_save, pre_save

from apps.audit.models import AuditAction, AuditLog
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant


def _receivers(signal, sender):
    # Django 5: `_live_receivers` answers a (sync, async) pair.
    sync_receivers, async_receivers = signal._live_receivers(sender)
    return list(sync_receivers) + list(async_receivers)


def _audit_receivers(signal, sender):
    return [r for r in _receivers(signal, sender) if getattr(r, "__module__", "") == "apps.audit.signals"]


@pytest.mark.django_db
def test_every_audited_model_has_exactly_one_of_each_receiver():
    """一套接线的可观测形状:每个模型上 pre_save / post_save / post_delete 各恰好一个
    审计接收者,而且 pre_save 那个**存在** —— 这正是 apps.py 那一套缺的。"""
    from django.apps import apps

    from apps.audit import signals
    from apps.audit.models import AuditLog as AuditLogModel
    from apps.core.models import AuditUserFields

    audited = [
        m
        for m in apps.get_models()
        if issubclass(m, AuditUserFields)
        and not m._meta.abstract
        and m is not AuditLogModel
        and m.__name__ != "SoulEvent"
    ]
    assert len(audited) > 10, "主体清单空了"
    for model in audited:
        pre = [r for r in _receivers(pre_save, model) if r is signals._on_pre_save]
        post = [r for r in _receivers(post_save, model) if r is signals._on_post_save]
        dele = [r for r in _receivers(post_delete, model) if r is signals._on_post_delete]
        assert (len(pre), len(post), len(dele)) == (1, 1, 1), (
            f"{model.__name__}: pre_save={len(pre)} post_save={len(post)} post_delete={len(dele)}"
        )


@pytest.mark.django_db
def test_soul_event_is_not_audited():
    from apps.audit import signals
    from apps.events.models import SoulEvent

    assert signals._on_post_save not in _receivers(post_save, SoulEvent)
    assert signals._on_post_delete not in _receivers(post_delete, SoulEvent)


@pytest.mark.django_db
def test_no_receiver_is_attached_to_every_sender():
    """那个挂在裸 `post_save` 上、每次任何模型保存都跑一遍的 `_auto_connect_signals`
    不再存在 —— 它是「第二套」的入口。"""
    from apps.audit import signals
    from apps.audit.models import AuditLog

    assert not hasattr(signals, "_auto_connect_signals")
    # A receiver connected with no sender fires for every model, AuditLog
    # included — and AuditLog is the one model this module must never audit.
    # So "no audit receiver on AuditLog's post_save" is "no catch-all".
    catch_all = _audit_receivers(post_save, AuditLog)
    assert catch_all == [], [getattr(r, "__name__", r) for r in catch_all]


@pytest.mark.django_db(transaction=True)
def test_renaming_a_role_records_the_old_and_new_name():
    role = Role.objects.create(name="DIFF_PROBE", display_name="before")
    AuditLog.objects.filter(resource_id=str(role.pk)).delete()

    role.name = "DIFF_PROBE_2"
    role.display_name = "after"
    role.save()

    row = (
        AuditLog.objects.filter(action=AuditAction.UPDATE, resource="role", resource_id=str(role.pk))
        .order_by("-timestamp")
        .first()
    )
    assert row is not None, "Role 的保存没有 UPDATE 审计行"
    assert row.changes, f"changes 是 {row.changes!r} —— Role 从未接过 pre_save,于是没有「旧行」可比"
    assert row.changes["name"] == ["DIFF_PROBE", "DIFF_PROBE_2"], row.changes
    assert row.changes["display_name"] == ["before", "after"], row.changes


@pytest.mark.django_db(transaction=True)
def test_swapping_a_grants_permission_records_old_then_new():
    """BP-20:更新分支此前在 post_save 里重新 get 那一行,old == new 恒真。"""
    role = Role.objects.create(name="SWAP_PROBE", display_name="swap")
    a, _ = Permission.objects.get_or_create(codename="swap.a", defaults={"name": "a", "category": "swap"})
    b, _ = Permission.objects.get_or_create(codename="swap.b", defaults={"name": "b", "category": "swap"})
    rp = RolePermission.objects.create(role=role, permission=a)
    AuditLog.objects.filter(resource="rolepermission", resource_id=str(rp.pk)).delete()

    rp.permission = b
    rp.save()

    row = (
        AuditLog.objects.filter(
            action=AuditAction.PERMISSION_CHANGE, resource="rolepermission", resource_id=str(rp.pk)
        )
        .order_by("-timestamp")
        .first()
    )
    assert row is not None, "换权限没有 PERMISSION_CHANGE 行"
    assert row.changes["permissions"] == {"old": ["swap.a"], "new": ["swap.b"]}, row.changes


@pytest.mark.django_db(transaction=True)
def test_a_grant_save_that_changes_nothing_writes_no_permission_change_row():
    """反对照:修之前每次 save 都写一行 old == new 的假 diff。"""
    role = Role.objects.create(name="NOOP_PROBE", display_name="noop")
    a, _ = Permission.objects.get_or_create(codename="noop.a", defaults={"name": "a", "category": "noop"})
    rp = RolePermission.objects.create(role=role, permission=a)
    AuditLog.objects.filter(resource="rolepermission", resource_id=str(rp.pk)).delete()

    rp.save()

    rows = AuditLog.objects.filter(
        action=AuditAction.PERMISSION_CHANGE, resource="rolepermission", resource_id=str(rp.pk)
    )
    assert rows.count() == 0, [r.changes for r in rows]


@pytest.mark.django_db(transaction=True)
def test_renaming_a_role_invalidates_the_old_names_cache_too():
    """BP-07 在信号这一层:不经过 view 的改名(shell、admin)也要失效旧名。"""
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.checker import check_permission
    from apps.perm.services import RoleHolder

    invalidate_all_permissions()
    Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    role = Role.objects.create(name="CACHE_PROBE", display_name="cache")
    perm, _ = Permission.objects.get_or_create(codename="cache.read", defaults={"name": "r", "category": "cache"})
    RolePermission.objects.create(role=role, permission=perm)
    assert check_permission(RoleHolder("CACHE_PROBE"), "cache.read") is True  # now cached

    role.name = "CACHE_PROBE_2"
    role.save()

    assert check_permission(RoleHolder("CACHE_PROBE"), "cache.read") is False, "旧名的缓存条目没有失效"
    assert check_permission(RoleHolder("CACHE_PROBE_2"), "cache.read") is True
