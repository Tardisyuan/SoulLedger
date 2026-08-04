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

from apps.disposition.services import DispositionService
from apps.judgment.models import JudgmentMethod, Verdict


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

    def test_purgatory_and_retry_use_karma_threshold(self):
        """Unlike Chinese/European, an inconclusive Egyptian verdict is
        doctrinally resolved by the karma threshold (a real "heart balanced
        against the feather" tie), so this band is intentional and is left
        unchanged — only its reachability from FAILED was the bug."""
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
                self.assertEqual(
                    DispositionService._route_egyptian(
                        None, verdict, JudgmentMethod.STANDARD, -50
                    ),
                    DispositionService.EG_DEVOURER,
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
