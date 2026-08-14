"""
Field-level permissions on SoulSerializer.

Two layers guard a soul's fields and they are not interchangeable.

The hardcoded VIEWER checks in apps/souls/serializers.py are the floor: they
hold whether or not anything is seeded. FieldPermissionMixin reads
FieldPermission rows and narrows further. It cannot be the only guard,
because the rules live in a management command — an unseeded database has no
rows, get_field_rules returns nothing, and a DB-only guard would hand VIEWER
every field. Fail-closed floor, DB-driven refinement on top.

Nothing tested either layer before. The mixin shipped wired into three
serializers, the FieldPermission model shipped, seed_field_permissions
shipped rules naming merit_score and demerit_score, and no test anywhere
asserted that a rule ever changed a payload.
"""
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.perm.models import FieldPermission, Permission, Role, RolePermission
from apps.souls.models import Soul, SoulState
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
class TestSoulFieldPermissions:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
        )[0]
        self.soul = Soul.objects.create(
            name="Scored Soul", tenant=self.tenant,
            current_state=SoulState.JUDGING, merit_score=40, demerit_score=15,
        )
        self.clients = {}
        for role in ("ADMIN", "VIEWER", "JUDGE"):
            user = User.objects.create_user(
                username=f"fp_{role.lower()}", password="test123",
                role=role, tenant=self.tenant,
            )
            self.clients[role] = _jwt_client(user, self.tenant)

    def _rule(self, role_name, field_name, **flags):
        """Seed one FieldPermission row the way the command would."""
        role, _ = Role.objects.get_or_create(
            name=role_name, defaults={"display_name": role_name.title()}
        )
        return FieldPermission.objects.create(
            role=role, model_name="Soul", field_name=field_name,
            **{"visible": True, "read_only": False, "editable": True, **flags},
        )

    # ---- the hardcoded floor -------------------------------------------

    def test_viewer_never_receives_the_scores_even_with_no_rules_seeded(self):
        """The floor, with an empty FieldPermission table.

        This is the case a DB-only guard gets wrong: no rows, nothing to
        apply, and every field goes out.
        """
        assert FieldPermission.objects.count() == 0
        body = self.clients["VIEWER"].get(f"{BASE}/{self.soul.id}/").json()
        assert "merit_score" not in body
        assert "demerit_score" not in body
        assert "karmic_balance" not in body
        assert body["name"] == "Scored Soul"  # not a blanket denial

    def test_admin_receives_the_scores(self):
        body = self.clients["ADMIN"].get(f"{BASE}/{self.soul.id}/").json()
        assert body["merit_score"] == 40
        assert body["demerit_score"] == 15

    def test_judge_receives_the_scores(self):
        body = self.clients["JUDGE"].get(f"{BASE}/{self.soul.id}/").json()
        assert body["merit_score"] == 40

    # ---- the DB-driven layer -------------------------------------------

    def test_a_seeded_rule_removes_a_field_the_floor_does_not_touch(self):
        """Proof the mixin is live rather than merely inherited.

        origin_location is picked precisely because no hardcoded check
        mentions it — if this passes, the removal came from the rule.
        """
        before = self.clients["VIEWER"].get(f"{BASE}/{self.soul.id}/").json()
        assert "origin_location" in before

        self._rule("VIEWER", "origin_location", visible=False)

        after = self.clients["VIEWER"].get(f"{BASE}/{self.soul.id}/").json()
        assert "origin_location" not in after, (
            "FieldPermissionMixin is wired into SoulSerializer but a "
            "visible=False rule changed nothing — the layer is inert"
        )

    def _grant(self, role_name, codename):
        """Give a role the RBAC codename, so the request reaches the serializer.

        Without it the request stops at CodenamePermission with a 403 and the
        field rule is never consulted — a green test that proves nothing about
        field permissions.
        """
        role, _ = Role.objects.get_or_create(
            name=role_name, defaults={"display_name": role_name.title()}
        )
        perm, _ = Permission.objects.get_or_create(
            codename=codename,
            defaults={"name": codename, "category": "soul"},
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)

    def test_a_rule_can_make_a_writable_field_read_only(self):
        self._grant("JUDGE", "soul.update")
        self._rule("JUDGE", "description", read_only=True, editable=False)

        resp = self.clients["JUDGE"].patch(
            f"{BASE}/{self.soul.id}/", {"description": "edited"}, format="json"
        )
        assert resp.status_code == status.HTTP_200_OK
        self.soul.refresh_from_db()
        assert self.soul.description != "edited", "read_only rule did not hold"

    def test_the_same_field_is_writable_without_the_rule(self):
        """Control for the test above — otherwise the 403-shaped failure and
        the read_only-worked success look identical from the outside."""
        self._grant("JUDGE", "soul.update")
        resp = self.clients["JUDGE"].patch(
            f"{BASE}/{self.soul.id}/", {"description": "edited"}, format="json"
        )
        assert resp.status_code == status.HTTP_200_OK
        self.soul.refresh_from_db()
        assert self.soul.description == "edited"

    def test_admin_bypasses_the_rules(self):
        """ADMIN skips the mixin outright — see _apply_field_permissions."""
        self._rule("ADMIN", "origin_location", visible=False)
        body = self.clients["ADMIN"].get(f"{BASE}/{self.soul.id}/").json()
        assert "origin_location" in body

    def test_a_rule_for_another_role_leaves_this_one_alone(self):
        self._rule("JUDGE", "origin_location", visible=False)
        body = self.clients["VIEWER"].get(f"{BASE}/{self.soul.id}/").json()
        assert "origin_location" in body

    # ---- the two layers must not contradict each other -------------------

    def test_the_seeded_soul_rules_agree_with_what_the_serializer_does(self):
        """The defect that started this: a rule that described nothing.

        seed_field_permissions declared VIEWER's scores visible=True while
        the serializer removed them from the payload. Whichever way that
        disagreement is resolved, the two must not be allowed to drift apart
        again silently — widening VIEWER back to reading scores is a
        security decision, and it should have to break this test first.
        """
        call_command("seed_field_permissions")

        for field in ("merit_score", "demerit_score"):
            rule = FieldPermission.objects.get(
                role__name="VIEWER", model_name="Soul", field_name=field
            )
            assert rule.visible is False, (
                f"seed says VIEWER may see Soul.{field}, but SoulSerializer "
                f"drops it from the payload. One of them is lying."
            )

    def test_the_seeded_rules_do_not_re_open_the_scores(self):
        """Belt to the previous test's braces: assert on the payload, not the row.

        A rule row can be right while the wiring that reads it is wrong, so
        this seeds for real and then looks at what a VIEWER receives.
        """
        call_command("seed_field_permissions")
        body = self.clients["VIEWER"].get(f"{BASE}/{self.soul.id}/").json()
        assert "merit_score" not in body
        assert "demerit_score" not in body
