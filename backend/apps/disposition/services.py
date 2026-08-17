"""
Disposition service — creates disposition from judgment verdict.
Routes to the correct realm based on civilization and verdict.
"""
from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, JudgmentMethod, Verdict
from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS, LedgerService
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

    # The eight *punishment* courts, keyed by severity band. The ten courts are
    # a procedural sequence, not a severity ladder, and two of them administer
    # no punishment at all: the first reads the Ledger of Life and Death and
    # opens the case, the tenth assigns the next life. Sentencing a soul to
    # either is not a milder or harsher outcome, it is a category error — so
    # the band is clamped to 2..9 and those two courts are deliberately absent
    # from this map. Court 9 (阿鼻地狱) is the deepest hell and therefore the
    # ceiling; it is not the tenth court's job to be the worst.
    #
    # The keys are a severity band, *not* the realm's `tier` column, even
    # though both now run 1..10 over the same rows. Those were the same number
    # before this map was rewritten, which is part of how a realm called
    # "第十殿 / Tenth Court Yama" ended up holding the fifth court's king: tier
    # was doing duty as a karma bucket and as a court number simultaneously,
    # and whichever meaning you read it with, some other file disagreed. `tier`
    # is the court number now and nothing else; the bucket lives here.
    CHINESE_HELL_MIN_TIER = 2
    CHINESE_HELL_MAX_TIER = 9
    CHINESE_HELL_TIERS = {
        2: "DY_COURT_02_CHUJIANG",
        3: "DY_COURT_03_SONGDI",
        4: "DY_COURT_04_WUGUAN",
        5: "DY_COURT_05_YANLUO",
        6: "DY_COURT_06_BIANCHENG",
        7: "DY_COURT_07_TAISHAN",
        8: "DY_COURT_08_DUSHI",
        9: "DY_COURT_09_PINGDENG",
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
    #
    # EG_ANNIHILATION IS AN OUTCOME, NOT AN ADDRESS. The row used to be
    # modelled as "Ammit's realm" — a hell the failed soul is sent to, with
    # Ammit living in it. Being devoured by Ammit is the second death: the heart
    # is destroyed and the person ceases to exist. There is no damned population
    # and nowhere for it to be, and Ammit stands at the balance in the Hall of
    # Two Truths, which is where seed_mythology seeds her. 79dee57 corrected the
    # row's name and description on 2026-08-15 and deliberately left the code
    # alone, because the string was a live identifier in three places at once
    # and renaming it in any one of them alone would have broken the other two.
    #
    # The rename landed as the coordinated change that note asked for:
    #
    #   1. this constant and `_route_egyptian`'s two return sites,
    #   2. the seed row in apps/actors/mythology/realms.py, plus
    #      realms/0015_rename_devourer_to_annihilation for databases that
    #      already hold the old code — including Reincarnation.target_realm,
    #      which is a CharField and does not follow a rename the way the
    #      Disposition.destination_realm foreign key does,
    #   3. the frontend's annihilation signal, which no longer hard-codes a
    #      string at all: it reads ANNIHILATION_REALM_CODE from
    #      frontend/src/lib/realmCodes.ts.
    #
    # tests/test_annihilation_realm_code.py compares this constant against that
    # TypeScript module, so the next rename cannot land on one side only.
    EG_AARU = "EG_AARU"           # Paradise (passed)
    EG_ANNIHILATION = "EG_ANNIHILATION"  # Annihilation (failed) — see above
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
            # 「功過有不可折者」 reaches the router here, and only here.
            #
            # `karma` is merit minus demerit over one undifferentiated pool, so
            # a hundred hundred-cash alms cancel a killing in it exactly. That
            # arithmetic is still what `karmic_balance` means everywhere else in
            # this system (it is a column expression that querysets sort and
            # filter on — see apps/souls/querysets.py), so it is not redefined;
            # what changes is which number sentences a Chinese soul.
            #
            # Computed only for FAILED, because that is the only branch that
            # consumes a severity figure and computing one walks the soul's
            # whole record set. A PASSED soul goes to heaven regardless and a
            # PURGATORY/RETRY soul waits regardless; neither should pay for a
            # ledger read to be told so.
            unoffset_demerit = (
                LedgerService.get_unoffset_demerit(soul)
                if verdict == Verdict.FAILED
                else None
            )
            return cls._route_chinese(soul, verdict, karma, unoffset_demerit)
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
    def _route_chinese(
        cls,
        soul: Soul,
        verdict: str,
        karma: int,
        unoffset_demerit: float | None = None,
    ) -> str:
        """
        Route Chinese soul based on verdict and severity.

        `unoffset_demerit` is the fault left standing once merit has been netted
        off *within* its own class — 「功過有不可折者。如用財之百功，不可折致死
        人之百過。」 (《文昌帝君功過格·凡例》). When it is given it is the
        severity input; `karma` then decides nothing at all here, and that is
        the change. Under `abs(karma)` a soul who gave a hundred hundred-cash
        alms and killed a man read as a soul at zero and was sentenced to 第二
        殿楚江王, the mildest punishment court — nine courts milder than the same
        killing alone, the difference being a hundred coins. See
        `LedgerService.get_unoffset_demerit`.

        None means no partitioned reading was available (a soul with no scored
        records; or a direct call from a unit test exercising the tier
        arithmetic), and `abs(karma)` is used exactly as before. That fallback
        is a refusal to invent a partition, not a softer rule: see the same
        method for why 0 would have been a claim and None is not.

        The two are never blended and never compared. A ledger is partitioned or
        it is not; taking `max(abs(karma), unoffset_demerit)` would let the
        undifferentiated pool raise a sentence the partition says is unwarranted,
        which is the netting error again with the sign flipped.

        The verdict is the court's authoritative judicial decision; severity is
        only the input used to pick a tier *within* the outcome the verdict
        already determined — so an unoffset killing does not overturn a PASSED
        verdict any more than a positive balance used to overturn a FAILED one.
        This used to be checked as
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
            # formula already floors at the mildest punishment court via
            # max(CHINESE_HELL_MIN_TIER, ...) for any hell-bound soul, so
            # karma == 0 needs no special case — it lands in 第二殿楚江王,
            # which is the correct floor for "guilty, but no recorded
            # severity", not a free pass.
            #
            # That floor is also where a FAILED soul with *only* merit now
            # lands. `abs(karma)` used to send it to the deepest hell for
            # having been generous — abs() reads a magnitude and cannot tell
            # +95 from -95 — and 不可折 severity, being a demerit total, has no
            # sign to lose. A soul with no recorded fault has no recorded
            # severity, which is precisely the case the floor is for.
            severity = abs(karma) if unoffset_demerit is None else unoffset_demerit
            tier = min(
                cls.CHINESE_HELL_MAX_TIER,
                max(cls.CHINESE_HELL_MIN_TIER, int(severity // 10) + 1),
            )
            return cls.CHINESE_HELL_TIERS.get(
                tier, cls.CHINESE_HELL_TIERS[cls.CHINESE_HELL_MAX_TIER]
            )
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

        DELIBERATELY NOT GIVEN THE 不可折 TREATMENT. 「功過有不可折者」 is a limit
        on 功過相抵, and 功過相抵 is a Chinese mechanic; a 1724 Daoist ledger has
        no jurisdiction over Dante's circles, and importing its pool rule here
        would be the flattening apps/ledger/readings.py refuses, arriving from
        the opposite direction. There is a separate and real question about this
        line — readings.py holds that European culpa is not reduced by merit at
        all, which `abs(karma)` (merit minus demerit) plainly does — but the
        answer to it is a European doctrine of guilt, not a Chinese one, and it
        is not this change's to make.
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

        DELIBERATELY NOT GIVEN THE 不可折 TREATMENT, and for a sharper reason
        than the European branch: there is no offsetting step here for a
        non-fungibility rule to constrain. The heart is weighed against the
        feather and merit never goes on the scale at all (see
        `_egyptian_reading`), so partitioning merit into pools it may and may
        not discharge from answers a question this cosmology does not ask.
        `karma >= 50` on the inconclusive branch is a threshold read, not an
        offset, and it is left exactly as it was.
        """
        if judgment_method == JudgmentMethod.HEART_WEIGHING:
            if verdict == Verdict.PASSED:
                # Heart lighter than Ma'at's feather → paradise
                return cls.EG_AARU
            elif verdict == Verdict.FAILED:
                # Heart heavier than feather → Ammit devours
                return cls.EG_ANNIHILATION
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
                return cls.EG_ANNIHILATION
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
