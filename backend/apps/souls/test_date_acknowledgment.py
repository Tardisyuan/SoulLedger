"""Tests for acknowledging a soul record's `event_after_death` DateProblem WARNING.

DateProblem is computed fresh on every request — there is no persistent
"problem" row anywhere in this system (see apps.souls.dates). So
acknowledgment cannot be a bare boolean: SoulRecord stores who, when, and a
fingerprint of the exact two values (this record's event_date, its soul's
death_date) the warning depends on. The acknowledgment only applies while
that fingerprint still matches the live values — see
apps.souls.dates.date_warning_fingerprint and
SoulViewSet.acknowledge_record_date_warning.

Pure-function coverage (no database) and the API/endpoint coverage live in
the same file because they are one feature: dates.py decides what
"acknowledged" means, the serializer and the endpoint are plumbing for it.
"""
import time

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.souls.dates import WARNING, check_record_date, date_warning_fingerprint
from apps.souls.models import Soul
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


class TestDateWarningFingerprint:
    """Pure function, no database — the fingerprint is exactly (event, death)."""

    def test_same_inputs_give_the_same_fingerprint(self):
        event, death = (-570, None, None), (-580, None, None)
        assert date_warning_fingerprint(event, death) == date_warning_fingerprint(event, death)

    def test_a_different_event_date_changes_the_fingerprint(self):
        death = (-580, None, None)
        a = date_warning_fingerprint((-570, None, None), death)
        b = date_warning_fingerprint((-571, None, None), death)
        assert a != b

    def test_a_different_death_date_changes_the_fingerprint(self):
        event = (-570, None, None)
        a = date_warning_fingerprint(event, (-580, None, None))
        b = date_warning_fingerprint(event, (-581, None, None))
        assert a != b


class TestCheckRecordDateAcknowledgment:
    """check_record_date's ack_fingerprint parameter, no database."""

    LIFE = ((-612, None, None), (-580, None, None))
    EVENT = (-570, None, None)

    def test_no_ack_fingerprint_is_unacknowledged(self):
        problems = check_record_date(self.EVENT, *self.LIFE)
        assert problems[0].code == "event_after_death"
        assert problems[0].acknowledged is False

    def test_a_matching_fingerprint_is_acknowledged(self):
        fp = date_warning_fingerprint(self.EVENT, self.LIFE[1])
        problems = check_record_date(self.EVENT, *self.LIFE, ack_fingerprint=fp)
        assert problems[0].acknowledged is True

    def test_a_stale_fingerprint_is_not_acknowledged(self):
        """A fingerprint computed against a different death date does not
        apply here — an operator who acknowledged one gap did not
        pre-approve a different one."""
        stale_fp = date_warning_fingerprint(self.EVENT, (-590, None, None))
        problems = check_record_date(self.EVENT, *self.LIFE, ack_fingerprint=stale_fp)
        assert problems[0].acknowledged is False

    def test_acknowledgment_does_not_suppress_the_warning(self):
        """Still reported even when acknowledged — the caller decides what
        to do with that fact, it is never silently dropped here."""
        fp = date_warning_fingerprint(self.EVENT, self.LIFE[1])
        problems = check_record_date(self.EVENT, *self.LIFE, ack_fingerprint=fp)
        assert len(problems) == 1
        assert problems[0].severity == WARNING
        assert problems[0].code == "event_after_death"

    def test_acknowledgment_is_irrelevant_to_error_severity_problems(self):
        """event_before_birth is an ERROR; ack_fingerprint only ever
        touches event_after_death."""
        problems = check_record_date(
            (-620, None, None), *self.LIFE, ack_fingerprint="anything"
        )
        assert problems[0].code == "event_before_birth"
        assert problems[0].acknowledged is False


