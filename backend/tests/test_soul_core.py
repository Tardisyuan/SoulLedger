"""
Basic tests for Soul Core models and state machine.
"""
import pytest
from apps.souls.models import Soul, SoulState, Civilization
from apps.souls.record_models import SoulRecord, RecordType
from apps.realms.models import Realm, RealmType
from apps.actors.models import Actor, ActorRole
from apps.tenants.models import Tenant


@pytest.fixture
def cn_tenant(db):
    return Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")


@pytest.mark.django_db
class TestSoulModel:
    def test_create_soul(self, cn_tenant):
        soul = Soul.objects.create(
            name="张三",
            tenant=cn_tenant,
            birth_date="1990-01-01",
        )
        assert soul.id is not None
        assert soul.current_state == SoulState.ALIVE
        assert soul.karmic_balance == 0
        assert soul.civilization == Civilization.CHINESE

    def test_soul_state_transition_valid(self, cn_tenant):
        soul = Soul.objects.create(name="测试灵魂", tenant=cn_tenant)
        assert soul.can_transition_to(SoulState.JUDGING) is True

    def test_soul_state_transition_invalid(self, cn_tenant):
        soul = Soul.objects.create(name="测试灵魂", tenant=cn_tenant)
        # Cannot jump from ALIVE to DISPOSED
        assert soul.can_transition_to(SoulState.DISPOSED) is False

    def test_die_transitions_to_judging(self, cn_tenant):
        soul = Soul.objects.create(name="死者", tenant=cn_tenant)
        result = soul.die(location="北京")
        assert result is not None  # die() returns a Judgment object
        assert soul.current_state == SoulState.JUDGING
        assert soul.death_date is not None

    def test_alive_soul_cannot_die_twice(self, cn_tenant):
        soul = Soul.objects.create(name="死者", tenant=cn_tenant)
        soul.die()
        result = soul.die()
        assert result is None  # die() returns None when soul is not ALIVE


@pytest.mark.django_db
class TestSoulRecord:
    def test_record_updates_karma(self, cn_tenant):
        soul = Soul.objects.create(name="积累功德", tenant=cn_tenant)
        SoulRecord.objects.create(
            soul=soul,
            tenant=cn_tenant,
            record_type=RecordType.MERIT,
            description="救人一命",
            weight=50,
        )
        soul.refresh_from_db()
        assert soul.merit_score == 50
        assert soul.demerit_score == 0
        assert soul.karmic_balance == 50

    def test_multiple_records_accumulate(self, cn_tenant):
        soul = Soul.objects.create(name="混合记录", tenant=cn_tenant)
        SoulRecord.objects.create(soul=soul, tenant=cn_tenant, record_type=RecordType.MERIT, description="A", weight=10)
        SoulRecord.objects.create(soul=soul, tenant=cn_tenant, record_type=RecordType.DEMERIT, description="B", weight=3)
        SoulRecord.objects.create(soul=soul, tenant=cn_tenant, record_type=RecordType.MERIT, description="C", weight=7)
        soul.refresh_from_db()
        assert soul.merit_score == 17
        assert soul.demerit_score == 3
        assert soul.karmic_balance == 14


@pytest.mark.django_db
class TestRealmAndActor:
    def test_create_chinese_realm(self, cn_tenant):
        realm = Realm.objects.create(
            realm_code="DY_10_YAMA",
            civilization=Civilization.CHINESE,
            name_local="第十殿",
            name_en="Tenth Court Yama",
            realm_type=RealmType.HELL,
            tier=10,
            is_eternal=True,
            tenant=cn_tenant,
        )
        assert realm.id is not None
        assert realm.realm_code == "DY_10_YAMA"

    def test_create_actor(self, cn_tenant):
        realm = Realm.objects.create(
            realm_code="DY_10_YAMA",
            civilization=Civilization.CHINESE,
            name_local="第十殿",
            name_en="Tenth Court",
            realm_type=RealmType.HELL,
            tier=10,
            tenant=cn_tenant,
        )
        actor = Actor.objects.create(
            name="阎罗王",
            civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE,
            realm=realm,
            title="十殿阎王",
            description="最高审判者",
            tenant=cn_tenant,
        )
        assert actor.id is not None
        assert actor.realm == realm
