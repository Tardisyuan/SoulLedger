"""`POST /api/v1/ask-data/`(docs/ARCHITECTURE-ask-data.md §2 的验收),与演示命令 `manage.py ask_data`。

SQLite 上跑的几条把执行器换成记录调用的替身(只读角色与 RLS 只在 PostgreSQL 上有):它们证明的是接口的形状、
权限、殿从哪来、哪一步先拒。最后两条只在真 PostgreSQL 上跑:同一个接口、真闸门、真执行器,以只读角色登录、过 RLS
(tests/ask_data_wall.py),模型写的 SQL 不带租户过滤也只数到本殿。
"""
import json
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.db import connection

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.soul_assist.ask_data import executor, gate, service
from apps.soul_assist.providers import FakeProvider
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.ai_feature_support import enable, stub_fixture  # noqa: F401  (fixture `stub`)
from tests.soul_account_support import officer_client

URL = "/api/v1/ask-data/"
SQLITE = connection.vendor == "sqlite"
REPLY = "好的:\n```sql\nSELECT court, count(*) AS n FROM judgment_judgment GROUP BY court\n```"


@pytest.fixture
def ran(monkeypatch):
    """执行器替身:记下 (sql, 殿, 别名),回一行结果。ALIAS 换成一定存在的 `default`,让「已配置」成立。"""
    calls = []

    def run(sql, tenant_id, *, using):
        calls.append((sql, tenant_id, using))
        return executor.Result(columns=["court", "n"], rows=[["第一殿", 3]], truncated=False, elapsed_ms=4)

    monkeypatch.setattr(service, "ALIAS", "default")
    monkeypatch.setattr(executor, "run", run)
    return calls


@pytest.mark.django_db
def test_a_hall_officer_gets_the_sql_and_the_rows(cn_tenant, judge_user, stub, ran):
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: REPLY)
    response = officer_client(judge_user).post(URL, {"question": "各殿结了多少案?"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data == {"sql": "SELECT court, count(*) AS n FROM judgment_judgment GROUP BY court",
                             "columns": ["court", "n"], "rows": [["第一殿", 3]], "truncated": False, "elapsed_ms": 4}
    assert ran == [(response.data["sql"], cn_tenant.pk, "default")]  # 殿来自令牌,不来自问题
    call = FakeProvider.calls[0]
    facts = json.loads(call["facts"])
    assert set(facts) == {"today", "tables"} and "judgment_judgment" in facts["tables"]
    assert "confession" not in facts["tables"]  # 未授权的列不给模型看
    assert '<data source="question">\n各殿结了多少案?\n</data>' in call["history"][-1].text


@pytest.mark.django_db
def test_without_judgment_read_it_is_403_and_nothing_is_sent(cn_tenant, stub, ran):
    enable(cn_tenant)
    guardian = User.objects.create_user(username="ask_guardian", password="x", role="GUARDIAN", tenant=cn_tenant)
    assert officer_client(guardian).post(URL, {"question": "几件案子"}, format="json").status_code == 403
    assert FakeProvider.calls == [] and ran == []


@pytest.mark.django_db
def test_an_officer_with_no_hall_is_refused_before_the_model(admin_user, cn_tenant, stub, ran):
    """§9 Q2:没绑殿的 ADMIN(这里是全局的 SYSTEM_ADMIN 与文明管理员)不开放。"""
    civ_admin = User.objects.create_user(username="ask_civ_admin", password="x", role="ADMIN", tenant=None)
    for user in (admin_user, civ_admin):
        response = officer_client(user).post(URL, {"question": "几件案子"}, format="json")
        assert (response.status_code, response.data["code"]) == (403, "no_tenant"), user.username
    assert FakeProvider.calls == [] and ran == []


@pytest.mark.django_db
def test_no_model_is_503_assistant_not_configured(cn_tenant, judge_user, stub, ran):
    enable(cn_tenant, False)
    response = officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    assert (response.status_code, response.data["code"]) == (503, "assistant_not_configured")
    assert FakeProvider.calls == [] and ran == []


@pytest.mark.django_db
def test_no_ask_data_database_is_503_before_the_model(cn_tenant, judge_user, stub, monkeypatch):
    enable(cn_tenant)
    monkeypatch.setattr(service, "ALIAS", "ask_data_never_configured")
    response = officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    assert (response.status_code, response.data["code"]) == (503, "ask_data_not_configured")
    assert FakeProvider.calls == []


@pytest.mark.django_db
@pytest.mark.parametrize(("reply", "code"), [
    ("```sql\nSELECT count(*) FROM souls_soul; DROP TABLE souls_soul\n```", gate.MULTIPLE_STATEMENTS),
    ("SELECT id FROM authentication_user", gate.TABLE_NOT_ALLOWED),
    ("SELECT * FROM judgment_judgment", gate.STAR_NOT_ALLOWED),
    ("我不知道。", gate.NOT_A_SELECT),  # 没有围栏就取整段;sqlglot 把它读成一个列名
    ("", gate.UNPARSEABLE),
])
def test_a_refused_sql_is_400_with_the_code_and_the_sql(cn_tenant, judge_user, stub, ran, reply, code):
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: reply)
    response = officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    assert (response.status_code, response.data["code"]) == (400, code), response.data
    assert response.data["sql"] == (service.evals.extract_sql(reply) or "")
    assert ran == []  # 闸门拒了,执行器没被叫到


@pytest.mark.django_db
@pytest.mark.parametrize(("code", "status"), [(executor.TIMEOUT, 400), (executor.PERMISSION_DENIED, 400),
                                              (executor.NOT_CONFIGURED, 503)])
def test_an_executor_refusal_keeps_its_code(cn_tenant, judge_user, stub, monkeypatch, code, status):
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: REPLY)
    monkeypatch.setattr(service, "ALIAS", "default")

    def refuse(sql, tenant_id, *, using):
        raise executor.ExecutionError(code)

    monkeypatch.setattr(executor, "run", refuse)
    response = officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    assert (response.status_code, response.data["code"]) == (status, code)
    assert response.data["sql"].startswith("SELECT court")


