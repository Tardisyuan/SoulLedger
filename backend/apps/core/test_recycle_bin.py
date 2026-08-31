"""
Tests for the Stage 4 §4.7 global recycle bin: cascade-id propagation,
cascade-exact restore, the archive-instead-of-delete guard for
judgment-adjacent records once a verdict exists, and the bin listing/
hard-delete API.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.archive import DeletionNotAllowedError
from apps.core.recycle_bin import cascade_dependent_count, list_bin_entries, restore_cascade
from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.menus.models import Menu
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import RecordType, SoulRecord
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestSoulCascadeDelete:
    """Soul.delete_with_cascade — the cascade-id proposal from §4.7."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        self.admin = User.objects.create_user(
            username="rb_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(name="白鹤龄", tenant=self.tenant, current_state=SoulState.ALIVE)
        self.record1 = SoulRecord.objects.create(
            soul=self.soul, record_type=RecordType.MERIT, description="Gave alms", weight=5,
        )
        self.record2 = SoulRecord.objects.create(
            soul=self.soul, record_type=RecordType.DEMERIT, description="Told a lie", weight=2,
        )
        self.pending_judgment = Judgment.objects.create(soul=self.soul, civilization=Civilization.CHINESE)

    def test_cascade_delete_propagates_the_same_id_to_dependents(self):
        cascade_id = self.soul.delete_with_cascade(user=self.admin, reason="test cleanup")

        self.soul.refresh_from_db()
        self.record1.refresh_from_db()
        self.record2.refresh_from_db()
        self.pending_judgment.refresh_from_db()

        assert self.soul.is_deleted
        assert self.soul.delete_cascade_id == cascade_id
        assert self.record1.is_deleted
        assert self.record1.delete_cascade_id == cascade_id
        assert self.record2.is_deleted
        assert self.record2.delete_cascade_id == cascade_id
        assert self.pending_judgment.is_deleted
        assert self.pending_judgment.delete_cascade_id == cascade_id
        assert self.soul.deleted_by_id == self.admin.pk
        assert self.soul.delete_reason == "test cleanup"

    def test_dependent_count_matches_what_was_cascaded(self):
        cascade_id = self.soul.delete_with_cascade(user=self.admin)
        # Two SoulRecords + one pending Judgment = 3 dependents, not the
        # parent Soul itself.
        assert cascade_dependent_count(cascade_id, self.soul) == 3

    def test_restore_cascade_reverses_the_whole_set(self):
        cascade_id = self.soul.delete_with_cascade(user=self.admin)
        restored = restore_cascade(cascade_id)
        assert restored == 4  # soul + 2 records + 1 judgment

        self.soul.refresh_from_db()
        self.record1.refresh_from_db()
        self.record2.refresh_from_db()
        self.pending_judgment.refresh_from_db()
        for obj in (self.soul, self.record1, self.record2, self.pending_judgment):
            assert obj.is_deleted is False
            assert obj.delete_cascade_id is None

    def test_restore_cascade_does_not_touch_a_different_cascade(self):
        """A record deleted separately (its own cascade id) must not be
        resurrected when an unrelated soul's cascade is restored — the
        exact case the design doc's dependent-count reasoning calls out."""
        other_soul = Soul.objects.create(name="Other Soul", tenant=self.tenant)
        other_record = SoulRecord.objects.create(
            soul=other_soul, record_type=RecordType.MERIT, description="Unrelated", weight=1,
        )
        other_record.soft_delete(user=self.admin, reason="deleted on its own, separately")

        cascade_id = self.soul.delete_with_cascade(user=self.admin)
        restore_cascade(cascade_id)

        other_record.refresh_from_db()
        assert other_record.is_deleted is True, (
            "restoring one soul's cascade must not resurrect an unrelated "
            "record deleted under a different cascade id"
        )

    def test_soul_with_no_verdict_can_be_deleted(self):
        # Sanity check for the has_concluded_judgment gate below: a soul
        # whose only judgment is pending is an ordinary delete.
        assert self.soul.has_concluded_judgment is False
        self.soul.delete_with_cascade(user=self.admin)
        self.soul.refresh_from_db()
        assert self.soul.is_deleted


