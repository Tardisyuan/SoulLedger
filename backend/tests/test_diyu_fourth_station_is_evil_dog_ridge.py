"""地府第四站叫「恶狗岭」(2026-11-11 用户定，docs/06 §一 总览表与章标题)。

此前代码标签、语言包写的是 06 §〇 考出的「恶狗村」,与同一文档的总览表不一致。只改显示名：存的值仍是
`EVIL_DOG_VILLAGE`,不迁数据。把代码、两份语言包、文档 §〇 钉成同一个名字，任何一处回到「恶狗村」都红。
"""
import json
from pathlib import Path

from apps.souls.models import DiyuStation

REPO_ROOT = Path(__file__).resolve().parents[2]
MESSAGES = REPO_ROOT / "packages" / "core" / "messages"
DOC = REPO_ROOT / "docs" / "06_地府十三站详解.md"


def _station(locale):
    return json.loads((MESSAGES / f"{locale}.json").read_text(encoding="utf-8"))["souls"]["diyu_station"]


def test_the_stored_value_did_not_move():
    assert DiyuStation.EVIL_DOG_VILLAGE.value == "EVIL_DOG_VILLAGE"


def test_the_label_is_evil_dog_ridge_in_code_and_both_packs():
    assert DiyuStation.EVIL_DOG_VILLAGE.label == "恶狗岭"
    assert _station("zh-Hans")["EVIL_DOG_VILLAGE"] == "恶狗岭"
    assert "Village" not in _station("en")["EVIL_DOG_VILLAGE"]


def test_the_doc_no_longer_calls_the_village_the_proper_name():
    text = DOC.read_text(encoding="utf-8")
    assert "| 第四站 | 恶狗岭 |" in text and "### 第四站：恶狗岭" in text
    assert "正名是「恶狗村」" not in text and "正名 **恶狗村**" not in text and "正名**恶狗村**" not in text
    assert "2026-11-11 用户定" in text
