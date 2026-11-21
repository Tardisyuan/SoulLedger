"""`?ordering=` with a name the queryset cannot order by is ignored, never a 500 (apps/core/shard_search.py).

A view that sets no `ordering_fields` lets DRF accept every serializer field name, and some are no path at all:
`/death-sync/api-keys/?ordering=_raw_key`, `/death-sync/webhooks/?ordering=_signing_secret`, the officer inbox's
`?ordering=unread` / `has_draft` / `archived` / `tenant__hall_names` -- FieldError, 500 (2026-11-21). This walks
every routed view with an ordering backend, on one database, and drives it with each term DRF lists plus names it
must never order by. The sharded walk is `test_crossing_key_filters.py`, which drives the same terms on a shard.

Mutation: `ShardOrderingFilter.remove_invalid_fields` removed -> FieldError on the api keys, the webhooks and the
inbox, red."""
import pytest
from django.urls import resolve

from tests.test_crossing_key_filters import _ordering_failures

#: The sorts the web and the apps send (grep `ordering` in frontend/, packages/core/, mobile*/): each stays applied.
#: (`/souls/?ordering=karmic_balance` is not an ordering term: SoulViewSet.get_queryset orders by karma itself.)
USED_SORTS = [("/api/v1/disposition/", "term_end"), ("/api/v1/judgment/appeals/", "create_time"),
              ("/api/v1/judgment/", "-created_at"), ("/api/v1/souls/", "name"),
              ("/api/v1/audit-logs/", "-timestamp"), ("/api/v1/users/", "username"), ("/api/v1/users/", "email"),
              ("/api/v1/users/", "role"), ("/api/v1/dispatch/records/", "-proposed_at"),
              ("/api/v1/dispatch/cross-tenant-judgments/", "-create_time"), ("/api/v1/events/", "create_time"),
              ("/api/v1/judgment/statutes/", "code")]


@pytest.mark.django_db
def test_no_ordering_term_of_any_viewset_is_a_500(admin_user, cn_tenant):
    failed, ran = _ordering_failures(admin_user, cn_tenant, shard_only=False)
    assert failed == []
    assert {"ExternalApiKeyViewSet", "WebhookViewSet", "OfficerInboxViewSet"} <= ran  # not vacuous


@pytest.mark.django_db
@pytest.mark.parametrize("path,term", USED_SORTS)
def test_a_sort_the_clients_send_is_still_applied(path, term, admin_user, cn_tenant):
    from apps.core.shard_search import ShardOrderingFilter
    from tests.test_crossing_key_filters import _request, _view

    cls = resolve(path).func.cls
    request = _request({"ordering": term}, admin_user, cn_tenant)
    view = _view(cls, request)
    qs = view.get_queryset()
    assert ShardOrderingFilter().get_ordering(request, qs, view) == [term]


@pytest.mark.django_db
@pytest.mark.parametrize("path,term", [("/api/v1/death-sync/api-keys/", "_raw_key"),
                                       ("/api/v1/death-sync/api-keys/", "-unknown")])
def test_a_secret_name_is_ignored_over_http(path, term, admin_user):  # webhooks: the walk above (a hall's admin)
    from rest_framework.test import APIClient

    from tests.conftest import sign_in

    client = sign_in(APIClient(), admin_user)
    response = client.get(path, {"ordering": term})
    assert response.status_code == 200, response.content[:300]
