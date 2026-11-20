"""问数评测(docs/ARCHITECTURE-ask-data.md §7):比对口径、错误分类、用例集自检,和种子上的一次离线试跑。

- 比对与分类是 `apps/soul_assist/ask_data/evals.py` 里的纯函数,SQLite 也跑,不碰库;
- 用例集自检读 `evalsets/ask_data.json` 与 `ask_data/schema.yaml`:条数、题型分布、四张表、gold 结构上能过闸门、
  gold 只读授权列、反例题不期望 ok、`offline_summary` 与每题的 `offline` 自洽;
- 闸门:每条 gold_sql 过真闸门(`gate.check`),每条反例题的 naive_sql 被它拒;
- 最后一条只在真 PostgreSQL 上跑:种子 + 真闸门 + 真执行器(`service.eval_hooks`,以 tests/ask_data_wall.py 建的只读角色
  登录、过 RLS)跑一遍 `--offline`,每题落在用例集记下的分类上。第一步用的是两个替身(临时视图挡在真表前、结构闸门);
  2026-11-21 换成真东西后分数与分类计数没有变(读未授权列从「列不存在」42703 变成「无权限」42501,两者都记 permission_denied)。
"""
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
import sqlglot
import yaml
from django.db import connection, transaction
from sqlglot import exp

from apps.soul_assist import features
from apps.soul_assist.ask_data import evals, gate, service

SQLITE = connection.vendor == "sqlite"
EVAL = features.evalset("ask_data")
CASES = EVAL["cases"]
SCHEMA = yaml.safe_load((Path(evals.__file__).parent / "schema.yaml").read_text(encoding="utf-8"))["tables"]
GRANTED = {t: [c["name"] for c in spec["columns"] if c["granted"]] for t, spec in SCHEMA.items()}
MAX_ROWS = 200


def _ok(rows, truncated=False):
    return {"rows": rows, "truncated": truncated}


# --- 比对 ---

def test_column_order_does_not_matter():
    assert evals.same_result([(1, "FAILED"), (2, "PASSED")], [("FAILED", 1), ("PASSED", 2)], ordered=False)


def test_row_order_matters_only_when_the_question_asks_for_an_order():
    gold, got = [(1,), (2,)], [(2,), (1,)]
    assert evals.same_result(gold, got, ordered=False)
    assert not evals.same_result(gold, got, ordered=True)


def test_rows_are_a_multiset_not_a_set():
    assert not evals.same_result([(1,), (1,)], [(1,)], ordered=False)


def test_null_equals_null_and_nothing_else():
    assert evals.same_result([(None, 1)], [(1, None)], ordered=False)
    assert not evals.same_result([(None,)], [(0,)], ordered=False)
    assert not evals.same_result([(None,)], [("",)], ordered=False)


def test_decimals_are_compared_to_six_places_and_integers_exactly():
    assert evals.same_result([(Decimal("41.6666666667"),)], [(41.666667,)], ordered=False)
    assert not evals.same_result([(Decimal("41.666666"),)], [(Decimal("41.666667"),)], ordered=False)
    assert evals.same_result([(3,)], [(Decimal("3.000"),)], ordered=False)  # count(*) 与 sum(…) 的同一个数
    assert not evals.same_result([(10**18,)], [(10**18 + 1,)], ordered=False)


def test_dates_and_times_compare_as_iso_strings():
    at = datetime(2026, 3, 1, 9, tzinfo=UTC)
    assert evals.same_result([(at,)], [(at.isoformat(),)], ordered=False)
    assert evals.same_result([(date(2026, 3, 1),)], [("2026-03-01",)], ordered=False)


def test_a_truncated_side_is_never_judged_correct():
    rows = [(i,) for i in range(MAX_ROWS)]
    for gold, got in ((_ok(rows, True), _ok(rows)), (_ok(rows), _ok(rows, True))):
        assert evals.classify("SELECT 1", gate_code=None, got=got, gold=gold, gold_sql="SELECT 1",
                              ordered=False) == ("truncated", None)


# --- 分类:每个分类一条构造用例 ---

GOLD_SQL = ("SELECT j.court, count(*) FROM judgment_judgment j JOIN souls_soul s ON s.id = j.soul_id "
            "WHERE j.is_final GROUP BY j.court")
GOLD = _ok([("第一殿", 3), ("第五殿", 2)])
WRONG = _ok([("第一殿", 9)])


