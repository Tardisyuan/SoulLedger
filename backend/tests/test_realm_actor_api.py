"""
Tests for Realm and Actor API endpoints.
"""
import pytest

from apps.actors.models import Actor, ActorRole
from apps.realms.models import Realm, RealmType
from apps.souls.models import Civilization


@pytest.mark.django_db
class TestRealmAPI:
    """Test /api/v1/realms/ endpoints."""

    def test_list_realms(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/realms/ returns realms."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        Realm.objects.create(
            realm_code="TEST_REALM",
            civilization=Civilization.CHINESE,
            name_local="测试地域",
            name_en="Test Realm",
            realm_type=RealmType.PURGATORY,
            tenant=cn_tenant,
        )

        response = api_client.get("/api/v1/realms/")
        assert response.status_code == 200

    def test_list_realms_unauthenticated(self, api_client):
        """GET /api/v1/realms/ without auth returns 401."""
        response = api_client.get("/api/v1/realms/")
        assert response.status_code == 401

    def test_realms_select_related_parent(self, api_client, admin_user, cn_tenant):
        """Realms endpoint uses select_related for parent_realm."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        parent = Realm.objects.create(
            realm_code="PARENT", civilization=Civilization.CHINESE,
            name_local="父级", name_en="Parent",
            realm_type=RealmType.PURGATORY, tenant=cn_tenant,
        )
        Realm.objects.create(
            realm_code="CHILD", civilization=Civilization.CHINESE,
            name_local="子级", name_en="Child",
            realm_type=RealmType.HELL, parent_realm=parent,
            tenant=cn_tenant,
        )

        response = api_client.get("/api/v1/realms/")
        assert response.status_code == 200


@pytest.mark.django_db
class TestActorAPI:
    """Test /api/v1/actors/ endpoints."""

    def test_list_actors(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/actors/ returns actors."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        Actor.objects.create(
            name="测试角色",
            role=ActorRole.JUDGE,
            civilization=Civilization.CHINESE,
            tenant=cn_tenant,
        )

        response = api_client.get("/api/v1/actors/")
        assert response.status_code == 200

    def test_list_actors_unauthenticated(self, api_client):
        """GET /api/v1/actors/ without auth returns 401."""
        response = api_client.get("/api/v1/actors/")
        assert response.status_code == 401


def _authenticate(api_client, user):
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")


@pytest.mark.django_db
class TestActorBenchOfFortyTwo:
    """The list endpoint has to distinguish the bench of 42 from the major gods.

    Both halves are needed and neither implies the other: the serializer says
    WHICH actors hold a seat, the queryset says in WHAT ORDER they come back.
    A client that got only the first would still have to know that
    `Actor.Meta.ordering` sorts the bench alphabetically; one that got only the
    second could not tell an assessor from Osiris.
    """

    # Names chosen so alphabetical and canonical order disagree — the same
    # property tests/test_seed_mythology.py pins on the real seed data. Sorted
    # by name these read Aati, Neha-hau, Usekht-nemmat; by seat they do not.
    BENCH = [("Usekht-nemmat", 1), ("Neha-hau", 5), ("Aati", 17)]

    def _seed(self, tenant):
        for name, index in self.BENCH:
            Actor.objects.create(
                name=name, role=ActorRole.JUDGE,
                civilization=Civilization.EGYPTIAN, tenant=tenant,
                powers_json={
                    "assessor_index": index,
                    "negative_confession": "a clause the list has no use for",
                },
            )
        Actor.objects.create(
            name="Osiris", role=ActorRole.JUDGE,
            civilization=Civilization.EGYPTIAN, tenant=tenant,
            powers_json={"domain": "the weighing"},
        )

    def _egyptians(self, api_client):
        response = api_client.get("/api/v1/actors/?civilization=EGYPTIAN")
        assert response.status_code == 200
        return response.data["results"]

    def test_seat_number_is_on_the_list_row(self, api_client, admin_user, cn_tenant):
        """`assessor_index` distinguishes the bench; None is the major gods."""
        _authenticate(api_client, admin_user)
        self._seed(cn_tenant)

        seats = {row["name"]: row["assessor_index"] for row in self._egyptians(api_client)}
        assert seats == {
            "Usekht-nemmat": 1, "Neha-hau": 5, "Aati": 17, "Osiris": None
        }, (
            "The list row must carry the seat. Without it the client cannot "
            "tell an assessor from a major god, because both are EGYPTIAN "
            f"JUDGEs and nothing else on the row differs. Got: {seats}"
        )

    def test_the_rest_of_powers_json_stays_off_the_list(self, api_client, admin_user, cn_tenant):
        """One key, not the payload — the confession clauses are bulk here."""
        _authenticate(api_client, admin_user)
        self._seed(cn_tenant)

        rows = self._egyptians(api_client)
        assert all("powers_json" not in row for row in rows), (
            "The list endpoint is exposing the whole powers_json. Only "
            "assessor_index belongs on a list row; negative_confession, "
            "source_edition and source_notes are hundreds of bytes each, "
            "repeated across 42 rows."
        )
        assert all(
            "negative_confession" not in str(row) for row in rows
        ), "A confession clause reached the list payload by some other name."

    def test_the_bench_comes_back_in_the_order_the_text_seats_it(
        self, api_client, admin_user, cn_tenant
    ):
        """Seat order, not name order — and the major gods still lead."""
        _authenticate(api_client, admin_user)
        self._seed(cn_tenant)

        names = [row["name"] for row in self._egyptians(api_client)]
        assert names == ["Osiris", "Usekht-nemmat", "Neha-hau", "Aati"], (
            "Egyptian JUDGEs came back in the wrong order. Expected the major "
            "gods first (no seat), then the bench by assessor_index 1, 5, 17. "
            f"Alphabetical order would be {sorted(names)}. Got: {names}"
        )

    def test_an_explicit_ordering_still_wins(self, api_client, admin_user, cn_tenant):
        """The seat order is the default, not a lock on the endpoint."""
        _authenticate(api_client, admin_user)
        self._seed(cn_tenant)

        response = api_client.get("/api/v1/actors/?civilization=EGYPTIAN&ordering=name")
        names = [row["name"] for row in response.data["results"]]
        assert names == sorted(names), (
            "?ordering=name no longer reaches the queryset — the viewset's "
            f"default clause is overriding OrderingFilter. Got: {names}"
        )
