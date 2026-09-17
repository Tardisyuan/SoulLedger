"""推送文案的后端副本与三份语言包逐字一致。

权威是 `packages/core/messages/*.json` 的 `soul_push`;后端镜像里没有 `packages/`,
所以 `apps/soul_push/messages.py` 是副本(那个文件头写了为什么)。这条让两份不能各改各的。
"""
import json
from pathlib import Path

import pytest

from apps.soul_push import services
from apps.soul_push.messages import MESSAGES

PACKS = Path(__file__).resolve().parents[2] / "packages" / "core" / "messages"


@pytest.mark.parametrize("locale", ["zh-Hans", "en", "egy"])
def test_backend_copy_equals_the_language_pack(locale):
    pack = json.loads((PACKS / f"{locale}.json").read_text(encoding="utf-8"))
    assert pack["soul_push"] == MESSAGES[locale]


def test_every_kind_the_rules_can_produce_has_text_in_every_locale():
    kinds = {*services.REBIRTH_STATUS_KINDS.values(), "rebirth_submitted", "judgment_result", "disposition_executed"}
    for locale, pack in MESSAGES.items():
        assert set(pack) == kinds, locale
        assert all(entry["title"] and entry["body"] for entry in pack.values())
