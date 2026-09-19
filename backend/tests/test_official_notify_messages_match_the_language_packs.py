"""官员站内通知文案的后端副本与三份语言包的 `official_notify` 逐字一致(理由见 apps/notifications/messages.py)。"""
import json
from pathlib import Path

import pytest

from apps.notifications.messages import KIND_BY_TYPE, MESSAGES
from apps.notifications.models import NotificationType

PACKS = Path(__file__).resolve().parents[2] / "packages" / "core" / "messages"


@pytest.mark.parametrize("locale", ["zh-Hans", "en", "egy"])
def test_backend_copy_equals_the_language_pack(locale):
    pack = json.loads((PACKS / f"{locale}.json").read_text(encoding="utf-8"))
    assert pack["official_notify"] == MESSAGES[locale]


def test_every_localized_type_is_a_real_type_with_text_in_every_locale():
    assert set(KIND_BY_TYPE) <= set(NotificationType.values)
    for locale, pack in MESSAGES.items():
        assert set(pack) == set(KIND_BY_TYPE.values()), locale
        for kind, entry in pack.items():
            # 每条都点名灵魂;各自的其余占位符与发送方给的 params 对上(egy 与 zh 同键一致由前端测试守)。
            assert entry["title"] and "{{soul}}" in entry["body"], (locale, kind)
        assert "{{count}}" in pack["dispatch_return_blocked"]["body"], locale
        for kind in ("sentence_node_active", "sentence_node_done", "sentence_node_waiting", "sentence_node_refused"):
            assert "{{order}}" in pack[kind]["body"] and "{{tenant}}" in pack[kind]["body"], (locale, kind)
