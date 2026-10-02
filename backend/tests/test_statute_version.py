"""律条版本(`Statute.revision` / `effective_from`):条文变了才升版,种子重跑不升版。

回填(judgment/0032)的往返在 `tests/test_judgment_case_number.py` 那条 0030 → 0033 里。
"""
import io
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.actors.management.commands.seed_mythology import Command, Stats
from apps.judgment.models import Statute, StatuteCorpus, StatutePolarity
from apps.souls.models import Civilization

ROW = {
    "code": "ZZ-VER-01",
    "ordinal": 1,
    "polarity": StatutePolarity.OFFENCE,
    "title_zh": "样例", "title_en": "Fixture",
    "text_zh": "样例条文。", "text_en": "A fixture article.",
    "payload": {"note": "fixture"},
    "notes": ["fixture row — no source is being claimed"],
}


def _seed(tenant, row, update):
    stats = Stats("statutes")
    Command(stdout=io.StringIO())._seed_statutes(
        Civilization.CHINESE, tenant, StatuteCorpus.HELL_LAW, "fixture", [row], update, stats,
    )
    return Statute.all_objects.get(code=row["code"])


@pytest.mark.django_db
def test_reseeding_unchanged_text_keeps_the_version(cn_tenant):
    first = _seed(cn_tenant, ROW, update=False)
    assert (first.revision, first.effective_from) == (1, timezone.localdate())
    again = _seed(cn_tenant, ROW, update=True)
    assert (again.revision, again.effective_from) == (1, first.effective_from)


@pytest.mark.django_db
def test_an_update_that_changes_the_text_starts_a_new_version(cn_tenant):
    _seed(cn_tenant, ROW, update=False)
    Statute.all_objects.filter(code=ROW["code"]).update(effective_from=date(2026, 8, 27))

    # 不带 --update:差异只报告,不写,所以也不升版。
    kept = _seed(cn_tenant, {**ROW, "text_en": "Corrected."}, update=False)
    assert (kept.revision, kept.effective_from, kept.text_en) == (1, date(2026, 8, 27), "A fixture article.")

    tomorrow = timezone.localdate() + timedelta(days=1)
    with patch("apps.judgment.models.timezone.localdate", return_value=tomorrow):
        bumped = _seed(cn_tenant, {**ROW, "text_en": "Corrected."}, update=True)
    assert (bumped.revision, bumped.effective_from, bumped.text_en) == (2, tomorrow, "Corrected.")


@pytest.mark.django_db
def test_moving_an_article_or_saving_named_fields(cn_tenant):
    art = _seed(cn_tenant, ROW, update=False)
    art.ordinal = 9
    art.save()
    art.refresh_from_db()
    assert art.revision == 1, "换位置不是改条文"

    art.payload_json = {"note": "points changed"}
    art.save(update_fields=["payload_json"])
    art.refresh_from_db()
    assert art.revision == 2, "update_fields 也要把 revision 一起写下去"


@pytest.mark.django_db
def test_the_api_shows_the_version(api_client, auth_headers, cn_tenant):
    art = _seed(cn_tenant, ROW, update=False)
    body = api_client.get(f"/api/v1/judgment/statutes/{art.pk}/", **auth_headers).data
    assert (body["revision"], body["effective_from"]) == (1, timezone.localdate().isoformat())
