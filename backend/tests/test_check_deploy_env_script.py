"""scripts/check-deploy-env.sh: a good env passes, each bad value turns its own line red,
and no secret value ever reaches the output."""
import subprocess
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check-deploy-env.sh"
SECRET = "s3cr3t-" + "x" * 40


def _good():
    return {
        "SECRET_KEY": SECRET,
        "ALLOWED_HOSTS": "example.com",
        "DESK_URL": "https://example.com",
        "ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "DB_PASSWORD": "dbpass",
        "REDIS_PASSWORD": "redispass",
        "NEXT_PUBLIC_API_URL": "https://example.com/api/v1",
    }


def _run(tmp_path, env):
    f = tmp_path / ".env"
    f.write_text("".join(f"{k}={v}\n" for k, v in env.items()))
    p = subprocess.run(["bash", str(SCRIPT), str(f)], capture_output=True, text=True)
    return p.returncode, p.stdout


def test_good_env_passes_and_prints_no_secret(tmp_path):
    env = _good()
    code, out = _run(tmp_path, env)
    assert code == 0, out
    assert "FAIL" not in out
    for k in ("SECRET_KEY", "ENCRYPTION_KEY", "DB_PASSWORD"):
        assert env[k] not in out


@pytest.mark.parametrize(
    "key,value,needle",
    [
        ("SECRET_KEY", "short", "SECRET_KEY is"),
        ("DEBUG", "true", "DEBUG is true"),
        ("ALLOWED_HOSTS", "example.com,*", "ALLOWED_HOSTS contains a wildcard"),
        ("DESK_URL", "http://localhost:3000", "DESK_URL must start with https"),
        ("DESK_URL", "https://localhost", "DESK_URL points at localhost"),
        ("ENCRYPTION_KEY", "not-a-fernet-key", "ENCRYPTION_KEY is not a Fernet key"),
        ("CORS_ALLOWED_ORIGINS", "*", "CORS_ALLOWED_ORIGINS"),
    ],
)
def test_each_bad_value_fails_its_own_line(tmp_path, key, value, needle):
    env = _good()
    env[key] = value
    code, out = _run(tmp_path, env)
    assert code == 1, out
    assert any(line.startswith("FAIL") and needle in line for line in out.splitlines()), out


def test_missing_variable_fails(tmp_path):
    env = _good()
    del env["DESK_URL"]
    code, out = _run(tmp_path, env)
    assert code == 1
    assert "FAIL  DESK_URL is missing" in out
