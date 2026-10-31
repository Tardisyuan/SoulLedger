"""Deployment hardening from the 2026-10-31 review, section B (items 13-19).

B13 TLS out of the box: nginx's listener comes from scripts/nginx-entrypoint.sh, which
    turns HTTPS on only when the certificate exists, so a missing one never stops nginx.
B14 alerts / off-site required (check-deploy-env.sh; the script side is test_backup_scripts.py).
B15 every service's docker log is size-capped.
B16/B17 backup encryption and the wider restore drill: test_backup_scripts.py.
B18/B19 Redis keeps its queue across a recreate, its healthcheck authenticates, every
    *_RETENTION_DAYS settings.py reads reaches the containers, the worker pool is sized.
"""
import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE = REPO_ROOT / "docker-compose.yml"
PROD = REPO_ROOT / "docker-compose.production.yml"
COMPOSE_FILES = [BASE, PROD, REPO_ROOT / "docker-compose.override.yml", REPO_ROOT / "docker-compose.staging.yml"]
NGINX_CONF = REPO_ROOT / "nginx.conf"
ENTRY = REPO_ROOT / "scripts" / "nginx-entrypoint.sh"
CHECK = REPO_ROOT / "scripts" / "check-deploy-env.sh"
SETTINGS = REPO_ROOT / "backend" / "config" / "settings.py"
DEPLOYMENT_DOC = REPO_ROOT / "docs" / "DEPLOYMENT.md"


def _yaml(path):
    return yaml.safe_load(path.read_text())


def _live_lines(text):
    return [line for line in text.splitlines() if not line.strip().startswith("#")]


# -- B13 ---------------------------------------------------------------------