CLASSIFY_CASES = [
    (None, None, {}, ("no_sql", None)),
    ("", None, {}, ("no_sql", None)),
    ("SELECT 1; DROP TABLE souls_soul", "multiple_statements", {}, ("gate_rejected", "multiple_statements")),
    ("SELECT pg_sleep(10)", None, {"code": "timeout"}, ("timeout", "timeout")),
    ("SELECT confession FROM judgment_judgment", None, {"code": "permission_denied"},
     ("permission_denied", "permission_denied")),
    ("SELECT 1/0", None, {"code": "execution_error"}, ("execution_error", "execution_error")),
    ("UPDATE x SET y = 1", None, {"code": "read_only"}, ("execution_error", "read_only")),
    (GOLD_SQL, None, _ok(GOLD["rows"], True), ("truncated", None)),
    # 别名不同、列序不同、行序不同:结果一样就是对的
    ("SELECT count(*), judgment_judgment.court FROM souls_soul JOIN judgment_judgment ON judgment_judgment.soul_id = "
     "souls_soul.id WHERE judgment_judgment.is_final GROUP BY judgment_judgment.court", None,
     _ok([(2, "第五殿"), (3, "第一殿")]), ("ok", None)),
    ("SELECT j.court, count(*) FROM judgment_judgment j JOIN disposition_disposition d ON d.judgment_id = j.id "
     "WHERE j.is_final GROUP BY j.court", None, WRONG, ("wrong_table", None)),
    ("SELECT j.court, count(*) FROM judgment_judgment j JOIN souls_soul s ON s.id = j.id "
     "WHERE j.is_final GROUP BY j.court", None, WRONG, ("wrong_join", None)),
    ("SELECT j.court, count(*) FROM judgment_judgment j JOIN souls_soul s ON s.id = j.soul_id "
     "WHERE NOT j.is_final GROUP BY j.court", None, WRONG, ("wrong_filter", None)),
    ("SELECT j.civilization, count(*) FROM judgment_judgment j JOIN souls_soul s ON s.id = j.soul_id "
     "WHERE j.is_final GROUP BY j.civilization", None, WRONG, ("wrong_aggregate", None)),
    ("SELECT j.court, count(*) FROM judgment_judgment j JOIN souls_soul s ON s.id = j.soul_id "
     "WHERE j.is_final GROUP BY j.court LIMIT 1", None, WRONG, ("other", None)),
    ("not even sql (((", None, WRONG, ("other", None)),
]


@pytest.mark.parametrize(("sql", "gate_code", "got", "expected"), CLASSIFY_CASES)
def test_each_category_has_a_case_that_lands_on_it(sql, gate_code, got, expected):
    assert evals.classify(sql, gate_code=gate_code, got=got, gold=GOLD, gold_sql=GOLD_SQL, ordered=False) == expected


def test_every_category_is_reached_by_the_cases_above():
    assert {expected[0] for *_, expected in CLASSIFY_CASES} == set(evals.CATEGORIES)


def test_a_join_is_compared_by_table_not_by_column_name():
    """`d.soul_id = s.id` 与 `j.soul_id = s.id` 去掉限定后一模一样;别名换回表名才分得开。"""
    gold_sql = ("SELECT count(*) FROM judgment_judgment j JOIN disposition_disposition d ON d.judgment_id = j.id "
                "JOIN souls_soul s ON d.soul_id = s.id")
    sql = ("SELECT count(*) FROM judgment_judgment AS jj JOIN disposition_disposition AS dd ON dd.judgment_id = jj.id "
           "JOIN souls_soul AS ss ON jj.soul_id = ss.id")
    assert evals.classify(sql, gate_code=None, got=_ok([(4,)]), gold=_ok([(5,)]), gold_sql=gold_sql,
                          ordered=False) == ("wrong_join", None)


def test_sql_is_extracted_from_a_fenced_reply_or_taken_whole():
    assert evals.extract_sql("好的:\n```sql\nSELECT 1\n```\n") == "SELECT 1"
    assert evals.extract_sql("  SELECT 1  ") == "SELECT 1"
    assert evals.extract_sql("```\n```") is None
    assert evals.extract_sql(None) is None


def test_the_summary_scores_graded_and_adversarial_cases_apart():
    results = [{"category": "ok", "expect": "ok"}, {"category": "wrong_join", "expect": "ok"},
               {"category": "gate_rejected", "expect": "gate_rejected"}, {"category": "ok", "expect": "gate_rejected"}]
    assert evals.summarize(results) == {"accuracy": "1/2", "rejected": "1/2",
                                        "counts": {"gate_rejected": 1, "ok": 2, "wrong_join": 1}}


