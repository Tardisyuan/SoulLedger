"""
Tests for disposition app — verdict/karma routing rules.

Focus: verdict is the authoritative judicial decision and must take
precedence over karma. Regression coverage for the bug where
`verdict == PASSED or karma >= 0` (and the Egyptian equivalent) let a
nonnegative/tied karmic balance override an explicit non-PASSED verdict,
most notably sending FAILED souls to heaven whenever karma had decayed
to zero.
"""
from django.test import TestCase

from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.judgment.models import JudgmentMethod, Verdict
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import Tenant


class ChineseRoutingTest(TestCase):
    """Matrix: every Verdict value crossed with negative/zero/positive karma."""

    def test_passed_always_heaven_regardless_of_karma(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_chinese(None, Verdict.PASSED, karma),
                    DispositionService.CHINESE_HEAVEN,
                )

    def test_failed_never_routes_to_heaven(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                realm = DispositionService._route_chinese(None, Verdict.FAILED, karma)
                self.assertNotEqual(realm, DispositionService.CHINESE_HEAVEN)
                self.assertIn(realm, DispositionService.CHINESE_HELL_TIERS.values())

    def test_failed_with_zero_karma_is_regression_case(self):
        """The bug: karmic_balance decays to 0 for ancient souls, which used
        to send an explicit FAILED verdict to heaven. It must land in the
        mildest hell tier (tier 3) instead."""
        realm = DispositionService._route_chinese(None, Verdict.FAILED, 0)
        self.assertEqual(realm, DispositionService.CHINESE_HELL_TIERS[3])

    def test_failed_severity_scales_with_negative_karma(self):
        self.assertEqual(
            DispositionService._route_chinese(None, Verdict.FAILED, -25),
            DispositionService.CHINESE_HELL_TIERS[3],
        )
        self.assertEqual(
            DispositionService._route_chinese(None, Verdict.FAILED, -95),
            DispositionService.CHINESE_HELL_TIERS[10],
        )
        # Severity is driven by magnitude, not sign — a FAILED verdict with
        # positive karma still gets tiered by abs(karma), it just can never
        # escape to heaven.
        self.assertEqual(
            DispositionService._route_chinese(None, Verdict.FAILED, 95),
            DispositionService.CHINESE_HELL_TIERS[10],
        )

    def test_purgatory_verdict_never_routes_to_heaven(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_chinese(None, Verdict.PURGATORY, karma),
                    DispositionService.CHINESE_PURGATORY,
                )

    def test_retry_verdict_never_routes_to_heaven(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_chinese(None, Verdict.RETRY, karma),
                    DispositionService.CHINESE_PURGATORY,
                )


class EuropeanRoutingTest(TestCase):
    """Matrix: every Verdict value crossed with negative/zero/positive karma."""

    def test_passed_always_heaven_regardless_of_karma(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_european(None, Verdict.PASSED, karma),
                    DispositionService.EU_HEAVEN,
                )

    def test_failed_never_routes_to_heaven(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                realm = DispositionService._route_european(None, Verdict.FAILED, karma)
                self.assertNotEqual(realm, DispositionService.EU_HEAVEN)
                self.assertIn(realm, DispositionService.EU_HELL_CIRCLES.values())

    def test_failed_with_zero_karma_is_regression_case(self):
        """Same regression as Chinese routing: decayed karma == 0 must not
        send a FAILED verdict to heaven. Lands in the outermost circle."""
        realm = DispositionService._route_european(None, Verdict.FAILED, 0)
        self.assertEqual(realm, DispositionService.EU_HELL_CIRCLES[1])

    def test_failed_severity_scales_with_negative_karma(self):
        self.assertEqual(
            DispositionService._route_european(None, Verdict.FAILED, -30),
            DispositionService.EU_HELL_CIRCLES[3],
        )
        self.assertEqual(
            DispositionService._route_european(None, Verdict.FAILED, -200),
            DispositionService.EU_HELL_CIRCLES[9],
        )

    def test_purgatory_verdict_never_routes_to_heaven(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_european(None, Verdict.PURGATORY, karma),
                    DispositionService.EU_PURGATORY,
                )

    def test_retry_verdict_never_routes_to_heaven(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_european(None, Verdict.RETRY, karma),
                    DispositionService.EU_PURGATORY,
                )


class EgyptianStandardRoutingTest(TestCase):
    """
    STANDARD (non heart-weighing) Egyptian routing has the analogous
    precedence bug: `verdict == PASSED or karma >= 50` and
    `verdict == PURGATORY or -50 < karma < 50` let karma override an
    explicit FAILED verdict, parking condemned souls in EG_DUAT_ENTRY
    instead of EG_DEVOURER whenever karma landed in the tie band.
    """

    def test_passed_always_aaru_regardless_of_karma(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, Verdict.PASSED, JudgmentMethod.STANDARD, karma
                    ),
                    DispositionService.EG_AARU,
                )

    def test_failed_never_routes_to_aaru_or_duat(self):
        """The regression: FAILED with karma == 0 used to fall into the
        -50 < karma < 50 tie band and get parked in Duat indefinitely."""
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, Verdict.FAILED, JudgmentMethod.STANDARD, karma
                    ),
                    DispositionService.EG_DEVOURER,
                )

    def test_inconclusive_verdict_never_reaches_the_devourer(self):
        """An undecided judgment must not annihilate a soul, however heavy
        its heart reads. Being devoured by Ammit is the second death; there
        is no appeal from it and nothing left to appeal for, so it may only
        follow a verdict that has actually concluded."""
        for verdict in (Verdict.PURGATORY, Verdict.RETRY):
            for karma in (-50, -100, -1000):
                with self.subTest(verdict=verdict, karma=karma):
                    self.assertEqual(
                        DispositionService._route_egyptian(
                            None, verdict, JudgmentMethod.STANDARD, karma
                        ),
                        DispositionService.EG_DUAT_ENTRY,
                    )

    def test_purgatory_and_retry_still_admit_on_a_light_heart(self):
        """The positive side stays asymmetric on purpose: Egyptian judgment
        is a threshold, so a decisively light heart is the weighing speaking
        rather than an arithmetic tie-break, and admission is final without
        being annihilating. See _route_egyptian for the reasoning."""
        for verdict in (Verdict.PURGATORY, Verdict.RETRY):
            with self.subTest(verdict=verdict):
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, verdict, JudgmentMethod.STANDARD, 50
                    ),
                    DispositionService.EG_AARU,
                )
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, verdict, JudgmentMethod.STANDARD, 0
                    ),
                    DispositionService.EG_DUAT_ENTRY,
                )


