"""生产日志的每一行都是合法 JSON,消息里有引号、换行也一样(IS-22)。

生产 LOGGING 的 formatter 是一个 `%` 字符串模板:
`'{"time": "%(asctime)s", ..., "message": "%(message)s"}'` —— 不转义。
消息里一个 `"` 就让这一行不再是 JSON,一个 `\\n` 把一条日志劈成两行,
而日志采集按行解析 JSON:这两种都是静默丢日志或错位。

settings 每个进程只加载一次,DEBUG=False 的分支只能在子进程里跑;环境变量逐个
给全,`load_dotenv` 从不覆盖已设的变量,所以不会读到真实的 `.env`。
"""
import json
import subprocess
import sys

from tests.test_encryption_key_is_required import BACKEND, _env

MESSAGE = 'PROBE he said "stop"\nPROBE second line \\ and a backslash'

LOG_IN_PRODUCTION = f"""
import django, logging
django.setup()
logging.getLogger("apps.probe").warning({MESSAGE!r})
try:
    raise ValueError('PROBE boom "quoted"')
except ValueError:
    logging.getLogger("apps.probe").exception("PROBE failed")
"""


def _probe_lines():
    from cryptography.fernet import Fernet

    proc = subprocess.run(
        [sys.executable, "-W", "ignore", "-c", LOG_IN_PRODUCTION], cwd=BACKEND,
        env=_env("false", Fernet.generate_key().decode()),
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    return [line for line in proc.stderr.splitlines() if "PROBE" in line]


def test_a_message_with_quotes_and_newlines_is_one_json_line():
    lines = _probe_lines()
    entries = []
    for line in lines:
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            raise AssertionError(f"not a JSON line: {line!r}") from None
    assert len(entries) == 2, lines
    assert entries[0]["message"] == MESSAGE
    assert entries[0]["level"] == "WARNING"
    assert entries[0]["logger"] == "apps.probe"
    assert entries[1]["message"] == "PROBE failed"
    assert 'ValueError: PROBE boom "quoted"' in entries[1]["exc_info"]
