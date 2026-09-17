"""`apps/core/lock_join_guard.py` 自己的测试:它判的是编译后的查询,正反两面都要能判。"""
import pytest
from django.db import connection

from apps.core.lock_join_guard import _violations, check
from apps.soul_accounts.models import InitialCredential, SoulAccount
from apps.souls.models import Soul


def _verdict(qs):
    sql, _ = qs.query.get_compiler(connection=connection).as_sql()
    # 这里是故意编译违规查询;插件已经记下了,清掉,免得本测试被自己的样本判失败。
    _violations.clear()
    return check(qs.query, sql)


@pytest.mark.django_db
def test_a_lock_across_a_nullable_join_without_of_is_flagged():
    # Soul.tenant 可空 → LEFT OUTER JOIN:PostgreSQL 在这里报 NotSupportedError。
    assert "left_outer_join=True" in _verdict(Soul.all_objects.select_for_update().select_related("tenant"))
    assert _verdict(SoulAccount.objects.select_for_update().select_related("soul__tenant", "user"))


@pytest.mark.django_db
def test_an_inner_select_related_under_a_lock_is_flagged_too():
    # PG 不报错,但会把关联表的行一起锁住。
    verdict = _verdict(InitialCredential.objects.select_for_update().select_related("account"))
    assert verdict and "left_outer_join=False" in verdict


@pytest.mark.django_db
def test_of_self_and_plain_locks_and_unlocked_joins_pass():
    assert _verdict(Soul.all_objects.select_for_update(of=("self",)).select_related("tenant")) is None
    assert _verdict(Soul.all_objects.select_for_update().filter(pk=1)) is None
    assert _verdict(Soul.all_objects.select_related("tenant")) is None


def test_the_plugin_is_registered_for_every_run(pytestconfig):
    assert pytestconfig.pluginmanager.has_plugin("apps.core.lock_join_guard")
