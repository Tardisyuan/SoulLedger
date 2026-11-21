"""问数的库墙,给测试用(ADR 0007):`setup.apply` 照 `ask_data_setup` 的样子建一个带随机后缀的只读角色(角色是集群级的),
加一个以它登录的临时别名;退出时删掉别名、策略、RLS 开关与角色。PostgreSQL only,且要 `django_db(transaction=True)`:
DDL 已提交,只能手工撤。读者:tests/test_ask_data_rls.py、test_ask_data_evals.py、test_ask_data_api.py、
test_ask_data_sharded.py。

`sharded=True`(2026-11-21 决定 2):墙由 `manage.py ask_data_setup` 本身建在 default 与每个分库上,每个分库再加一个
`<别名>_<分库别名>`,由 settings 用的同一个 `ask_data_shard_databases` 从别名的设置推出来(执行器按这个名字找分库)。
"""
import io
import uuid
from contextlib import contextmanager
from unittest import mock

from django.core.management import call_command
from django.db import connections

from apps.core.sharding import shard_aliases
from apps.soul_assist.ask_data import setup
from config.shard_db import ask_data_shard_databases


@contextmanager
def wall(sharded=False):
    """→ (角色名, 别名)。"""
    suffix = uuid.uuid4().hex[:12]
    role, alias, password = f"ask_data_t_{suffix}", f"ask_data_t_{suffix}", uuid.uuid4().hex
    databases = ["default", *shard_aliases()] if sharded else ["default"]
    added = []
    try:
        if sharded:
            with mock.patch.dict("os.environ", {"ASK_DATA_DB_PASSWORD": password}):
                call_command("ask_data_setup", "--role", role, stdout=io.StringIO())
        else:
            setup.apply(connections["default"], role, password)
        base = {**connections["default"].settings_dict, "USER": role, "PASSWORD": password, "CONN_MAX_AGE": 0}
        derived = ask_data_shard_databases({"ask_data": base, **{a: connections[a].settings_dict
                                                                  for a in databases[1:]}})
        entries = {alias: base, **{name.replace("ask_data", alias, 1): d for name, d in derived.items()}}
        for name, entry in entries.items():
            connections.settings[name] = entry
            added.append(name)
            # Log in now: Django's test case refuses to *open* a connection on an alias outside its `databases`,
            # and this alias did not exist when the test case was set up. An open one it leaves alone.
            connections[name].connect()
        yield role, alias
    finally:
        # Gone before Django's own teardown, which walks every alias in `connections`.
        for name in added:
            connections[name].close()
            del connections[name]
            del connections.settings[name]
        for db in databases:  # DROP OWNED is per database; the role goes once its grants are gone everywhere
            with connections[db].cursor() as cursor:
                for table in setup.tables():
                    cursor.execute(f"DROP POLICY IF EXISTS {setup.POLICY} ON {table}")
                    cursor.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
                cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role])
                if cursor.fetchone():
                    cursor.execute(f"DROP OWNED BY {role}")
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role])
            if cursor.fetchone():
                cursor.execute(f"DROP ROLE {role}")
