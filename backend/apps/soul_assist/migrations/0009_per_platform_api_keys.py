"""API key 按平台存(用户 2026-10-01 定):单个 `api_key` → `api_keys`(平台 → key 的 JSON,整份加密)。

已存的那一个 key 放进**它当时发往的那台主机**的格子 —— 与运行时找 key 的规则(`platforms.key_slot`)同一条:
页面没改过的地址 / 适配器按 env 取。115 上的配置早于「平台」字段,地址是 api.deepseek.com,所以落在 `deepseek`。
`api_key_set_at` 为空 = 用的是 env 的 key,没有东西要搬。回滚把当前连接那一格搬回单个 `api_key`,其余格子丢掉。
"""
import json

from django.db import migrations
from django.utils.dateparse import parse_datetime

import apps.death_sync.fields


def _slot(values):
    from django.conf import settings

    from apps.soul_assist import config, platforms

    provider = config.provider_path(values["provider"]) if "provider" in values else settings.ASSISTANT_PROVIDER
    conn = config.Connection(provider, values.get("base_url", settings.ASSISTANT_BASE_URL), "", "", "", "")
    return platforms.key_slot(conn)


def forward(apps, schema_editor):
    AssistConfig = apps.get_model("soul_assist", "AssistConfig")
    for row in AssistConfig.objects.exclude(api_key_set_at=None):
        row.api_keys = json.dumps({_slot(row.values or {}): {"key": row.api_key,
                                                             "set_at": row.api_key_set_at.isoformat()}})
        row.save(update_fields=["api_keys"])


def backward(apps, schema_editor):
    AssistConfig = apps.get_model("soul_assist", "AssistConfig")
    for row in AssistConfig.objects.exclude(api_keys=""):
        entry = json.loads(row.api_keys).get(_slot(row.values or {}))
        if entry is not None:
            row.api_key, row.api_key_set_at = entry["key"], parse_datetime(entry["set_at"])
            row.save(update_fields=["api_key", "api_key_set_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("soul_assist", "0008_streaming_failover"),
    ]

    operations = [
        migrations.AddField(
            model_name="assistconfig",
            name="api_keys",
            field=apps.death_sync.fields.EncryptedCharField(blank=True, default="", max_length=20000),
        ),
        migrations.RunPython(forward, backward),
        migrations.RemoveField(model_name="assistconfig", name="api_key"),
        migrations.RemoveField(model_name="assistconfig", name="api_key_set_at"),
    ]
