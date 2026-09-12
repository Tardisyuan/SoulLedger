"""A reborn soul's ledger is the ledger of its current life.

Before this file, `complete_rebirth` wrote the carried-over 20% into
`soul.merit_score` and then the very next `recalculate_soul_ledger` -- which
every `SoulRecord.save()` triggers -- summed *all* of the soul's records,
previous lives included, and wrote the pre-rebirth total straight back over
the inheritance. Measured on the pre-fix tree: 200 -> 40 at rebirth, then
201 after one weight-1 deed in the new life, where 41 is the number the
rebirth just promised. The endpoint summary and the routing helpers read
the same all-lives queryset, so the previous life's deeds also went on
routing the next one.
"""
import pytest

from apps.ledger.services import LedgerService
from apps.reincarnation.services import ReincarnationService
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant


def _tenant():
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]


def _record(soul, record_type, weight, description="deed", event_year=None):
    # First-life deeds are dated at death (event_year=2000) so decay_factor is
    # exactly 1.0; deeds of a living soul carry no event date and measure from
    # recorded_at to today, which is also 0 years. Either way the numbers are exact.
    return SoulRecord.objects.create(
        soul=soul, record_type=record_type, civilization="CHINESE",
        description=description, weight=weight, event_year=event_year,
    )


@pytest.fixture
def reborn_soul(db):
    soul = Soul.objects.create(
        name="Wheel Rider", current_state=SoulState.REINCARNATING,
        death_year=2000, tenant=_tenant(),
    )
    _record(soul, "MERIT", 100, "first half", event_year=2000)
    _record(soul, "MERIT", 100, "second half", event_year=2000)
    _record(soul, "DEMERIT", 30, "a fault", event_year=2000)
    soul.refresh_from_db()
    assert (soul.merit_score, soul.demerit_score) == (200, 30)
    ReincarnationService.complete_rebirth(soul=soul, new_identity="Again")
    soul.refresh_from_db()
    assert (soul.merit_score, soul.demerit_score) == (40, 30)
    return soul


@pytest.mark.django_db
class TestRecalculationKeepsTheInheritance:
    def test_a_new_deed_adds_to_the_inheritance_not_to_the_old_life(self, reborn_soul):
        _record(reborn_soul, "MERIT", 1, "first deed of the new life")
        reborn_soul.refresh_from_db()
        assert reborn_soul.merit_score == 41
        assert reborn_soul.demerit_score == 30

    def test_an_explicit_recalculation_agrees(self, reborn_soul):
        _record(reborn_soul, "MERIT", 1)
        result = LedgerService.recalculate_soul_ledger(reborn_soul)
        assert (result["merit_score"], result["demerit_score"]) == (41, 30)

    def test_the_summary_endpoint_reads_the_same_life(self, reborn_soul):
        """The summary is what the inheritance card shows and what the next
        rebirth inherits from, so it has to see the carry-over and only this
        life's deeds -- not three deeds from a life that ended."""
        LedgerService._invalidate_cache(reborn_soul)
        summary = LedgerService.get_ledger_summary(reborn_soul)
        assert summary["merit_score"] == 40
        assert summary["demerit_score"] == 30
        assert summary["record_count"] == 0
        assert summary["records"] == []

    def test_records_are_stamped_with_the_life_they_belong_to(self, reborn_soul):
        old = list(reborn_soul.records.order_by("recorded_at").values_list("cycle", flat=True))
        assert old == [0, 0, 0]
        new = _record(reborn_soul, "DEMERIT", 5)
        new.refresh_from_db()
        assert new.cycle == 1
        assert reborn_soul.life_index == 1

    def test_routing_does_not_see_the_previous_life(self, reborn_soul):
        """`get_unoffset_demerit` is the Chinese court's routing input. With
        no deeds in this life it has nothing to partition and must say so
        (None), rather than partitioning the deeds of the life that ended."""
        LedgerService._invalidate_cache(reborn_soul)
        assert LedgerService.get_unoffset_demerit(reborn_soul) is None

    def test_a_second_rebirth_inherits_from_the_second_life_only(self, reborn_soul):
        _record(reborn_soul, "MERIT", 10)
        reborn_soul.refresh_from_db()
        assert reborn_soul.merit_score == 50
        Soul.objects.filter(pk=reborn_soul.pk).update(
            current_state=SoulState.REINCARNATING, death_year=2000,
        )
        reborn_soul.refresh_from_db()
        ReincarnationService.complete_rebirth(soul=reborn_soul, new_identity="Thrice")
        reborn_soul.refresh_from_db()
        # 20% of 50, not 20% of 210.
        assert reborn_soul.merit_score == 10
        assert reborn_soul.life_index == 2