@pytest.mark.django_db
class TestArchiveGuard:
    """Once a verdict exists, Soul/Judgment/Disposition refuse deletion and
    must be archived instead — Stage 4 §4.7's exact gate."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        self.admin = User.objects.create_user(
            username="rb_archive_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        # JUDGING,不是 ALIVE:`conclude` 要把灵魂送到 DISPOSED,而那条边只从
        # JUDGING 出发。这里此前是 ALIVE,而 `conclude` **丢掉了 transition_to
        # 的返回值** —— judgment 标记 final、处置已创建,而灵魂纹丝不动。
        self.soul = Soul.objects.create(
            name="Concluded Soul", tenant=self.tenant, current_state=SoulState.JUDGING
        )
        self.judgment = Judgment.objects.create(soul=self.soul, civilization=Civilization.CHINESE)
        self.judgment.conclude("PASSED", "Lived well")
        self.disposition = Disposition.objects.get(judgment=self.judgment)

    def test_soul_with_concluded_judgment_refuses_delete(self):
        assert self.soul.has_concluded_judgment is True
        with pytest.raises(DeletionNotAllowedError) as exc_info:
            self.soul.delete_with_cascade(user=self.admin)
        assert exc_info.value.archivable is True
        self.soul.refresh_from_db()
        assert self.soul.is_deleted is False

    def test_soul_archive_succeeds_and_does_not_soft_delete(self):
        self.soul.archive(user=self.admin, reason="judicial history closed")
        self.soul.refresh_from_db()
        assert self.soul.is_archived is True
        assert self.soul.is_deleted is False
        assert self.soul.archived_by_id == self.admin.pk

    def test_judgment_with_verdict_refuses_delete(self):
        assert self.judgment.can_delete is False
        with pytest.raises(DeletionNotAllowedError) as exc_info:
            self.judgment.delete_or_raise(user=self.admin)
        assert exc_info.value.archivable is True
        self.judgment.refresh_from_db()
        assert self.judgment.is_deleted is False

    def test_pending_judgment_can_still_be_deleted(self):
        other_judgment = Judgment.objects.create(soul=self.soul, civilization=Civilization.CHINESE)
        assert other_judgment.can_delete is True
        other_judgment.delete_or_raise(user=self.admin)
        other_judgment.refresh_from_db()
        assert other_judgment.is_deleted is True

    def test_disposition_tied_to_verdict_refuses_delete(self):
        assert self.disposition.can_delete is False
        with pytest.raises(DeletionNotAllowedError) as exc_info:
            self.disposition.delete_or_raise(user=self.admin)
        assert exc_info.value.archivable is True
        self.disposition.refresh_from_db()
        assert self.disposition.is_deleted is False

    def test_soul_destroy_api_returns_409_with_archivable_flag(self):
        client = _jwt_client(self.admin, self.tenant)
        resp = client.delete(f"/api/v1/souls/{self.soul.pk}/")
        assert resp.status_code == status.HTTP_409_CONFLICT
        assert resp.data["archivable"] is True

    def test_soul_archive_api_succeeds(self):
        client = _jwt_client(self.admin, self.tenant)
        resp = client.post(f"/api/v1/souls/{self.soul.pk}/archive/", {}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        self.soul.refresh_from_db()
        assert self.soul.is_archived is True

    def test_judgment_destroy_api_returns_409(self):
        client = _jwt_client(self.admin, self.tenant)
        resp = client.delete(f"/api/v1/judgment/{self.judgment.pk}/")
        assert resp.status_code == status.HTTP_409_CONFLICT

    def test_disposition_destroy_api_returns_409(self):
        client = _jwt_client(self.admin, self.tenant)
        resp = client.delete(f"/api/v1/disposition/{self.disposition.pk}/")
        assert resp.status_code == status.HTTP_409_CONFLICT

    def test_archived_soul_disappears_from_the_ordinary_list(self):
        client = _jwt_client(self.admin, self.tenant)
        self.soul.archive(user=self.admin)
        resp = client.get("/api/v1/souls/")
        assert resp.status_code == status.HTTP_200_OK
        ids = [row["id"] for row in resp.data["results"]]
        assert str(self.soul.pk) not in ids


@pytest.mark.django_db
class TestRecycleBinListing:
    """list_bin_entries() lists parents, never their cascaded dependents,
    with correct dependent counts — the bin API's core contract."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        self.admin = User.objects.create_user(
            username="rb_list_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(name="白鹤龄", tenant=self.tenant, current_state=SoulState.ALIVE)
        SoulRecord.objects.create(
            soul=self.soul, record_type=RecordType.MERIT, description="r1", weight=1,
        )
        SoulRecord.objects.create(
            soul=self.soul, record_type=RecordType.MERIT, description="r2", weight=1,
        )
        self.menu = Menu.objects.create(name="Deleted Menu", path="/gone", roles=["ADMIN"])

    def test_bin_lists_soul_as_one_entry_with_dependent_count_not_as_separate_rows(self):
        self.soul.delete_with_cascade(user=self.admin)
        entries = list_bin_entries(tenant=self.tenant, is_admin=True)
        soul_entries = [e for e in entries if e["entity_type"] == "soul" and e["id"] == self.soul.pk]
        assert len(soul_entries) == 1
        assert soul_entries[0]["dependent_count"] == 2
        assert soul_entries[0]["label"] == "白鹤龄"
        # The two SoulRecords must not appear as their own bin entries —
        # SoulRecord isn't a registered bin type at all.
        assert all(e["entity_type"] != "soulrecord" for e in entries)

    def test_reference_data_entry_carries_retention_metadata(self):
        self.menu.soft_delete(user=self.admin, reason="cleanup")
        entries = list_bin_entries(tenant=self.tenant, is_admin=True)
        menu_entries = [e for e in entries if e["entity_type"] == "menu" and e["id"] == self.menu.pk]
        assert len(menu_entries) == 1
        assert menu_entries[0]["kind"] == "reference"
        assert menu_entries[0]["retention_days"] == 30
        assert menu_entries[0]["hard_delete_eligible"] is False  # just deleted, inside the window

    def test_domain_entry_has_no_hard_delete_window(self):
        self.soul.delete_with_cascade(user=self.admin)
        entries = list_bin_entries(tenant=self.tenant, is_admin=True)
        soul_entry = next(e for e in entries if e["entity_type"] == "soul" and e["id"] == self.soul.pk)
        assert soul_entry["kind"] == "domain"
        assert soul_entry["retention_days"] is None
        assert soul_entry["hard_delete_eligible"] is False


