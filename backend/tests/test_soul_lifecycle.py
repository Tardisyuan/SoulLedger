"""
Integration tests for soul lifecycle: ALIVE -> JUDGING -> DISPOSED -> REINCARNATING -> ALIVE
"""
import pytest

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, Verdict
from apps.realms.models import Realm
from apps.reincarnation.services import ReincarnationService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.fixture
def cn_tenant(db):
    return Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")


@pytest.fixture
def chinese_realms(db, cn_tenant):
    """Seed minimal Chinese realms needed for disposition routing."""
    Realm.objects.get_or_create(
        realm_code="DY_01_HEAVEN",
        defaults={
            "name_local": "天堂", "name_zh": "第一层天界", "name_en": "First Heaven",
            "civilization": "CHINESE", "realm_type": "BLISS", "tier": 1,
            "is_eternal": False,  # as seeded: 福尽仍入轮回
            "tenant": cn_tenant,
        }
    )
    # 第九殿平等王 — 阿鼻地狱, the deepest hell and therefore where the karma
    # band saturates. Not the tenth court: that one turns the wheel of rebirth
    # and administers no punishment, so it is deliberately absent from
    # DispositionService.CHINESE_HELL_TIERS.
    Realm.objects.get_or_create(
        realm_code="DY_COURT_09_PINGDENG",
        defaults={
            "name_local": "第九殿", "name_zh": "第九殿平等王",
            "name_en": "Ninth Court Pingdeng",
            "civilization": "CHINESE", "realm_type": "HELL", "tier": 9,
            "is_eternal": True,
            "tenant": cn_tenant,
        }
    )
    return True


@pytest.mark.django_db
class TestSoulLifecycle:
    def test_full_lifecycle_passed(self, chinese_realms, cn_tenant):
        """Test: Create soul -> Die -> Judge PASSED -> Dispose -> Reincarnate -> Alive"""
        # 1. Create soul
        soul = Soul.objects.create(
            name="Zhang Wei",
            tenant=cn_tenant,
            birth_date="1990-01-01",
        )
        assert soul.current_state == SoulState.ALIVE
        assert soul.civilization == "CHINESE"

        # 2. Mark dead
        soul.die()
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING
        assert soul.death_date is not None

        # 3. The judgment `die()` opened. This used to create a second one
        # beside it; the stray open case went unnoticed until the sentence plan
        # (docs/ARCHITECTURE-sentence-plan.md §3.3) started asking "is any case
        # still open?" before completing — an open case now holds the plan.
        judgment = Judgment.objects.get(soul=soul)
        judgment.court = "First Court Qinguang"
        judgment.save(update_fields=["court"])
        assert not judgment.is_final

        # 4. Conclude judgment → PASSED. 地府判无罪不发落、不建刑期节点(用户 2026-10-29,docs/11 第六步
        # 「无罪 → 直接投胎」):没有审批流程时结案即候转世。此前这里先建去 DY_01_HEAVEN 的处置、再执行。
        judgment.conclude(Verdict.PASSED, "Excellent karma, enter paradise")
        soul.refresh_from_db()

        assert judgment.is_final
        assert judgment.verdict == Verdict.PASSED
        assert soul.current_state == SoulState.REINCARNATING

        # 5–6. No disposition to execute.
        assert not Disposition.objects.filter(soul=soul).exists()
        disposition = None

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

    def test_full_lifecycle_failed(self, chinese_realms, cn_tenant):
        """Test: Soul with negative karma fails judgment and goes to the deepest hell"""
        soul = Soul.objects.create(
            name="Criminal Wang",
            tenant=cn_tenant,
            merit_score=0,
            demerit_score=100,  # karma = -100 → severity band saturates at 9
        )
        soul.die()
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

        judgment = Judgment.objects.create(
            soul=soul, civilization=soul.civilization, tenant=cn_tenant
        )
        judgment.conclude(Verdict.FAILED, "Murderer, condemned to the Ninth Court")
        soul.refresh_from_db()

        assert soul.current_state == SoulState.DISPOSED
        disposition = Disposition.objects.filter(soul=soul).first()
        assert disposition is not None
        assert disposition.destination_realm is not None
        # karma=-100: band = min(9, max(2, abs(-100)//10 + 1)) = min(9, 11) = 9
        assert disposition.destination_realm.realm_code == "DY_COURT_09_PINGDENG"

    def test_invalid_transitions(self, cn_tenant):
        """Test: Cannot die twice, cannot skip states"""
        soul = Soul.objects.create(name="Test", tenant=cn_tenant)
        soul.die()
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

        # Cannot die twice
        assert not soul.die()

        # Cannot skip: JUDGING -> REINCARNATING directly
        assert not soul.can_transition_to(SoulState.REINCARNATING)

        # Cannot skip: JUDGING -> ALIVE
        assert not soul.can_transition_to(SoulState.ALIVE)
