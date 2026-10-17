"""推送文案的后端副本与三份语言包逐字一致。

权威是 `packages/core/messages/*.json` 的 `soul_push`;后端镜像里没有 `packages/`,
所以 `apps/soul_push/messages.py` 是副本(那个文件头写了为什么)。这条让两份不能各改各的。
"""
import json
from pathlib import Path

import pytest

from apps.soul_push import services
from apps.soul_push.messages import MESSAGES, REASON_LABELS

PACKS = Path(__file__).resolve().parents[2] / "packages" / "core" / "messages"
EGY_PENDING_KINDS = {
    key.split(".")[1]
    for key in json.loads((Path(__file__).resolve().parents[2] / "frontend" / "src" / "__tests__" / "support"
                           / "egyPendingKeys.json").read_text(encoding="utf-8"))
    if key.startswith("soul_push.")
}


@pytest.mark.parametrize("locale", ["zh-Hans", "en", "egy"])
def test_backend_copy_equals_the_language_pack(locale):
    pack = json.loads((PACKS / f"{locale}.json").read_text(encoding="utf-8"))
    assert pack["soul_push"] == MESSAGES[locale]
    # 隐藏 / 删除推送里 `{{reason}}` 用的理由名,同一份 `social_moderation.reason`。
    assert pack["social_moderation"]["reason"] == REASON_LABELS[locale]


def test_every_kind_the_rules_can_produce_has_text_in_every_locale():
    kinds = set(services.KIND_CATEGORY)
    assert {"rebirth_approved", "rebirth_rejected", "rebirth_appeal_rejected",
            "cooldown_shortening_approved", "cooldown_shortening_rejected", "judgment_result",
            "disposition_executed", "residence_approved", "residence_started", "residence_returned",
            "sentence_waiting", "sentence_completed", "sentence_amended", "sentence_pardoned", "chat_message",
            "social_warned_post", "social_warned_comment", "social_warned_user",
            "mfa_reset_by_officer", "export_ready",
            *(f"content_{outcome}_{target}" for outcome in ("hidden", "deleted", "approved", "restored")
              for target in ("post", "comment")),
            *(f"content_{outcome}_{target}_reason" for outcome in ("hidden", "deleted")
              for target in ("post", "comment")),
            "comment", "reply"} == kinds
    for locale, pack in MESSAGES.items():
        # egy 可以恰好缺 Design 还没给词的种类(egyPendingKeys.json 里的 `soul_push.<kind>`),别的不许缺。
        assert set(pack) == kinds - (EGY_PENDING_KINDS if locale == "egy" else set()), locale
        assert all(entry["title"] and entry["body"] for entry in pack.values())


def test_results_are_told_apart_but_each_rebirth_kind_has_its_own_text():
    """批准与驳回在锁屏上区分(2026-09-18 用户决定):三种结果的文案两两不同。"""
    for locale, pack in MESSAGES.items():
        texts = {(pack[k]["title"], pack[k]["body"]) for k in services.REBIRTH_STATUS_KINDS.values()}
        assert len(texts) == 3, locale


def test_a_pending_egy_kind_reads_as_zh_hans_and_a_translated_one_does_not(monkeypatch):
    """egy 缺的种类退回 zh-Hans(而不是 KeyError 让整条推送丢掉);egy 有的种类照用 egy。"""
    from apps.soul_push import messages

    egy = {k: v for k, v in messages.MESSAGES["egy"].items() if k != "export_ready"}
    monkeypatch.setitem(messages.MESSAGES, "egy", egy)
    assert messages.render("egy", "export_ready") == messages.render("zh-Hans", "export_ready")
    assert messages.render("egy", "chat_message", name="甲") != messages.render("zh-Hans", "chat_message", name="甲")
