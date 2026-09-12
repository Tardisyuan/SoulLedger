"""An ordinary Judgment binds a soul and a judge from the requester's tenant.

BD-01 (P0), 2026-09-12. `validate_soul = tenant_scoped("soul")` and
`validate_judge = tenant_scoped("judge")` were declared on
`JudgmentCitationSerializer`, whose fields are `id/statute/note/created_at`.
DRF only calls `validate_<name>` for a declared field, so both guards were dead
code from the commit that added them, and `JudgmentSerializer` — the class with
the `soul` and `judge` fields — resolved bare primary keys against
`TenantManager`, which filters `is_deleted` and nothing else. Measured: a CN
JUDGE could `POST /api/v1/judgment/ {soul: <EU soul>}`, get a 201, and
`perform_create` then walked the EU soul ALIVE -> JUDGING.

The rule the user set: cross-tenant hearings go through
`apps.dispatch.CrossTenantJudgment`, where the other civilization's judge is a
*participant*; the soul stays with its own tenant because it has to come back
when the sentence is executed. So here both `soul` and `judge` must belong to
the requester's tenant (ADMIN exempt, the same exemption `tenant_scoped` has
always carried).

Also pinned in this file, because they are the same serializer and were found
in the same pass:

  * BD-03 — `verdict` / `is_final` / `concluded_at` were writable. A PATCH
    could mark a case final with no Disposition, no soul transition, and a
    later `conclude/` refused with "already concluded". Read-only now, and an
    attempt is an explicit 400 (the `ApprovalNodeSerializer.validate` shape).
  * BD-08 — `civilization` accepted any member; it is derived from the soul.
    A SETTLED soul and a soul with an open case are refused.

Every client here is a JUDGE with a JWT that carries `tenant_code`, so
`TenantMiddleware` sets `request.tenant` exactly as in production. ADMIN
short-circuits every tenant check and would prove nothing.
"""
import importlib
import inspect
import pkgutil

import pytest
from django.contrib.auth import get_user_model
from rest_framework import serializers as drf_serializers
from rest_framework.test import APIClient

from apps.actors.models import Actor
from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentCitationSerializer, JudgmentSerializer
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
URL = "/api/v1/judgment/"


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def courts(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})[0]
    eu = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Heaven/Hell"}
    )[0]
    cn_judge = User.objects.create_user(username="jt_cn_judge", password="x", role="JUDGE", tenant=cn)
    cn_admin = User.objects.create_user(username="jt_cn_admin", password="x", role="ADMIN", tenant=cn)
    return {
        "cn": cn,
        "eu": eu,
        "cn_soul": Soul.objects.create(name="CN Soul", current_state=SoulState.ALIVE, tenant=cn),
        "eu_soul": Soul.objects.create(name="EU Soul", current_state=SoulState.ALIVE, tenant=eu),
        "cn_actor": Actor.objects.create(name="秦广王", civilization="CHINESE", role="JUDGE", tenant=cn),
        "eu_actor": Actor.objects.create(name="Minos", civilization="EUROPEAN", role="JUDGE", tenant=eu),
        "judge": _jwt_client(cn_judge, cn),
        "admin": _jwt_client(cn_admin, cn),
    }


# ---------------------------------------------------------------------------
# BD-01: the soul and the judge belong to the requester's tenant
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_a_judge_cannot_open_a_case_on_another_tenants_soul(courts):
    eu_soul = courts["eu_soul"]
    resp = courts["judge"].post(URL, {"soul": str(eu_soul.id), "civilization": "EUROPEAN", "court": "第一殿"}, format="json")

    assert resp.status_code == 400, resp.data
    # Not "wrong tenant" — the same "no such X" phrasing reads use, so a write
    # does not confirm that another tenant's row exists.
    assert "soul" in resp.data
    eu_soul.refresh_from_db()
    assert eu_soul.current_state == SoulState.ALIVE, "the EU soul was moved by a refused request"
    assert not Judgment.all_objects.filter(soul=eu_soul).exists()


