"""过期的 refresh token 行会被定期清掉(IS-18)。

`ROTATE_REFRESH_TOKENS` + `BLACKLIST_AFTER_ROTATION`:每次 refresh 往
`token_blacklist_outstandingtoken` 写一行、往 blacklistedtoken 再写一行,7 天后
过期,**而仓库里没有任何东西调度 `flushexpiredtokens`** —— 两张表只增不减。

定时任务的方向已定为 django-celery-beat + DatabaseScheduler,所以这里要的是:
一个 celery 任务真的删掉过期行、一个幂等命令把它登记成 PeriodicTask、而且登记的
任务名是 worker 真能认领的名字(beat 会安静地往一个没人应答的名字派发)。
"""
from datetime import timedelta

import pytest
import yaml
from django.core.management import call_command
from django.utils import timezone
from django_celery_beat.models import PeriodicTask
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from tests.test_production import COMPOSE_BASE, _production_services

TASK_NAME = "authentication.flush_expired_tokens"


def _outstanding(jti, expires_at):
    return OutstandingToken.objects.create(
        jti=jti, token=f"t-{jti}", created_at=expires_at - timedelta(days=7), expires_at=expires_at
    )


@pytest.mark.django_db
def test_the_task_deletes_expired_rows_and_keeps_live_ones():
    from apps.authentication.tasks import flush_expired_tokens

    now = timezone.now()
    expired = _outstanding("expired", now - timedelta(hours=1))
    BlacklistedToken.objects.create(token=expired)
    live = _outstanding("live", now + timedelta(days=3))
    BlacklistedToken.objects.create(token=live)

    flush_expired_tokens()

    assert list(OutstandingToken.objects.values_list("jti", flat=True)) == ["live"]
    assert list(BlacklistedToken.objects.values_list("token__jti", flat=True)) == ["live"]


@pytest.mark.django_db
def test_the_setup_command_registers_one_task_however_often_it_runs():
    call_command("setup_token_flush_task")
    call_command("setup_token_flush_task")

    tasks = PeriodicTask.objects.filter(task=TASK_NAME)
    assert tasks.count() == 1
    assert tasks.get().enabled
    assert tasks.get().crontab is not None


def test_the_scheduled_name_is_a_task_a_worker_can_run():
    from config.celery import app

    app.loader.import_default_modules()
    assert TASK_NAME in app.tasks


@pytest.mark.parametrize("services", ["base", "production"])
def test_the_deploy_command_registers_the_schedule(services):
    if services == "base":
        with open(COMPOSE_BASE) as f:
            backend = yaml.safe_load(f)["services"]["backend"]
    else:
        backend = _production_services()["backend"]
    assert "manage.py setup_token_flush_task" in backend["command"]
