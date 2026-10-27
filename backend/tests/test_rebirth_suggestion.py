"""第十殿结案的六道建议(docs/07 §四、docs/05 §3.2;用户 2026-10-27,官员可改)— docs-others C-2."""
import pytest

from apps.disposition.models import Disposition
from apps.disposition.serializers import DispositionSerializer
from apps.judgment.models import Judgment
from apps.reincarnation.models import suggested_rebirth_form
from apps.souls.models import Soul
from tests import sentence_plan_support as sp


@pytest.mark.parametrize("balance,form", [
    (500, "DIVINE"), (499, "HUMAN"), (0, "HUMAN"), (-99, "HUMAN"),
    (-100, None), (-299, None), (-300, None), (-499, None), (-500, "HELL_BEING"),
])
def test_the_bands(balance, form):
    # -100~-499:畜生 / 饿鬼由官员定,不给建议(用户 2026-10-27)
    assert suggested_rebirth_form(balance) == form


@pytest.mark.django_db
def test_a_diyu_disposition_carries_the_suggestion_from_the_balance_at_conclusion():
    hall = sp.tenant("CN_DIYU")
    soul = Soul.objects.create(name="建议魂", tenant=hall, merit_score=900)  # today's balance says 天道 …
    judgment = Judgment.objects.create(soul=soul, civilization="CHINESE", court="第十殿", verdict="FAILED",
                                       is_final=True, tenant=hall, concluded_balance=-600)  # … the conclusion did not
    disposition = Disposition.objects.create(soul=soul, judgment=judgment, tenant=hall)
    assert DispositionSerializer(disposition).data["suggested_rebirth_form"] == "HELL_BEING"


@pytest.mark.django_db
def test_other_civilizations_have_no_six_paths():
    hall = sp.tenant("GR_HADES")
    soul = Soul.objects.create(name="希腊魂", tenant=hall)
    disposition = Disposition.objects.create(soul=soul, tenant=hall)
    assert DispositionSerializer(disposition).data["suggested_rebirth_form"] is None
