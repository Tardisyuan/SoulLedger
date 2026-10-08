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


# ── Editing a booked record: PATCH /souls/<id>/records/<record_id>/ ───────────

def _token_for(user, tenant):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


def test_a_record_can_be_edited_and_the_snapshot_follows_the_statute(cn_soul, api_client, auth_headers):
    record = SoulRecord.objects.create(soul=cn_soul, **_payload())
    url = f"/api/v1/souls/{cn_soul.pk}/records/{record.pk}/"
    done = api_client.patch(url, {"description": "改后", "weight": 20, "statute": str(_cn_statute().pk),
                                  "life_stage": "YOUTH", "evidence_source": "REGISTRY",
                                  "evidence_note": "司录册"}, format="json", **auth_headers)
    assert done.status_code == 200, done.content
    body = done.json()
    assert (body["description"], body["weight"], body["life_stage"]) == ("改后", 20, "YOUTH")
    assert body["statute_snapshot"]["code"] == CN_CODE
    record.refresh_from_db()
    assert record.statute_id == _cn_statute().pk and record.statute_snapshot["code"] == CN_CODE
    cleared = api_client.patch(url, {"statute": None}, format="json", **auth_headers)
    assert cleared.status_code == 200 and cleared.json()["statute_snapshot"] is None


def test_editing_the_weight_or_type_recomputes_the_souls_scores(cn_soul, api_client, auth_headers):
    record = SoulRecord.objects.create(soul=cn_soul, event_year=1990, **_payload(weight=10))
    cn_soul.refresh_from_db()
    before = (cn_soul.merit_score, cn_soul.demerit_score)
    assert before[0] > 0 and before[1] == 0
    url = f"/api/v1/souls/{cn_soul.pk}/records/{record.pk}/"
    assert api_client.patch(url, {"weight": 40}, format="json", **auth_headers).status_code == 200
    cn_soul.refresh_from_db()
    assert cn_soul.merit_score > before[0]
    assert api_client.patch(url, {"record_type": "DEMERIT"}, format="json", **auth_headers).status_code == 200
    cn_soul.refresh_from_db()
    assert cn_soul.merit_score == 0 and cn_soul.demerit_score > 0


def test_record_400s_carry_stable_error_codes(cn_soul, api_client, auth_headers):
    record = SoulRecord.objects.create(soul=cn_soul, **_payload())
    url = f"/api/v1/souls/{cn_soul.pk}/records/{record.pk}/"

    def codes(body, **kw):
        res = api_client.patch(url, body, format="json", **auth_headers)
        assert res.status_code == 400, res.content
        return res.json()["error_codes"]

    assert codes({"occurrence_count": 0}) == {"occurrence_count": ["min_value"]}
    assert codes({"weight": 101}) == {"weight": ["max_value"]}
    assert codes({"life_stage": "INFANCY"}) == {"life_stage": ["invalid_choice"]}
    assert codes({"occurrence_count": 2}) == {"non_field_errors": ["clause_count_pair"]}
    eu = Statute.objects.exclude(civilization=cn_soul.civilization).first()
    assert codes({"statute": str(eu.pk)}) == {"statute": ["statute_other_civilization"]}
    # add_record answers the same way.
    added = api_client.post(f"/api/v1/souls/{cn_soul.pk}/add_record/", _payload(weight=0), format="json", **auth_headers)
    assert added.status_code == 400 and added.json()["error_codes"] == {"weight": ["min_value"]}


def test_editing_runs_the_create_validation(cn_soul, api_client, auth_headers):
    record = SoulRecord.objects.create(soul=cn_soul, **_payload())
    url = f"/api/v1/souls/{cn_soul.pk}/records/{record.pk}/"
    assert api_client.patch(url, {"occurrence_count": 0}, format="json", **auth_headers).status_code == 400
    # 次数与条款成对:只给次数不给条款是 400。
    assert api_client.patch(url, {"occurrence_count": 2}, format="json", **auth_headers).status_code == 400
    ok = api_client.patch(url, {"occurrence_count": 2, "statute_clause": "CN-GGG-F-JJ-07:賑濟窮民百錢"},
                          format="json", **auth_headers)
    assert ok.status_code == 200 and ok.json()["occurrence_count"] == 2
    record.refresh_from_db()
    assert record.weight == 10  # 失败的那几次没写


def test_editing_needs_soul_update_and_the_record_must_belong_to_this_soul(
    cn_soul, api_client, auth_headers, cn_tenant, eu_tenant, django_user_model,
):
    import uuid

    record = SoulRecord.objects.create(soul=cn_soul, **_payload())
    url = f"/api/v1/souls/{cn_soul.pk}/records/{record.pk}/"
    assert api_client.patch(f"/api/v1/souls/{cn_soul.pk}/records/{uuid.uuid4()}/", {"weight": 3}, format="json",
                            **auth_headers).status_code == 404
    other = Soul.objects.create(name="旁人", current_state=SoulState.JUDGING, tenant=cn_tenant)
    assert api_client.patch(f"/api/v1/souls/{other.pk}/records/{record.pk}/", {"weight": 3}, format="json",
                            **auth_headers).status_code == 404
    viewer = django_user_model.objects.create_user(username="viewer_v5", password="x", role="VIEWER", tenant=cn_tenant)
    assert api_client.patch(url, {"weight": 3}, format="json", **_token_for(viewer, cn_tenant)).status_code == 403
    # Another hall's officer who CAN edit souls (MODERATOR holds soul.update; a JUDGE does not, and would
    # be refused 403 by the permission check before any lookup): the soul is not theirs to see → 404.
    eu_mod = django_user_model.objects.create_user(username="eu_mod_v5b", password="x", role="MODERATOR", tenant=eu_tenant)
    assert api_client.patch(url, {"weight": 3}, format="json", **_token_for(eu_mod, eu_tenant)).status_code == 404
    record.refresh_from_db()
    assert record.weight == 10