class EgyptianHeartWeighingRoutingTest(TestCase):
    """HEART_WEIGHING routing is verdict-only and was never karma-driven;
    covered here for completeness alongside the STANDARD fix above."""

    def test_heart_weighing_ignores_karma(self):
        for karma in (-100, 0, 100):
            with self.subTest(karma=karma):
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, Verdict.PASSED, JudgmentMethod.HEART_WEIGHING, karma
                    ),
                    DispositionService.EG_AARU,
                )
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, Verdict.FAILED, JudgmentMethod.HEART_WEIGHING, karma
                    ),
                    DispositionService.EG_DEVOURER,
                )
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, Verdict.PURGATORY, JudgmentMethod.HEART_WEIGHING, karma
                    ),
                    DispositionService.EG_DUAT_ENTRY,
                )


class ExecuteTerminalStateTest(TestCase):
    """Executing a disposition must not claim a rebirth the cosmology lacks.

    `execute` used to send every soul to REINCARNATING. For the two terminal
    cosmologies that was a label describing an afterlife the soul was never
    going to have — the rebirth was already blocked downstream, so the state
    was the only thing saying otherwise.
    """

    @classmethod
    def setUpTestData(cls):
        cls.tenants = {
            Civilization.CHINESE: Tenant.objects.create(
                code="CN_DIYU", display_name="Chinese Diyu"
            ),
            Civilization.EUROPEAN: Tenant.objects.create(
                code="EU_HEAVEN_HELL", display_name="European Heaven/Hell"
            ),
            Civilization.EGYPTIAN: Tenant.objects.create(
                code="EG_DUAT", display_name="Egyptian Duat"
            ),
        }

    def _disposed_soul(self, civilization):
        return Soul.objects.create(
            name=f"{civilization} soul",
            tenant=self.tenants[civilization],
            current_state=SoulState.DISPOSED,
        )

    def _execute_for(self, civilization):
        soul = self._disposed_soul(civilization)
        DispositionService.execute(Disposition.objects.create(soul=soul, tenant=soul.tenant))
        soul.refresh_from_db()
        return soul

    def test_chinese_soul_still_goes_to_reincarnating(self):
        """Diyu is the one cosmology here that has a next life."""
        self.assertEqual(
            self._execute_for(Civilization.CHINESE).current_state,
            SoulState.REINCARNATING,
        )

    def test_terminal_cosmologies_settle_instead_of_reincarnating(self):
        for civilization in (Civilization.EUROPEAN, Civilization.EGYPTIAN):
            with self.subTest(civilization=civilization):
                self.assertEqual(
                    self._execute_for(civilization).current_state,
                    SoulState.SETTLED,
                )

    def test_disposition_is_still_marked_executed_for_terminal_souls(self):
        """The soul's route changed; the disposition bookkeeping did not."""
        soul = self._disposed_soul(Civilization.EGYPTIAN)
        disposition = Disposition.objects.create(soul=soul, tenant=soul.tenant)
        self.assertTrue(DispositionService.execute(disposition))
        disposition.refresh_from_db()
        self.assertTrue(disposition.is_executed)
        self.assertIsNotNone(disposition.executed_at)

    def test_soul_with_no_known_cosmology_does_not_reincarnate(self):
        """An unrecognised tenant code used to resolve to CHINESE and so
        earned the soul a next life. SETTLED is the wrong answer too, strictly
        — we do not know that this soul's cosmology is terminal — but of the
        two available states it is the one that does not hand out an afterlife
        nobody has established. The real fix is configuring the tenant."""
        tenant = Tenant.objects.create(code="GR_HADES_TBD", display_name="Not wired up")
        soul = Soul.objects.create(
            name="Unplaced", tenant=tenant, current_state=SoulState.DISPOSED
        )
        DispositionService.execute(Disposition.objects.create(soul=soul, tenant=tenant))
        soul.refresh_from_db()
        self.assertEqual(soul.current_state, SoulState.SETTLED)


class UnknownCivilizationRoutingTest(TestCase):
    """A soul whose tenant code names no cosmology gets no realm."""

    def test_unknown_civilization_routes_to_no_realm(self):
        tenant = Tenant.objects.create(code="NOT_A_COSMOLOGY", display_name="?")
        soul = Soul.objects.create(name="Unplaced", tenant=tenant)
        for verdict in (Verdict.PASSED, Verdict.FAILED, Verdict.PURGATORY, Verdict.RETRY):
            with self.subTest(verdict=verdict):
                self.assertEqual(DispositionService._route_to_realm(soul, verdict), "")

    def test_unknown_civilization_is_not_filed_into_a_chinese_realm(self):
        """The regression: the fallback used to be CHINESE_PURGATORY, which
        assigned an unplaceable soul to a real place in someone's afterlife."""
        tenant = Tenant.objects.create(code="NOT_A_COSMOLOGY_2", display_name="?")
        soul = Soul.objects.create(name="Unplaced", tenant=tenant)
        self.assertNotEqual(
            DispositionService._route_to_realm(soul, Verdict.PURGATORY),
            DispositionService.CHINESE_PURGATORY,
        )