@pytest.mark.django_db
class TestRecycleBinAPI:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        self.admin = User.objects.create_user(
            username="rb_api_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="rb_api_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)
        self.menu = Menu.objects.create(name="API Deleted Menu", path="/gone-api", roles=["ADMIN"])

    def test_viewer_cannot_read_the_bin(self):
        resp = self.viewer_client.get("/api/v1/recycle-bin/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_lists_deleted_menu_in_the_bin(self):
        self.menu.soft_delete(user=self.admin, reason="via API test")
        resp = self.admin_client.get("/api/v1/recycle-bin/")
        assert resp.status_code == status.HTTP_200_OK
        ids = [(e["entity_type"], e["id"]) for e in resp.data["results"]]
        assert ("menu", self.menu.pk) in ids

    def test_restore_via_cascade_id_brings_the_menu_back(self):
        self.menu.soft_delete(user=self.admin, reason="oops")
        self.menu.refresh_from_db()
        cascade_id = str(self.menu.delete_cascade_id)

        resp = self.admin_client.post(
            "/api/v1/recycle-bin/restore/", {"cascade_id": cascade_id}, format="json"
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["restored"] == 1

        self.menu.refresh_from_db()
        assert self.menu.is_deleted is False

    def test_restore_unknown_cascade_id_is_404(self):
        import uuid
        resp = self.admin_client.post(
            "/api/v1/recycle-bin/restore/", {"cascade_id": str(uuid.uuid4())}, format="json"
        )
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_hard_delete_refused_inside_retention_window(self):
        self.menu.soft_delete(user=self.admin, reason="too soon")
        resp = self.admin_client.post(
            "/api/v1/recycle-bin/hard-delete/",
            {"entity_type": "menu", "id": self.menu.pk},
            format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert Menu.all_objects.filter(pk=self.menu.pk).exists()

    def test_hard_delete_succeeds_past_retention_window(self):
        from datetime import timedelta

        from django.utils import timezone

        self.menu.soft_delete(user=self.admin, reason="old")
        Menu.all_objects.filter(pk=self.menu.pk).update(
            deleted_at=timezone.now() - timedelta(days=31)
        )
        resp = self.admin_client.post(
            "/api/v1/recycle-bin/hard-delete/",
            {"entity_type": "menu", "id": self.menu.pk},
            format="json",
        )
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not Menu.all_objects.filter(pk=self.menu.pk).exists()

    def test_hard_delete_refused_for_a_domain_type(self):
        tenant = self.tenant
        soul = Soul.objects.create(name="Cannot hard delete me", tenant=tenant, current_state=SoulState.ALIVE)
        soul.delete_with_cascade(user=self.admin)
        resp = self.admin_client.post(
            "/api/v1/recycle-bin/hard-delete/",
            {"entity_type": "soul", "id": str(soul.pk)},
            format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert Soul.all_objects.filter(pk=soul.pk).exists()
