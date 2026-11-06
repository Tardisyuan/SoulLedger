"""`JudgmentDetail.final_review_by`: who actually gave the final judgment (GR-5, user 2026-11-07).

Gorgias 524a and the seeded Greek flow (docs/02_希腊冥府审判与人物详解.md §5.2): Aeacus or Rhadamanthus passing
ends the case; only their doubt sends the soul to Minos. The Gorgias verdict document signs 「米诺斯 终裁」 only
when this field is set, so it must be null when Minos never decided — including when his station was SKIPPED,
which also stamps `decided_at` (`test_workflow_return_rules.py`), so a reader that looked only at the timestamp
would sign him onto every case.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentDetailSerializer
from apps.souls.models import Soul
from apps.workflow.services import WorkflowService
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db


def _flow(region):
    gr = plan.tenant("GR_HADES")
    minos = Actor.objects.create(name="Minos", civilization="GREEK", role="JUDGE", tenant=gr)
    for name in ("Aeacus", "Rhadamanthus"):
        Actor.objects.create(name=name, civilization="GREEK", role="JUDGE", tenant=gr)
    call_command("seed_workflow_templates", stdout=io.StringIO())
    soul = Soul.objects.create(name="终裁魂", tenant=gr, origin_region=region)
    judgment = Judgment.objects.create(soul=soul, civilization="GREEK", court="—", verdict="PASSED", is_final=True,
                                       tenant=gr)
    wf = WorkflowService.create_from_judgment(judgment)
    return judgment, wf, minos


def _final(judgment):
    judgment = Judgment.all_objects.get(pk=judgment.pk)
    return JudgmentDetailSerializer().get_final_review_by(judgment)


def _decide(wf, verdict):
    wf.refresh_from_db()
    assert wf.complete_node(wf.current_node_id, verdict)


def test_aeacus_passing_ends_the_case_without_minos():
    judgment, wf, _ = _flow("EUROPE")
    assert _final(judgment) is None  # nothing decided yet
    _decide(wf, "PASSED")
    assert _final(judgment) is None  # Minos's station is SKIPPED (decided_at set), not decided


def test_minos_is_named_once_he_decides_after_a_doubt():
    judgment, wf, minos = _flow("ASIA")
    _decide(wf, "FAILED")  # Rhadamanthus doubts
    assert _final(judgment) is None  # Minos has the case but has not ruled
    _decide(wf, "PASSED")
    assert _final(judgment) == str(minos.pk)


def test_an_unknown_origin_goes_straight_to_minos_and_names_him():
    judgment, wf, minos = _flow("")
    _decide(wf, "FAILED")
    assert _final(judgment) == str(minos.pk)


def test_no_flow_no_final_review():
    gr = plan.tenant("GR_HADES")
    soul = Soul.objects.create(name="无流程魂", tenant=gr)
    judgment = Judgment.objects.create(soul=soul, civilization="GREEK", court="—", tenant=gr)
    assert _final(judgment) is None
    assert "final_review_by" in JudgmentDetailSerializer.Meta.fields
