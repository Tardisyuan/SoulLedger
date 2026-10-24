"""2026-10-25 用户决定的一组后端:官员交接、邀请、导入发邀请、建殿 / 停用、跨殿总览、外部进度查询、我的数、孟婆汤。"""
import re

import pytest
from django.core import mail

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client
from tests.test_judgment_claim import _case, _post, world  # noqa: F401


@pytest.mark.django_db
class TestHandover:
    def test_preview_then_commit_moves_claims_and_tells_the_receiver(self, world, django_capture_on_commit_callbacks):  # noqa: F811
        case = _case(world.cn)
        assert _post(world.clients["a"], case, "claim").status_code == 200
        body = {"from": world.users["a"].pk, "to": world.users["b"].pk}
        res = world.clients["mod"].post("/api/v1/judgment/handover/preview/", body, format="json")
        assert res.status_code == 200, res.data
        assert res.data["judgments"] == 1 and res.data["problems"] == []
        assert Judgment.all_objects.get(pk=case.pk).claimed_by_id == world.users["a"].pk  # preview writes nothing
        with django_capture_on_commit_callbacks(execute=True):
            res = world.clients["mod"].post("/api/v1/judgment/handover/", body, format="json")
        assert res.status_code == 200 and res.data["judgments"] == 1
        assert Judgment.all_objects.get(pk=case.pk).claimed_by_id == world.users["b"].pk
        from apps.notifications.models import UserNotification
        assert UserNotification.objects.filter(user=world.users["b"], params__kind="officer_handover_received").exists()

    def test_another_halls_officer_is_not_found_and_a_judge_cannot_hand_over(self, world):  # noqa: F811
        body = {"from": world.users["eu_judge"].pk, "to": world.users["b"].pk}
        assert world.clients["mod"].post("/api/v1/judgment/handover/preview/", body, format="json").status_code == 404
        body = {"from": world.users["a"].pk, "to": world.users["eu_judge"].pk}
        res = world.clients["mod"].post("/api/v1/judgment/handover/preview/", body, format="json")
        assert (res.status_code, res.data["code"]) == (400, "invalid_target")
        body = {"from": world.users["a"].pk, "to": world.users["b"].pk}
        assert world.clients["a"].post("/api/v1/judgment/handover/", body, format="json").status_code == 403


@pytest.fixture
def admin_client(admin_user):
    return officer_client(admin_user)


@pytest.mark.django_db
class TestInvite:
    def test_invite_link_sets_the_password_once(self, admin_client, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            res = admin_client.post("/api/v1/users/invite/", {"email": "new@example.com", "role": "JUDGE"}, format="json")
        assert res.status_code == 201, res.data
        user = User.objects.get(email="new@example.com")
        assert not user.has_usable_password()
        uid, token = re.search(r"uid=([^&\s]+)&token=(\S+)", mail.outbox[-1].body).groups()
        body = {"uid": uid, "token": token, "new_password": "A-very-good-passphrase-2026"}
        assert admin_client.post("/api/v1/auth/officer-invite/accept/", body, format="json").status_code == 200
        user.refresh_from_db()
        assert user.check_password(body["new_password"]) and user.email_verified
        again = admin_client.post("/api/v1/auth/officer-invite/accept/", body, format="json")
        assert (again.status_code, again.data["code"]) == (400, "invite_link_invalid")

    def test_import_row_without_password_but_with_email_is_invited(self, admin_client, django_capture_on_commit_callbacks):
        from django.core.files.uploadedfile import SimpleUploadedFile

        csv = "username,email,role,password\ninv1,inv1@example.com,JUDGE,\n"
        f = SimpleUploadedFile("u.csv", csv.encode(), content_type="text/csv")
        with django_capture_on_commit_callbacks(execute=True):
            res = admin_client.post("/api/v1/users/import_csv/", {"file": f}, format="multipart")
        assert res.status_code == 200 and res.data["invited"] == 1, res.data
        assert "/accept-invite" in mail.outbox[-1].body

    def test_a_non_admin_cannot_invite(self, judge_user):
        res = officer_client(judge_user).post("/api/v1/users/invite/", {"email": "x@example.com", "role": "JUDGE"},
                                              format="json")
        assert res.status_code == 403


@pytest.mark.django_db
class TestHalls:
    def test_create_deactivate_and_refuse_new_souls(self, admin_client, judge_user):
        res = admin_client.post("/api/v1/tenants/", {"code": "CN_SECOND", "display_name": "Second",
                                                     "civilization": "CHINESE"}, format="json")
        assert res.status_code == 201, res.data
        hall = Tenant.objects.get(code="CN_SECOND")
        assert hall.civilization == "CHINESE"
        assert admin_client.post("/api/v1/tenants/CN_SECOND/deactivate/").status_code == 200
        hall.refresh_from_db()
        assert not hall.is_active
        from django.core.exceptions import ValidationError
        with pytest.raises(ValidationError):
            Soul.objects.create(name="late", tenant=hall)
        assert officer_client(judge_user).post("/api/v1/tenants/", {"code": "X_Y", "display_name": "x",
                                                                    "civilization": "GREEK"}, format="json").status_code == 403

    def test_overview_is_admin_only(self, admin_client, judge_user):
        res = admin_client.get("/api/v1/tenants/overview/")
        assert res.status_code == 200 and {"todo", "judgments", "open_appeals"} <= set(res.data[0])
        assert officer_client(judge_user).get("/api/v1/tenants/overview/").status_code == 403


@pytest.mark.django_db
def test_officer_stats_counts_my_claims(world):  # noqa: F811
    case = _case(world.cn)
    _post(world.clients["a"], case, "claim")
    res = world.clients["a"].get("/api/v1/officer-app/stats/")
    assert res.status_code == 200 and res.data["open_claims"] == 1


@pytest.mark.django_db
class TestMengpoSoup:
    def _soul(self, tenant, state=SoulState.REINCARNATING):
        return Soul.objects.create(name="待转", birth_date="1900-01-01", current_state=state, tenant=tenant)

    def test_cn_needs_soup_then_rebirth_clears_it(self, cn_tenant, admin_user):
        from apps.reincarnation.services import ReincarnationService, SoupNotTaken, drink_soup
        soul = self._soul(cn_tenant)
        with pytest.raises(SoupNotTaken):
            ReincarnationService.complete_rebirth(soul=soul)
        drink_soup(soul)
        ReincarnationService.complete_rebirth(soul=Soul.objects.get(pk=soul.pk))
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE and soul.soup_taken_at is None
        from apps.events.models import SoulEvent
        assert SoulEvent.objects.filter(soul=soul, event_type="MENGPO_SOUP_TAKEN").count() == 1

    def test_wrong_state_and_other_civilizations_are_refused(self, cn_tenant, eu_tenant, admin_client):
        alive = self._soul(cn_tenant, SoulState.ALIVE)
        res = admin_client.post("/api/v1/reincarnation/drink-soup/", {"soul_id": str(alive.pk)}, format="json")
        assert (res.status_code, res.data["code"]) == (409, "not_reincarnating")
        eu = self._soul(eu_tenant)
        res = admin_client.post("/api/v1/reincarnation/drink-soup/", {"soul_id": str(eu.pk)}, format="json")
        assert (res.status_code, res.data["code"]) == (409, "not_diyu")
