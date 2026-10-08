"""Admin webhook management: `/death-sync/admin-webhooks/` and
`/death-sync/webhook-deliveries/` (JWT + ADMIN), beside the unchanged
self-service `/death-sync/webhooks/` (API key only).

What is pinned, and why each line is here rather than assumed:

* The three credentials answer differently on the admin door — ADMIN JWT
  200, non-ADMIN JWT 403, API key 401 — and the self-service door is
  byte-for-byte as before (JWT 401, key with `can_manage_webhooks` 200).
* The signing secret is in the 201 and nowhere else: the list, the retrieve
  and the update of the same row carry no `_signing_secret` key at all.
* URL validation refuses the scheme and the address classes the delivery
  task would refuse at send time (`_validate_webhook_url`), so a row that
  can never deliver is never written. Valid cases use TEST-NET-3 literals
  (`203.0.113.0/24`) — an IP literal needs no DNS, and it is not in the
  blocklist.
* `events` is checked against `EventType` — the enum the handler compares
  against verbatim — so a misspelt name is a 400, not a silent nothing.
* Disabling is a PATCH that keeps the row and its deliveries; there is no
  DELETE route.
* Tenant: creation pins `tenant` to the request's and refuses another
  tenant's `api_key`; the queryset goes through `scope_to_tenant` with the
  same ADMIN bypass as `ExternalApiKeyViewSet` (asserted side by side, so a
  change to one shows up as a disagreement with the other).
* Deliveries: newest first, paginated, `?webhook=` filters, `payload_json`
  is not on the wire, and the non-ADMIN branch of the queryset scopes by
  `webhook__tenant`.
"""
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.death_sync.models import ExternalApiKey, WebhookConfig
from apps.events.models import EventType, EventWebhookDelivery, EventWebhookStatus
from apps.tenants.models import Tenant
from tests.test_death_sync import _api_key_client, _jwt_client

ADMIN_URL = "/api/v1/death-sync/admin-webhooks/"
DELIVERIES_URL = "/api/v1/death-sync/webhook-deliveries/"
SELF_SERVICE_URL = "/api/v1/death-sync/webhooks/"
PUBLIC_URL = "https://203.0.113.10/hook"


def _key(tenant, name="Key", **extra):
    raw, key_hash, key_prefix = ExternalApiKey.generate_key()
    return ExternalApiKey.objects.create(
        tenant=tenant, name=name, system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix, **extra,
    ), raw


def _webhook(tenant, key, url=PUBLIC_URL, **extra):
    return WebhookConfig.objects.create(
        tenant=tenant, api_key=key, url=url, signing_secret="whsec_fixture", **extra
    )


@pytest.fixture
def cn_tenant(db):
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})[0]


@pytest.fixture
def eu_tenant(db):
    return Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})[0]


@pytest.fixture
def users(db, cn_tenant, eu_tenant):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    admin = User.objects.create_user(username="awh_admin", password="x", role="ADMIN", tenant=cn_tenant)
    viewer = User.objects.create_user(username="awh_viewer", password="x", role="VIEWER", tenant=cn_tenant)
    eu_admin = User.objects.create_user(username="awh_eu_admin", password="x", role="ADMIN", tenant=eu_tenant)
    return {
        "admin": _jwt_client(admin, cn_tenant),
        "viewer": _jwt_client(viewer, cn_tenant),
        "eu_admin": _jwt_client(eu_admin, eu_tenant),
    }


@pytest.fixture
def cn_key(cn_tenant):
    return _key(cn_tenant, "CN Hospital", can_manage_webhooks=True)


# ── Who may open which door ──────────────────────────────────────────


@pytest.mark.django_db
class TestAuth:
    def test_admin_jwt_lists(self, users, cn_tenant, cn_key):
        _webhook(cn_tenant, cn_key[0])
        resp = users["admin"].get(ADMIN_URL)
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1

    def test_non_admin_jwt_is_forbidden(self, users):
        assert users["viewer"].get(ADMIN_URL).status_code == status.HTTP_403_FORBIDDEN
        assert users["viewer"].post(ADMIN_URL, {}, format="json").status_code == status.HTTP_403_FORBIDDEN
        assert users["viewer"].get(DELIVERIES_URL).status_code == status.HTTP_403_FORBIDDEN

    def test_api_key_is_not_a_credential_on_the_admin_door(self, cn_key):
        client = _api_key_client(cn_key[1])
        assert client.get(ADMIN_URL).status_code == status.HTTP_401_UNAUTHORIZED
        assert client.get(DELIVERIES_URL).status_code == status.HTTP_401_UNAUTHORIZED

    def test_anonymous_is_401(self):
        assert APIClient().get(ADMIN_URL).status_code == status.HTTP_401_UNAUTHORIZED

    def test_self_service_door_is_unchanged(self, users, cn_tenant, cn_key):
        """JWT still 401 there; the key with the grant still sees its own rows."""
        key, raw = cn_key
        _webhook(cn_tenant, key)
        assert users["admin"].get(SELF_SERVICE_URL).status_code == status.HTTP_401_UNAUTHORIZED
        resp = _api_key_client(raw).get(SELF_SERVICE_URL)
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert "_signing_secret" not in resp.data["results"][0]


