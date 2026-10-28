"""A denial recorded as untrue bars PASSED (user 2026-10-28; docs/02_奥西里斯审判详解.md §2.2, §四, §5.1).

Thoth's verdict for the one who passes is "There hath not been found any wickedness in him"; the 42 denials are where
the deceased says there is none. One row with `truthful=False` refuses PASSED at conclusion (original and reopened,
`JudgmentConclusionService`) and at an appeal amended to PASSED (`sentence_plan.requests.amend_for_appeal`):
400 `untruthful_confession` with the assessor ordinals. No row, or only true / unrecorded ones: not checked.
"""
import io

import pytest
from django.core.management import call_command

from apps.judgment.confessions import refuse_passed_if_untruthful
from apps.judgment.models import Judgment, JudgmentMethod, NegativeConfession, Statute, StatuteCorpus, Verdict
from apps.judgment.services import JudgmentConclusionService
from apps.sentence_plan.requests import PlanChangeRefusedError, amend_for_appeal
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def case():
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    tenant = Tenant.objects.get(code="EG_DUAT")
    soul = Soul.objects.create(name="Ani", tenant=tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, tenant=tenant, civilization="EGYPTIAN", court="—",
                                   judgment_method=JudgmentMethod.HEART_WEIGHING)


def _heard(case, ordinal, truthful):
    statute = Statute.all_objects.get(tenant_id=case.tenant_id, corpus=StatuteCorpus.NEGATIVE_CONFESSION,
                                      ordinal=ordinal, is_deleted=False)
    NegativeConfession.objects.create(judgment=case, statute=statute, truthful=truthful, tenant_id=case.tenant_id)


def _refused(call):
    with pytest.raises(PlanChangeRefusedError) as refused:
        call()
    return refused.value


def test_any_untrue_denial_refuses_passed_and_names_the_assessors(case):
    _heard(case, 1, True)
    _heard(case, 7, False)
    _heard(case, 3, False)
    _heard(case, 9, None)
    refused = _refused(lambda: refuse_passed_if_untruthful(case, Verdict.PASSED))
    assert refused.code == "untruthful_confession" and refused.extra == {"ordinals": [3, 7]}
    # Only PASSED: the other verdicts are the scale's business, as before.
    for verdict in (Verdict.FAILED, Verdict.PURGATORY, Verdict.RETRY):
        refuse_passed_if_untruthful(case, verdict)


@pytest.mark.parametrize("rows", [[], [(1, True)], [(1, True), (2, None)]])
def test_true_or_unrecorded_denials_do_not_bar_passed(case, rows):
    for ordinal, truthful in rows:
        _heard(case, ordinal, truthful)
    refuse_passed_if_untruthful(case, Verdict.PASSED)


def test_conclude_refuses_and_writes_nothing(case, admin_user):
    """A light heart (no deeds): the scale gives PASSED, and the untrue denial refuses it."""
    _heard(case, 12, False)
    res = officer_client(admin_user).post(f"/api/v1/judgment/{case.pk}/conclude/", {"verdict": "PASSED"},
                                          format="json")
    assert res.status_code == 400, res.data
    assert res.data["code"] == "untruthful_confession" and res.data["ordinals"] == [12], res.data
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final
    case.soul.refresh_from_db()
    assert case.soul.current_state == SoulState.JUDGING


def test_the_in_process_conclusion_is_refused_too(case):
    _heard(case, 42, False)
    refused = _refused(lambda: JudgmentConclusionService.conclude_judgment(case, Verdict.PASSED))
    assert refused.code == "untruthful_confession"


def test_an_appeal_cannot_amend_to_passed(case):
    _heard(case, 5, False)
    Judgment.objects.filter(pk=case.pk).update(verdict=Verdict.FAILED, is_final=True)
    case.refresh_from_db()
    refused = _refused(lambda: amend_for_appeal(case.soul, case, Verdict.PASSED))
    assert refused.code == "untruthful_confession" and refused.extra == {"ordinals": [5]}
