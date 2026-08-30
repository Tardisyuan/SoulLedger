"""
Disposition service — creates disposition from judgment verdict.
Routes to the correct realm based on civilization and verdict.
"""
from apps.disposition.models import Disposition, MemoryResetMechanism
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

    #: Points of culpa per circle in `_route_european`'s stopgap depth ladder.
    #: Named rather than inlined so that the tests which pin the ladder as
    #: WRONG can build souls in known bands without hard-coding the arithmetic
    #: they are objecting to. It is a bucket width, not a doctrine: Dante sorts
    #: by kind of sin, not by quantity of it — see `_route_european`.
    EU_HELL_CULPA_BAND = 15

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

    # Greek realms — Plato's fork and the two roads out of it (Gorgias 524a).
    #
    # THERE ARE THREE CODES HERE AND ONLY TWO OF THEM ARE DESTINATIONS. The
    # meadow is the ground the judging happens on, not a place anyone is sent
    # to; see `_route_greek` for why an inconclusive verdict lands there anyway
    # and why that is not a third road. `EU_PLATO_MEADOW` keeps its `EU_` prefix
    # under GREEK on purpose — a realm_code is a join key, not a label (see
    # apps/actors/mythology/realms.py, GREEK_REALMS §CODES).
    GR_MEADOW = "EU_PLATO_MEADOW"
    GR_ISLES = "GR_ISLES_OF_THE_BLESSED"
    GR_TARTARUS = "GR_TARTARUS"

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
                # THE REALM SAYS WHAT HAPPENS TO THE MEMORY, AND UNTIL NOW
                # NOBODY ASKED IT. `is_eternal` was copied off the realm here
                # and `memory_reset_mechanism` was not, so every auto-created
                # disposition took the field's default of NONE — which made
                # 孟婆汤 on twelve Chinese realms, the Egyptian SPELL on five
                # and Dante's LETHE on two into seed data that nothing read.
                # `apps/reincarnation/services.py`'s `if disposition
                # .memory_reset != "NONE"` branch could not fire, so a soul
                # that drank the broth at the tenth court was reborn carrying
                # the description of the life it had just left.
                #
                # A disposition with no realm keeps NONE, which is the same
                # answer as before for the case realms/0018 documents: an
                # unmapped tenant produces `destination_realm=None`, and
                # inventing a mechanism for a destination that does not exist
                # would be worse than the gap this fixes.
                memory_reset=(
                    realm.memory_reset_mechanism if realm
                    else MemoryResetMechanism.NONE
                ),
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
            # `karma` is deliberately not passed. European culpa is the demerit
            # total alone (apps/ledger/readings.py::_european_reading), so the
            # net balance is not merely unused here — handing it over is what
            # let a hundred alms buy a killing down to circle 1.
            return cls._route_european(soul, verdict, soul.demerit_score)
        elif civilization == Civilization.EGYPTIAN:
            return cls._route_egyptian(soul, verdict, judgment_method, karma)
        elif civilization == Civilization.GREEK:
            # No ledger figure is passed, and the omission is the argument. The
            # other three branches each hand their router a number because each
            # of those cosmologies grades an outcome once the verdict has fixed
            # it — a court, a circle, a threshold. Plato's fork has nothing to
            # grade: two roads, no depth. See `_route_greek`.
            return cls._route_greek(soul, verdict)
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
    def _route_european(cls, soul: Soul, verdict: str, culpa: int) -> str:
        """
        Route European soul based on verdict and culpa (Dante's Inferno circles).

        Same precedence rule as `_route_chinese`: verdict is checked first
        and is authoritative, the ledger only selects circle depth once FAILED
        is already established. See `_route_chinese` for why the previous
        `verdict == PASSED or karma >= 0` disjunction was wrong.

        MERIT NO LONGER ENTERS, AND THE DEPTH LADDER IS STILL NOT DANTE'S.
        Those are two separate statements and only the first has been acted on.

        1. What was fixed: `abs(karma)`, merit minus demerit
        ----------------------------------------------------
        The depth used to be read off `abs(karma)`, so a European soul got
        *shallower* — milder — the more good it had done: a hundred alms against
        one killing netted to zero and landed the killer in circle 1. That is
        the trade apps/ledger/readings.py rules out for this cosmology by name:
        「in this cosmology a good deed does not retire a sin, absolution does,
        and letting merit reduce culpa would rebuild the Chinese netting account
        under a Latin name」. `_european_reading` already reports `culpa` as the
        DEMERIT total alone for exactly that reason, and the router now reads
        the same figure off the same column.

        This is NOT the 不可折 treatment 452616f gave `_route_chinese`.
        「功過有不可折者」 is a limit on 功過相抵, 功過相抵 is a Chinese mechanic,
        and a 1724 Daoist ledger has no jurisdiction over Dante's circles;
        `LedgerService.get_unoffset_demerit` still returns None here and is still
        not called. What changed is that European guilt is now read by the
        European rule that readings.py already states — merit is simply not on
        the scale — rather than by a partition borrowed from somebody else.

        `culpa` is supplied by the caller as `soul.demerit_score`, not fetched
        through a ledger walk, because unlike the unoffset figure there is
        nothing to partition: culpa *is* the decayed demerit total, which is the
        column `recalculate_soul_ledger` writes and the rest of the system
        displays. There is therefore no "no partition available" case, no None
        to fall back from — and no fallback that could quietly readmit merit.
        It is a parameter rather than a lookup for the reason `_route_chinese`
        takes its severity as one: the arithmetic stays unit-testable without a
        database.

        2. What was NOT fixed: sorting nine circles by magnitude at all
        ---------------------------------------------------------------
        Dante does not layer Hell by how much wrong was done. He layers it by
        WHAT KIND, and says so outright — Virgil, Inf. XI.79-84, citing the
        Ethics: 「Incontinence, and Malice, and insane Bestiality」 (Longfellow
        1867, Project Gutenberg #1001). Incontinenza fills circles 2-5, malizia
        (violence and fraud) and matta bestialitade (treachery) fill 6-9 inside
        the walls of Dis, and that wall is the only real divider in the poem.
        docs/lore-verification/verify-christian-structure.md §2, §3.1, §6.

        So `culpa // 15` is the wrong SHAPE, not merely the wrong input. Under
        it a fraud and a murder of equal weight go to the same circle, which
        Inf. XI puts on opposite sides of Dis; and circle 1, the floor this
        arithmetic lands a nearly-blameless soul in, is Limbo — the virtuous
        pagans and unbaptized infants, who are there for want of baptism and not
        as a light sentence (Inf. IV).

        3. Why it is not fixed here: the classification does not exist
        --------------------------------------------------------------
        Routing by kind needs to know what kind, and nothing in this system
        records it:

          * `Soul` carries `merit_score` and `demerit_score` and no other moral
            field.
          * `SoulRecord.category` (RecordCategory) is the closest thing, and it
            is a Chinese vocabulary — apps/ledger/fungibility.py maps each
            member onto a 功過格 gate. It has no member for lust, gluttony,
            wrath, heresy or treachery, which is five of the nine circles; and
            treachery is not a deed type at all but a relationship of trust
            betrayed (kin / country / guest / benefactor, Inf. XXXII-XXXIV),
            which no field records.
          * `Judgment` records `evidence_json`, `confession` and `notes`, all
            free-form, plus `JudgmentCitation` to a `Statute`.
          * The only European corpus is DEADLY_SIN — the seven capital sins,
            EU-DS-T1..T7. Those are PURGATORIO terraces. Every article carries
            NOT_A_CIRCLE_NOTE saying so, the `dante_circle` payload key that an
            earlier version invented was withdrawn in 8308204 as a coordinate
            the poem does not have, and pride, envy and sloth get no circle at
            all. Citing a terrace article says nothing about a circle.

        Inventing the missing classification is the one repair that is certainly
        wrong; docs/lore-verification/README.md §1 says so about this exact
        material, and 8308204 is what happened the last time it was tried.

        So this method sentences on culpa, states that the ladder is a stopgap,
        and does not manufacture a taxonomy to replace it.
        `tests/test_european_hell_basis.py` pins both halves: the merit fix, and
        the contradiction that remains — whoever supplies real sin
        classification has to delete those assertions on purpose.
        """
        if verdict == Verdict.PASSED:
            return cls.EU_HEAVEN
        if verdict == Verdict.FAILED:
            # BY KIND WHERE THE KIND IS RECORDED, BY THE LADDER WHERE IT IS NOT.
            #
            # `SoulRecord.inferno_article` cites the seeded EU-INF-* corpus,
            # which carries each article's circle. A soul with any classified
            # deed is sorted by the GRAVEST circle its deeds cite, and that word
            # is the poem's own arithmetic rather than a threshold invented
            # here: Inf. XI.22-27 has fraud graver than violence "because it is
            # a fault peculiar to man", and the order of the nine is the order
            # of the descent. A soul who both killed and swindled is a swindler
            # as far as the eighth circle is concerned.
            #
            # NOT a total replacement, deliberately. Every row written before
            # souls/0029 is unclassified and falls through to the ladder below,
            # exactly as before. Inferring a circle from `RecordCategory`
            # instead would be the mapping the EU-INF corpus exists to avoid —
            # that vocabulary is Chinese, mapped onto 功過格 gates, with no
            # member for five of the nine circles.
            deepest = cls._deepest_cited_circle(soul)
            if deepest is not None:
                return cls.EU_HELL_CIRCLES[deepest]

            # culpa / 15 → circle 1-9. A stopgap ladder on the right number,
            # not Dante's basis; see §2 and §3 above. culpa is a demerit total
            # and so is never negative — there is no magnitude to take and no
            # sign to lose, which is why there is no abs() here any more.
            circle = min(9, max(1, (culpa // cls.EU_HELL_CULPA_BAND) + 1))
            return cls.EU_HELL_CIRCLES.get(circle, cls.EU_HELL_CIRCLES[9])
        # PURGATORY and RETRY: inconclusive verdict, soul waits regardless
        # of what the ledger says.
        return cls.EU_PURGATORY

    @classmethod
    def _deepest_cited_circle(cls, soul: Soul) -> int | None:
        """The lowest circle any of this soul's DEMERIT deeds cites, or None.

        Reads the circle off the cited Statute's payload rather than parsing it
        out of the code. `EU-INF-C8-B2` looks like it says 8, and it does — but
        a parser that believed the string would be a second reader of a fact the
        corpus already states, and the two would be free to disagree the first
        time a code is renamed. `apps/actors/mythology/statutes_inferno.py`
        writes `circle` into `payload_json` for exactly this.

        MERIT RECORDS ARE NOT CONSULTED. Dante's circles hold the damned;
        `apps/ledger/readings.py` already rules for this cosmology that a good
        deed does not retire a sin, and letting a cited merit pull a soul upward
        would be that netting under another name.

        LIMBO AND HERESY ARE NOT REACHABLE HERE, which is not an oversight —
        their articles carry `aristotle: None` because Virgil's tripartition at
        Inf. XI gives them no heading. They are facts about a person, not about
        a deed; see `Soul.baptism` and `Soul.denied_immortality`. A record
        citing either is refused on write, so this never has to decide what to
        do with one.
        """
        from apps.judgment.models import Statute

        # `_route_european` is called with soul=None by callers that have a
        # culpa figure and no row — apps/disposition/tests.py does it directly
        # to exercise the ladder at chosen totals. Found by that suite going
        # red, not by reading: a soul is where the citations live, so no soul
        # is no citation and the ladder answers, which is what those callers
        # were already asking for.
        if soul is None:
            return None

        codes = [
            code
            for code in soul.records.filter(record_type="DEMERIT").values_list(
                "inferno_article", flat=True
            )
            if code
        ]
        if not codes:
            return None
        circles = [
            circle
            for circle in Statute.all_objects.filter(code__in=codes).values_list(
                "payload_json__circle", flat=True
            )
            if isinstance(circle, int)
        ]
        return max(circles) if circles else None

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

    @classmethod
    def _route_greek(cls, soul: Soul, verdict: str) -> str:
        """Route a Greek soul. Two roads out of one meadow, and nothing to grade.

        THE SOURCE IS ONE SENTENCE AND IT NAMES ALL THREE PLACES. Plato,
        Gorgias 524a: the dead are judged 「in the meadow at the dividing of the
        road, whence are the two ways leading, one to the Isles of the Blest,
        and the other to Tartarus」. That is the whole geography this method
        has, and it is the whole geography it is allowed to have — the two
        destination rows exist in `GREEK_REALMS` *because* that sentence names
        them.

        The map has since gained one row this passage does not name —
        `GR_ACHERON`, the crossing, from Aeneid 6 — and that changes nothing
        here: a crossing is passed through before the judging and no verdict
        sends a soul to it, so it is not a `_route_greek` outcome and must not
        become one. See the basis note at the top of `GREEK_REALMS`, which
        divides the two texts by what each is asked for: Plato supplies the
        judgment this method performs, Virgil the ground it happens on.

        WHY THERE IS NO SEVERITY INPUT. `_route_chinese` takes an unoffset
        demerit figure and `_route_european` takes culpa because both
        cosmologies grade an outcome the verdict has already fixed: ten courts,
        nine circles. Plato's fork has no such dimension. A road is not deep,
        and 524a does not say the greatly unjust go further along it than the
        slightly unjust — it says which way each is sent. So this method reads
        the verdict and nothing else, and the two ladders next door are
        deliberately not borrowed:

          * NOT the European circles. Depth is Dante's structure, arrived at
            through Inf. XI's kinds of sin; `_route_european` §2 already records
            that even *that* ladder is the wrong shape for its own poem.
            Copying it here would import a stopgap as a doctrine.
          * NOT the Chinese pool. `apps/ledger/readings.py` refuses 功過相抵 for
            this cosmology by name: Republic X 615b requites good-doing on its
            own road and in its own measure, never as a subtraction from the
            term owed on the other, and netting the two 「would rebuild the
            Chinese account under a Greek name」.
            `LedgerService.get_unoffset_demerit` returns None for a Greek soul
            and is not called here.

        WHERE AN INCONCLUSIVE VERDICT GOES, AND WHY THAT IS NOT A THIRD ROAD.
        524a is a single sorting at a fork; it has no 「pending」 outcome,
        because nothing in it is pending — the judges try the case and the soul
        takes one road or the other. `Verdict` has four members and two of them
        (PURGATORY, RETRY) say the outcome is not fixed yet, so this system can
        hold a state the passage does not describe. It is answered by naming
        the one place in 524a that is *not* a destination: the meadow itself.
        A soul whose verdict is unfinished has not been sent anywhere; it is
        still standing where the judging happens. That is a statement about the
        absence of a sorting, not the invention of a third outcome, and it is
        why `GR_MEADOW` must never appear beside the other two as an outcome
        anywhere else.

        RETRY in particular has a sourced home there and no home above it.
        Gorgias 524a gives Rhadamanthus the dead of Asia and Aeacus those of
        Europe, and Minos 「the privilege of the final decision」 when those two
        are in doubt — the review happens *at the fork*, and there is nothing
        over Minos to appeal to. `tests/test_workflow_appeal_nodes.py` records
        the same absence from the workflow side.

        THE INCURABLE (ἀνίατοι) ARE NOT ROUTED, BECAUSE THEY CANNOT BE
        IDENTIFIED. Gorgias 525c makes those whose wrongs are incurable
        everlasting examples in Hades, while Republic X 615a-b sentences the
        unjust to a thousand-year circuit and then sends them back to choose a
        new life (617d-620d). The owner's ruling is that both hold: rebirth is
        the norm and the incurable are the exception. Only the norm is
        implemented, and the exception is left unrouted rather than
        approximated, because Plato's criterion is *curability* — whether
        punishment can still benefit the soul — and this system records nothing
        that bears on it. `Soul` carries `merit_score` and `demerit_score` and
        no other moral field; `RecordCategory` is a 功過格 vocabulary (see
        apps/ledger/fungibility.py) with no member for incorrigibility;
        `Judgment` has free-form notes and a citation to a `Statute`. There is
        no number here that means 「beyond help」, and manufacturing one — a
        demerit threshold, a record count — would be inventing the classifier,
        which is the one repair `docs/lore-verification/README.md` §1 rules out
        for exactly this kind of material. So every FAILED Greek soul takes the
        same road, and how far along it stops is a question this system does not
        answer. `tests/test_greek_sentence_basis.py` pins that as a
        contradiction, the way `tests/test_european_hell_basis.py` pins Dante's.
        """
        if verdict == Verdict.PASSED:
            return cls.GR_ISLES
        if verdict == Verdict.FAILED:
            # Tartarus for everyone the judges send left, with no attempt to
            # tell the curable from the incurable — see the docstring. The
            # realm's `is_eternal` is False, which now carries Republic X's
            # term-served norm rather than merely declining to assert
            # perpetuity; the exception 525c states has no column to live in.
            return cls.GR_TARTARUS
        # PURGATORY and RETRY: no road taken yet, so the soul is still on the
        # ground the judging happens on. Not a third destination.
        return cls.GR_MEADOW

    @staticmethod
    def execute(disposition: Disposition) -> bool:
        """
        Mark disposition as executed and move the soul to whatever comes after
        its realm — a next life, or nothing at all.

        Returns False, and writes nothing, when the soul cannot make that move.

        WHAT THIS USED TO DO. `is_executed`/`executed_at` were written and
        saved **first**, the two `transition_to` calls below had their return
        values dropped on the floor, and the method ended in a bare
        `return True`. There was no `atomic()`, so the disposition row was
        already committed by the time the transition was refused. Measured:

            an ALIVE soul + a Disposition
            execute(d) -> True
            d.is_executed = True, d.executed_at set
            soul.current_state = ALIVE      <- the edge does not exist

        **The disposition record said "executed" and the soul was never
        disposed of.** The caller got 200. Nothing downstream could tell the
        difference, because the only thing that recorded the outcome was the
        flag that had been written before the outcome was known.

        The order is now: decide, then record. The whole method is atomic so a
        refusal cannot leave the flag behind.
        """
        from django.db import transaction
        from django.utils import timezone

        from apps.souls.models import SoulState

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
        # rebirth gate disagreeing about the same soul. GREEK was that one
        # line: Plato's souls do choose a new life at the Spindle of Necessity
        # (Republic X, 617d-620d), so a Greek soul leaves an executed
        # disposition REINCARNATING and this method needed no Greek branch to
        # make that happen.
        soul = disposition.soul
        with transaction.atomic():
            if soul.civilization in REBIRTH_CAPABLE_CIVILIZATIONS:
                moved = soul.transition_to(
                    SoulState.REINCARNATING, "Disposition executed"
                )
            else:
                moved = soul.transition_to(
                    SoulState.SETTLED,
                    "Disposition executed; this cosmology has no next life",
                )
            if not moved:
                # The soul is not in a state this disposition can act on. Say so
                # instead of recording an execution that did not happen.
                return False

            disposition.is_executed = True
            disposition.executed_at = timezone.now()
            disposition.save()
        return True
