"""每个 compose 组合里恰好一个 celery beat,且它用 DatabaseScheduler(上线前缺口 16)。

两个 beat 读同一张调度表,每个任务派发两次;单飞锁只挡得住时间重叠的那次
(docs/DEPLOYMENT.md「beat 只能起一个实例」)。`setup_scheduled_tasks` 写的是
django-celery-beat 的表,beat 若退回默认的 PersistentScheduler,那些行一行都不会触发,
而进程照样健康地跑着。所以这里断:

- base / +override / +production / +staging 每个组合里,命令是 `celery … beat` 的服务
  恰好一个,没有 `deploy.replicas` > 1,也没有 worker 带 `-B` / `--beat` 偷偷再起一个;
- 那个 beat 的命令写明 DatabaseScheduler,settings 也是;
- worker 与 beat 都有 healthcheck,beat 的探针读单 beat 锁(apps/scheduler/beat_guard.py)。
"""
import os
import re
import subprocess
import sys

import pytest
from django.conf import settings
from django.core.cache import cache

from apps.scheduler import beat_guard
from tests.test_production import COMPOSE_BASE, COMPOSE_ROOT_PROD, COMPOSE_STAGING, REPO_ROOT, _load_compose

COMPOSE_OVERRIDE = os.path.join(REPO_ROOT, "docker-compose.override.yml")
DB_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"


def _merged(*overrides):
    """Service-level merge as compose does it for the keys that matter here."""
    services = {k: dict(v) for k, v in _load_compose(COMPOSE_BASE)["services"].items()}
    for path in overrides:
        for name, override in (_load_compose(path).get("services") or {}).items():
            services.setdefault(name, {}).update(override)
    return services


COMBOS = {
    "base": (),
    "dev": (COMPOSE_OVERRIDE,),
    "production": (COMPOSE_ROOT_PROD,),
    "staging": (COMPOSE_STAGING,),
}


def _cmd(service):
    command = service.get("command") or ""
    return " ".join(command) if isinstance(command, list) else command


def _beats(services):
    return {n: s for n, s in services.items() if re.search(r"\bcelery\b.*\bbeat\b", _cmd(s))}


@pytest.mark.parametrize("combo", COMBOS)
def test_exactly_one_beat_on_the_database_scheduler(combo):
    services = _merged(*COMBOS[combo])
    beats = _beats(services)
    assert list(beats) == ["celery-beat"], f"{combo}: beat services {sorted(beats)}"
    beat = beats["celery-beat"]
    assert f"--scheduler {DB_SCHEDULER}" in _cmd(beat), f"{combo}: beat not on DatabaseScheduler"
    assert (beat.get("deploy") or {}).get("replicas", 1) == 1, f"{combo}: beat replicas > 1"
    assert "scale" not in beat
    for name, svc in services.items():
        if name != "celery-beat" and "worker" in _cmd(svc):
            assert not re.search(r"(^|\s)(-B|--beat)(\s|$)", _cmd(svc)), f"{combo}: {name} embeds a beat"


def test_settings_point_beat_at_the_database_scheduler():
    assert settings.CELERY_BEAT_SCHEDULER == DB_SCHEDULER


def test_worker_and_beat_have_healthchecks():
    services = _merged()
    worker_probe = " ".join(services["celery"]["healthcheck"]["test"])
    assert "inspect ping" in worker_probe and "$$HOSTNAME" in worker_probe
    assert services["celery-beat"]["healthcheck"]["test"] == ["CMD", "python", "-m", "apps.scheduler.beat_guard"]


def test_the_beat_probe_is_healthy_only_where_the_key_is_held(monkeypatch):
    cache.delete(beat_guard.KEY)
    assert not beat_guard.held_here()
    monkeypatch.setattr(beat_guard.socket, "gethostname", lambda: "beat-a")
    beat_guard.claim("beat-a:1")
    assert beat_guard.held_here()
    # Same prefix, different host: `beat-a` must not count `beat-ab`'s key.
    cache.set(beat_guard.KEY, "beat-ab:1")
    assert not beat_guard.held_here()
    cache.delete(beat_guard.KEY)


def test_the_probe_runs_as_a_module_without_django_setup():
    """The healthcheck is `python -m apps.scheduler.beat_guard` in a fresh
    interpreter: it must import and exit 1 (nobody holds the key) rather than
    die on an import or app-registry error."""
    env = {**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings"}
    # The key lives in whatever Redis REDIS_URL names; this test owns no beat.
    proc = subprocess.run(
        [sys.executable, "-m", "apps.scheduler.beat_guard"],
        cwd=os.path.join(REPO_ROOT, "backend"), env=env, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 1, proc.stderr
    assert "Traceback" not in proc.stderr, proc.stderr
