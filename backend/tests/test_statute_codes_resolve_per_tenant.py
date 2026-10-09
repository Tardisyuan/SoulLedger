"""Statute.code is unique per (tenant, code), so two halls can hold the same
code with different content. Citing a code must resolve in the soul's own hall.

Before: `SoulRecordSerializer.validate_inferno_article` and
`DispositionService._deepest_cited_circle` looked the code up with
`Statute.all_objects.filter(code=...).first()` -- whichever hall's row came
first answered, for every hall.
"""
import pytest

from apps.disposition.services import DispositionService
from apps.judgment.models import Statute
from apps.souls.models import Soul
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.souls.serializers import SoulRecordSerializer
from apps.tenants.models import Tenant

CODE = "EU-INF-C7-DUP"


def _statute(tenant, circle):
    return Statute.all_objects.create(
        tenant=tenant, civilization="EUROPEAN", corpus="EUROPEAN_INFERNO", code=CODE,
        payload_json={"circle": circle},
    )


@pytest.fixture
def halls(db):
    a = Tenant.objects.create(code="STAT_A", display_name="A")
    b = Tenant.objects.create(code="STAT_B", display_name="B")
    c = Tenant.objects.create(code="STAT_C", display_name="C")  # holds no such code
    _statute(a, 7)
    _statute(b, 8)
    return a, b, c


def _serializer(tenant):
    return SoulRecordSerializer(context={"tenant_id": tenant.id}, data={
        "record_type": "DEMERIT", "category": RecordCategory.DECEPTION,
        "description": "x", "weight": 10, "inferno_article": CODE,
    })


def test_a_code_only_another_hall_holds_is_not_citable(halls):
    a, b, c = halls
    assert _serializer(a).is_valid()
    assert _serializer(b).is_valid()
    s = _serializer(c)
    assert not s.is_valid()
    assert "inferno_article" in s.errors


def test_without_a_known_tenant_nothing_resolves(halls):
    s = SoulRecordSerializer(data={
        "record_type": "DEMERIT", "category": RecordCategory.DECEPTION,
        "description": "x", "weight": 10, "inferno_article": CODE,
    })
    assert not s.is_valid()
    assert "inferno_article" in s.errors


def test_the_deepest_circle_is_read_from_the_souls_own_halls_statute(halls):
    a, b, _ = halls
    for tenant, circle in ((a, 7), (b, 8)):
        soul = Soul.objects.create(name=f"s{circle}", tenant=tenant)
        rec = SoulRecord.objects.create(
            soul=soul, record_type="DEMERIT", category=RecordCategory.DECEPTION,
            weight=10, description="d", event_year=2000,
        )
        SoulRecord.all_objects.filter(pk=rec.pk).update(inferno_article=CODE)
        assert DispositionService._deepest_cited_circle(soul) == circle
