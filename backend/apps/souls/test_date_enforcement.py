"""Tests for date-sanity enforcement — the serializers and the report command.

The rules themselves are tested in test_dates.py, without a database. This
file is about the boundary: bad dates must not get in through the API, and
rows that were already there must be findable.

Split from test_dates.py to stay under the 500-line limit, along the seam
that was already there — a rule and the place it is applied are different
things, and only one of them needs Postgres.
"""
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/souls"


def _jwt_client(user, tenant):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestSoulDateEnforcement:
    """The serializer is the write boundary — bad dates must not get in."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_DATES", defaults={"display_name": "Soul Dates Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="dates_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)

    def _post(self, **payload):
        return self.client.post(f"{BASE}/", {"name": "Dated Soul", **payload}, format="json")

    def test_death_before_birth_is_refused(self):
        resp = self._post(birth_date={"year": 2019}, death_date={"year": 1943})
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "cannot die before it is born" in str(resp.data)

    def test_bce_death_before_bce_birth_is_refused(self):
        resp = self._post(birth_date={"year": -580}, death_date={"year": -612})
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_an_ordinary_bce_life_is_accepted(self):
        resp = self._post(birth_date={"year": -612}, death_date={"year": -580})
        assert resp.status_code == status.HTTP_201_CREATED
        soul = Soul.objects.get(pk=resp.data["id"])
        assert (soul.birth_year, soul.death_year) == (-612, -580)

    def test_a_medieval_life_is_accepted(self):
        resp = self._post(
            birth_date={"year": 1487, "month": 3, "day": 2},
            death_date={"year": 1546, "month": 11, "day": 20},
        )
        assert resp.status_code == status.HTTP_201_CREATED

    def test_an_implausible_lifespan_is_refused(self):
        resp = self._post(birth_date={"year": 1487}, death_date={"year": 1998})
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "511 years" in str(resp.data)

    def test_a_life_spanning_the_era_boundary_is_measured_correctly(self):
        """Exactly 150 years, 100 BCE to 51 CE. Naive subtraction would call
        it 151 and refuse a legitimate soul."""
        assert self._post(
            birth_date={"year": -100}, death_date={"year": 51}
        ).status_code == status.HTTP_201_CREATED

    def test_a_living_soul_needs_no_death_date(self):
        assert self._post(birth_date={"year": 1943}).status_code == status.HTTP_201_CREATED

    def test_a_soul_with_no_dates_at_all_is_accepted(self):
        assert self._post().status_code == status.HTTP_201_CREATED

    def test_patching_only_a_death_date_is_checked_against_the_stored_birth(self):
        """The hole a naive `validate` leaves: the write mentions one date,
        so the other has to come off the instance."""
        soul = Soul.objects.create(name="Half Dated", tenant=self.tenant, birth_year=2019)
        resp = self.client.patch(
            f"{BASE}/{soul.pk}/", {"death_date": {"year": 1943}}, format="json"
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        soul.refresh_from_db()
        assert soul.death_year is None

    def test_patching_only_a_birth_date_is_checked_against_the_stored_death(self):
        soul = Soul.objects.create(name="Half Dated 2", tenant=self.tenant, death_year=1943)
        resp = self.client.patch(
            f"{BASE}/{soul.pk}/", {"birth_date": {"year": 2019}}, format="json"
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_a_valid_correction_still_goes_through(self):
        soul = Soul.objects.create(name="Correctable", tenant=self.tenant, birth_year=1943)
        resp = self.client.patch(
            f"{BASE}/{soul.pk}/", {"death_date": {"year": 2019}}, format="json"
        )
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.death_year == 2019

    def test_editing_the_name_of_an_already_broken_soul_is_not_blocked(self):
        """Refusing this would turn a data problem into a locked record —
        and the person editing the soul is the one most likely to spot the
        bad dates. Any write that touches a date is still checked."""
        soul = Soul.objects.create(
            name="Broken", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        resp = self.client.patch(f"{BASE}/{soul.pk}/", {"name": "Renamed"}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.name == "Renamed"


@pytest.mark.django_db
class TestDieActionDateEnforcement:
    """POST /souls/<id>/die/ writes a death date without a serializer.

    It is the likeliest door for a bad date — where a death gets entered in
    a hurry — so a rule that holds everywhere except here is not a rule.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="DIE_DATES", defaults={"display_name": "Die Dates Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="diedates_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)

    def _die(self, soul, **payload):
        return self.client.post(f"{BASE}/{soul.pk}/die/", payload, format="json")

    def test_dying_before_being_born_is_refused(self):
        soul = Soul.objects.create(name="Backwards", tenant=self.tenant, birth_year=2019)
        resp = self._die(soul, death_date={"year": 1943})
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "cannot die before it is born" in str(resp.data)
        soul.refresh_from_db()
        # The state machine must not have moved either — a refused death is
        # not a death, and a soul left in JUDGING with no death date would be
        # worse than the bad date itself.
        assert soul.current_state == SoulState.ALIVE
        assert soul.death_year is None

    def test_an_implausible_lifespan_is_refused(self):
        soul = Soul.objects.create(name="Methuselah", tenant=self.tenant, birth_year=1487)
        resp = self._die(soul, death_date={"year": 1998})
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "511 years" in str(resp.data)
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE

    def test_dying_before_being_born_in_bce_is_refused(self):
        soul = Soul.objects.create(name="Ancient Backwards", tenant=self.tenant, birth_year=-580)
        assert self._die(soul, death_date={"year": -612}).status_code == (
            status.HTTP_400_BAD_REQUEST
        )

    def test_an_ordinary_bce_death_still_goes_through(self):
        soul = Soul.objects.create(name="Ancient", tenant=self.tenant, birth_year=-612)
        resp = self._die(soul, death_date={"year": -580})
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.death_year == -580
        assert soul.current_state == SoulState.JUDGING

    def test_a_soul_with_no_birth_date_can_still_die(self):
        """Most souls have no birth date. Nothing to contradict, nothing to
        refuse."""
        soul = Soul.objects.create(name="Undated", tenant=self.tenant)
        assert self._die(soul, death_date={"year": 1990}).status_code == status.HTTP_200_OK

    def test_dying_with_no_date_at_all_still_defaults_to_today(self):
        soul = Soul.objects.create(name="Today", tenant=self.tenant, birth_year=1943)
        resp = self._die(soul)
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.death_year is not None

    def test_a_malformed_date_still_answers_in_the_endpoints_own_shape(self):
        """This endpoint reports errors as {"error": ...}. Adding a check
        must not make it answer in two different shapes depending on which
        check failed."""
        soul = Soul.objects.create(name="Bad Input", tenant=self.tenant, birth_year=1943)
        resp = self._die(soul, death_date={"year": 0})
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "error" in resp.data

    def test_a_refused_death_answers_in_that_same_shape(self):
        soul = Soul.objects.create(name="Backwards 2", tenant=self.tenant, birth_year=2019)
        resp = self._die(soul, death_date={"year": 1943})
        assert "error" in resp.data


