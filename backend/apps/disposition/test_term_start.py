"""The term-start column and the rules that landed with it.

The column and its validation shipped in one pass on purpose. Adding the field
first and the rules afterwards leaves a window in which a contradictory date
can be written with nothing going red — and a bad date already in the database
is not fixed by a rule that arrives later, it is grandfathered past it, which
is how `check_soul_dates` came to need a management command to find rows the
API would refuse today.

So these tests are about the write path specifically: the two contradictions
being refused at the door, and — the half that is easy to lose — the ordinary
writes that must still go through.
"""
import pytest
from rest_framework.exceptions import ValidationError

from apps.disposition.models import Disposition
from apps.disposition.serializers import DispositionSerializer
from apps.disposition.views import DispositionViewSet
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTermStartWrites:

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="GR_HADES", defaults={"display_name": "GR_HADES"}
        )[0]

    def _soul(self, state=SoulState.DISPOSED, death=(-402, 6, 1)):
        year, month, day = death
        return Soul.objects.create(
            name="Er", current_state=state, tenant=self.tenant,
            death_year=year, death_month=month, death_day=day,
        )

    def _write(self, soul, term_start, instance=None, **extra):
        data = {"soul": str(soul.id), "term_start": term_start, **extra}
        serializer = DispositionSerializer(
            instance=instance, data=data, partial=instance is not None
        )
        serializer.is_valid(raise_exception=True)
        return serializer.save() if instance is None else serializer.save()

    def test_the_viewset_actually_uses_this_serializer(self):
        """Everything below tests `DispositionSerializer.validate`. This is the
        one line that says the API goes through it — without it these are
        tests of a class nothing calls."""
        assert DispositionViewSet.serializer_class is DispositionSerializer

    # -- the column round-trips -------------------------------------------

    def test_a_bce_term_start_is_stored_and_returned_as_a_structured_date(self):
        """The reason these are three integer columns and not a DateField:
        `datetime.date` has MINYEAR = 1 and this term began in 399 BCE."""
        soul = self._soul()
        disposition = self._write(soul, {"year": -399, "month": 2, "day": 15})

        disposition.refresh_from_db()
        assert (
            disposition.term_start_year,
            disposition.term_start_month,
            disposition.term_start_day,
        ) == (-399, 2, 15)
        assert DispositionSerializer(disposition).data["term_start"] == {
            "year": -399, "month": 2, "day": 15,
        }

    def test_a_disposition_written_without_one_has_none(self):
        """NULL means not recorded — the convention `sentence_years` uses, and
        the state every row predating disposition/0011 is in."""
        soul = self._soul()
        disposition = self._write(soul, None)
        assert disposition.term_start_year is None
        assert DispositionSerializer(disposition).data["term_start"] is None

    def test_it_is_not_executed_at(self):
        """The owner's decision, asserted rather than described.

        A disposition can be executed on a Tuesday for a term that began in
        399 BCE. If a later edit ever collapses the two — deriving one from the
        other, or reading `term_start` off `executed_at` — this is what says so.
        """
        soul = self._soul()
        disposition = self._write(soul, {"year": -399, "month": 2, "day": 15})
        disposition.is_executed = True
        disposition.save(update_fields=["is_executed"])
        disposition.refresh_from_db()

        assert disposition.executed_at is None
        assert disposition.term_start_year == -399

    # -- term_start_before_death ------------------------------------------

    def test_a_term_starting_before_death_is_refused(self):
        soul = self._soul(death=(-402, 6, 1))
        with pytest.raises(ValidationError) as exc:
            self._write(soul, {"year": -450, "month": 1, "day": 1})

        message = str(exc.value)
        assert "before the soul's death" in message
        # Both dates named: either one may be the mistake, and the message must
        # not assert which.
        assert "450-01-01 BCE" in message
        assert "402-06-01 BCE" in message
        assert not Disposition.all_objects.filter(soul=soul).exists()

    def test_a_term_starting_after_death_goes_through(self):
        soul = self._soul(death=(-402, 6, 1))
        assert self._write(soul, {"year": -399, "month": 2, "day": 15}).pk

    # -- term_start_on_a_living_soul --------------------------------------

    def test_a_term_start_on_a_living_soul_is_refused(self):
        soul = self._soul(state=SoulState.ALIVE, death=(None, None, None))
        with pytest.raises(ValidationError) as exc:
            self._write(soul, {"year": 1900, "month": 1, "day": 1})

        assert "ALIVE" in str(exc.value)
        assert not Disposition.all_objects.filter(soul=soul).exists()

    def test_a_reborn_souls_executed_term_is_not_refused(self):
        """The case that would have made this rule wrong.

        `complete_rebirth` clears the death date and returns the soul to ALIVE,
        and the disposition it served under keeps its rows. Re-saving that row
        — for any reason, a note, a realm correction — must not be refused
        because the soul it belongs to is alive again.
        """
        soul = self._soul(state=SoulState.ALIVE, death=(None, None, None))
        disposition = Disposition.objects.create(
            soul=soul, tenant=self.tenant, is_executed=True,
            term_start_year=-399, term_start_month=2, term_start_day=15,
        )

        serializer = DispositionSerializer(
            instance=disposition, data={"notes": "cycle 1"}, partial=True
        )
        assert serializer.is_valid(), serializer.errors
        serializer.save()

        # And the same row written with the date explicitly present.
        again = DispositionSerializer(
            instance=disposition,
            data={"term_start": {"year": -399, "month": 2, "day": 15}},
            partial=True,
        )
        assert again.is_valid(), again.errors

    # -- what must still go through ---------------------------------------

    def test_an_unrelated_patch_is_not_refused_by_a_stored_bad_date(self):
        """A pre-existing contradiction must not lock the record.

        The operator most likely to fix a bad date is the one editing the row,
        and refusing every write until it is fixed turns a data problem into an
        unusable record. `apps/souls/serializers.py::_touches_dates` takes the
        same position for a soul's dates and states this reason.
        """
        soul = self._soul(state=SoulState.ALIVE, death=(None, None, None))
        # Written past the serializer, the way legacy data arrives.
        disposition = Disposition.objects.create(
            soul=soul, tenant=self.tenant,
            term_start_year=1900, term_start_month=1, term_start_day=1,
        )

        serializer = DispositionSerializer(
            instance=disposition, data={"notes": "looked at this"}, partial=True
        )
        assert serializer.is_valid(), serializer.errors

    def test_repointing_a_disposition_at_another_soul_is_checked(self):
        """The contradiction can be created without the date moving at all —
        the other half of the pair is what changed. A rule that only looks when
        the date is written would not see this."""
        dead = self._soul(death=(-402, 6, 1))
        disposition = self._write(dead, {"year": -399, "month": 2, "day": 15})

        living = self._soul(state=SoulState.ALIVE, death=(None, None, None))
        serializer = DispositionSerializer(
            instance=disposition, data={"soul": str(living.id)}, partial=True
        )
        assert not serializer.is_valid()
        assert "ALIVE" in str(serializer.errors)

    def test_a_disposition_with_no_term_start_is_never_checked(self):
        """Every existing row is in this state, including on souls whose state
        or dates the rules would otherwise object to."""
        soul = self._soul(state=SoulState.ALIVE, death=(None, None, None))
        assert self._write(soul, None).pk