# --- 用例集自检 ---

def test_the_evalset_has_the_size_and_spread_the_spec_asks_for():
    assert 30 <= len(CASES) <= 50
    assert len({c["id"] for c in CASES}) == len(CASES)
    spread = {cat: sum(c["category"] == cat for c in CASES) for cat in
              ("single", "join", "aggregate", "time", "synonym", "adversarial")}
    assert spread["single"] >= 10 and spread["join"] >= 8 and spread["aggregate"] >= 8
    assert spread["time"] >= 6 and spread["synonym"] >= 5 and spread["adversarial"] >= 5
    assert sum(spread.values()) == len(CASES)
    assert EVAL["today"] and EVAL["tenant"]


def test_every_table_is_used_and_join_cases_really_join():
    used = set().union(*(evals.tables(sqlglot.parse_one(c["gold_sql"], read="postgres")) for c in CASES))
    assert used == set(SCHEMA)
    for case in CASES:
        if case["category"] == "join":
            assert len(evals.tables(sqlglot.parse_one(case["gold_sql"], read="postgres"))) >= 2, case["id"]


def test_adversarial_cases_expect_a_rejection_and_graded_cases_expect_ok():
    for case in CASES:
        assert (case["expect"] != "ok") == (case["category"] == "adversarial"), case["id"]
        assert case["expect"] in evals.CATEGORIES and case["offline"] in evals.CATEGORIES, case["id"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_gold_passes_the_gate_and_reads_only_granted_columns(case):
    assert gate.check(case["gold_sql"]).ok, gate.check(case["gold_sql"])
    tree = sqlglot.parse_one(case["gold_sql"], read="postgres")
    granted = set().union(*(GRANTED[t] for t in evals.tables(tree)))
    aliases = {a.alias for a in tree.find_all(exp.Alias)}
    read = {c.name for c in tree.find_all(exp.Column) if not isinstance(c.this, exp.Star)}
    assert read - aliases <= granted


def test_adversarial_naive_sql_is_rejected_by_the_gate():
    adversarial = [c for c in CASES if c["category"] == "adversarial"]
    assert adversarial and all(not gate.check(c["naive_sql"]).ok for c in adversarial)


def test_the_recorded_offline_summary_matches_the_per_case_record():
    recorded = [{"category": c["offline"], "expect": c["expect"]} for c in CASES]
    assert evals.summarize(recorded) == EVAL["offline_summary"]


# --- 种子上的离线试跑(真 PostgreSQL) ---

def _unscoped(sql):
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(sql.replace("FROM ", "FROM public.").replace("JOIN ", "JOIN public."))
        return cursor.fetchall()


@pytest.mark.skipif(SQLITE, reason="The seed run reads through the read-only role and RLS: PostgreSQL only.")
@pytest.mark.django_db(transaction=True)
def test_the_offline_run_on_the_seed_lands_where_the_evalset_says():
    from apps.tenants.models import Tenant
    from tests.ask_data_eval_seed import HALLS, seed
    from tests.ask_data_wall import wall

    tenants = {code: Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0] for code in HALLS}
    seed(tenants)
    home = tenants[EVAL["tenant"]]
    with wall() as (_role, alias):
        _run_offline(home, alias)


def _run_offline(home, alias):
    check, execute = service.eval_hooks(home.pk, using=alias)

    for case in CASES:  # gold 跑得通,而且不是空的(除非本来就该空)
        rows = execute(case["gold_sql"])["rows"]
        meaningful = rows not in ([], [[0]], [[None]])  # the executor gives rows as lists
        assert meaningful != bool(case.get("empty_ok")), (case["id"], rows)
    for case in CASES:  # 不经 RLS 会数进别殿:判 ok 才说明是墙兜住的
        if case.get("forgets_tenant"):
            assert not evals.same_result(execute(case["naive_sql"])["rows"], _unscoped(case["naive_sql"]),
                                         ordered=False), case["id"]

    results = evals.evaluate(CASES, generate=lambda c: c["naive_sql"], check=check, execute=execute)
    assert {r["id"]: r["category"] for r in results} == {c["id"]: c["offline"] for c in CASES}
    assert evals.summarize(results) == EVAL["offline_summary"]