@pytest.mark.django_db
def test_an_empty_or_too_long_question_is_refused(cn_tenant, judge_user, stub, ran):
    enable(cn_tenant)
    client = officer_client(judge_user)
    assert client.post(URL, {"question": " "}, format="json").status_code == 400
    assert client.post(URL, {"question": "案" * (service.MAX_QUESTION + 1)}, format="json").status_code == 400
    assert FakeProvider.calls == [] and ran == []


@pytest.mark.django_db
def test_the_demo_command_refuses_without_the_database(cn_tenant):
    with pytest.raises(CommandError, match="ask_data_not_configured"):
        call_command("ask_data", "--tenant", "CN_DIYU", "--sql", "SELECT count(*) FROM judgment_judgment")
    with pytest.raises(CommandError, match="ask_data_not_configured"):
        call_command("ask_data_eval", "--offline")


# --- 每次调用一行审计(2026-11-21 决定 3)---

#: 只在结果里出现的值:审计行里一个都不能有(结果只回给官员)。
SECRET_CELL, SECRET_NUMBER, SECRET_COLUMN = "结果里才有的殿名", 31337, "only_in_the_result"


@pytest.fixture
def ran_secret(monkeypatch):
    def run(sql, tenant_id, *, using):
        return executor.Result(columns=[SECRET_COLUMN], rows=[[SECRET_CELL, SECRET_NUMBER]] * 3, truncated=True,
                               elapsed_ms=4)

    monkeypatch.setattr(service, "ALIAS", "default")
    monkeypatch.setattr(executor, "run", run)


def _audit_rows():
    from apps.audit.models import AuditLog

    return list(AuditLog.objects.filter(resource=service.AUDIT_RESOURCE))


def _the_one_row(user, tenant, outcome, sql, rows=None, truncated=None):
    from apps.audit.models import AuditAction

    found = _audit_rows()
    assert len(found) == 1, [r.changes for r in found]
    row = found[0]
    assert (row.user_id, row.tenant_id, row.action) == (user.pk, getattr(tenant, "pk", None), AuditAction.READ)
    changes = dict(row.changes)
    assert isinstance(changes.pop("elapsed_ms"), int)
    assert changes == {"question": "几件案子", "sql": sql, "outcome": outcome, "rows": rows, "truncated": truncated}
    written = json.dumps([row.changes, row.description, row.resource_id], ensure_ascii=False)
    assert SECRET_CELL not in written and str(SECRET_NUMBER) not in written and SECRET_COLUMN not in written
    return row


@pytest.mark.django_db
def test_an_answered_call_writes_one_row_without_the_result(cn_tenant, judge_user, stub, ran_secret):
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: REPLY)
    response = officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    assert response.status_code == 200 and response.data["rows"][0] == [SECRET_CELL, SECRET_NUMBER]
    _the_one_row(judge_user, cn_tenant, "ok", response.data["sql"], rows=3, truncated=True)


@pytest.mark.django_db
@pytest.mark.parametrize(("reply", "code"), [
    ("```sql\nSELECT 1; DROP TABLE souls_soul\n```", gate.MULTIPLE_STATEMENTS),
    ("SELECT * FROM judgment_judgment", gate.STAR_NOT_ALLOWED),
    ("", gate.UNPARSEABLE),
])
def test_a_gate_refusal_writes_one_row_with_the_gates_code(cn_tenant, judge_user, stub, ran_secret, reply, code):
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: reply)
    assert officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json").status_code == 400
    _the_one_row(judge_user, cn_tenant, code, service.evals.extract_sql(reply) or "")