@pytest.mark.django_db
def test_a_judge_cannot_seat_another_tenants_judge(courts):
    cn_soul = courts["cn_soul"]
    resp = courts["judge"].post(
        URL, {"soul": str(cn_soul.id), "civilization": "CHINESE", "judge": courts["eu_actor"].pk}, format="json"
    )

    assert resp.status_code == 400, resp.data
    assert "judge" in resp.data
    cn_soul.refresh_from_db()
    assert cn_soul.current_state == SoulState.ALIVE
    assert not Judgment.all_objects.filter(soul=cn_soul).exists()


@pytest.mark.django_db
def test_a_judge_can_still_hear_a_case_in_their_own_court(courts):
    """Positive control: the guard refuses the other tenant, not everyone."""
    cn_soul = courts["cn_soul"]
    resp = courts["judge"].post(
        URL, {"soul": str(cn_soul.id), "civilization": "CHINESE", "judge": courts["cn_actor"].pk, "court": "第一殿"}, format="json"
    )
    assert resp.status_code == 201, resp.data
    cn_soul.refresh_from_db()
    assert cn_soul.current_state == SoulState.JUDGING


@pytest.mark.django_db
def test_admin_keeps_the_global_exemption(courts):
    """The one globally scoped role — `apps/core/tenant.py` owns that decision."""
    eu_soul = courts["eu_soul"]
    resp = courts["admin"].post(URL, {"soul": str(eu_soul.id), "civilization": "EUROPEAN"}, format="json")
    assert resp.status_code == 201, resp.data


def test_every_validate_hook_names_a_declared_field():
    """The defect was a `validate_<field>` on a serializer without that field.

    DRF looks the hook up by name at validation time and simply never finds
    it, so nothing fails — the guard exists in the source and nowhere else.
    Walk every serializer under `apps.*.serializers` and require that the
    suffix of each `validate_*` method is a declared field. This is the check
    that would have caught BD-01 the day it was written.
    """
    import apps

    offenders = []
    for module_info in pkgutil.walk_packages(apps.__path__, prefix="apps."):
        if not module_info.name.endswith(".serializers"):
            continue
        module = importlib.import_module(module_info.name)
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if cls.__module__ != module.__name__:
                continue
            if not issubclass(cls, drf_serializers.Serializer):
                continue
            hooks = {
                name[len("validate_"):]
                for name, _ in inspect.getmembers(cls, callable)
                if name.startswith("validate_") and name != "validate_empty_values"
            }
            if not hooks:
                continue
            try:
                declared = set(cls().get_fields())
            except Exception:  # noqa: BLE001 — a serializer that needs context; skip, do not fail
                continue
            for hook in hooks - declared:
                offenders.append(f"{module.__name__}.{cls.__name__}.validate_{hook}")

    assert not offenders, (
        "validate_<field> hooks on serializers that do not declare <field> — "
        "DRF never calls these, so they guard nothing:\n  " + "\n  ".join(offenders)
    )


def test_the_guards_sit_on_the_serializer_with_the_fields():
    """The specific instance, stated plainly next to the general walk above."""
    assert "soul" in JudgmentSerializer().get_fields()
    assert callable(getattr(JudgmentSerializer, "validate_soul", None))
    assert callable(getattr(JudgmentSerializer, "validate_judge", None))
    assert not hasattr(JudgmentCitationSerializer, "validate_soul")
    assert not hasattr(JudgmentCitationSerializer, "validate_judge")


# ---------------------------------------------------------------------------
# BD-03: a verdict is filed through `conclude/`, never through a field write
# ---------------------------------------------------------------------------

