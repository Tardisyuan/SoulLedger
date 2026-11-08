"""审计行写失败不能拖垮它所记录的那笔业务(重构审查 2026-11-08 后端第 5 节)。

- 事务里的两处插入(权限变更、批量操作):PostgreSQL 上一条失败的语句会中止整个事务,
  `except` 吞了异常,之后的语句照样报 `current transaction is aborted`。要包在保存点里。
  SQLite 不中止事务,所以这里量的是「插入发生在一个新的保存点里」,不是中止本身。
- `on_commit` 里的那处:回调在提交之后才跑,外面那层 `try` 早已退出,异常一路抛给提交的调用方。
"""
from unittest import mock

import pytest
from django.db import DatabaseError, connection

from apps.audit.models import AuditLog
from apps.audit.signals import create_batch_audit_log
from apps.perm.models import Permission, Role, RolePermission
from apps.souls.models import Soul, SoulState

pytestmark = pytest.mark.django_db


def _record_savepoint_depth(seen):
    def create(*args, **kwargs):
        seen.append(len(connection.savepoint_ids))
        raise DatabaseError("audit insert failed")
    return create


def test_the_permission_change_row_is_written_in_its_own_savepoint():
    role, _ = Role.objects.get_or_create(name="SP_ROLE", defaults={"display_name": "SP"})
    perm, _ = Permission.objects.get_or_create(codename="sp.permission", defaults={"name": "SP", "category": "test"})
    seen, depth = [], len(connection.savepoint_ids)
    with mock.patch.object(AuditLog.objects, "create", side_effect=_record_savepoint_depth(seen)):
        RolePermission.objects.create(role=role, permission=perm)
    assert seen and seen[0] > depth


def test_the_batch_row_is_written_in_its_own_savepoint(cn_tenant):
    soul = Soul.objects.create(name="批", tenant=cn_tenant, current_state=SoulState.ALIVE)
    seen, depth = [], len(connection.savepoint_ids)
    with mock.patch.object(AuditLog.objects, "create", side_effect=_record_savepoint_depth(seen)):
        create_batch_audit_log("UPDATE", [soul])
    assert seen and seen[0] > depth


def test_a_failed_insert_after_commit_does_not_reach_the_committer(cn_tenant, django_capture_on_commit_callbacks):
    failing = mock.patch.object(AuditLog.objects, "create", side_effect=DatabaseError("audit insert failed"))
    with failing, django_capture_on_commit_callbacks(execute=True) as callbacks:
        Soul.objects.create(name="后", tenant=cn_tenant, current_state=SoulState.ALIVE)
    assert callbacks  # the audit write was queued, ran, and its failure stayed inside it
