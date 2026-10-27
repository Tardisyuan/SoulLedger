"""Limbo and the sixth circle read the person, not a deed (2026-10-27, review E-2).

docs/03_七宗罪与地狱惩罚.md §三: the first circle is Limbo — unbaptised infants and virtuous pagans, no punishment
(Inf. IV); the sixth is the heretics, the Epicureans who held that the soul dies with the body (Inf. X.13-15).
`Soul.baptism` and `Soul.denied_immortality` record those two facts; the officer sets them on a European soul.

User decision: a heavier sin wins over Limbo. A soul not recorded as unbaptised never lands in Limbo.
"""
import io

import pytest
from django.core.management import call_command

from apps.disposition.destination import allowed_realm_codes
from apps.disposition.services import DispositionService
from apps.judgment.models import Verdict
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

D = DispositionService
LIMBO, LUST, HERESY, FRAUD = (D.EU_HELL_CIRCLES[n] for n in (1, 2, 6, 8))


def _soul(baptism=Soul.Baptism.UNRECORDED, denied=None, code="EU_HEAVEN_HELL"):
    tenant = Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]
    return Soul.objects.create(name="s", tenant=tenant, current_state=SoulState.JUDGING, death_year=1300,
                               baptism=baptism, denied_immortality=denied)


def _demerit(soul, weight, article=None):
    with SoulRecord.batch():
        record = SoulRecord.objects.create(soul=soul, record_type="DEMERIT", category=RecordCategory.DECEPTION,
                                           weight=weight, description="d", event_year=1300)
    if article:
        SoulRecord.all_objects.filter(pk=record.pk).update(inferno_article=article)
    soul.refresh_from_db()


@pytest.mark.parametrize("baptism", [Soul.Baptism.UNBAPTISED, Soul.Baptism.BEFORE_CHRIST])
@pytest.mark.parametrize("verdict", [Verdict.PASSED, Verdict.FAILED])
def test_an_unbaptised_soul_without_a_heavier_sin_is_in_limbo(baptism, verdict):
    assert D._route_to_realm(_soul(baptism), verdict) == LIMBO


@pytest.mark.parametrize("baptism", [Soul.Baptism.UNRECORDED, Soul.Baptism.BAPTISED])
def test_a_soul_not_recorded_unbaptised_is_never_in_limbo(baptism):
    assert D._route_to_realm(_soul(baptism), Verdict.PASSED) == D.EU_HEAVEN
    assert D._route_to_realm(_soul(baptism), Verdict.FAILED) == LUST


def test_a_heavier_sin_wins_over_limbo_by_the_ladder():
    soul = _soul(Soul.Baptism.UNBAPTISED)
    _demerit(soul, D.EU_HELL_CULPA_BAND * 4)
    assert D._route_to_realm(soul, Verdict.FAILED) == D.EU_HELL_CIRCLES[5]


def test_a_heavier_sin_wins_over_limbo_by_citation():
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    soul = _soul(Soul.Baptism.UNBAPTISED)
    _demerit(soul, 1, article="EU-INF-C8")
    assert D._route_to_realm(soul, Verdict.FAILED) == FRAUD


def test_denying_immortality_is_the_sixth_circle_unless_a_cited_sin_lies_deeper():
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    heretic = _soul(denied=True)
    assert D._route_to_realm(heretic, Verdict.FAILED) == HERESY
    # Heresy over the ladder (kind over magnitude) and over a shallower citation; a deeper citation wins.
    _demerit(heretic, D.EU_HELL_CULPA_BAND * 8, article="EU-INF-C2")
    assert D._route_to_realm(heretic, Verdict.FAILED) == HERESY
    swindler = _soul(denied=True)
    _demerit(swindler, 1, article="EU-INF-C8")
    assert D._route_to_realm(swindler, Verdict.FAILED) == FRAUD
    # Heresy over Limbo: a sin is heavier than none.
    assert D._route_to_realm(_soul(Soul.Baptism.UNBAPTISED, denied=True), Verdict.FAILED) == HERESY
    # Not a verdict: a passed soul is not sent to the sixth circle by this fact.
    assert D._route_to_realm(_soul(denied=True), Verdict.PASSED) == D.EU_HEAVEN
    assert D._route_to_realm(_soul(denied=False), Verdict.FAILED) == LUST


def test_an_officer_may_pick_limbo_for_either_verdict():
    """The judge's own pick is checked against the router's image; Limbo is in it for both verdicts now."""
    for verdict in (Verdict.PASSED, Verdict.FAILED):
        assert LIMBO in allowed_realm_codes("EUROPEAN", verdict)


def test_the_officer_records_both_facts_on_a_european_soul_only(admin_user):
    european = _soul()
    client = officer_client(admin_user)
    res = client.patch(f"/api/v1/souls/{european.pk}/",
                       {"baptism": "UNBAPTISED", "denied_immortality": True}, format="json")
    assert res.status_code == 200, res.data
    assert (res.data["baptism"], res.data["denied_immortality"]) == ("UNBAPTISED", True)
    european.refresh_from_db()
    assert (european.baptism, european.denied_immortality) == ("UNBAPTISED", True)

    chinese = _soul(code="CN_DIYU")
    for field, value in (("baptism", "BAPTISED"), ("denied_immortality", False)):
        res = client.patch(f"/api/v1/souls/{chinese.pk}/", {field: value}, format="json")
        assert res.status_code == 400 and field in res.data, res.data
    # The defaults round-trip for any civilization (a client may send the whole form back).
    res = client.patch(f"/api/v1/souls/{chinese.pk}/", {"baptism": "UNRECORDED", "denied_immortality": None},
                       format="json")
    assert res.status_code == 200, res.data