# ── Create / update / disable ────────────────────────────────────────


@pytest.mark.django_db
class TestCreate:
    def test_create_returns_the_secret_once_and_pins_the_tenant(self, users, cn_tenant, cn_key):
        resp = users["admin"].post(
            ADMIN_URL,
            {"api_key": str(cn_key[0].id), "url": PUBLIC_URL, "events": ["DEATH_SYNC_PROCESSED"]},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        secret = resp.data["_signing_secret"]
        assert secret.startswith("whsec_")
        row = WebhookConfig.objects.get(id=resp.data["id"])
        assert row.signing_secret == secret
        assert row.tenant == cn_tenant
        assert row.events == ["DEATH_SYNC_PROCESSED"]
        assert resp.data["api_key_name"] == "CN Hospital"
        assert "signing_secret" not in resp.data

        # Nowhere after the 201.
        listed = users["admin"].get(ADMIN_URL).data["results"][0]
        assert "_signing_secret" not in listed
        assert "signing_secret" not in listed
        got = users["admin"].get(f"{ADMIN_URL}{row.id}/").data
        assert "_signing_secret" not in got
        patched = users["admin"].patch(f"{ADMIN_URL}{row.id}/", {"is_active": False}, format="json").data
        assert "_signing_secret" not in patched

    def test_another_tenants_key_is_refused(self, users, eu_tenant):
        eu_key, _ = _key(eu_tenant, "EU Key")
        resp = users["admin"].post(ADMIN_URL, {"api_key": str(eu_key.id), "url": PUBLIC_URL}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "api_key" in resp.data
        assert WebhookConfig.objects.count() == 0

    @pytest.mark.parametrize(
        "url",
        [
            "ftp://203.0.113.10/hook",
            "https://127.0.0.1/hook",
            "https://10.0.0.5/hook",
            "https://[::1]/hook",
            "https://169.254.169.254/latest/meta-data",
        ],
    )
    def test_unsafe_urls_are_refused_at_the_boundary(self, users, cn_key, url):
        resp = users["admin"].post(ADMIN_URL, {"api_key": str(cn_key[0].id), "url": url}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST, url
        assert "url" in resp.data
        assert WebhookConfig.objects.count() == 0

    def test_an_unknown_event_is_refused(self, users, cn_key):
        resp = users["admin"].post(
            ADMIN_URL, {"api_key": str(cn_key[0].id), "url": PUBLIC_URL, "events": ["DEATH_SYNC_PROCESED"]},
            format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "events" in resp.data

    def test_event_types_is_the_enum_the_handler_filters_on(self, users):
        resp = users["admin"].get(f"{ADMIN_URL}event-types/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data == EventType.values
        assert "DEATH_SYNC_PROCESSED" in resp.data


@pytest.mark.django_db
class TestUpdateAndDisable:
    def test_patch_url_events_and_disable_keeps_the_row_and_its_deliveries(self, users, cn_tenant, cn_key):
        hook = _webhook(cn_tenant, cn_key[0])
        EventWebhookDelivery.objects.create(
            webhook=hook, tenant=cn_tenant, domain="death_sync",
            event_type="DEATH_SYNC_PROCESSED", payload_json={},
        )
        resp = users["admin"].patch(
            f"{ADMIN_URL}{hook.id}/",
            {"url": "https://203.0.113.11/v2", "events": ["SOUL_CREATED", "STATE_CHANGED"], "is_active": False},
            format="json",
        )
        assert resp.status_code == status.HTTP_200_OK, resp.data
        hook.refresh_from_db()
        assert hook.url == "https://203.0.113.11/v2"
        assert hook.events == ["SOUL_CREATED", "STATE_CHANGED"]
        assert hook.is_active is False
        assert hook.signing_secret == "whsec_fixture"
        assert EventWebhookDelivery.objects.filter(webhook=hook).count() == 1

    def test_patch_with_an_unsafe_url_is_refused(self, users, cn_tenant, cn_key):
        hook = _webhook(cn_tenant, cn_key[0])
        resp = users["admin"].patch(f"{ADMIN_URL}{hook.id}/", {"url": "http://192.168.1.1/"}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        hook.refresh_from_db()
        assert hook.url == PUBLIC_URL

    def test_a_webhook_cannot_be_moved_to_another_key(self, users, cn_tenant, cn_key):
        other, _ = _key(cn_tenant, "Other CN Key")
        hook = _webhook(cn_tenant, cn_key[0])
        resp = users["admin"].patch(f"{ADMIN_URL}{hook.id}/", {"api_key": str(other.id)}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        hook.refresh_from_db()
        assert hook.api_key == cn_key[0]

    def test_there_is_no_delete_route(self, users, cn_tenant, cn_key):
        hook = _webhook(cn_tenant, cn_key[0])
        assert users["admin"].delete(f"{ADMIN_URL}{hook.id}/").status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert WebhookConfig.objects.filter(id=hook.id).exists()


# ── Tenant scoping ───────────────────────────────────────────────────


def _queryset_for(view_cls, role, tenant):
    from types import SimpleNamespace

    view = view_cls()
    view.request = SimpleNamespace(user=SimpleNamespace(role=role, is_authenticated=True), tenant=tenant)
    return view.get_queryset()


@pytest.mark.django_db
class TestTenantScoping:
    @pytest.fixture(autouse=True)
    def rows(self, cn_tenant, eu_tenant):
        self.cn_key, _ = _key(cn_tenant, "CN")
        self.eu_key, _ = _key(eu_tenant, "EU")
        self.cn_hook = _webhook(cn_tenant, self.cn_key)
        self.eu_hook = _webhook(eu_tenant, self.eu_key)
        self.cn_delivery = EventWebhookDelivery.objects.create(
            webhook=self.cn_hook, tenant=cn_tenant, domain="d", event_type="SOUL_CREATED", payload_json={}
        )
        # `tenant` left null on purpose: scoping goes through the webhook.
        self.eu_delivery = EventWebhookDelivery.objects.create(
            webhook=self.eu_hook, tenant=None, domain="d", event_type="SOUL_CREATED", payload_json={}
        )

    def test_non_admin_branch_scopes_both_viewsets_by_tenant(self, cn_tenant):
        from apps.death_sync.views import AdminWebhookDeliveryViewSet, AdminWebhookViewSet

        assert list(_queryset_for(AdminWebhookViewSet, "VIEWER", cn_tenant)) == [self.cn_hook]
        assert list(_queryset_for(AdminWebhookDeliveryViewSet, "VIEWER", cn_tenant)) == [self.cn_delivery]

    def test_admin_bypass_matches_the_api_key_viewset(self, cn_tenant):
        """One global role, the same way on all three admin doors of this app."""
        from apps.death_sync.views import AdminWebhookViewSet, ExternalApiKeyViewSet

        keys = set(_queryset_for(ExternalApiKeyViewSet, "ADMIN", cn_tenant))
        hooks = set(_queryset_for(AdminWebhookViewSet, "ADMIN", cn_tenant))
        assert keys == {self.cn_key, self.eu_key}
        assert hooks == {self.cn_hook, self.eu_hook}


# ── Deliveries ───────────────────────────────────────────────────────


@pytest.mark.django_db
class TestDeliveries:
    def test_newest_first_paginated_filterable_and_without_the_payload(self, users, cn_tenant, cn_key):
        a = _webhook(cn_tenant, cn_key[0])
        b = _webhook(cn_tenant, cn_key[0], url="https://203.0.113.12/b")
        rows = []
        for i in range(25):
            rows.append(EventWebhookDelivery.objects.create(
                webhook=a if i % 2 == 0 else b, tenant=cn_tenant, domain="death_sync",
                event_type="DEATH_SYNC_PROCESSED", payload_json={"soul_id": "secret"},
                status=EventWebhookStatus.FAILED if i == 24 else EventWebhookStatus.SUCCESS,
                attempt=i, error="boom" if i == 24 else "",
            ))
        # create_time is auto_now_add and the loop is sub-millisecond on
        # SQLite; make the ordering unambiguous by spacing them out.
        from datetime import timedelta

        from django.utils import timezone

        base = timezone.now()
        for i, row in enumerate(rows):
            EventWebhookDelivery.objects.filter(id=row.id).update(create_time=base + timedelta(seconds=i))

        resp = users["admin"].get(DELIVERIES_URL)
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 25
        assert len(resp.data["results"]) == 20
        first = resp.data["results"][0]
        assert str(first["id"]) == str(rows[24].id)
        assert first["status"] == "FAILED"
        assert first["attempt"] == 24
        assert first["error"] == "boom"
        assert first["event_type"] == "DEATH_SYNC_PROCESSED"
        assert str(first["webhook"]) == str(a.id)
        assert first["webhook_url"] == PUBLIC_URL
        assert "payload_json" not in first
        assert [r["attempt"] for r in resp.data["results"]] == list(range(24, 4, -1))

        page2 = users["admin"].get(DELIVERIES_URL, {"page": 2}).data
        assert [r["attempt"] for r in page2["results"]] == list(range(4, -1, -1))

        only_b = users["admin"].get(DELIVERIES_URL, {"webhook": str(b.id)}).data
        assert only_b["count"] == 12
        assert {str(r["webhook"]) for r in only_b["results"]} == {str(b.id)}

        failed = users["admin"].get(DELIVERIES_URL, {"status": "FAILED"}).data
        assert failed["count"] == 1

    def test_read_only(self, users, cn_tenant, cn_key):
        hook = _webhook(cn_tenant, cn_key[0])
        row = EventWebhookDelivery.objects.create(
            webhook=hook, tenant=cn_tenant, domain="d", event_type="SOUL_CREATED", payload_json={}
        )
        assert users["admin"].post(DELIVERIES_URL, {}, format="json").status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert users["admin"].delete(f"{DELIVERIES_URL}{row.id}/").status_code == status.HTTP_405_METHOD_NOT_ALLOWED
