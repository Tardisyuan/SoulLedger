"""
Basic tests for Soul Core models and state machine.
"""
import pytest
from apps.souls.models import Soul, SoulState, Civilization
from apps.souls.record_models import SoulRecord, RecordType
from apps.realms.models import Realm, RealmType
from apps.actors.models import Actor, ActorRole


@pytest.mark.django_db
class TestSoulModel:
    def test_create_soul(self):
        soul = Soul.objects.create(
            name="张三",
            civilization=Civilization.CHINESE,
            birth_date="1990-01-01",
        )
        assert soul.id is not None
        assert soul.current_state == SoulState.ALIVE
        assert soul.karmic_balance == 0

    def test_soul_state_transition_valid(self):
        soul = Soul.objects.create(name="测试灵魂", civilization=Civilization.CHINESE)
        assert soul.can_transition_to(SoulState.JUDGING) is True

    def test_soul_state_transition_invalid(self):
        soul = Soul.objects.create(name="测试灵魂", civilization=Civilization.CHINESE)
        # Cannot jump from ALIVE to DISPOSED
        assert soul.can_transition_to(SoulState.DISPOSED) is False

    def test_die_transitions_to_judging(self):
        soul = Soul.objects.create(name="死者", civilization=Civilization.CHINESE)
        result = soul.die(location="北京")
        assert result is True
        assert soul.current_state == SoulState.JUDGING
        assert soul.death_date is not None

    def test_alive_soul_cannot_die_twice(self):
        soul = Soul.objects.create(name="死者", civilization=Civilization.CHINESE)
        soul.die()
        result = soul.die()
        assert result is False


@pytest.mark.django_db
class TestSoulRecord:
    def test_record_updates_karma(self):
        soul = Soul.objects.create(name="积累功德", civilization=Civilization.CHINESE)
        SoulRecord.objects.create(
            soul=soul,
            record_type=RecordType.MERIT,
            description="救人一命",
            weight=50,
        )
        soul.refresh_from_db()
        assert soul.merit_score == 50
        assert soul.demerit_score == 0
        assert soul.karmic_balance == 50

    def test_multiple_records_accumulate(self):
        soul = Soul.objects.create(name="混合记录", civilization=Civilization.CHINESE)
        SoulRecord.objects.create(soul=soul, record_type=RecordType.MERIT, description="A", weight=10)
        SoulRecord.objects.create(soul=soul, record_type=RecordType.DEMERIT, description="B", weight=3)
        SoulRecord.objects.create(soul=soul, record_type=RecordType.MERIT, description="C", weight=7)
        soul.refresh_from_db()
        assert soul.merit_score == 17
        assert soul.demerit_score == 3
        assert soul.karmic_balance == 14


@pytest.mark.django_db
class TestRealmAndActor:
    def test_create_chinese_realm(self):
        realm = Realm.objects.create(
            realm_code="DY_10_YAMA",
            civilization=Civilization.CHINESE,
            name_local="第十殿",
            name_en="Tenth Court Yama",
            realm_type=RealmType.HELL,
            tier=10,
            is_eternal=True,
        )
        assert realm.id is not None
        assert realm.realm_code == "DY_10_YAMA"

    def test_create_actor(self):
        realm = Realm.objects.create(
            realm_code="DY_10_YAMA",
            civilization=Civilization.CHINESE,
            name_local="第十殿",
            name_en="Tenth Court",
            realm_type=RealmType.HELL,
            tier=10,
        )
        actor = Actor.objects.create(
            name="阎罗王",
            civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE,
            realm=realm,
            title="十殿阎王",
            description="最高审判者",
        )
        assert actor.id is not None
        assert actor.realm == realm
