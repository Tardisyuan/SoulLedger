"""守卫的守卫:证明 `apps/audit/oncommit_guard.py` 真的会响,并且响得准。

H19 的形状:审计日志经 `transaction.on_commit` 写入,而 `django_db` 的事务最后
回滚,回调永不执行。断言「有审计日志」会红(写的人会发现),断言「没有审计日志」
**无条件通过**(没有人会发现)。

守卫在测试**结束时**判决,所以证明它有效只能起一个子进程 —— 在同一个进程里
`pytest.raises` 包不住一个发生在 call 阶段收尾处的异常。四个场景写进**同一个**
探针文件,跑**一次**真的 pytest,再按测试名逐条读结果:该红的红,该绿的绿。
**没有后三个,一个「永远抛异常」的插件也能让第一个通过,而它会让整个套件失去意义。**

一次而不是四次(2026-09-29):每个子进程都要重建一遍迁移过的测试库,约 16 秒,
四次就是一分多钟。合并不削弱隔离 —— 守卫的状态在 `pytest_runtest_setup` 里
逐测试清零(`oncommit_guard.py`),而且会红的那条排在最前:若它的状态漏进后面,
后面的正对照会红,不会假绿。结果按测试名取,少一条就报错,不会被别的条目顶替。
"""
import os
import subprocess
import sys
import textwrap
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

HEADER = """
import pytest
from apps.audit.models import AuditLog
from apps.tenants.models import Tenant
"""


def run_nested(tmp_path, bodies):
    """把几段测试写进同一个临时文件,用真的 pytest 跑**一遍**。

    回传 {测试名: (outcome, 该测试自己的报错文本)},外加整次运行的输出。
    outcome 取 junitxml:passed / failed / error —— 守卫在测试收尾处判决,
    它的异常可能记在 call 上(failed)也可能记在 teardown 上(error)。
    """
    probe = tmp_path / "test_probe.py"
    probe.write_text(
        HEADER + "".join(textwrap.dedent(b) for b in bodies), encoding="utf-8"
    )
    junit = tmp_path / "probe.xml"
    proc = subprocess.run(
        # `-c <仓库>/pytest.ini` 是有意的,不是为了省事:插件是**通过那份 ini 的
        # addopts** 挂上的,子进程从 /private/tmp 出发定位不到它。显式写
        # `-p apps.audit.oncommit_guard` 也能让下面的断言过,但那样就绕开了
        # 「pytest.ini 里那一行还在不在」—— 而那一行被删掉,守卫就整个消失。
        # 实测:不带 `-c`,子进程 1 passed(守卫没挂上),这份文件会绿得毫无意义。
        [
            sys.executable, "-m", "pytest", str(probe),
            "-c", str(REPO_ROOT / "pytest.ini"),
            "-q", "--no-cov", "-p", "no:cacheprovider", f"--junitxml={junit}",
        ],
        cwd=REPO_ROOT,
        # `pythonpath = backend` 写在 pytest.ini 里,而子进程从 /private/tmp 下的
        # 探针文件出发定位 rootdir,拿不到它 —— 实测 `ImportError: No module named
        # 'config'`。显式给上,子进程的环境不继承这两样。
        env={
            **os.environ,
            "PYTHONPATH": str(REPO_ROOT / "backend"),
            "DJANGO_SETTINGS_MODULE": "config.settings",
            # 子进程固定用 SQLite 内存库。
            #
            # 它要证明的是**那个插件会不会响**,与数据库无关。而继承父进程的
            # 配置时,如果父进程正跑在 PostgreSQL 上,子进程会去建同一个
            # `test_soulledger`,拿到
            #     database "test_soulledger" already exists
            #     database "test_soulledger" is being accessed by other users
            # —— 2026-08-31 在真 PostgreSQL 上全量跑时,这四条就是这么红的。
            # 一条**因为测试装置而红**的失败,读起来和产品缺陷一模一样。
            "DATABASE_URL": "sqlite:///:memory:",
        },
        capture_output=True,
        text=True,
        timeout=300,
    )
    out = proc.stdout + proc.stderr
    assert junit.exists(), f"the nested run wrote no report:\n{out}"
    results = {}
    for case in ET.parse(junit).getroot().iter("testcase"):
        bad = [el for el in case if el.tag in ("failure", "error")]
        tags = {el.tag for el in bad}
        outcome = "error" if "error" in tags else "failed" if tags else "passed"
        text = "\n".join((el.get("message") or "") + "\n" + (el.text or "") for el in bad)
        results[case.get("name")] = (outcome, text)
    return results, out


# 四个探针。**会红的那条排第一**:守卫若把状态漏给下一条测试,后面的正对照会红。
VACUOUS = """
@pytest.mark.django_db
def test_vacuous():
    Tenant.objects.get_or_create(code="VAC1", defaults={"display_name": "P"})
    # 表是空的,所以这一句无条件成立。
    assert AuditLog.objects.filter(resource="tenant").count() == 0
"""

