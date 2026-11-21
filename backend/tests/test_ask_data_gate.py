"""问数的 SQL 闸门(`apps/soul_assist/ask_data/gate.py`;docs/ARCHITECTURE-ask-data.md §3)。

纯函数,不碰库:拒绝用例断言错误码,放行用例断言表集合不多不少。每个错误码都有「该拒的拒了」
与「只差那一处的合法写法放行」两面,免得一条规则靠误伤全部 SQL 变绿。
"""

import pytest

from apps.soul_assist.ask_data import gate

J = "judgment_judgment"
S = "souls_soul"
D = "disposition_disposition"
P = "sentence_plan_sentenceplan"


def _code(sql):
    verdict = gate.check(sql)
    assert not verdict.ok, f"放行了:{sql!r}"
    assert verdict.tables == frozenset()
    return verdict.code


REJECTED = [
    # 解析失败、空串
    ("", gate.UNPARSEABLE),
    ("   \n\t", gate.UNPARSEABLE),
    (";", gate.UNPARSEABLE),
    ("SEL/**/ECT id FROM judgment_judgment", gate.UNPARSEABLE),
    ("SELECT FROM WHERE (", gate.UNPARSEABLE),
    # 多语句(含 `--` 只截掉同一行、换行后跟第二条)
    ("SELECT 1; DROP TABLE souls_soul", gate.MULTIPLE_STATEMENTS),
    ("SELECT id FROM judgment_judgment;   \n  drop table souls_soul", gate.MULTIPLE_STATEMENTS),
    ("SELECT id FROM judgment_judgment ;DrOp TaBlE souls_soul;", gate.MULTIPLE_STATEMENTS),
    ("SELECT id FROM judgment_judgment -- 注释\n; DELETE FROM souls_soul", gate.MULTIPLE_STATEMENTS),
    ("SELECT 1; SELECT 2", gate.MULTIPLE_STATEMENTS),
    # 不是查询
    ("DROP TABLE souls_soul", gate.NOT_A_SELECT),
    ("DELETE FROM judgment_judgment", gate.NOT_A_SELECT),
    ("UPDATE souls_soul SET status = 'X'", gate.NOT_A_SELECT),
    ("INSERT INTO souls_soul (id) VALUES (1)", gate.NOT_A_SELECT),
    ("WITH x AS (DELETE FROM judgment_judgment RETURNING *) SELECT id FROM x", gate.NOT_A_SELECT),
    ("WITH x AS (UPDATE souls_soul SET status = 'X' RETURNING id) SELECT id FROM x", gate.NOT_A_SELECT),
    ("SELECT id INTO stolen FROM judgment_judgment", gate.NOT_A_SELECT),
    ("SET app.tenant_id = '2'", gate.NOT_A_SELECT),
    ("COPY judgment_judgment TO STDOUT", gate.NOT_A_SELECT),
    ("TRUNCATE judgment_judgment", gate.NOT_A_SELECT),
    ("CREATE TABLE t (a int)", gate.NOT_A_SELECT),
    ("ALTER TABLE souls_soul ADD COLUMN x int", gate.NOT_A_SELECT),
    ("VACUUM", gate.NOT_A_SELECT),
    # 根不是查询、树里也没有写节点的:只靠「根必须是查询」那一条挡(COMMIT 会结束执行器的只读事务)
    ("COMMIT", gate.NOT_A_SELECT),
    ("ROLLBACK", gate.NOT_A_SELECT),
    ("BEGIN", gate.NOT_A_SELECT),
    ("GRANT SELECT ON souls_soul TO public", gate.NOT_A_SELECT),
    ("ANALYZE souls_soul", gate.NOT_A_SELECT),
    # 锁子句
    ("SELECT id FROM judgment_judgment FOR UPDATE", gate.LOCKING_CLAUSE),
    ("SELECT id FROM judgment_judgment FOR SHARE", gate.LOCKING_CLAUSE),
    ("SELECT id FROM judgment_judgment FOR NO KEY UPDATE SKIP LOCKED", gate.LOCKING_CLAUSE),
    # 黑名单函数(大小写、引号、schema 前缀、藏在 FROM 里都算)
    ("SELECT pg_sleep(10)", gate.FORBIDDEN_FUNCTION),
    ("select PG_SLEEP(10)", gate.FORBIDDEN_FUNCTION),
    ('SELECT "pg_sleep"(10)', gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_catalog.pg_sleep(10)", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_sleep_for('10 seconds')", gate.FORBIDDEN_FUNCTION),
    ("SELECT count(*) FROM pg_sleep(10)", gate.FORBIDDEN_FUNCTION),
    ("SELECT dblink('host=evil', 'SELECT 1')", gate.FORBIDDEN_FUNCTION),
    ("SELECT dblink_exec('host=evil', 'DROP TABLE x')", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_read_file('/etc/passwd')", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_read_binary_file('/etc/passwd')", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_ls_dir('.')", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_stat_file('/etc/passwd')", gate.FORBIDDEN_FUNCTION),
    ("SELECT lo_import('/etc/passwd')", gate.FORBIDDEN_FUNCTION),
    ("SELECT set_config('app.tenant_id', '2', true)", gate.FORBIDDEN_FUNCTION),
    ("SELECT current_setting('app.tenant_id')", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_terminate_backend(1)", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_cancel_backend(1)", gate.FORBIDDEN_FUNCTION),
    ("SELECT query_to_xml('SELECT 1', true, true, '')", gate.FORBIDDEN_FUNCTION),
    ("SELECT txid_current()", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_advisory_lock(1)", gate.FORBIDDEN_FUNCTION),
    ("SELECT id FROM judgment_judgment WHERE pg_sleep(1) IS NULL", gate.FORBIDDEN_FUNCTION),
    # 不在放行清单(sqlglot 认不出的一律拒)
    ("SELECT my_udf(id) FROM judgment_judgment", gate.UNKNOWN_FUNCTION),
    ("SELECT public.my_udf(1)", gate.UNKNOWN_FUNCTION),
    # 按名字放的 age / make_date 只认不带前缀、拼写完全一样的那个(2026-11-21 决定 1)
    ("SELECT ages(created_at) FROM judgment_judgment", gate.UNKNOWN_FUNCTION),
    ("SELECT age_in_days(created_at) FROM judgment_judgment", gate.UNKNOWN_FUNCTION),
    ("SELECT make_dates(2026, 1, 1)", gate.UNKNOWN_FUNCTION),
    ("SELECT public.age(created_at) FROM judgment_judgment", gate.UNKNOWN_FUNCTION),
    ("SELECT j.age(created_at) FROM judgment_judgment j", gate.UNKNOWN_FUNCTION),
    ("SELECT make_timestamp(2026, 1, 1, 0, 0, 0)", gate.UNKNOWN_FUNCTION),
    # 放行的名字不给黑名单开后门:前缀与精确名照旧先判
    ("SELECT age(created_at), pg_sleep(1) FROM judgment_judgment", gate.FORBIDDEN_FUNCTION),
    ("SELECT set_config('app.tenant_id', make_date(2026, 1, 1)::text, true)", gate.FORBIDDEN_FUNCTION),
    ("SELECT lo_unlink(age(now())::int)", gate.FORBIDDEN_FUNCTION),
    ("SELECT dblink_connect('x'), make_interval(days => 1)", gate.FORBIDDEN_FUNCTION),
    ("SELECT pg_sleep_for(make_interval(secs => 10))", gate.FORBIDDEN_FUNCTION),
    ("SELECT count(*) FROM pg_sleep(age(now())::int)", gate.FORBIDDEN_FUNCTION),
    # 表函数只放 generate_series;FROM 里别的函数照旧
    ("SELECT n FROM my_srf(1) AS n", gate.UNKNOWN_FUNCTION),
    # 数组放行了,unnest 没有:在 FROM 里、在选择列表里都拒
    ("SELECT u FROM unnest(ARRAY[1, 2]) AS u", gate.UNKNOWN_FUNCTION),
    ("SELECT unnest(fail_reasons) FROM judgment_judgment", gate.UNKNOWN_FUNCTION),
    ("SELECT x FROM judgment_judgment, unnest(ARRAY[1]) AS x", gate.UNKNOWN_FUNCTION),
    # 会话身份:sqlglot 把 user / current_role 读成列,真 PG 返回角色名(2026-11-21 评审)
    ("SELECT user", gate.FORBIDDEN_FUNCTION),
    ("SELECT current_role", gate.FORBIDDEN_FUNCTION),
    ("SELECT current_user", gate.FORBIDDEN_FUNCTION),
    ("SELECT session_user", gate.FORBIDDEN_FUNCTION),
    ("SELECT count(*) FROM judgment_judgment WHERE USER = 'x'", gate.FORBIDDEN_FUNCTION),
    # 属性调用写法:`j.to_jsonb` 就是 `to_jsonb(j)`,限定名后面不是该来源的列就当函数
    ("SELECT j.to_jsonb FROM judgment_judgment j", gate.UNKNOWN_FUNCTION),
    ("SELECT judgment_judgment.row_to_json FROM judgment_judgment", gate.UNKNOWN_FUNCTION),
    ("SELECT s.to_jsonb FROM (SELECT id FROM judgment_judgment) s", gate.UNKNOWN_FUNCTION),
    ("WITH c AS (SELECT id FROM judgment_judgment) SELECT c.to_jsonb FROM c", gate.UNKNOWN_FUNCTION),
    ("SELECT count(*) FROM judgment_judgment j WHERE j.to_jsonb IS NOT NULL", gate.UNKNOWN_FUNCTION),
    # 表
    ("SELECT table_name FROM information_schema.tables", gate.TABLE_NOT_ALLOWED),
    ("SELECT rolname FROM pg_catalog.pg_roles", gate.TABLE_NOT_ALLOWED),
    ("SELECT rolname FROM pg_roles", gate.TABLE_NOT_ALLOWED),
    ("SELECT id FROM public.judgment_judgment", gate.TABLE_NOT_ALLOWED),
    ("SELECT id FROM soulledger.public.judgment_judgment", gate.TABLE_NOT_ALLOWED),
    ("SELECT username FROM authentication_user", gate.TABLE_NOT_ALLOWED),
    ('SELECT id FROM "Judgment_Judgment"', gate.TABLE_NOT_ALLOWED),
    (
        "SELECT id FROM judgment_judgment WHERE judge_id IN (SELECT id FROM authentication_user)",
        gate.TABLE_NOT_ALLOWED,
    ),
    ("SELECT j.id FROM judgment_judgment j JOIN authentication_user u ON u.id = j.judge_id", gate.TABLE_NOT_ALLOWED),
    ("SELECT id FROM judgment_judgment UNION SELECT id FROM authentication_user", gate.TABLE_NOT_ALLOWED),
    # CTE 名只在它的作用域里算:另一个子查询里定义的 `pg_roles` 不能掩护外层的真 `pg_roles`
    (
        "SELECT a FROM (WITH pg_roles AS (SELECT 1 AS a) SELECT a FROM pg_roles) s UNION SELECT rolname FROM pg_roles",
        gate.TABLE_NOT_ALLOWED,
    ),
    # 非递归 CTE 看不见自己、也看不见排在后面的兄弟:定义里的同名表是真表(2026-11-21 评审在真 PG 上读到 pg_roles)
    ("WITH pg_roles AS (SELECT rolname FROM pg_roles) SELECT rolname FROM pg_roles", gate.TABLE_NOT_ALLOWED),
    (
        "WITH a AS (SELECT rolname FROM pg_roles), pg_roles AS (SELECT 1 AS rolname) SELECT rolname FROM a",
        gate.TABLE_NOT_ALLOWED,
    ),
    (
        "WITH pg_roles AS (SELECT rolname FROM (SELECT rolname FROM pg_roles) s) SELECT rolname FROM pg_roles",
        gate.TABLE_NOT_ALLOWED,
    ),
    (
        "WITH authentication_user AS (SELECT username FROM authentication_user) "
        "SELECT username FROM authentication_user",
        gate.TABLE_NOT_ALLOWED,
    ),
    # 星号
    ("SELECT * FROM judgment_judgment", gate.STAR_NOT_ALLOWED),
    ("SELECT j.* FROM judgment_judgment j", gate.STAR_NOT_ALLOWED),
    ("SELECT id FROM (SELECT * FROM souls_soul) s", gate.STAR_NOT_ALLOWED),
    # 不带限定的来源名是整行(等于 `j.*`):别名、表名、子查询与 CTE 名都算
    ("SELECT j FROM judgment_judgment j", gate.STAR_NOT_ALLOWED),
    ("SELECT judgment_judgment FROM judgment_judgment", gate.STAR_NOT_ALLOWED),
    ("SELECT count(*) FROM judgment_judgment j GROUP BY j", gate.STAR_NOT_ALLOWED),
    ("SELECT s FROM (SELECT id FROM souls_soul) s", gate.STAR_NOT_ALLOWED),
    ("WITH c AS (SELECT id FROM souls_soul) SELECT c FROM c", gate.STAR_NOT_ALLOWED),
]


@pytest.mark.parametrize("sql,code", REJECTED, ids=[f"{c}-{i}" for i, (_, c) in enumerate(REJECTED)])
def test_rejected_with_its_code(sql, code):
    assert _code(sql) == code


ALLOWED = [
    # 单表计数
    ("SELECT count(*) FROM judgment_judgment WHERE is_final OR court = '第一殿'", {J}),
    ("select COUNT(*) from JUDGMENT_judgment", {J}),
    ("SELECT count(*) FROM judgment_judgment;", {J}),
    ("SELECT count(*) FROM judgment_judgment;;", {J}),
    # `--` 注释被丢掉,后面的 `; DROP` 在同一行、跟着被注释掉
    ("SELECT count(*) FROM judgment_judgment -- ; DROP TABLE souls_soul", {J}),
    ("SELECT /* 注释 */ count(*) FROM souls_soul", {S}),
    # 两表 JOIN
    (
        "SELECT s.current_state, count(j.id) FROM judgment_judgment j JOIN souls_soul s ON s.id = j.soul_id GROUP BY s.current_state",
        {J, S},
    ),
    # CTE(CTE 名不算表)
    ("WITH done AS (SELECT soul_id FROM judgment_judgment WHERE is_final) SELECT count(*) FROM done", {J}),
    (
        "WITH a AS (SELECT soul_id FROM disposition_disposition), b AS (SELECT soul_id FROM a) "
        "SELECT count(*) FROM b JOIN souls_soul s ON s.id = b.soul_id",
        {D, S},
    ),
    # WITH RECURSIVE 看得见自己;CTE 定义里的子查询看得见外层 WITH 的 CTE
    ("WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r WHERE n < 3) SELECT count(*) FROM r", set()),
    (
        "WITH a AS (SELECT soul_id FROM disposition_disposition) "
        "SELECT count(*) FROM (WITH b AS (SELECT soul_id FROM a) SELECT soul_id FROM b) s",
        {D},
    ),
    # UNION
    ("SELECT soul_id FROM disposition_disposition UNION SELECT soul_id FROM sentence_plan_sentenceplan", {D, P}),
    # 日期函数与 CASE
    (
        "SELECT date_trunc('month', concluded_at) AS m, "
        "sum(CASE WHEN verdict = 'GUILTY' THEN 1 ELSE 0 END), count(*) FILTER (WHERE is_final) "
        "FROM judgment_judgment WHERE concluded_at >= DATE '2026-01-01' "
        "AND concluded_at < now() - INTERVAL '1 day' "
        "AND extract(year FROM created_at) = 2026 GROUP BY 1 ORDER BY 1",
        {J},
    ),
    # 子查询
    ("SELECT count(*) FROM souls_soul WHERE id IN (SELECT soul_id FROM judgment_judgment WHERE NOT is_final)", {S, J}),
    ("SELECT x.c FROM (SELECT count(*) AS c FROM sentence_plan_sentenceplan) x", {P}),
    # 放行清单里的常见函数与窗口
    (
        "SELECT court, coalesce(verdict, '无'), round(avg(1.0), 2), lower(court), cast(created_at AS date), "
        "row_number() OVER (PARTITION BY court ORDER BY created_at), created_at::date "
        "FROM judgment_judgment GROUP BY court, verdict, created_at",
        {J},
    ),
    # 2026-11-21 决定 1:sqlglot 不建模(Anonymous)或建了类但原先不在清单里的日期 / 序列函数
    ("SELECT age(created_at) FROM judgment_judgment", {J}),
    ("SELECT AGE(now(), created_at), \"age\"(created_at) FROM judgment_judgment", {J}),
    ("SELECT count(*) FROM judgment_judgment WHERE created_at >= make_date(2026, 1, 1)", {J}),
    ("SELECT count(*) FROM judgment_judgment WHERE created_at > now() - make_interval(days => 30)", {J}),
    ("SELECT date_part('year', created_at), to_char(created_at, 'YYYY-MM') FROM judgment_judgment", {J}),
    ("SELECT justify_interval(now() - created_at), justify_days(now() - created_at), "
     "justify_hours(now() - created_at) FROM judgment_judgment", {J}),
    ("SELECT n FROM generate_series(1, 12) AS n", set()),
    (
        "SELECT m, count(j.id) FROM generate_series(make_date(2026, 1, 1), make_date(2026, 12, 1), "
        "interval '1 month') AS m LEFT JOIN judgment_judgment j ON date_trunc('month', j.created_at) = m GROUP BY m",
        {J},
    ),
    ("SELECT generate_series(1, 3)", set()),
    # 数组字面量、ANY / ALL、下标,jsonb 的 -> / ->> / #> / #>>(2026-11-21 评审:原先都是 unknown_function)
    ("SELECT count(*) FROM judgment_judgment WHERE court = ANY(ARRAY['第一殿', '第二殿'])", {J}),
    ("SELECT count(*) FROM judgment_judgment WHERE court <> ALL(ARRAY['第一殿'])", {J}),
    ("SELECT count(*) FROM judgment_judgment WHERE court = ANY('{第一殿,第二殿}'::text[])", {J}),
    ("SELECT (ARRAY[1, 2, 3])[2]", set()),
    ("SELECT p.fail_reasons -> 0, fail_reasons ->> 0, fail_reasons #> '{0}', fail_reasons #>> '{0}' "
     "FROM judgment_judgment p", {J}),
    ("SELECT count(*) FROM judgment_judgment WHERE fail_reasons ->> 0 = 'LATE'", {J}),
    # 来源名也是列名的不算整行:generate_series 的别名、CTE / 子查询里同名的输出列、限定写法下的真列
    ("SELECT n FROM generate_series(1, 3) AS n WHERE n > 1", set()),
    ("WITH n AS (SELECT 1 AS n) SELECT n FROM n", set()),
    ("SELECT s.c FROM (SELECT count(*) AS c FROM souls_soul) s", {S}),
    ("SELECT judgment_judgment.court FROM judgment_judgment", {J}),
    ('SELECT count(*) FROM judgment_judgment j WHERE j."court" IS NOT NULL', {J}),
    # 四张表
    (
        "SELECT count(*) FROM judgment_judgment j JOIN souls_soul s ON s.id = j.soul_id "
        "JOIN disposition_disposition d ON d.soul_id = s.id JOIN sentence_plan_sentenceplan p ON p.soul_id = s.id",
        {J, S, D, P},
    ),
]


@pytest.mark.parametrize("sql,tables", ALLOWED)
def test_allowed_with_exactly_its_tables(sql, tables):
    verdict = gate.check(sql)
    assert verdict.ok, f"拒了({verdict.code}):{sql!r}"
    assert verdict.code is None
    assert verdict.tables == frozenset(tables)


def test_every_code_is_both_rejected_and_has_a_near_miss_that_passes():
    """每个码在拒绝表里出现;与之对照的合法写法在放行表里(`count(*)` 的星号、`--` 注释、CTE 名…)。"""
    codes = {v for k, v in vars(gate).items() if k.isupper() and isinstance(v, str)}
    assert codes == {c for _, c in REJECTED}
    assert len(codes) == 8


def test_whitelist_is_the_schema_yaml_tables():
    assert gate.allowed_tables() == frozenset({J, S, D, P})


def test_cte_named_like_a_table_outside_the_whitelist_is_a_cte_not_a_table():
    """同一作用域里的 CTE 名遮住同名真表:`authentication_user` 在这里是 CTE,只读到白名单表。"""
    verdict = gate.check(
        "WITH authentication_user AS (SELECT id FROM souls_soul) SELECT count(*) FROM authentication_user"
    )
    assert verdict.ok and verdict.tables == frozenset({S})
