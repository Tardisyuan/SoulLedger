"""
Disposition service — creates disposition from judgment verdict.
Routes to the correct realm based on civilization and verdict.
"""
from apps.judgment.models import Judgment, JudgmentMethod, Verdict
from apps.disposition.models import Disposition
from apps.realms.models import Realm, RealmType
from apps.souls.models import Soul, Civilization


class DispositionService:
    """
    Handles disposition creation and execution.
    Routes to civilization-specific realms based on verdict.
    """

    # -------------------------------------------------------------------------
    # Realm routing maps (realm_code lookups)
    # -------------------------------------------------------------------------

    # Chinese realms
    CHINESE_PURGATORY = "DY_00_PURGATORY"
    CHINESE_HEAVEN = "DY_01_HEAVEN"
    CHINESE_HELL_TIERS = {
        3: "DY_03_QISHI",
        4: "DY_04_TAISHAN",
        5: "DY_05_CITY",
        6: "DY_06_ZHUAN",
        7: "DY_07_JIAN",
        8: "DY_08_HAN",
        9: "DY_09_YANG",
        10: "DY_10_YAMA",
    }

    # European realms
    EU_HEAVEN = "EU_HEAVEN"
    EU_PURGATORY = "EU_PURGATORY"
    EU_HELL_CIRCLES = {
        1: "EU_HELL_1ST",   # Limbo
        2: "EU_HELL_2ND",   # Lust
        3: "EU_HELL_3RD",   # Gluttony
        4: "EU_HELL_4TH",   # Greed
        5: "EU_HELL_5TH",   # Anger
        6: "EU_HELL_6TH",   # Heresy
        7: "EU_HELL_7TH",   # Violence
        8: "EU_HELL_8TH",   # Malebolge (fraud)
        9: "EU_HELL_9TH",   # Treachery (Judas/Brutus)
    }

    # Egyptian realms
    EG_AARU = "EG_AARU"           # Paradise (passed)
    EG_DEVOURER = "EG_DEVOURER"   # Ammit's realm (failed)
    EG_DUAT_ENTRY = "EG_DUAT_ENTRY"  # Entry/purgatory

    @classmethod
    def create_from_judgment(cls, judgment: Judgment) -> Disposition:
        """
        Create a disposition based on judgment verdict and civilization.
        Routes to the correct realm using civilization-specific rules.
        """
        soul = judgment.soul
        verdict = judgment.verdict
        civilization = soul.civilization

        realm_code = cls._route_to_realm(soul, verdict, judgment.judgment_method)
        realm = Realm.objects.filter(realm_code=realm_code).first()

        disposition = Disposition.objects.create(
            soul=soul,
            judgment=judgment,
            destination_realm=realm,
            is_eternal=(realm.is_eternal if realm else False),
            notes=f"Auto-created from {civilization} judgment {judgment.id}",
        )

        from apps.events.services import log_disposition_created
        log_disposition_created(disposition)

        return disposition

    @classmethod
    def _route_to_realm(
        cls,
        soul: Soul,
        verdict: str,
        judgment_method: str = JudgmentMethod.STANDARD,
    ) -> str:
        """
        Route a soul to the correct realm based on civilization, verdict,
        karma balance, and judgment method.
        """
        civilization = soul.civilization
        karma = soul.karmic_balance

        if civilization == Civilization.CHINESE:
            return cls._route_chinese(soul, verdict, karma)
        elif civilization == Civilization.EUROPEAN:
            return cls._route_european(soul, verdict, karma)
        elif civilization == Civilization.EGYPTIAN:
            return cls._route_egyptian(soul, verdict, judgment_method, karma)
        else:
            # Fallback: purgatory
            return cls.CHINESE_PURGATORY

    @classmethod
    def _route_chinese(cls, soul: Soul, verdict: str, karma: int) -> str:
        """Route Chinese soul based on verdict and karma."""
        if verdict == Verdict.PASSED or karma >= 0:
            return cls.CHINESE_HEAVEN
        if verdict == Verdict.PURGATORY:
            return cls.CHINESE_PURGATORY
        if verdict == Verdict.RETRY:
            return cls.CHINESE_PURGATORY
        # FAILED: determine hell tier by severity
        # karma is negative; abs(karma) / 10 → tier 3-10
        tier = min(10, max(3, (abs(karma) // 10) + 1))
        return cls.CHINESE_HELL_TIERS.get(tier, cls.CHINESE_HELL_TIERS[10])

    @classmethod
    def _route_european(cls, soul: Soul, verdict: str, karma: int) -> str:
        """Route European soul based on verdict and karma (Dante's Inferno circles)."""
        if verdict == Verdict.PASSED or karma >= 0:
            return cls.EU_HEAVEN
        if verdict == Verdict.PURGATORY:
            return cls.EU_PURGATORY
        if verdict == Verdict.RETRY:
            return cls.EU_PURGATORY
        # FAILED: determine circle by severity
        # abs(karma) / 15 → circle 1-9 (Dante's structure: outer circles = less severe)
        circle = min(9, max(1, (abs(karma) // 15) + 1))
        return cls.EU_HELL_CIRCLES.get(circle, cls.EU_HELL_CIRCLES[9])

    @classmethod
    def _route_egyptian(
        cls,
        soul: Soul,
        verdict: str,
        judgment_method: str,
        karma: int,
    ) -> str:
        """
        Route Egyptian soul.
        - HEART_WEIGHING: verdict already encodes heart weighing result
          (PASSED = heart lighter than feather = paradise,
           FAILED = heart heavier = Ammit destroys)
          PURGATORY = inconclusive, wait in Duat
        - STANDARD: fall back to karma-based routing
        """
        if judgment_method == JudgmentMethod.HEART_WEIGHING:
            if verdict == Verdict.PASSED:
                # Heart lighter than Ma'at's feather → paradise
                return cls.EG_AARU
            elif verdict == Verdict.FAILED:
                # Heart heavier than feather → Ammit devours
                return cls.EG_DEVOURER
            else:
                # PURGATORY/RETRY: soul waits in Duat entry
                return cls.EG_DUAT_ENTRY
        else:
            # STANDARD judgment for Egyptian souls: use karma
            if verdict == Verdict.PASSED or karma >= 50:
                return cls.EG_AARU
            if verdict == Verdict.PURGATORY or -50 < karma < 50:
                return cls.EG_DUAT_ENTRY
            return cls.EG_DEVOURER

    @staticmethod
    def execute(disposition: Disposition) -> bool:
        """
        Mark disposition as executed, trigger reincarnation.
        """
        from django.utils import timezone
        from apps.souls.models import SoulState

        disposition.is_executed = True
        disposition.executed_at = timezone.now()
        disposition.save()

        disposition.soul.transition_to(SoulState.REINCARNATING, "Disposition executed")
        return True