def _render(tmp_path, domain="example.com", cert=True):
    le = tmp_path / "le"
    if cert:
        (le / "live" / domain).mkdir(parents=True)
        for name in ("fullchain.pem", "privkey.pem"):
            (le / "live" / domain / name).write_text("pem\n")
    out = tmp_path / "tls"
    env = {"PATH": "/usr/bin:/bin", "LETSENCRYPT_DIR": str(le), "NGINX_TLS_DIR": str(out),
           "NGINX_RENDER_ONLY": "1", "TLS_DOMAIN": domain}
    p = subprocess.run(["sh", str(ENTRY)], env=env, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return p, (out / "listen.conf").read_text(), (out / "redirect.conf").read_text(), le


def test_with_a_certificate_nginx_listens_on_443_and_port_80_only_redirects(tmp_path):
    p, listen, redirect, le = _render(tmp_path)
    assert "nginx: https" in p.stdout
    assert "listen 443 ssl;" in listen
    assert f"ssl_certificate     {le}/live/example.com/fullchain.pem;" in listen
    assert f"ssl_certificate_key {le}/live/example.com/privkey.pem;" in listen
    assert "listen 80" not in listen
    assert re.search(r"listen 80;.*location /\.well-known/acme-challenge/ \{\s*root /var/www/certbot;"
                     r".*location / \{\s*return 301 https://\$host\$request_uri;", redirect, re.S)


@pytest.mark.parametrize("domain,cert", [("example.com", False), ("", False)])
def test_without_a_certificate_nginx_still_starts_on_plain_80(tmp_path, domain, cert):
    p, listen, redirect, _ = _render(tmp_path, domain=domain, cert=cert)
    assert "nginx: http" in p.stdout and "WARNING" in p.stderr
    assert listen.strip() == "listen 80;"
    assert "443" not in listen and "ssl_certificate" not in listen
    assert redirect == ""


def test_nginx_conf_takes_its_listeners_from_the_rendered_files_only():
    """No hand-edited `listen` left to forget: both are includes the entrypoint writes,
    and the redirect server sits outside the one app server block."""
    live = "\n".join(_live_lines(NGINX_CONF.read_text()))
    assert not re.search(r"^\s*listen\b", live, re.M)
    assert "ssl_certificate" not in live
    assert live.index("include /etc/nginx/tls/redirect.conf;") < live.index("server {")
    first_server = live[live.index("server {"):]
    assert first_server.splitlines()[1].strip() == "include /etc/nginx/tls/listen.conf;"
    assert live.count("server {") == 1


def test_production_nginx_runs_the_entrypoint_with_the_domain():
    nginx = _yaml(PROD)["services"]["nginx"]
    assert nginx["command"] == ["/bin/sh", "/nginx-entrypoint.sh"]
    assert "./scripts/nginx-entrypoint.sh:/nginx-entrypoint.sh:ro" in nginx["volumes"]
    assert "/etc/letsencrypt:/etc/letsencrypt:ro" in nginx["volumes"]
    assert nginx["environment"]["TLS_DOMAIN"] == "${TLS_DOMAIN:-}"
    assert {"80:80", "443:443"} <= set(nginx["ports"])
    # renewal reload still keyed on the marker certbot's deploy-hook touches
    assert '"$LE/.deployed" -nt /tmp/.reloaded' in ENTRY.read_text()
    assert "nginx -s reload" in ENTRY.read_text()


def _check(tmp_path, env, cert=True, **process_env):
    f = tmp_path / "check.env"
    f.write_text("".join(f"{k}={v}\n" for k, v in env.items()))
    le = tmp_path / "le-check"
    if cert:
        (le / "live" / "example.com").mkdir(parents=True, exist_ok=True)
        (le / "live" / "example.com" / "fullchain.pem").write_text("pem\n")
    p = subprocess.run(["bash", str(CHECK), str(f)], capture_output=True, text=True,
                       env={"PATH": os.environ["PATH"], "LETSENCRYPT_DIR": str(le), **process_env})
    return p.returncode, p.stdout


def _good():
    from cryptography.fernet import Fernet
    return {
        "SECRET_KEY": "s" * 40, "ALLOWED_HOSTS": "example.com", "DESK_URL": "https://example.com",
        "ENCRYPTION_KEY": Fernet.generate_key().decode(), "DB_PASSWORD": "d", "REDIS_PASSWORD": "r",
        "NEXT_PUBLIC_API_URL": "https://example.com/api/v1", "TLS_DOMAIN": "example.com",
        "OPS_ALERT_WEBHOOK_URL": "https://hooks.example/o", "BACKUP_OFFSITE_REMOTE": "box:sl",
        "BACKUP_AGE_RECIPIENT": "age1" + "q" * 58,
    }


def _lines(out, kind):
    return [line for line in out.splitlines() if line.startswith(kind)]


def test_check_passes_a_complete_production_env(tmp_path):
    code, out = _check(tmp_path, _good())
    assert code == 0, out
    assert not _lines(out, "FAIL") and not _lines(out, "WARN  no certificate")
    assert any("certificate found" in line for line in _lines(out, "PASS"))


def test_check_refuses_https_redirect_without_a_domain_or_a_certificate(tmp_path):
    env = _good()
    del env["TLS_DOMAIN"]
    code, out = _check(tmp_path, env)
    assert code == 1 and "FAIL  TLS_DOMAIN is missing" in out
    sub = tmp_path / "nocert"
    sub.mkdir()
    code, out = _check(sub, _good(), cert=False)
    assert code == 1, out
    assert any("no certificate at" in line for line in _lines(out, "FAIL"))


def test_check_allows_the_first_issuance_bring_up_and_staging(tmp_path):
    code, out = _check(tmp_path, {**_good(), "ALLOW_NO_TLS_CERT": "1"}, cert=False)
    assert code == 0, out
    assert any("ALLOW_NO_TLS_CERT=1" in line for line in _lines(out, "WARN"))
    env = {**_good(), "SECURE_SSL_REDIRECT": "false"}
    del env["TLS_DOMAIN"]
    code, out = _check(tmp_path, env, cert=False)
    assert code == 0, out
    assert "WARN  SECURE_SSL_REDIRECT is off" in out


# -- B14 ---------------------------------------------------------------------

@pytest.mark.parametrize("var,flag", [("OPS_ALERT_WEBHOOK_URL", "ALLOW_NO_ALERTS"),
                                      ("BACKUP_OFFSITE_REMOTE", "ALLOW_NO_OFFSITE")])
def test_check_refuses_no_alerts_or_no_offsite_unless_waived(tmp_path, var, flag):
    env = _good()
    del env[var]
    if var == "BACKUP_OFFSITE_REMOTE":
        del env["BACKUP_AGE_RECIPIENT"]
    code, out = _check(tmp_path, env)
    assert code == 1, out
    assert any(line.startswith(f"FAIL  {var} is empty") for line in out.splitlines()), out
    for waived in ({**env, flag: "1"}, env):  # in the file, or on the command line
        code, out = _check(tmp_path, waived, **({} if flag in waived else {flag: "1"}))
        assert code == 0, out
        assert any(line.startswith(f"WARN  {var} is empty and {flag}=1") for line in out.splitlines()), out


def test_check_refuses_an_unencrypted_offsite_unless_waived_and_a_malformed_key(tmp_path):
    env = _good()
    del env["BACKUP_AGE_RECIPIENT"]
    code, out = _check(tmp_path, env)
    assert code == 1 and any("BACKUP_AGE_RECIPIENT is empty" in line for line in _lines(out, "FAIL")), out
    code, out = _check(tmp_path, {**env, "ALLOW_PLAINTEXT_OFFSITE": "1"})
    assert code == 0 and any("off-site backups are unencrypted" in line for line in _lines(out, "WARN")), out
    code, out = _check(tmp_path, {**_good(), "BACKUP_AGE_RECIPIENT": "AGE-SECRET-KEY-1ABC"})
    assert code == 1 and any("BACKUP_AGE_RECIPIENT is not" in line for line in _lines(out, "FAIL")), out
    assert "AGE-SECRET-KEY-1ABC" not in out


def test_production_backup_is_strict_and_its_health_needs_a_clean_run():
    backup = _yaml(PROD)["services"]["backup"]
    env = backup["environment"]
    assert env["BACKUP_STRICT"] == "1"
    for name in ("ALLOW_NO_ALERTS", "ALLOW_NO_OFFSITE", "BACKUP_AGE_RECIPIENT", "ALLOW_PLAINTEXT_OFFSITE"):
        assert env[name] == f"${{{name}:-}}"
    assert "test -f /backups/.backup-ok" in backup["healthcheck"]["test"][1]
    cmd = backup["command"][0]
    assert "/scripts/backup-db.sh /backups || [ $$? -eq 3 ]" in cmd  # exit 3 still starts cron
    assert "apk add --no-cache age" in cmd


# -- B15 ---------------------------------------------------------------------

@pytest.mark.parametrize("path", COMPOSE_FILES, ids=lambda p: p.name)
def test_every_service_logs_with_a_size_cap(path):
    base = _yaml(BASE)["services"]
    data = _yaml(path)
    for name, svc in data["services"].items():
        logging = svc.get("logging") or base.get(name, {}).get("logging")
        assert logging, f"{path.name}: {name} has no logging (and none from the base file)"
        assert logging["driver"] == "json-file"
        assert logging["options"]["max-size"] and int(logging["options"]["max-file"]) >= 1
    # the anchors are the only definition, so the two copies cannot drift apart
    if path in (BASE, PROD):
        assert data["x-logging"] == _yaml(BASE)["x-logging"]


# -- B18 / B19 -----------------------------------------------------------------

def test_redis_persists_its_queue_and_its_healthcheck_needs_a_pong():
    base, prod = _yaml(BASE), _yaml(PROD)
    redis = base["services"]["redis"]
    assert "redis_data:/data" in redis["volumes"] and "redis_data" in base["volumes"]
    assert "--appendonly yes" in redis["command"]
    assert "--appendonly yes" in prod["services"]["redis"]["command"]
    assert "--requirepass" in prod["services"]["redis"]["command"]
    assert redis["healthcheck"]["test"] == ["CMD-SHELL", "redis-cli ping | grep -qx PONG"]
    assert prod["services"]["redis"]["environment"]["REDISCLI_AUTH"].startswith("${REDIS_PASSWORD")


def test_every_retention_setting_reaches_the_containers_with_settings_default():
    read = dict(re.findall(r'os\.getenv\("([A-Z_]+_RETENTION_DAYS)", "(\d+)"\)', SETTINGS.read_text()))
    assert len(read) >= 10
    env = _yaml(BASE)["x-django-env"]
    for name, default in read.items():
        assert env.get(name) == f"${{{name}:-{default}}}", name
    # and nothing in the app reads one that settings.py does not define
    app_reads = set()
    for py in (REPO_ROOT / "backend" / "apps").rglob("*.py"):
        app_reads |= set(re.findall(r'getenv\("([A-Z_]+_RETENTION_DAYS)"', py.read_text()))
    assert app_reads <= set(read)


def test_the_worker_pool_is_sized_for_its_memory_limit():
    cmd = _yaml(BASE)["services"]["celery"]["command"]
    m = re.search(r"--concurrency=(\d+)", cmd)
    assert m and 1 <= int(m.group(1)) <= 2
    assert "--max-memory-per-child=" in cmd
    assert _yaml(PROD)["services"]["celery"]["deploy"]["resources"]["limits"]["memory"] == "512m"


# -- B16 docs: the keys that make an encrypted backup readable ---------------------

def test_deployment_doc_says_the_keys_live_apart_from_the_backups():
    doc = DEPLOYMENT_DOC.read_text()
    section = doc[doc.index("### 备份加密"):]
    section = section[:section.index("\n### ", 1)]
    for name in ("ENCRYPTION_KEY", "ENCRYPTION_KEY_FALLBACKS", "SECRET_KEY", "SECRET_KEY_FALLBACKS",
                 "BACKUP_AGE_RECIPIENT", "BACKUP_AGE_IDENTITY"):
        assert name in section, name