@pytest.mark.django_db
def test_the_backfill_files_old_rows_under_the_life_the_soul_is_in_now():
    """souls/0034: rows that predate `cycle` go to reincarnations.count(),
    which is the one assignment that leaves every existing score unchanged.
    Exercised against the live registry; the historical-state variant of the
    same function ran when the test database was migrated."""
    from importlib import import_module

    from django.apps import apps as live_apps

    from apps.reincarnation.models import Reincarnation

    stamp = import_module(
        "apps.souls.migrations.0034_ledger_is_per_life"
    ).stamp_existing_records_with_the_current_life

    tenant = _tenant()
    twice_reborn = Soul.objects.create(name="Old Hand", tenant=tenant)
    never_reborn = Soul.objects.create(name="First Timer", tenant=tenant)
    for n in (1, 2):
        Reincarnation.objects.create(soul=twice_reborn, target_realm="X", cycle_count=n, tenant=tenant)
    old = _record(twice_reborn, "MERIT", 5)
    other = _record(never_reborn, "MERIT", 5)
    # Pretend both rows predate the column.
    SoulRecord.all_objects.filter(pk__in=[old.pk, other.pk]).update(cycle=0)

    stamp(live_apps, None)

    old.refresh_from_db()
    other.refresh_from_db()
    assert old.cycle == 2
    assert other.cycle == 0


@pytest.mark.django_db
class TestDateChecksAreAlsoPerLife:
    """The date checks read the same all-lives queryset the ledger used to.

    After a rebirth the soul carries the new life's birth and death, but its
    first-life deeds are still dated in the first life. Compared against the
    new dates they are "before birth" (an ERROR) — so a reborn soul is flagged
    on the list, matched by ?has_date_problem=true, and its old records show
    problems on the detail page, all for dates that were right when written.
    The previous life's dates are not stored, so its records cannot be judged
    at all: they are left out, not re-judged.
    """

    @pytest.fixture
    def reborn_with_a_later_birth(self, reborn_soul):
        Soul.objects.filter(pk=reborn_soul.pk).update(birth_year=2010)
        return (
            Soul.objects.select_related("tenant")
            .prefetch_related("records", "reincarnations")
            .get(pk=reborn_soul.pk)
        )

    def test_the_list_row_is_not_flagged_for_the_previous_lifes_deeds(self, reborn_with_a_later_birth):
        from apps.souls.serializers import SoulListSerializer

        data = SoulListSerializer(reborn_with_a_later_birth, context={}).data
        assert data["has_record_error"] is False
        assert data["has_date_warning"] is False

    def test_the_filter_does_not_match_the_previous_lifes_deeds(self, reborn_with_a_later_birth):
        from apps.souls.filters import SoulFilter

        matched = SoulFilter({"has_date_problem": "true"}, queryset=Soul.objects.all()).qs
        assert reborn_with_a_later_birth not in matched
        unmatched = SoulFilter({"has_date_problem": "false"}, queryset=Soul.objects.all()).qs
        assert reborn_with_a_later_birth in unmatched

    def test_a_previous_lifes_record_reports_no_problems(self, reborn_with_a_later_birth):
        from apps.souls.serializers import SoulRecordSerializer

        old = reborn_with_a_later_birth.records.order_by("recorded_at").first()
        assert old.cycle == 0
        assert SoulRecordSerializer(old, context={}).data["date_problems"] == []

    def test_this_lifes_record_is_still_judged(self, reborn_with_a_later_birth):
        """The scoping must not switch the check off for the current life."""
        from apps.souls.serializers import SoulListSerializer

        _record(reborn_with_a_later_birth, "MERIT", 1, "dated before this birth", event_year=2005)
        soul = Soul.objects.prefetch_related("records", "reincarnations").get(pk=reborn_with_a_later_birth.pk)
        assert SoulListSerializer(soul, context={}).data["has_record_error"] is True

    def test_editing_a_previous_lifes_record_date_is_not_refused_by_this_lifes_dates(self, reborn_with_a_later_birth):
        from apps.souls.serializers import SoulRecordSerializer

        old = reborn_with_a_later_birth.records.order_by("recorded_at").first()
        serializer = SoulRecordSerializer(old, data={"event_date": "2001-06-01"}, partial=True)
        assert serializer.is_valid(), serializer.errors
