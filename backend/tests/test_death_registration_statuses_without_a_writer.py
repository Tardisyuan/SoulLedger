"""ACCEPTED 与 PARTIAL 已删(2026-10-29 用户决定):没有任何代码写过它们。迁移 death_sync/0009 把可能残留的旧行
改成最接近的现有状态;枚举里不再有它们。DUPLICATE 随后(审查 2026-11-01 P3,迁移 0011):同样没有写入方。"""
import importlib
from types import SimpleNamespace

import pytest
from django.apps import apps as live_apps
from django.db import connection

from apps.death_sync.models import DeathRegistrationRequest, DeathRegistrationStatus

pytestmark = pytest.mark.django_db

migration = importlib.import_module("apps.death_sync.migrations.0009_drop_unwritten_statuses")
migration_0011 = importlib.import_module("apps.death_sync.migrations.0011_drop_duplicate_status")


def test_the_enum_no_longer_offers_them():
    assert set(DeathRegistrationStatus.values) == {"PENDING", "PROCESSED", "FAILED"}


def test_left_over_rows_move_to_the_nearest_status(cn_tenant):
    rows = {}
    for i, old in enumerate(("ACCEPTED", "PARTIAL", "PROCESSED")):
        row = DeathRegistrationRequest.objects.create(
            tenant=cn_tenant, source_system="test-source", idempotency_key=f"key-{i}", source_payload={})
        DeathRegistrationRequest._base_manager.filter(pk=row.pk).update(status=old)
        rows[old] = row.pk
    migration.move_rows(live_apps, SimpleNamespace(connection=connection))
    status = {old: DeathRegistrationRequest._base_manager.get(pk=pk).status for old, pk in rows.items()}
    assert status == {"ACCEPTED": "PENDING", "PARTIAL": "FAILED", "PROCESSED": "PROCESSED"}


def test_a_left_over_duplicate_row_becomes_failed_and_says_why(cn_tenant):
    rows = {}
    for i, (old, code) in enumerate((("DUPLICATE", ""), ("DUPLICATE", "SOUL_NOT_ALIVE"), ("PROCESSED", ""))):
        row = DeathRegistrationRequest.objects.create(
            tenant=cn_tenant, source_system="test-source", idempotency_key=f"dup-{i}", source_payload={})
        DeathRegistrationRequest._base_manager.filter(pk=row.pk).update(status=old, error_code=code)
        rows[i] = row.pk
    migration_0011.move_rows(live_apps, SimpleNamespace(connection=connection))
    after = {i: DeathRegistrationRequest._base_manager.values_list("status", "error_code").get(pk=pk)
             for i, pk in rows.items()}
    assert after == {0: ("FAILED", "DUPLICATE"), 1: ("FAILED", "SOUL_NOT_ALIVE"), 2: ("PROCESSED", "")}