@pytest.mark.django_db
class TestRecordDateEnforcement:
    """add_record passes the soul at save() time, not in the posted data —
    the create path has to be checked there or not at all."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="REC_DATES", defaults={"display_name": "Record Dates Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="recdates_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)
        self.soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )

    def _add(self, **payload):
        return self.client.post(f"{BASE}/{self.soul.pk}/add_record/", {
            "record_type": "MERIT",
            "civilization": "EGYPTIAN",
            "description": "Built a temple",
            "weight": 10,
            **payload,
        }, format="json")

    def test_a_record_within_the_life_is_accepted(self):
        assert self._add(event_date={"year": -600}).status_code == status.HTTP_201_CREATED

    def test_a_record_before_birth_is_refused(self):
        resp = self._add(event_date={"year": -620})
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "cannot predate the soul" in str(resp.data)
        assert SoulRecord.objects.filter(soul=self.soul).count() == 0

    def test_a_posthumous_record_is_accepted(self):
        """A warning, not an error — the decay code already tolerates these."""
        resp = self._add(event_date={"year": -570})
        assert resp.status_code == status.HTTP_201_CREATED

    def test_a_record_with_no_event_date_is_accepted(self):
        """Legitimate and common for ancient sources."""
        assert self._add().status_code == status.HTTP_201_CREATED

    def test_a_record_on_a_dateless_soul_is_accepted(self):
        soul = Soul.objects.create(name="Undated", tenant=self.tenant)
        resp = self.client.post(f"{BASE}/{soul.pk}/add_record/", {
            "record_type": "MERIT", "civilization": "CHINESE",
            "description": "Anonymous good deed", "weight": 1,
            "event_date": {"year": -3000},
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
class TestCheckSoulDatesCommand:
    """`manage.py check_soul_dates` — finds what the serializers cannot,
    because it was already there before they existed."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CMD_DATES", defaults={"display_name": "Command Dates Tenant"}
        )[0]

    def _run(self, *args):
        out = StringIO()
        call_command("check_soul_dates", "--tenant", self.tenant.code, *args, stdout=out)
        return out.getvalue()

    def test_clean_data_reports_nothing_flagged(self):
        Soul.objects.create(
            name="Fine", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        output = self._run()
        assert "0 soul(s) flagged" in output

    def test_a_soul_written_around_the_serializer_is_found(self):
        Soul.objects.create(
            name="Backwards", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        output = self._run()
        assert "death_before_birth" in output
        assert "Backwards" in output
        assert "1 soul(s) flagged: 1 error(s)" in output

    def test_an_implausible_lifespan_is_found(self):
        Soul.objects.create(
            name="Ancient Mariner", tenant=self.tenant, birth_year=1487, death_year=1998
        )
        assert "implausible_lifespan" in self._run()

    def test_a_record_outside_the_life_is_found(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Impossibly early", weight=1, event_year=-700,
        )
        output = self._run()
        assert "event_before_birth" in output
        assert str(soul.id) in output

    def test_posthumous_records_are_reported_as_warnings_and_can_be_hidden(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Remembered later", weight=1, event_year=-500,
        )
        assert "event_after_death" in self._run()
        assert "event_after_death" not in self._run("--errors-only")

    def test_the_command_changes_nothing(self):
        """It reports. What to do about a soul born after it died is a
        judgement, not something a script gets to make."""
        soul = Soul.objects.create(
            name="Backwards", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        self._run()
        soul.refresh_from_db()
        assert (soul.birth_year, soul.death_year) == (2019, 1943)

    def test_strict_exits_non_zero_when_errors_are_found(self):
        Soul.objects.create(
            name="Backwards", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        with pytest.raises(CommandError):
            self._run("--strict")

    def test_strict_is_quiet_when_only_warnings_are_found(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Remembered later", weight=1, event_year=-500,
        )
        assert "0 error(s)" in self._run("--strict")

    def test_the_report_says_which_population_it_examined(self):
        """A report that silently omits soft-deleted rows gets read as a
        report on everything."""
        soul = Soul.objects.create(
            name="Gone", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        soul.is_deleted = True
        soul.save()
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="Attached to a deleted soul", weight=1, event_year=1900,
        )
        output = self._run()
        assert "Checking live rows only" in output
        # The record is live; it is skipped because its soul is not, and
        # counting only is_deleted records would report 0 and be wrong.
        assert "1 soul(s) and 1 record(s) were not examined" in output
        assert "Gone" not in output

    def test_include_deleted_examines_the_soft_deleted_originals(self):
        """A soft-deleted row is not necessarily junk — it may be the
        original a live row was rewritten from, and restoring it makes its
        dates live again."""
        soul = Soul.objects.create(
            name="Gone", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        soul.is_deleted = True
        soul.save()
        output = self._run("--include-deleted")
        assert "Checking live and soft-deleted rows." in output
        assert "Gone" in output
        assert "[soft-deleted]" in output
        assert "death_before_birth" in output

    def test_a_deleted_record_on_a_live_soul_is_marked_too(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        record = SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Impossibly early", weight=1, event_year=-700,
        )
        record.is_deleted = True
        record.save()
        assert "event_before_birth" not in self._run()
        output = self._run("--include-deleted")
        assert f"record {record.id} [soft-deleted]" in output

    def test_the_tenant_filter_scopes_the_report(self):
        other = Tenant.objects.get_or_create(
            code="CMD_DATES_OTHER", defaults={"display_name": "Other"}
        )[0]
        Soul.objects.create(
            name="Elsewhere", tenant=other, birth_year=2019, death_year=1943
        )
        assert "Elsewhere" not in self._run()
