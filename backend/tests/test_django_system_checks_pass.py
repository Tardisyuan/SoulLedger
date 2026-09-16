"""`manage.py check` 必须干净。

pytest-django 不跑系统检查,于是一个只有 `manage.py` 才会报的错误可以让全量测试绿着进 main。
2026-09-17 实测:给 `EventType` 加了一个 34 字符的成员,而 `SoulEvent.event_type` 是
`max_length=30` —— 3700 多条测试全绿(SQLite 不强制 varchar 长度),`manage.py spectacular`
却因 `fields.E009` 拒绝启动;到 PostgreSQL 上它会是一次写入失败。
"""
from django.core.management import call_command


def test_system_checks_report_no_errors():
    call_command("check", fail_level="ERROR")
