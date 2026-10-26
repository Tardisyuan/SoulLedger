"""A hall the global admin creates is seeded from its civilization (docs-others X-1; user decision 2026-10-27).

Realms, actors, statutes and the formal workflow templates are copied into the new hall under the same codes
and names, which the per-hall realm-code constraint (realms/0024) allows; officers are not created.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.authentication.models import User
from apps.disposition.services import DispositionService
from apps.judgment.models import Judgment, Statute
from apps.realms.models import Realm
from apps.souls.models import Soul
from apps.tenants.models import Tenant
from apps.workflow.models import WorkflowTemplate
from apps.workflow.services import WorkflowService
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


def _create(admin_user, code, civilization):
    res = officer_client(admin_user).post(
        "/api/v1/tenants/", {"code": code, "display_name": code, "civilization": civilization}, format="json")
    assert res.status_code == 201, res.data
    return Tenant.objects.get(code=code)


def _codes(model, tenant, field):
    return set(model.all_objects.filter(tenant=tenant, is_deleted=False).values_list(field, flat=True))


def test_a_new_chinese_hall_gets_the_seed_and_leaves_the_seeded_hall_alone(admin_user, cn_tenant):
    call_command("seed_mythology", "--civilization=chinese", stdout=io.StringIO())
    before = _codes(Realm, cn_tenant, "realm_code")
    users = User.objects.count()

    hall = _create(admin_user, "CN_SECOND", "CHINESE")

    assert before and _codes(Realm, hall, "realm_code") == before
    assert _codes(Realm, cn_tenant, "realm_code") == before  # nothing moved out of CN_DIYU
    assert _codes(Actor, hall, "name") == _codes(Actor, cn_tenant, "name")
    assert _codes(Statute, hall, "code") == _codes(Statute, cn_tenant, "code")
    assert {t.case_type for t in WorkflowTemplate.objects.filter(tenant=hall, is_active=True)} == {
        "ROUTINE", "APPEAL", "CROSS_REALM"}
    assert User.objects.count() == users  # officers are the admin's to add

    # Routing lands in the new hall's own realm, and the ten courts name the new hall's kings.
    soul = Soul.objects.create(name="新殿魂", tenant=hall, demerit_score=50)
    realm = DispositionService.route_realm(soul, "FAILED")
    assert realm is not None and realm.tenant_id == hall.pk
    judgment = Judgment.objects.create(soul=soul, civilization="CHINESE", court="—", verdict="FAILED",
                                       is_final=True, tenant=hall)
    first = WorkflowService.create_from_judgment(judgment).nodes.get(node_order=1)
    assert first.approver_actor.tenant_id == hall.pk and first.approver_actor.name == "秦广王"

    # Re-running the canonical seed is still clean: it neither sees nor moves the new hall's rows.
    out = io.StringIO()
    call_command("seed_mythology", "--civilization=chinese", stdout=out)
    assert "ambiguous" not in out.getvalue()
    assert _codes(Realm, hall, "realm_code") == before


@pytest.mark.parametrize("civilization", ["EUROPEAN", "GREEK", "EGYPTIAN"])
def test_every_civilization_seeds_its_realms_and_templates(admin_user, civilization):
    hall = _create(admin_user, f"NEW_{civilization}", civilization)
    assert Realm.all_objects.filter(tenant=hall, civilization=civilization).exists()
    assert WorkflowTemplate.objects.filter(tenant=hall, case_type="ROUTINE", is_active=True).exists()
