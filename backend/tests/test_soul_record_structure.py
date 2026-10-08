"""Structured merit/demerit records (V5): article link with a frozen
snapshot, life stage, evidence source.

The decisions these tests pin:

* `weight` is the TOTAL for the row. `occurrence_count` says how many
  occasions that total covers (souls/0028's granularity input) and does NOT
  multiply into the ledger — the balance test below holds the weight fixed
  and varies the count.
* The snapshot is taken by `SoulRecord.save()` when the statute is first set,
  and a later revision of the article leaves it unchanged.
* A statute from another civilization is refused at the serializer boundary,
  whichever way the soul arrives (context on update, `save(soul=)` on create).
"""
import io

import pytest
from django.core.management import call_command
from rest_framework import serializers

from apps.judgment.models import Statute
from apps.ledger.services import LedgerService
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.souls.serializers import SoulRecordSerializer
from apps.tenants.models import Tenant

CN_CODE = "CN-GGG-F-JJ-07"  # 救濟門#7


@pytest.fixture
def seeded(db):
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())


@pytest.fixture
def cn_soul(seeded):
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Diyu"})[0]
    return Soul.objects.create(name="沈青梧", current_state=SoulState.JUDGING, death_year=2000, tenant=tenant)


def _cn_statute():
    return Statute.objects.get(code=CN_CODE)


def _payload(**over):
    data = {"record_type": "MERIT", "category": RecordCategory.CHARITY, "description": "賑濟", "weight": 10}
    data.update(over)
    return data


# ── Snapshot ────────────────────────────────────────────────────────────────

def test_save_takes_the_snapshot_and_a_later_revision_does_not_touch_it(cn_soul):
    statute = _cn_statute()
    record = SoulRecord.objects.create(soul=cn_soul, statute=statute, **_payload())
    snap = record.statute_snapshot
    assert snap["statute_id"] == str(statute.pk)
    assert snap["code"] == CN_CODE
    assert snap["revision"] == statute.revision
    assert snap["title"]["zh"] == statute.title_zh

    statute.title_zh = statute.title_zh + "（修訂）"
    statute.save()
    assert Statute.objects.get(pk=statute.pk).revision == snap["revision"] + 1

    record.refresh_from_db()
    assert record.statute_snapshot == snap

    # Re-saving the record for any other reason keeps the original snapshot too.
    record.description = "賑濟（補記）"
    record.save()
    record.refresh_from_db()
    assert record.statute_snapshot == snap
    assert record.statute_snapshot["title"]["zh"] != "（修訂）"


def test_clearing_the_statute_clears_the_snapshot(cn_soul):
    record = SoulRecord.objects.create(soul=cn_soul, statute=_cn_statute(), **_payload())
    record.statute = None
    record.save()
    record.refresh_from_db()
    assert record.statute_snapshot is None


# ── Boundary validation ──────────────────────────────────────────────────────

def test_a_statute_from_another_civilization_is_refused_on_create(cn_soul):
    foreign = Statute.all_objects.exclude(civilization=cn_soul.civilization).first()
    assert foreign is not None
    # Create path: the soul arrives in save(soul=), so the refusal happens there.
    s = SoulRecordSerializer(data=_payload(statute=str(foreign.pk)))
    assert s.is_valid(), s.errors
    with pytest.raises(serializers.ValidationError) as exc:
        s.save(soul=cn_soul)
    assert "statute" in exc.value.detail
    assert not SoulRecord.objects.filter(soul=cn_soul).exists()


def test_a_statute_from_another_civilization_is_refused_on_update(cn_soul):
    foreign = Statute.all_objects.exclude(civilization=cn_soul.civilization).first()
    record = SoulRecord.objects.create(soul=cn_soul, **_payload())
    s = SoulRecordSerializer(record, data={"statute": str(foreign.pk)}, partial=True)
    assert not s.is_valid()
    assert "statute" in s.errors


def test_a_statute_from_the_souls_own_corpus_is_accepted_and_echoed_with_its_snapshot(cn_soul):
    s = SoulRecordSerializer(data=_payload(statute=str(_cn_statute().pk), life_stage="YOUTH",
                                           evidence_source="WITNESS", evidence_note="鄰人王氏"))
    assert s.is_valid(), s.errors
    record = s.save(soul=cn_soul)
    out = SoulRecordSerializer(record).data
    assert out["statute"] == _cn_statute().pk
    assert out["statute_snapshot"]["code"] == CN_CODE
    assert (out["life_stage"], out["evidence_source"], out["evidence_note"]) == ("YOUTH", "WITNESS", "鄰人王氏")


@pytest.mark.parametrize("bad", [
    {"life_stage": "INFANCY"},
    {"evidence_source": "RUMOUR"},
    {"statute_clause": "CN-GGG-F-JJ-07:賑濟窮民百錢", "occurrence_count": 0},
])
def test_unknown_members_and_a_zero_count_are_refused(seeded, bad):
    s = SoulRecordSerializer(data=_payload(**bad))
    assert not s.is_valid()
    assert set(bad) & set(s.errors), s.errors


def test_the_snapshot_is_not_writable(cn_soul):
    s = SoulRecordSerializer(data=_payload(statute_snapshot={"code": "forged"}))
    assert s.is_valid(), s.errors
    assert "statute_snapshot" not in s.validated_data


# ── Ledger: weight is the total, the count does not multiply ─────────────────

def test_occurrence_count_does_not_change_the_balance(cn_soul):
    SoulRecord.objects.create(
        soul=cn_soul, event_year=2000, statute_clause="CN-GGG-F-JJ-07:賑濟窮民百錢",
        occurrence_count=1, **_payload(weight=10),
    )
    once = LedgerService.get_ledger_summary(cn_soul)["merit_score"]
    SoulRecord.objects.filter(soul=cn_soul).update(occurrence_count=12)
    twelve = LedgerService.get_ledger_summary(cn_soul)["merit_score"]
    assert once == twelve == 10


# ── Tenant scoping unchanged ─────────────────────────────────────────────────

def test_the_records_endpoint_carries_the_structure_and_stays_tenant_scoped(
    cn_soul, api_client, auth_headers, eu_tenant, django_user_model,
):
    """ADMIN bypasses scoping by design (apps/core/tenant.py admin_bypass), so
    the other-tenant reader is a JUDGE, as in test_tenant_isolation.py."""
    from rest_framework_simplejwt.tokens import RefreshToken

    SoulRecord.objects.create(soul=cn_soul, statute=_cn_statute(), life_stage="OLD_AGE", **_payload())
    url = f"/api/v1/souls/{cn_soul.pk}/records/"
    mine = api_client.get(url, **auth_headers)
    assert mine.status_code == 200, mine.content
    (row,) = mine.json()
    assert row["statute_snapshot"]["code"] == CN_CODE and row["life_stage"] == "OLD_AGE"

    eu_judge = django_user_model.objects.create_user(username="eu_judge_v5", password="x", role="JUDGE", tenant=eu_tenant)
    token = RefreshToken.for_user(eu_judge)
    token["tenant_code"] = eu_tenant.code
    theirs = api_client.get(url, HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    assert theirs.status_code == 404, theirs.content
