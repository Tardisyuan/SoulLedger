"""
Disposition service — creates disposition from judgment verdict.
Routes to the correct realm based on civilization and verdict.
"""
from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, JudgmentMethod, Verdict
from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
from apps.realms.models import Realm
from apps.souls.models import Civilization, Soul


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
        from django.db import transaction

        soul = judgment.soul
        verdict = judgment.verdict
        civilization = soul.civilization

        realm_code = cls._route_to_realm(soul, verdict, judgment.judgment_method)
        realm = Realm.objects.filter(realm_code=realm_code).first()

        with transaction.atomic():
            disposition = Disposition.objects.create(
                soul=soul,
                judgment=judgment,
                destination_realm=realm,
                is_eternal=(realm.is_eternal if realm else False),
                notes=f"Auto-created from {civilization} judgment {judgment.id}",
                tenant=soul.tenant,
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
            # No cosmology, so no realm. This branch is reached when the
            # soul's tenant code is not in TENANT_CIVILIZATION — see
            # UNKNOWN_CIVILIZATION in apps/souls/models.py.
            #
            # It used to return CHINESE_PURGATORY, which was the same mistake
            # the civilization fallback itself was making, one layer down: a
            # soul nobody could place was quietly filed into a Chinese realm.
            # Diyu's purgatory is a specific place in a specific afterlife,
            # not a waiting room for administrative errors, and a soul put
            # there is not "pending" — it has been assigned somewhere, and the
            # record will read as if that were deliberate.
            #
            # An empty realm code matches no Realm, so the disposition is
            # created with destination_realm=None. That record is visibly
            # incomplete, which is what it is: the judgment happened, and
            # where the soul goes is not answerable until someone configures
            # the tenant.
            return ""

    @classmethod
    def _route_chinese(cls, soul: Soul, verdict: str, karma: int) -> str:
        """
        Route Chinese soul based on verdict and karma.

        The verdict is the court's authoritative judicial decision; karma is
        only the severity input used to pick a tier *within* the outcome the
        verdict already determined. This used to be checked as
        `verdict == PASSED or karma >= 0`, a disjunction that let a
        nonnegative karmic balance send a FAILED/PURGATORY/RETRY soul to
        heaven anyway. Because merit and demerit both decay toward zero for
        old souls, karmic_balance == 0 for every sufficiently ancient soul
        regardless of what it actually did in life — so a soul a court had
        explicitly condemned was being routed to heaven purely because its
        karma had decayed away to a tie. An explicit verdict must never be
        overridden by an arithmetic tie, so verdict is checked first, not
        disjunctively with karma.
        """
        if verdict == Verdict.PASSED:
            # PASSED is final and authoritative — heaven regardless of karma.
            return cls.CHINESE_HEAVEN
        if verdict == Verdict.FAILED:
            # FAILED is final and authoritative too — hell, regardless of
            # karma's sign. Karma only picks *how bad*: a FAILED soul with
            # karma == 0 still goes to hell, not purgatory. Purgatory is
            # reserved below for verdicts that are themselves inconclusive
            # (PURGATORY/RETRY); this soul's guilt is not inconclusive, so
            # conflating the two would blur a real distinction. The tier
            # formula already floors at tier 3 via max(3, ...) for any
            # hell-bound soul, so karma == 0 needs no special case — it
            # lands at the mildest hell tier, which is the correct floor
            # for "guilty, but no recorded severity", not a free pass.
            tier = min(10, max(3, (abs(karma) // 10) + 1))
            return cls.CHINESE_HELL_TIERS.get(tier, cls.CHINESE_HELL_TIERS[10])
        # PURGATORY and RETRY are themselves non-final/inconclusive verdicts
        # — the soul waits, regardless of what karma says. A nonnegative
        # karma balance is not a reason to short-circuit an appeal straight
        # to heaven.
        return cls.CHINESE_PURGATORY

    @classmethod
    def _route_european(cls, soul: Soul, verdict: str, karma: int) -> str:
        """
        Route European soul based on verdict and karma (Dante's Inferno circles).

        Same precedence rule as `_route_chinese`: verdict is checked first
        and is authoritative, karma only selects circle depth once FAILED
        is already established. See `_route_chinese` for why the previous
        `verdict == PASSED or karma >= 0` disjunction was wrong.
        """
        if verdict == Verdict.PASSED:
            return cls.EU_HEAVEN
        if verdict == Verdict.FAILED:
            # abs(karma) / 15 → circle 1-9 (Dante's structure: outer circles
            # are less severe). karma == 0 floors at circle 1, same
            # reasoning as the Chinese tier-3 floor above.
            circle = min(9, max(1, (abs(karma) // 15) + 1))
            return cls.EU_HELL_CIRCLES.get(circle, cls.EU_HELL_CIRCLES[9])
        # PURGATORY and RETRY: inconclusive verdict, soul waits regardless
        # of karma.
        return cls.EU_PURGATORY

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
            # STANDARD judgment for Egyptian souls: same precedence rule as
            # Chinese/European (see `_route_chinese`) — verdict is the
            # court's authoritative decision and is checked first, not
            # disjunctively with karma. The previous
            # `verdict == PASSED or karma >= 50` / `verdict == PURGATORY or
            # -50 < karma < 50` let a decayed-to-zero karma balance override
            # an explicit FAILED verdict: FAILED with karma == 0 fell into
            # the tie band and was parked in EG_DUAT_ENTRY indefinitely
            # instead of going to the Devourer — the same class of bug as
            # the Chinese/European heaven override, just landing in
            # purgatory instead of heaven.
            if verdict == Verdict.PASSED:
                return cls.EG_AARU
            if verdict == Verdict.FAILED:
                return cls.EG_DEVOURER
            # PURGATORY/RETRY: the verdict is inconclusive, so karma must not
            # be allowed to reach for the Devourer. Being eaten by Ammit is
            # the second death — annihilation, with no appeal and nothing left
            # to appeal for — and an undecided judgment has no business
            # triggering it however heavy the heart reads. A soul the court
            # has not finished judging waits in the Duat.
            #
            # The positive side is deliberately not symmetric. A decisive
            # karma reading still admits to Aaru, because Egyptian judgment is
            # a threshold ("not heavier than the feather") rather than a
            # severity score, so a clearly light heart is the weighing itself
            # speaking rather than an arithmetic tie-break. Admission is also
            # not destructive in the way the Devourer is: the asymmetry is
            # between an outcome that is merely final and one that is
            # annihilating, which is the same reason the rest of this codebase
            # treats irreversible operations as needing a higher bar.
            if karma >= 50:
                return cls.EG_AARU
            return cls.EG_DUAT_ENTRY

    @staticmethod
    def execute(disposition: Disposition) -> bool:
        """
        Mark disposition as executed and move the soul to whatever comes after
        its realm — a next life, or nothing at all.
        """
        from django.utils import timezone

        from apps.souls.models import SoulState

        disposition.is_executed = True
        disposition.executed_at = timezone.now()
        disposition.save()

        # Not every soul has a next life to be waiting for. This used to send
        # every executed disposition to REINCARNATING, which put an Egyptian
        # soul admitted to the Field of Reeds in a state that says it is
        # queued for rebirth — an outcome its cosmology does not contain. The
        # rebirth itself was already blocked downstream by
        # `assert_rebirth_capable`, so nothing was ever actually reborn out of
        # Aaru; the soul just sat under a label that described someone else's
        # afterlife.
        #
        # The capability question is answered by the same frozenset the ledger
        # gate uses rather than by a second `if civ == CHINESE` here, so that
        # adding a rebirth-capable civilization stays a one-line change in
        # apps/ledger/services.py and cannot leave the state machine and the
        # rebirth gate disagreeing about the same soul. GREEK will need
        # exactly that when it lands — Plato's souls do choose a new life at
        # the Spindle of Necessity.
        soul = disposition.soul
        if soul.civilization in REBIRTH_CAPABLE_CIVILIZATIONS:
            soul.transition_to(SoulState.REINCARNATING, "Disposition executed")
        else:
            soul.transition_to(
                SoulState.SETTLED,
                "Disposition executed; this cosmology has no next life",
            )
        return True
