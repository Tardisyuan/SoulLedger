"""`Soul.origin_region` (2026-10-19): the field, where it is mirrored, and the condition fact the Greek flow
routes on (Gorgias 524a: Aeacus tries Europe, Rhadamanthus Asia, Minos only in doubt).

The routing itself, through the seeded Greek row, is in `tests/test_workflow_return_rules.py`.
"""
from types import SimpleNamespace

from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.souls import importer
from apps.souls.models import Soul
from apps.souls.serializers import SoulSerializer
from apps.workflow import conditions
from apps.workflow.validation import validate_template_nodes
from tests import sentence_plan_support as plan

EU = {"fact": "origin_region", "op": "in", "value": ["EUROPE"]}
ASIA = {"fact": "origin_region", "op": "in", "value": ["ASIA"]}


# ── the condition fact ─────────────────────────────────────────────────


def test_the_fact_takes_the_two_regions_and_unknown_and_nothing_else():
    assert conditions.clause_error(EU) is None
    assert conditions.clause_error({**EU, "value": ["UNKNOWN"]}) is None
    assert conditions.clause_error({**EU, "op": "not_in", "value": ["EUROPE", "ASIA"]}) is None
    assert conditions.clause_error({**EU, "value": ["AFRICA"]}) == "bad_value"
    assert conditions.clause_error({**EU, "value": [""]}) == "bad_value"  # blank is spelled UNKNOWN
    assert conditions.clause_error({**EU, "op": "lt", "value": 0}) == "bad_op"


def test_regions_overlap_exactly():
    eu, asia = conditions.region([EU]), conditions.region([ASIA])
    assert not conditions.overlaps(eu, asia)
    not_eu = conditions.region([{**EU, "op": "not_in"}])
    assert not conditions.overlaps(eu, not_eu)
    assert conditions.overlaps(asia, not_eu)
    assert conditions.region([EU, ASIA]) is None  # one soul, one region


def test_a_blank_region_reads_as_unknown(db):
    soul = Soul.objects.create(name="不详魂", tenant=plan.tenant("GR_HADES"))
    flow = SimpleNamespace(soul=soul, judgment=None)
    facts = conditions.case_facts(flow)
    assert facts["origin_region"] == "UNKNOWN"
    assert not conditions.matches([EU], facts) and not conditions.matches([ASIA], facts)
    assert conditions.matches([{**EU, "value": ["UNKNOWN"]}], facts)
    soul.origin_region = "ASIA"
    assert conditions.matches([ASIA], conditions.case_facts(flow))


def _route(*branches):
    return [
        {"id": "n1", "node_name": "分流", "node_order": 1, "kind": "NOTIFY", "on_pass": "n3",
         "branches": [{"id": str(i), "when": when, "target": "n2"} for i, when in enumerate(branches)]},
        {"id": "n2", "node_name": "判", "node_order": 2, "on_pass": "n3"},
        {"id": "n3", "node_name": "结束", "node_order": 3, "kind": "END"},
    ]


def test_the_validator_accepts_disjoint_regions_and_refuses_overlapping_ones():
    assert validate_template_nodes(_route([EU], [ASIA])) == []
    issues = validate_template_nodes(_route([EU], [{**ASIA, "op": "not_in"}]))
    assert {(i["node"], i["code"]) for i in issues} == {("n1", "condition_overlap")}
    bad = validate_template_nodes(_route([{**EU, "value": ["MARS"]}]))
    assert [(i["code"], i.get("reason")) for i in bad] == [("condition_invalid", "bad_value")]


# ── the field and its mirrors ─────────────────────────────────────────


def test_the_soul_serializer_round_trips_the_region(db):
    soul = Soul.objects.create(name="来处魂", tenant=plan.tenant("GR_HADES"))
    assert SoulSerializer(soul).data["origin_region"] == ""
    for value in ("EUROPE", "ASIA", ""):
        s = SoulSerializer(soul, data={"origin_region": value}, partial=True)
        assert s.is_valid(), s.errors
        s.save()
        soul.refresh_from_db()
        assert soul.origin_region == value
        assert SoulSerializer(soul).data["origin_region"] == value
    refused = SoulSerializer(soul, data={"origin_region": "AFRICA"}, partial=True)
    assert not refused.is_valid() and "origin_region" in refused.errors


def test_the_soul_api_reads_the_region(db):
    tenant = plan.tenant("GR_HADES")
    soul = Soul.objects.create(name="接口魂", tenant=tenant, origin_region="EUROPE")
    admin = plan.officer("origin_admin", "ADMIN", tenant)
    client = APIClient()
    token = RefreshToken.for_user(admin)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    assert client.get(f"/api/v1/souls/{soul.pk}/").json()["origin_region"] == "EUROPE"


def test_the_csv_import_takes_the_region_and_refuses_anything_else(db):
    tenant = plan.tenant("GR_HADES")
    data = ("name,civilization,origin_region\n"
            "欧魂,GREEK,europe\n亚魂,GREEK,ASIA\n未详魂,GREEK,\n火星魂,GREEK,MARS\n").encode()
    results = importer.validate_csv(data, tenant)
    assert [r.parsed["origin_region"] if r.parsed else None for r in results] == ["EUROPE", "ASIA", "", None]
    assert results[3].errors == [{"field": "origin_region", "code": "invalid_origin_region"}]
    # Absence: a file without the column still imports, region blank.
    plain = importer.validate_csv("name,civilization\n旧魂,GREEK\n".encode(), tenant)
    assert plain[0].parsed["origin_region"] == ""