@pytest.mark.django_db
class TestAcknowledgeRecordDateWarningEndpoint:
    """POST /souls/<id>/records/<record_id>/acknowledge-date-warning/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="ACK_DATES", defaults={"display_name": "Ack Dates Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="ack_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)
        self.soul = Soul.objects.create(
            name="Posthumous", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        self.record = SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Remembered later", weight=1, event_year=-570,
        )

    def _ack(self, client, **payload):
        return client.post(
            f"{BASE}/{self.soul.pk}/records/{self.record.pk}/acknowledge-date-warning/",
            payload, format="json",
        )

    def _record_problems(self):
        resp = self.client.get(f"{BASE}/{self.soul.pk}/records/")
        record_data = next(r for r in resp.data if r["id"] == str(self.record.pk))
        return record_data["date_problems"]

    def test_the_warning_is_present_and_unacknowledged_before_acknowledging(self):
        problems = self._record_problems()
        assert len(problems) == 1
        assert problems[0]["code"] == "event_after_death"
        assert problems[0]["acknowledged"] is False

    def test_acknowledging_marks_it_acknowledged_in_the_response(self):
        resp = self._ack(self.client)
        assert resp.status_code == status.HTTP_200_OK
        problems = resp.data["date_problems"]
        assert len(problems) == 1
        assert problems[0]["acknowledged"] is True

    def test_acknowledgment_persists_and_is_reflected_on_a_later_read(self):
        self._ack(self.client)
        problems = self._record_problems()
        assert problems[0]["acknowledged"] is True

    def test_the_acting_user_is_recorded_from_the_request(self):
        self._ack(self.client)
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_by_id == self.admin.id
        assert self.record.date_warning_acknowledged_at is not None

    def test_a_client_supplied_acknowledger_is_ignored(self):
        """The acting user comes from request.user only — never trust a
        client-supplied "who acknowledged this"."""
        other = User.objects.create_user(
            username="someone_else", password="test123", role="ADMIN", tenant=self.tenant
        )
        self._ack(self.client, acknowledged_by=str(other.id), user_id=str(other.id))
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_by_id == self.admin.id

    def test_changing_the_souls_death_date_after_acknowledgment_reopens_the_warning(self):
        """An operator who acknowledged "this record is dated N years after
        death, that's fine" did not thereby pre-approve a record whose gap
        was later widened by editing the death date."""
        self._ack(self.client)
        self.soul.death_year = -900
        self.soul.save()

        problems = self._record_problems()
        assert len(problems) == 1
        assert problems[0]["code"] == "event_after_death"
        assert problems[0]["acknowledged"] is False

    def test_changing_the_records_event_date_after_acknowledgment_reopens_the_warning(self):
        self._ack(self.client)
        self.record.refresh_from_db()
        self.record.event_year = -400
        self.record.save()

        problems = self._record_problems()
        assert len(problems) == 1
        assert problems[0]["acknowledged"] is False

    def test_a_correction_that_still_lands_on_the_same_dates_stays_acknowledged(self):
        """Writing the same event_year back is not a change — the
        fingerprint still matches. Refreshed from the DB first so this
        save does not clobber the fingerprint the acknowledge endpoint
        just wrote with a stale in-memory copy of the record."""
        self._ack(self.client)
        self.record.refresh_from_db()
        self.record.event_year = self.record.event_year
        self.record.save()
        assert self._record_problems()[0]["acknowledged"] is True

    def test_the_stale_acknowledgment_is_not_cleared_from_storage(self):
        """Documents the choice made here: a stale acknowledgment is left in
        place and simply stops applying, rather than being wiped. The
        who/when stays queryable as history even after the fingerprint no
        longer matches."""
        self._ack(self.client)
        self.soul.death_year = -900
        self.soul.save()
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_by_id == self.admin.id
        assert self.record.date_warning_ack_fingerprint != ""

    def test_acknowledging_requires_authentication(self):
        anon = APIClient()
        resp = anon.post(
            f"{BASE}/{self.soul.pk}/records/{self.record.pk}/acknowledge-date-warning/",
            {}, format="json",
        )
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_by_id is None

    def test_a_role_without_soul_update_is_forbidden(self):
        """VIEWER holds soul.read but not soul.update — the same codename
        add_record requires for writing a soul's records."""
        viewer = User.objects.create_user(
            username="ack_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        client = _jwt_client(viewer, self.tenant)
        resp = self._ack(client)
        assert resp.status_code == status.HTTP_403_FORBIDDEN
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_by_id is None

    def test_a_record_with_no_warning_cannot_be_acknowledged(self):
        clean_record = SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Ordinary", weight=1, event_year=-600,
        )
        resp = self.client.post(
            f"{BASE}/{self.soul.pk}/records/{clean_record.pk}/acknowledge-date-warning/",
            {}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        clean_record.refresh_from_db()
        assert clean_record.date_warning_acknowledged_by_id is None

    def test_acknowledging_a_record_that_does_not_belong_to_the_soul_404s(self):
        other_soul = Soul.objects.create(
            name="Other", tenant=self.tenant, birth_year=1900, death_year=1950
        )
        resp = self.client.post(
            f"{BASE}/{other_soul.pk}/records/{self.record.pk}/acknowledge-date-warning/",
            {}, format="json",
        )
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_re_acknowledging_updates_the_timestamp(self):
        self._ack(self.client)
        self.record.refresh_from_db()
        first_at = self.record.date_warning_acknowledged_at

        time.sleep(0.01)
        self._ack(self.client)
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_at > first_at

    def test_acknowledged_response_names_who_and_when(self):
        """The UI needs to render "acknowledged by X at Y" — confirm the
        serializer actually carries that, not just the boolean."""
        resp = self._ack(self.client)
        problem = resp.data["date_problems"][0]
        assert problem["acknowledged_by"] == self.admin.username
        assert problem["acknowledged_at"] is not None

    def test_unacknowledged_response_has_no_who_or_when(self):
        problem = self._record_problems()[0]
        assert problem["acknowledged_by"] is None
        assert problem["acknowledged_at"] is None


@pytest.mark.django_db
class TestUnacknowledgeRecordDateWarningEndpoint:
    """POST /souls/<id>/records/<record_id>/unacknowledge-date-warning/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="UNACK_DATES", defaults={"display_name": "Unack Dates Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="unack_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)
        self.soul = Soul.objects.create(
            name="Posthumous", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        self.record = SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Remembered later", weight=1, event_year=-570,
        )

    def _ack(self):
        return self.client.post(
            f"{BASE}/{self.soul.pk}/records/{self.record.pk}/acknowledge-date-warning/",
            {}, format="json",
        )

    def _unack(self, client=None):
        client = client or self.client
        return client.post(
            f"{BASE}/{self.soul.pk}/records/{self.record.pk}/unacknowledge-date-warning/",
            {}, format="json",
        )

    def test_unacknowledging_clears_the_ack_fields(self):
        self._ack()
        resp = self._unack()
        assert resp.status_code == status.HTTP_200_OK
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_by_id is None
        assert self.record.date_warning_acknowledged_at is None
        assert self.record.date_warning_ack_fingerprint == ""

    def test_unacknowledging_makes_the_warning_reappear_as_unacknowledged(self):
        self._ack()
        self._unack()
        resp = self.client.get(f"{BASE}/{self.soul.pk}/records/")
        record_data = next(r for r in resp.data if r["id"] == str(self.record.pk))
        assert record_data["date_problems"][0]["acknowledged"] is False

    def test_unacknowledging_an_already_stale_ack_is_not_an_error(self):
        """A revoke on an ack that already stopped applying (fingerprint
        mismatch) is still allowed — it is harmless and there is no
        protective reason to refuse it."""
        self._ack()
        self.soul.death_year = -900
        self.soul.save()
        resp = self._unack()
        assert resp.status_code == status.HTTP_200_OK

    def test_unacknowledging_requires_authentication(self):
        anon = APIClient()
        resp = anon.post(
            f"{BASE}/{self.soul.pk}/records/{self.record.pk}/unacknowledge-date-warning/",
            {}, format="json",
        )
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_a_role_without_soul_update_is_forbidden(self):
        self._ack()
        viewer = User.objects.create_user(
            username="unack_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        client = _jwt_client(viewer, self.tenant)
        resp = self._unack(client)
        assert resp.status_code == status.HTTP_403_FORBIDDEN
        self.record.refresh_from_db()
        assert self.record.date_warning_acknowledged_by_id == self.admin.id
