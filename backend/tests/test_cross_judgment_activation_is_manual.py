"""A joint hearing is convened by its initiator, after the bench is seated.

BD-06, 2026-09-12. `CrossTenantJudgmentService.add_participant` ended by
calling `activate`, and `participate()` on the view did it again. So the
*first* participant flipped the judgment PROPOSED -> ACTIVE, and the second
was refused with "Can only add participants to proposed judgments". A
cross-tenant judgment could therefore have at most one participant, which is
one fewer than "joint" means. Measured in `apps/dispatch/tests.py`, whose
`test_participant_tenant_can_add_others` accepted a 400 as a passing result.

The rule the user set:

  * participants are added only while PROPOSED (unchanged);
  * adding one no longer activates anything;
  * the initiating tenant activates explicitly (`POST .../activate/`), and
    only once at least one participant is seated;
  * only the initiating tenant adds participants or activates. A participant
    is invited; it does not extend the invitation.

Clients are JUDGEs — the role that holds cross_judgment.* and is not ADMIN —
with JWTs carrying `tenant_code`.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.dispatch.models import (
    CrossTenantJudgment,
    CrossTenantJudgmentParticipant,
    JudgmentStatus,
)
from apps.dispatch.services import CrossTenantJudgmentService
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/dispatch/cross-tenant-judgments/"


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def bench(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})[0]
    eu = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Heaven/Hell"}
    )[0]
    eg = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Egyptian Duat"})[0]
    cn_judge = User.objects.create_user(username="cj_cn_judge", password="x", role="JUDGE", tenant=cn)
    eu_judge = User.objects.create_user(username="cj_eu_judge", password="x", role="JUDGE", tenant=eu)
    judgment = CrossTenantJudgment.objects.create(
        title="Joint", description="d", initiating_tenant=cn, tenant=cn,
    )
    return {
        "cn": cn, "eu": eu, "eg": eg,
        "judgment": judgment,
        "initiator": _jwt_client(cn_judge, cn),
        "participant": _jwt_client(eu_judge, eu),
    }


def _seat(judgment, tenant, role="CO_JUDGE"):
    return CrossTenantJudgmentParticipant.objects.create(
        judgment=judgment, participant_tenant=tenant, role=role, tenant=tenant,
    )


# ---------------------------------------------------------------------------
# Adding participants
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_adding_participants_does_not_activate_and_a_second_one_fits(bench):
    j = bench["judgment"]

    first = bench["initiator"].post(
        f"{BASE}{j.pk}/participate/", {"participant_tenant": bench["eu"].pk, "role": "CO_JUDGE"}, format="json"
    )
    assert first.status_code == 200, first.data
    j.refresh_from_db()
    assert j.status == JudgmentStatus.PROPOSED, "the first participant convened the court by itself"

    second = bench["initiator"].post(
        f"{BASE}{j.pk}/participate/", {"participant_tenant": bench["eg"].pk, "role": "ADVISOR"}, format="json"
    )
    assert second.status_code == 200, second.data
    assert j.participants.count() == 2
    j.refresh_from_db()
    assert j.status == JudgmentStatus.PROPOSED


@pytest.mark.django_db
def test_the_service_alone_does_not_activate_either(bench):
    """The view used to activate too, so a view-level test alone would stay
    green if only the view were fixed and the service kept flipping the row."""
    j = bench["judgment"]
    CrossTenantJudgmentService.add_participant(j, bench["eu"], None, "CO_JUDGE")
    assert CrossTenantJudgment.all_objects.get(pk=j.pk).status == JudgmentStatus.PROPOSED


@pytest.mark.django_db
def test_a_participant_does_not_add_participants(bench):
    j = bench["judgment"]
    _seat(j, bench["eu"])

    resp = bench["participant"].post(
        f"{BASE}{j.pk}/participate/", {"participant_tenant": bench["eg"].pk, "role": "ADVISOR"}, format="json"
    )
    assert resp.status_code == 403, resp.data
    assert not j.participants.filter(participant_tenant=bench["eg"]).exists()
    assert j.participants.count() == 1


@pytest.mark.django_db
def test_no_participant_after_activation(bench):
    """Unchanged rule, restated so the new manual step cannot loosen it."""
    j = bench["judgment"]
    _seat(j, bench["eu"])
    assert j.transition_to(JudgmentStatus.ACTIVE)

    resp = bench["initiator"].post(
        f"{BASE}{j.pk}/participate/", {"participant_tenant": bench["eg"].pk, "role": "ADVISOR"}, format="json"
    )
    assert resp.status_code == 400, resp.data
    assert j.participants.count() == 1


# ---------------------------------------------------------------------------
# Activating
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_the_initiator_activates_once_the_bench_is_seated(bench):
    j = bench["judgment"]
    _seat(j, bench["eu"])

    resp = bench["initiator"].post(f"{BASE}{j.pk}/activate/", {}, format="json")

    assert resp.status_code == 200, resp.data
    assert resp.data["status"] == JudgmentStatus.ACTIVE
    j.refresh_from_db()
    assert j.status == JudgmentStatus.ACTIVE


@pytest.mark.django_db
def test_an_empty_bench_cannot_be_convened(bench):
    j = bench["judgment"]
    resp = bench["initiator"].post(f"{BASE}{j.pk}/activate/", {}, format="json")

    assert resp.status_code == 400, resp.data
    j.refresh_from_db()
    assert j.status == JudgmentStatus.PROPOSED


@pytest.mark.django_db
def test_a_participant_does_not_convene_the_court(bench):
    j = bench["judgment"]
    _seat(j, bench["eu"])

    resp = bench["participant"].post(f"{BASE}{j.pk}/activate/", {}, format="json")

    assert resp.status_code == 403, resp.data
    j.refresh_from_db()
    assert j.status == JudgmentStatus.PROPOSED


@pytest.mark.django_db
def test_activation_happens_once(bench):
    j = bench["judgment"]
    _seat(j, bench["eu"])
    assert bench["initiator"].post(f"{BASE}{j.pk}/activate/", {}, format="json").status_code == 200

    again = bench["initiator"].post(f"{BASE}{j.pk}/activate/", {}, format="json")
    assert again.status_code == 400, again.data
    j.refresh_from_db()
    assert j.status == JudgmentStatus.ACTIVE


@pytest.mark.django_db
def test_conclusion_still_needs_an_active_court(bench):
    """PROPOSED -> CONCLUDED is not a transition; with automatic activation
    gone, a bench that was seated but never convened must still be refused."""
    j = bench["judgment"]
    _seat(j, bench["eu"])
    resp = bench["initiator"].post(f"{BASE}{j.pk}/conclude/", {"conclusion_type": "PASS"}, format="json")
    assert resp.status_code == 400, resp.data
    j.refresh_from_db()
    assert j.status == JudgmentStatus.PROPOSED
    assert j.conclusion_type is None
