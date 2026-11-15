"""Constrained SHARD -> SHARD keys stay inside one civilization (VERIFY-stage2 item 1).

Once the database is split per civilization a constrained key cannot name a row in another shard. The
keys that cross by design are bare ids (tests/tenancy_fk_inventory.py); the rest are refused at save time
by `apps.core.sharding`'s pre_save guard, derived from the placements. The two write paths the stage 2
review reproduced are pinned here: a residence court ruling on a home-hall record (allowed: that key is
now a bare id) and an Actor given another civilization's realm (refused, in `save()` and in the admin).
`test_shard_sync.test_every_constrained_key_of_the_world_refuses_another_civilization` covers every key.
"""
import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.test import RequestFactory

from apps.actors.models import Actor
from apps.core.sharding import CrossCivilizationKeyError
from apps.realms.models import Realm
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


@pytest.fixture
def halls():
    cn = Tenant.objects.create(code="KEY_CN", display_name="cn", declared_civilization="CHINESE")
    cn2 = Tenant.objects.create(code="KEY_CN2", display_name="cn2", declared_civilization="CHINESE")
    eg = Tenant.objects.create(code="KEY_EG", display_name="eg", declared_civilization="EGYPTIAN")
    return cn, cn2, eg


def _realm(hall, code, civ):
    return Realm.all_objects.create(realm_code=code, name_en=code, name_local=code, civilization=civ,
                                    realm_type="HELL", tenant=hall)


def test_an_actor_cannot_sit_in_another_civilizations_realm(halls):
    cn, cn2, eg = halls
    duat = _realm(eg, "KEY_DUAT", "EGYPTIAN")
    with pytest.raises(ValidationError) as e:
        Actor.all_objects.create(name="k-a", civilization="CHINESE", role="JUDGE", realm=duat, tenant=cn)
    assert list(e.value.message_dict) == ["realm"]
    assert not Actor.all_objects.filter(name="k-a").exists()
    # Absence of over-reach: another hall of the same civilization, and no realm, are fine.
    ok = Actor.all_objects.create(name="k-b", civilization="CHINESE", role="JUDGE",
                                  realm=_realm(cn2, "KEY_FENGDU", "CHINESE"), tenant=cn)
    assert Actor.all_objects.create(name="k-c", civilization="CHINESE", role="JUDGE", tenant=cn).realm_id is None
    # A path that skips clean(): the pre_save guard refuses it too.
    Actor.all_objects.filter(pk=ok.pk).update(powers_json={})
    ok.refresh_from_db()
    ok.realm_id = duat.pk
    with pytest.raises(CrossCivilizationKeyError):
        super(Actor, ok).save()


@pytest.mark.filterwarnings("ignore::django.utils.deprecation.RemovedInDjango60Warning")
def test_the_admin_form_refuses_another_civilizations_realm(halls, django_user_model):
    cn, _, eg = halls
    duat = _realm(eg, "KEY_DUAT2", "EGYPTIAN")
    su = django_user_model.objects.create_superuser("key_su", "su@x.test", "pw-not-used-1234")
    req = RequestFactory().get("/admin/actors/actor/add/")
    req.user = su
    form = admin.site._registry[Actor].get_form(req)(data={
        "name": "k-d", "civilization": "CHINESE", "role": "JUDGE", "realm": str(duat.pk), "tenant": str(cn.pk),
        "is_active": "on", "powers_json": "{}", "description_en": "", "sort_code": "0"})
    assert not form.is_valid()
    assert "realm" in form.errors, form.errors


def test_a_judgment_naming_another_civilizations_realm_is_refused(halls):
    """The generic guard on a key the API writes (Judgment.realm): tenant_scoped() compares the realm with
    the caller's hall, and lets a SYSTEM_ADMIN through; the save does not."""
    from apps.judgment.models import Judgment
    from apps.souls.models import Soul

    cn, _, eg = halls
    soul = Soul.objects.create(name="k-j", tenant=cn)
    with pytest.raises(CrossCivilizationKeyError) as e:
        Judgment.objects.create(soul=soul, tenant=cn, civilization="CHINESE", case_number="KEY-J1",
                                realm=_realm(eg, "KEY_DUAT3", "EGYPTIAN"))
    assert list(e.value.message_dict) == ["realm"]


def test_a_residence_court_rules_on_a_record_the_home_hall_wrote(halls):
    """The reviewer's reproducer, kept: a soul home in CN resides in EG and is judged there; the court rules on
    a record written in CN. That is the product (EvidenceAdmissionService.rule picks by soul + cycle), so
    EvidenceAdmission.record is a bare id and the ruling goes through."""
    from apps.judgment.models import EvidenceAdmission, Judgment
    from apps.judgment.services import EvidenceAdmissionService
    from apps.ledger.models import SoulRecord
    from apps.souls.models import Soul, SoulState

    cn, _, eg = halls
    soul = Soul.objects.create(name="k-r", birth_date="1900-01-01", current_state=SoulState.JUDGING,
                               tenant=cn, home_tenant=cn)
    home_record = SoulRecord.objects.create(soul=soul, tenant=cn, record_type="DEMERIT", description="d", weight=3)
    Soul._base_manager.filter(pk=soul.pk).update(tenant=eg)  # an executed dispatch: resides in EG
    soul.refresh_from_db()
    judgment = Judgment.objects.create(soul=soul, civilization="EGYPTIAN", court="Hall of Two Truths", tenant=eg)
    assert judgment.cycle == home_record.cycle
    row = EvidenceAdmissionService.rule(judgment, home_record.pk, admitted=False, reason="x")
    assert row.tenant.civilization == "EGYPTIAN" and row.record.tenant.civilization == "CHINESE"
    assert not EvidenceAdmission._meta.get_field("record").db_constraint