@pytest.mark.django_db
@pytest.mark.parametrize("code", [executor.TIMEOUT, executor.PERMISSION_DENIED, executor.EXECUTION_ERROR,
                                  executor.NOT_CONFIGURED])
def test_an_executor_refusal_writes_one_row_with_the_executors_code(cn_tenant, judge_user, stub, monkeypatch, code):
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: REPLY)
    monkeypatch.setattr(service, "ALIAS", "default")

    def refuse(sql, tenant_id, *, using):
        raise executor.ExecutionError(code)

    monkeypatch.setattr(executor, "run", refuse)
    officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    _the_one_row(judge_user, cn_tenant, code, service.evals.extract_sql(REPLY))


@pytest.mark.django_db
def test_a_call_refused_before_the_model_writes_one_row_too(admin_user, cn_tenant, judge_user, stub, monkeypatch):
    officer_client(admin_user).post(URL, {"question": "几件案子"}, format="json")  # no hall
    _the_one_row(admin_user, None, executor.NO_TENANT, None)
    _audit_rows()[0].delete()
    enable(cn_tenant, False)
    monkeypatch.setattr(service, "ALIAS", "default")  # a database, but no model
    officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    _the_one_row(judge_user, cn_tenant, "assistant_not_configured", None)
    _audit_rows()[0].delete()
    enable(cn_tenant)
    monkeypatch.setattr(service, "ALIAS", "ask_data_never_configured")
    officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")  # no database
    _the_one_row(judge_user, cn_tenant, executor.NOT_CONFIGURED, None)


@pytest.mark.django_db
def test_a_request_refused_before_the_service_writes_no_row(cn_tenant, judge_user, stub, ran_secret):
    """Serializer and permission refusals never reach `service.ask`: no call was made, nothing to record."""
    enable(cn_tenant)
    officer_client(judge_user).post(URL, {"question": " "}, format="json")
    assert _audit_rows() == []


@pytest.mark.django_db(transaction=True)
def test_when_the_audit_row_cannot_be_written_the_officer_gets_no_result(cn_tenant, judge_user, stub, ran_secret):
    """The repo's audit rule (apps/audit/signals.py `_write_row`, tests/test_audit_inside_transactions.py): the row is
    part of the record and its failure reaches the caller. A read has nothing to roll back, so the call fails and the
    result is not sent -- as an export does (apps/core/exports.py `record_export`)."""
    from django.db import OperationalError

    from tests.test_audit_inside_transactions import failing_audit_insert

    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: REPLY)
    with failing_audit_insert("READ") as hits, pytest.raises(OperationalError, match="injected"):
        officer_client(judge_user).post(URL, {"question": "几件案子"}, format="json")
    assert hits and _audit_rows() == []


# --- 真 PostgreSQL:接口与命令走只读角色与 RLS ---

def _case(code):
    tenant = Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]
    soul = Soul.objects.create(name=f"{code} soul", tenant=tenant, current_state=SoulState.JUDGING)
    Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=tenant, court="第一殿")
    return tenant


def _demo(sql, hall):
    out = StringIO()
    call_command("ask_data", "--tenant", hall, "--sql", sql, stdout=out)
    return out.getvalue().splitlines()


@pytest.mark.skipif(SQLITE, reason="The read-only role and RLS exist only on PostgreSQL.")
@pytest.mark.django_db(transaction=True)
def test_through_the_wall_the_model_forgets_the_hall_and_still_counts_only_its_own(judge_user, stub, monkeypatch):
    from tests.ask_data_wall import wall

    cn = _case("CN_DIYU")
    _case("EU_HEAVEN_HELL")
    _case("EU_HEAVEN_HELL")
    enable(cn)
    stub.reply = staticmethod(lambda s, f, p: REPLY)
    with wall() as (_role, alias):
        monkeypatch.setattr(service, "ALIAS", alias)
        response = officer_client(judge_user).post(URL, {"question": "各殿结了多少案?"}, format="json")
        assert response.status_code == 200, response.data
        assert response.data["rows"] == [["第一殿", 1]]  # 别殿两件不算:SQL 里没有租户过滤,RLS 兜住
        assert Judgment.all_objects.filter(court="第一殿").count() == 3

        # 演示命令(§11 第 3 条):同一条 SQL,换一个殿,数字不同;`; DROP` 给错误码。
        sql = "SELECT count(*) FROM judgment_judgment"
        assert _demo(sql, "CN_DIYU")[1:3] == ["count", "1"]
        assert _demo(sql, "EU_HEAVEN_HELL")[1:3] == ["count", "2"]
        with pytest.raises(CommandError, match="multiple_statements"):
            _demo(f"{sql}; DROP TABLE souls_soul", "CN_DIYU")