COMMITTED = """
@pytest.mark.django_db(transaction=True)
def test_committed():
    Tenant.objects.get_or_create(code="VAC2", defaults={"display_name": "P"})
    assert AuditLog.objects.filter(resource="tenant").exists()
"""

READS_BEFORE_IT_WRITES = """
@pytest.mark.django_db
def test_reads_before_it_writes():
    Tenant.objects.get_or_create(code="VAC3", defaults={"display_name": "P"})
    before = AuditLog.objects.filter(resource="probe").count()
    AuditLog.objects.create(action="CREATE", resource="probe", description="x")
    assert AuditLog.objects.filter(resource="probe").count() == before + 1
"""

FRAME_PREDICATE = """
from apps.audit.models import AuditLog as _AL

def _application_code_reads_it():
    # 这个函数所在的文件仍然是测试文件,所以用 Django 自己的 ORM 帧
    # 模拟不了。改为直接验证判据函数:调用者不是测试文件时返回 None。
    return None

@pytest.mark.django_db
def test_frame_predicate_ignores_non_test_callers():
    from apps.audit.oncommit_guard import _reading_test_line
    import apps.audit.oncommit_guard as g
    Tenant.objects.get_or_create(code="VAC4", defaults={"display_name": "P"})
    # 这一行写在测试文件里,判据应当认出它
    assert _reading_test_line() is not None
    # 换一个不是测试文件的调用者:用 exec 造一个别的文件名的帧
    ns = {"f": _reading_test_line, "out": None}
    exec(compile("out = f()", "/somewhere/views.py", "exec"), ns)
    assert ns["out"] is None
    g._state["suspect"] = None   # 上面那次探测别算成可疑读取
"""


@pytest.fixture(scope="module")
def nested(tmp_path_factory):
    """四个探针,一个子进程。"""
    return run_nested(
        tmp_path_factory.mktemp("audit_probe"),
        [VACUOUS, COMMITTED, READS_BEFORE_IT_WRITES, FRAME_PREDICATE],
    )


def _result(nested, name):
    results, out = nested
    # 按名取:一条没跑到(收集失败、改名)就在这里红,而不是读到别人的结果。
    assert name in results, f"{name} did not run in the nested session:\n{out}"
    outcome, text = results[name]
    return outcome, text + "\n" + out


def test_a_vacuous_audit_assertion_is_refused(nested):
    """本体。下面这段在守卫装上之前是**绿的**,而它什么都没验证。"""
    outcome, text = _result(nested, "test_vacuous")
    assert outcome != "passed", text
    own = nested[0]["test_vacuous"][1]   # 只看它自己的报错,不看整次输出
    assert "VacuousAuditAssertionError" in own, text
    # 报错要说得出改法,否则读到它的人只会加个 marker 绕过去。
    assert "transaction=True" in own
    assert "captureOnCommitCallbacks" in own


def test_the_same_assertion_is_allowed_when_the_transaction_commits(nested):
    """正对照一。没有它,一个「见到 AuditLog 查询就抛」的插件同样满足上一条,
    而那会让每一条真实的审计断言都变成写不出来的东西。"""
    outcome, text = _result(nested, "test_committed")
    assert outcome == "passed", text


def test_a_test_that_writes_the_table_itself_is_allowed(nested):
    """正对照二:`apps/audit/tests.py::TestAuditLogListRetrieve` 在 fixture 里
    直接插两行再测列表接口 —— 那张表对它不是空的。守卫的第一版没有这条判据,
    把那 6 条报成了缺陷。

    读**先于**写也算数:`apps/workflow/tests.py` 里有一条先取基线计数、再触发
    一次同步审计写入的测试,那条断言完全有效。守卫因此把判决推迟到测试结束 ——
    在读的那一行下结论,判不出这个区别。"""
    outcome, text = _result(nested, "test_reads_before_it_writes")
    assert outcome == "passed", text


def test_application_code_reading_the_table_is_not_the_tests_fault(nested):
    """正对照三:只有写在**测试文件**里的那一行才算数。

    `/api/v1/ledger/stats/overview/` 这类接口自己就要读审计表。守卫的第二版没有
    这条判据,29 个测试因此变红,无一例外是「视图内部读了 AuditLog」。
    **一个会误报的守卫最终会被关掉,那比没有守卫更糟。**
    """
    outcome, text = _result(nested, "test_frame_predicate_ignores_non_test_callers")
    assert outcome == "passed", text


@pytest.mark.django_db
@pytest.mark.allow_uncommitted_audit
def test_the_escape_hatch_works():
    """出口本身,在本进程里就能验:标了 marker 的测试不被判。

    有意留的出口。没有出口的守卫会被人用别的方式绕开,而那些方式不会写在
    测试头上。"""
    from apps.tenants.models import Tenant

    Tenant.objects.get_or_create(code="VAC5", defaults={"display_name": "P"})
    from apps.audit.models import AuditLog

    assert AuditLog.objects.count() == 0
