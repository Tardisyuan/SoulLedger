"""`GET /api/v1/judgment/next/` — the triage queue cursor (BRIEF §4.2).

The endpoint answers one question the paginated list cannot: *what do I decide
next, and what do I need in front of me to decide it*. These tests hold three
properties that are easy to lose and expensive to lose quietly:

1. It hands out exactly one case, the oldest pending one, and never a case that
   has already been ruled on, deleted, or archived.
2. It is tenant-scoped through ``apps.core.tenant`` like every other read on
   this viewset. ``backend/tests/test_tenant_scoping_contract.py`` proves the
   *viewset* routes through the helper; this file proves the *action* built on
   top of it did not quietly widen the scope by building its own queryset.
3. Skipping is not a data change. It is a query parameter and nothing else —
   no field on the judgment moves, and another operator's queue is unaffected.
"""
import uuid

import pytest

from apps.judgment.models import Judgment, Verdict
from apps.realms.models import Realm
from apps.reincarnation.models import Reincarnation
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

URL = "/api/v1/judgment/next/"


@pytest.mark.django_db
class TestJudgmentQueueCursor:
    @pytest.fixture
    def soul(self, cn_tenant):
        return Soul.objects.create(
            name="待判之魂",
            birth_date="1900-01-01",
            current_state=SoulState.JUDGING,
            tenant=cn_tenant,
        )

    @pytest.fixture
    def other_soul(self, cn_tenant):
        return Soul.objects.create(
            name="次待判之魂",
            birth_date="1901-01-01",
            current_state=SoulState.JUDGING,
            tenant=cn_tenant,
        )

    @pytest.fixture
    def admin_client(self, api_client, admin_user):
        api_client.force_authenticate(user=admin_user)
        return api_client

    @pytest.fixture
    def judge_headers(self, judge_user):
        """A real JUDGE caller: grants + a token carrying `tenant_code`.

        Two things have to be true and neither comes for free:

        * `apps.perm.checker` is DB-authoritative for seeded codenames, and a
          role with no RolePermission row is denied every one of them whatever
          ROLE_PERMISSIONS says — so the grants are made explicitly, the same
          way tests/test_websocket.py's judge fixture does.
        * `request.tenant` is resolved by TenantMiddleware from the access
          token's `tenant_code` claim, so `force_authenticate` alone leaves it
          None and TenantPermission refuses every non-ADMIN. ADMIN never
          notices because it bypasses both — which is exactly why the isolation
          test below has to use a JUDGE.
        """
        from rest_framework_simplejwt.tokens import RefreshToken

        from apps.perm.models import Permission, Role, RolePermission

        role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
        for codename in ("judgment.read", "judgment.execute"):
            permission, _ = Permission.objects.get_or_create(
                codename=codename,
                defaults={"name": codename, "category": "judgment"},
            )
            RolePermission.objects.get_or_create(role=role, permission=permission)

        token = RefreshToken.for_user(judge_user)
        token["tenant_code"] = judge_user.tenant.code
        return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}

    def _pending(self, soul, tenant, court="第一殿"):
        return Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court=court,
            tenant=tenant,
        )

    # -- the basic contract -------------------------------------------------

    def test_empty_queue_is_a_200_not_a_404(self, admin_client):
        """"Nothing left" is a renderable answer, not an error. A 404 here
        would drive the client's error boundary at the end of every session."""
        response = admin_client.get(URL)
        assert response.status_code == 200
        assert response.data["judgment"] is None
        assert response.data["total"] == 0
        assert response.data["position"] is None

    def test_returns_the_oldest_pending_case_first(self, admin_client, soul, other_soul, cn_tenant):
        first = self._pending(soul, cn_tenant, court="第一殿")
        self._pending(other_soul, cn_tenant, court="第二殿")

        response = admin_client.get(URL)
        assert response.status_code == 200
        # Judgment.Meta.ordering is -created_at; the queue must override it, or
        # the operator works the newest case and the oldest never surfaces.
        assert response.data["judgment"]["id"] == str(first.id)
        assert response.data["total"] == 2
        assert response.data["remaining"] == 2
        assert response.data["position"] == 1

    def test_carries_the_whole_decision_surface(self, admin_client, soul, cn_tenant):
        SoulRecord.objects.create(
            soul=soul,
            record_type="MERIT",
            description="修桥铺路",
            weight=30,
        )
        Reincarnation.objects.create(
            soul=soul,
            target_realm="DY_COURT_10_ZHUANLUN",
            cycle_count=1,
            tenant=cn_tenant,
        )
        Realm.objects.create(
            realm_code="DY_01_HEAVEN",
            civilization=soul.civilization,
            name_local="天道",
            realm_type="HEAVEN",
            tenant=cn_tenant,
        )
        self._pending(soul, cn_tenant)

        response = admin_client.get(URL)
        body = response.data
        assert body["soul"]["name"] == "待判之魂"
        assert body["ledger"]["merit_score"] > 0
        assert [c["cycle_count"] for c in body["prior_cycles"]] == [1]
        assert [r["realm_code"] for r in body["realm_options"]] == ["DY_01_HEAVEN"]

    def test_concluded_cases_never_appear(self, admin_client, soul, cn_tenant):
        judgment = self._pending(soul, cn_tenant)
        judgment.conclude(Verdict.PASSED, "done")

        response = admin_client.get(URL)
        assert response.data["judgment"] is None
        assert response.data["total"] == 0

    def test_archived_and_deleted_cases_never_appear(self, admin_client, soul, other_soul, cn_tenant, admin_user):
        archived = self._pending(soul, cn_tenant)
        archived.archive(user=admin_user, reason="录入重复")
        deleted = self._pending(other_soul, cn_tenant)
        deleted.delete_or_raise(user=admin_user, reason="录入重复")

        response = admin_client.get(URL)
        assert response.data["judgment"] is None
        assert response.data["total"] == 0

    # -- skipping is a view, not a write ------------------------------------

    def test_skip_hides_the_case_and_moves_the_cursor_on(self, admin_client, soul, other_soul, cn_tenant):
        first = self._pending(soul, cn_tenant)
        second = self._pending(other_soul, cn_tenant)

        response = admin_client.get(URL, {"skip": str(first.id)})
        assert response.data["judgment"]["id"] == str(second.id)
        assert response.data["total"] == 2
        assert response.data["remaining"] == 1
        assert response.data["skipped"] == 1
        # 2 total - 1 remaining + 1 => the second of two.
        assert response.data["position"] == 2

    def test_skip_changes_nothing_about_the_record(self, admin_client, soul, cn_tenant):
        judgment = self._pending(soul, cn_tenant)
        before = Judgment.objects.get(id=judgment.id)

        admin_client.get(URL, {"skip": str(judgment.id)})

        after = Judgment.objects.get(id=judgment.id)
        assert after.verdict == before.verdict is None
        assert after.is_final is False
        assert after.is_deleted is False
        assert after.is_archived is False
        # And it is back for the next caller — skipping is per-request state.
        assert admin_client.get(URL).data["judgment"]["id"] == str(judgment.id)

    def test_skip_accepts_repeated_and_comma_joined_forms(self, admin_client, soul, other_soul, cn_tenant):
        first = self._pending(soul, cn_tenant)
        second = self._pending(other_soul, cn_tenant)

        joined = admin_client.get(URL, {"skip": f"{first.id},{second.id}"})
        assert joined.data["judgment"] is None
        assert joined.data["skipped"] == 2

        repeated = admin_client.get(f"{URL}?skip={first.id}&skip={second.id}")
        assert repeated.data["judgment"] is None
        assert repeated.data["skipped"] == 2

    def test_unparseable_skip_ids_are_ignored_not_rejected(self, admin_client, soul, cn_tenant):
        """A stale or truncated entry in the caller's own skip list must show
        the item again, never 400 the request that renders it."""
        judgment = self._pending(soul, cn_tenant)
        response = admin_client.get(URL, {"skip": "not-a-uuid,,   "})
        assert response.status_code == 200
        assert response.data["judgment"]["id"] == str(judgment.id)
        assert response.data["skipped"] == 0

    # -- entering the queue on a named case ---------------------------------

    def test_at_enters_the_queue_on_the_named_case(self, admin_client, soul, other_soul, cn_tenant):
        self._pending(soul, cn_tenant)
        second = self._pending(other_soul, cn_tenant)

        response = admin_client.get(URL, {"at": str(second.id)})
        assert response.data["judgment"]["id"] == str(second.id)
        # Jumping the queue reports where the case really sits, not "1 of 2".
        assert response.data["position"] == 2

    def test_at_falls_through_to_the_head_when_the_case_is_gone(self, admin_client, soul, other_soul, cn_tenant):
        """The deep link from a soul's lifecycle spine was valid when the page
        rendered. If the case has since been concluded, land the operator at
        the head of the queue rather than on a dead end."""
        head = self._pending(soul, cn_tenant)
        stale = self._pending(other_soul, cn_tenant)
        stale.conclude(Verdict.PASSED, "already ruled")

        response = admin_client.get(URL, {"at": str(stale.id)})
        assert response.data["judgment"]["id"] == str(head.id)

        unknown = admin_client.get(URL, {"at": str(uuid.uuid4())})
        assert unknown.data["judgment"]["id"] == str(head.id)

        malformed = admin_client.get(URL, {"at": "not-a-uuid"})
        assert malformed.status_code == 200
        assert malformed.data["judgment"]["id"] == str(head.id)

    # -- isolation ----------------------------------------------------------

    def test_another_tenants_pending_case_is_not_handed_out(
        self, api_client, judge_headers, cn_tenant, soul
    ):
        """The action builds its own queryset on top of get_queryset(); this is
        the test that it did not build its own *scope*. judge_user is TENANT
        scoped, so the European case must be invisible to it."""
        eu_tenant = Tenant.objects.create(code="EU_HEAVEN_HELL", display_name="European")
        eu_soul = Soul.objects.create(
            name="European Soul", current_state=SoulState.JUDGING, tenant=eu_tenant
        )
        self._pending(eu_soul, eu_tenant, court="Curia")
        mine = self._pending(soul, cn_tenant)

        response = api_client.get(URL, **judge_headers)
        assert response.status_code == 200
        assert response.data["judgment"]["id"] == str(mine.id)
        assert response.data["total"] == 1

    def test_unauthenticated_is_refused(self, api_client):
        assert api_client.get(URL).status_code in (401, 403)

    def test_viewer_without_judgment_read_is_refused(self, api_client, viewer_user, soul, cn_tenant):
        """VIEWER holds no judgment.* codename (see JudgmentViewSet's note), and
        `next` maps to judgment.read rather than to a codename nobody holds."""
        self._pending(soul, cn_tenant)
        api_client.force_authenticate(user=viewer_user)
        assert api_client.get(URL).status_code == 403

    def test_judge_may_read_the_queue(self, api_client, judge_headers, soul, cn_tenant):
        judgment = self._pending(soul, cn_tenant)
        response = api_client.get(URL, **judge_headers)
        assert response.status_code == 200
        assert response.data["judgment"]["id"] == str(judgment.id)

    # -- the loop the queue exists to close ---------------------------------

    def test_ruling_removes_the_case_and_the_queue_advances(
        self, admin_client, soul, other_soul, cn_tenant
    ):
        """The whole point of §4.2: verdict in, next case out, no navigation."""
        first = self._pending(soul, cn_tenant)
        second = self._pending(other_soul, cn_tenant)

        assert admin_client.get(URL).data["judgment"]["id"] == str(first.id)

        # Deliberately with an empty note: that is what both clients post when
        # the operator does not type one, and it used to 400. See
        # JudgmentConcludeSerializer.notes.
        concluded = admin_client.post(
            f"/api/v1/judgment/{first.id}/conclude/",
            {"verdict": Verdict.PASSED, "notes": ""},
            format="json",
        )
        assert concluded.status_code == 200

        after = admin_client.get(URL)
        assert after.data["judgment"]["id"] == str(second.id)
        assert after.data["total"] == 1
