"""
Tests for tenant FK on all 8 business models (M3.2a - M3.2h).
"""
import pytest

from apps.actors.models import Actor, ActorRole
from apps.authentication.models import User
from apps.disposition.models import Disposition
from apps.events.models import EventType, SoulEvent
from apps.judgment.models import Judgment, JudgmentMethod
from apps.realms.models import Realm, RealmType
from apps.reincarnation.models import RebirthForm, Reincarnation
from apps.souls.models import Civilization, Soul
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantForeignKey:
    """M3.2a-h: Every business model MUST have a tenant FK."""

    # (a) Realm
    def test_realm_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        realm = Realm.objects.create(
            realm_code="TEST_REALM",
            civilization=Civilization.CHINESE,
            name_local="测试",
            realm_type=RealmType.HELL,
            tenant=tenant,
        )
        assert realm.tenant == tenant
        assert realm.tenant.code == "CN_DIYU"

    # (b) Actor
    def test_actor_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        actor = Actor.objects.create(
            name="Test Actor",
            civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE,
            tenant=tenant,
        )
        assert actor.tenant == tenant
        assert actor.tenant.code == "CN_DIYU"

    # (c) Soul
    def test_soul_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        soul = Soul.objects.create(
            name="Test Soul",
            tenant=tenant,
        )
        assert soul.tenant == tenant
        assert soul.tenant.code == "CN_DIYU"

    # (d) Judgment
    def test_judgment_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        soul = Soul.objects.create(
            name="Judged Soul",
            tenant=tenant,
        )
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=Civilization.CHINESE,
            judgment_method=JudgmentMethod.STANDARD,
            tenant=tenant,
        )
        assert judgment.tenant == tenant
        assert judgment.tenant.code == "CN_DIYU"

    # (e) Disposition
    def test_disposition_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        soul = Soul.objects.create(
            name="Disposed Soul",
            tenant=tenant,
        )
        disposition = Disposition.objects.create(
            soul=soul,
            tenant=tenant,
        )
        assert disposition.tenant == tenant
        assert disposition.tenant.code == "CN_DIYU"

    # (f) Reincarnation
    def test_reincarnation_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        soul = Soul.objects.create(
            name="Reborn Soul",
            tenant=tenant,
        )
        reincarnation = Reincarnation.objects.create(
            soul=soul,
            target_realm="Earth",
            rebirth_form=RebirthForm.HUMAN,
            tenant=tenant,
        )
        assert reincarnation.tenant == tenant
        assert reincarnation.tenant.code == "CN_DIYU"

    # (g) SoulEvent
    def test_events_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        soul = Soul.objects.create(
            name="Event Soul",
            tenant=tenant,
        )
        event = SoulEvent.objects.create(
            soul=soul,
            event_type=EventType.SOUL_CREATED,
            tenant=tenant,
        )
        assert event.tenant == tenant
        assert event.tenant.code == "CN_DIYU"

    # (h) User
    def test_user_has_tenant_fk(self):
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        user = User.objects.create(
            username="testuser",
            tenant=tenant,
        )
        assert user.tenant == tenant
        assert user.tenant.code == "CN_DIYU"
