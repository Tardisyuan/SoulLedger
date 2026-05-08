"""
Integration tests for soul lifecycle: ALIVE -> JUDGING -> DISPOSED -> REINCARNATING -> ALIVE
"""
import pytest
from apps.souls.models import Soul, SoulState
from apps.judgment.models import Judgment, Verdict
from apps.disposition.models import Disposition
from apps.reincarnation.models import Reincarnation
from apps.disposition.services import DispositionService
from apps.reincarnation.services import ReincarnationService
from apps.realms.models import Realm


@pytest.fixture
def chinese_realms(db):
    """Seed minimal Chinese realms needed for disposition routing."""
    Realm.objects.get_or_create(
        realm_code="DY_01_HEAVEN",
        defaults={
            "name_local": "天堂", "name_zh": "第一层天界", "name_en": "First Heaven",
            "civilization": "CHINESE", "realm_type": "BLISS", "tier": 1,
            "is_eternal": True,
        }
    )
    Realm.objects.get_or_create(
        realm_code="DY_10_YAMA",
        defaults={
            "name_local": "第十殿", "name_zh": "阎罗殿", "name_en": "Tenth Court Yama",
            "civilization": "CHINESE", "realm_type": "HELL", "tier": 10,
            "is_eternal": True,
        }
    )
    return True


@pytest.mark.django_db
class TestSoulLifecycle:
    def test_full_lifecycle_passed(self, chinese_realms):
        """Test: Create soul -> Die -> Judge PASSED -> Dispose -> Reincarnate -> Alive"""
        # 1. Create soul
        soul = Soul.objects.create(
            name="Zhang Wei",
            civilization="CHINESE",
            birth_date="1990-01-01",
        )
        assert soul.current_state == SoulState.ALIVE

        # 2. Mark dead
        soul.die()
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING
        assert soul.death_date is not None

        # 3. Create judgment
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="First Court Qinguang",
        )
        assert not judgment.is_final

        # 4. Conclude judgment → PASSED
        judgment.conclude(Verdict.PASSED, "Excellent karma, enter paradise")
        soul.refresh_from_db()

        assert judgment.is_final
        assert judgment.verdict == Verdict.PASSED
        assert soul.current_state == SoulState.DISPOSED

        # 5. Get disposition
        disposition = Disposition.objects.filter(soul=soul).first()
        assert disposition is not None, f"No disposition for soul {soul.id}"
        assert disposition.destination_realm is not None
        assert disposition.destination_realm.realm_code == "DY_01_HEAVEN"
        assert not disposition.is_executed

        # 6. Execute disposition
        DispositionService.execute(disposition)
        disposition.refresh_from_db()
        soul.refresh_from_db()

        assert disposition.is_executed
        assert soul.current_state == SoulState.REINCARNATING

        # 7. Complete reincarnation
        reincarnation = ReincarnationService.complete_rebirth(
            soul=soul,
            disposition=disposition,
            new_identity="Zhang Wei Reborn",
            rebirth_form="HUMAN",
        )
        soul.refresh_from_db()

        assert soul.current_state == SoulState.ALIVE
        assert soul.name == "Zhang Wei Reborn"
        assert reincarnation.cycle_count == 1
        assert reincarnation.rebirth_form == "HUMAN"

    def test_full_lifecycle_failed(self, chinese_realms):
        """Test: Soul fails judgment and goes to hell"""
        soul = Soul.objects.create(name="Criminal Wang", civilization="CHINESE")
        soul.die()
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

        judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization)
        judgment.conclude(Verdict.FAILED, "Murderer, condemned to Tenth Court")
        soul.refresh_from_db()

        assert soul.current_state == SoulState.DISPOSED
        disposition = Disposition.objects.filter(soul=soul).first()
        assert disposition is not None
        assert disposition.destination_realm is not None
        assert disposition.destination_realm.realm_code == "DY_10_YAMA"

    def test_invalid_transitions(self):
        """Test: Cannot die twice, cannot skip states"""
        soul = Soul.objects.create(name="Test", civilization="CHINESE")
        soul.die()
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

        # Cannot die twice
        assert not soul.die()

        # Cannot skip: JUDGING -> REINCARNATING directly
        assert not soul.can_transition_to(SoulState.REINCARNATING)

        # Cannot skip: JUDGING -> ALIVE
        assert not soul.can_transition_to(SoulState.ALIVE)
