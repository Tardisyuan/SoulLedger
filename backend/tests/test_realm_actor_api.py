"""
Tests for Realm and Actor API endpoints.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

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

    def test_realms_listing_does_not_cost_a_query_per_row(
        self, api_client, admin_user, cn_tenant
    ):
        """列表的查询条数不随行数增长。

        **改过名。** 它原来叫 `test_realms_select_related_parent`,声称验证
        `select_related` —— 而全部断言是 `== 200`。删掉那句 `select_related`
        不可能改变状态码,所以它对自己声称的属性**逻辑上不可能变红**。

        实测(2026-08-31,10 个子 realm 挂一个父):带 `select_related` 与去掉
        它,**都是 4 条 SQL**。`RealmSerializer` 把 `parent_realm` 渲染成主键
        id,不取那一行,所以那里根本没有可省的 join —— 那个 `select_related`
        是个空操作,而这条测试原来的名字替它做了担保。

        所以这里断的是真正成立的性质:条数不随行数增长。上界而不是精确值 ——
        精确值会因无关改动报红,于是被人调大,于是不再是守卫。
        """
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

        # 断查询条数,不是断状态码。
        #
        # 这条测试的名字声称验证 `select_related` —— 而它的全部断言曾经是
        # `== 200`。**删掉那句 `select_related` 不可能改变状态码**,所以它对自己
        # 声称的属性逻辑上不可能变红。
        #
        # 上界而不是精确值:精确值会因任何无关改动报红,于是被人调大,于是不再是
        # 守卫。上界给的是「不随行数线性增长」这个性质。
        with CaptureQueriesContext(connection) as captured:
            response = api_client.get("/api/v1/realms/")
        assert response.status_code == 200
        body = response.json()
        rows = body["results"] if isinstance(body, dict) else body
        assert len(rows) >= 2, f"只返回了 {len(rows)} 行 —— 下面那条上界形同虚设"
        assert len(captured) <= 8, (
            f"{len(captured)} 条 SQL —— parent_realm 又变回每行一查了。"
            f"queries: {[q['sql'][:80] for q in captured]}"
        )


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


@pytest.mark.django_db
class TestRealmDescriptionStaysOffTheCard:
    """Where `Realm.description` goes, and the TODO that asked the wrong thing.

    `frontend/app/realms/page.tsx` carried `{/* TODO: Add description field to
    Realm API response */}` on the realm card. Half of it was accurate: the
    field is on the model and in `RealmSerializer`, but `RealmListSerializer` —
    which is what `get_serializer_class` returns for `action == "list"`, and the
    list is what that page fetches — does not carry it. So the payload really
    did lack the field the comment named.

    The other half was wrong, and it is the half that would have shipped. What
    `description` holds is provenance prose for maintainers, written in English
    with citations embedded in it — "Second terrace: envy. The penitent's
    eyelids are sewn shut with iron wire (Purg. XIII-XV)" — and in one case a
    review finding addressed to whoever reads the seed table next: DY_02_YANGLIU
    says "SOURCE UNKNOWN: no underworld place by this name appears in 《玉历宝钞》
    or 《十王经》; treat as this project's own element until a source is
    produced". None of that is product copy, and a UI whose default locale is
    zh-Hans would have been rendering it untranslated on every card.

    Realm text that *is* product copy already has a home: the page reads
    `realms.names.<code>` and `realms.codes.<code>` out of the three message
    bundles, which is the same split `66a5a3f` and `52cf8e4` drew for the
    ledger — a string a component renders belongs where the translations are.
    Adding `description` to the list serializer in order to display it would
    have crossed that line in the one direction those two commits spent their
    effort closing.

    Same shape as `test_the_rest_of_powers_json_stays_off_the_list` above: one
    field being on the model is not an argument for it being on a list row.
    """

    def _realm(self, tenant):
        return Realm.objects.create(
            realm_code="DESC_REALM", civilization=Civilization.CHINESE,
            name_local="记述地域", name_en="Described Realm",
            realm_type=RealmType.HELL, tenant=tenant,
            description="SOURCE UNKNOWN: maintainer prose, not product copy",
        )

    def test_the_list_row_does_not_carry_the_seed_prose(
        self, api_client, admin_user, cn_tenant
    ):
        _authenticate(api_client, admin_user)
        realm = self._realm(cn_tenant)

        rows = api_client.get("/api/v1/realms/").data["results"]
        row = next(r for r in rows if r["realm_code"] == realm.realm_code)

        assert "description" not in row, (
            "RealmListSerializer is shipping `description` to the realms grid. "
            "It is unlocalized maintainer prose — source notes, citations, and "
            "in one row a 「查不到出处」 finding — and the page it feeds defaults "
            "to zh-Hans. If a realm blurb is genuinely wanted on the card, it "
            "belongs in the three message bundles keyed on realm_code, beside "
            "realms.names and realms.codes; it does not belong on this row."
        )
        # Absence asserted by content as well as by key: the same prose arriving
        # under `notes` or `summary` would be the identical mistake renamed.
        assert "SOURCE UNKNOWN" not in str(row)

    def test_the_detail_row_still_carries_it(self, api_client, admin_user, cn_tenant):
        """Not hidden — placed. A maintainer reading one realm still gets it."""
        _authenticate(api_client, admin_user)
        realm = self._realm(cn_tenant)

        detail = api_client.get(f"/api/v1/realms/{realm.pk}/").data

        assert detail["description"] == realm.description
