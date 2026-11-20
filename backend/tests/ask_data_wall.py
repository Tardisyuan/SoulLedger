"""问数的库墙,给测试用(ADR 0007):`setup.apply` 照 `ask_data_setup` 的样子建一个带随机后缀的只读角色(角色是集群级的),
加一个以它登录的临时别名;退出时删掉别名、策略、RLS 开关与角色。PostgreSQL only,且要 `django_db(transaction=True)`:
DDL 已提交,只能手工撤。读者:tests/test_ask_data_rls.py、test_ask_data_evals.py、test_ask_data_api.py。
"""
import uuid
from contextlib import contextmanager

from django.db import connection, connections

from apps.soul_assist.ask_data import setup


@contextmanager
def wall():
    """→ (角色名, 别名)。"""
    suffix = uuid.uuid4().hex[:12]
    role, alias, password = f"ask_data_t_{suffix}", f"ask_data_t_{suffix}", uuid.uuid4().hex
    try:
        setup.apply(connection, role, password)
        connections.settings[alias] = {**connection.settings_dict, "USER": role, "PASSWORD": password,
                                       "CONN_MAX_AGE": 0}
        # Log in now: Django's test case refuses to *open* a connection on an alias outside its `databases`,
        # and this alias did not exist when the test case was set up. An open one it leaves alone.
        connections[alias].connect()
        yield role, alias
    finally:
        # Gone before Django's own teardown, which walks every alias in `connections`.
        if alias in connections.settings:
            connections[alias].close()
            del connections[alias]
            del connections.settings[alias]
        with connection.cursor() as cursor:
            for table in setup.tables():
                cursor.execute(f"DROP POLICY IF EXISTS {setup.POLICY} ON {table}")
                cursor.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role])
            if cursor.fetchone():
                cursor.execute(f"DROP OWNED BY {role}")
                cursor.execute(f"DROP ROLE {role}")