@pytest.fixture
def open_case(courts):
    soul = courts["cn_soul"]
    soul.current_state = SoulState.JUDGING
    soul.save(update_fields=["current_state"])
    return Judgment.objects.create(soul=soul, civilization="CHINESE", court="第一殿", tenant=courts["cn"])


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload",
    [
        {"verdict": "PASSED"},
        {"is_final": True},
        {"concluded_at": "2026-01-01T00:00:00Z"},
        {"verdict": "PASSED", "is_final": True, "concluded_at": "2026-01-01T00:00:00Z"},
    ],
)
def test_patch_cannot_forge_a_conclusion(courts, open_case, payload):
    resp = courts["judge"].patch(f"{URL}{open_case.id}/", payload, format="json")

    assert resp.status_code == 400, resp.data
    for field in payload:
        assert field in resp.data, f"the refusal did not name {field!r}: {resp.data}"

    open_case.refresh_from_db()
    assert open_case.verdict is None
    assert open_case.is_final is False
    assert open_case.concluded_at is None
    # The forgery's signature: a "final" judgment with no disposition and a soul
    # still under judgment. Assert the absence of all three, not just the 400.
    assert not Disposition.all_objects.filter(judgment=open_case).exists()
    open_case.soul.refresh_from_db()
    assert open_case.soul.current_state == SoulState.JUDGING


@pytest.mark.django_db
def test_a_case_cannot_be_opened_already_concluded(courts):
    """Guarding update alone leaves the forgery one request away by another door."""
    cn_soul = courts["cn_soul"]
    resp = courts["judge"].post(
        URL, {"soul": str(cn_soul.id), "civilization": "CHINESE", "verdict": "PASSED", "is_final": True}, format="json"
    )
    assert resp.status_code == 400, resp.data
    assert not Judgment.all_objects.filter(soul=cn_soul).exists()
    cn_soul.refresh_from_db()
    assert cn_soul.current_state == SoulState.ALIVE


@pytest.mark.django_db
def test_the_sanctioned_door_still_works(courts, open_case):
    """Positive control: `conclude/` is how a verdict lands, and it still does."""
    resp = courts["judge"].post(f"{URL}{open_case.id}/conclude/", {"verdict": "PASSED"}, format="json")
    assert resp.status_code == 200, resp.data
    open_case.refresh_from_db()
    assert open_case.is_final is True
    assert Disposition.all_objects.filter(judgment=open_case).exists()


# ---------------------------------------------------------------------------
# BD-08: civilization comes from the soul; some souls cannot be judged
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_civilization_is_the_souls_not_the_callers(courts):
    cn_soul = courts["cn_soul"]
    resp = courts["judge"].post(URL, {"soul": str(cn_soul.id), "civilization": "EGYPTIAN"}, format="json")

    assert resp.status_code == 201, resp.data
    assert resp.data["civilization"] == "CHINESE"
    assert Judgment.objects.get(id=resp.data["id"]).civilization == "CHINESE"


@pytest.mark.django_db
def test_a_settled_soul_cannot_be_put_on_trial(courts):
    cn_soul = courts["cn_soul"]
    cn_soul.current_state = SoulState.SETTLED
    cn_soul.save(update_fields=["current_state"])

    resp = courts["judge"].post(URL, {"soul": str(cn_soul.id), "civilization": "CHINESE"}, format="json")

    assert resp.status_code == 400, resp.data
    assert "soul" in resp.data
    assert not Judgment.all_objects.filter(soul=cn_soul).exists()
    cn_soul.refresh_from_db()
    assert cn_soul.current_state == SoulState.SETTLED


@pytest.mark.django_db
def test_a_soul_with_an_open_case_does_not_get_a_second(courts, open_case):
    resp = courts["judge"].post(URL, {"soul": str(open_case.soul_id), "civilization": "CHINESE"}, format="json")

    assert resp.status_code == 400, resp.data
    assert "soul" in resp.data
    assert Judgment.all_objects.filter(soul=open_case.soul).count() == 1


@pytest.mark.django_db
def test_a_concluded_case_does_not_block_the_next_one(courts, open_case):
    """The bar is an *open* case. A soul whose earlier hearing concluded (and
    which is back to a judgeable state) can be heard again — otherwise a
    reincarnated soul could never face judgment twice."""
    open_case.verdict = "PASSED"
    open_case.is_final = True
    open_case.save(update_fields=["verdict", "is_final"])
    soul = open_case.soul
    soul.current_state = SoulState.ALIVE
    soul.save(update_fields=["current_state"])

    resp = courts["judge"].post(URL, {"soul": str(soul.id), "civilization": "CHINESE"}, format="json")
    assert resp.status_code == 201, resp.data
    assert Judgment.all_objects.filter(soul=soul).count() == 2
