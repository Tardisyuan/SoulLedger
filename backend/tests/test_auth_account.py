"""The login page's four account features: civilization rows, 「保持登录 30 天」,
「忘记密码」 (notify the administrators), and server-side preferences.

Each section pins the property the feature exists for, not just its happy path:
the public list leaks nothing the page does not draw; a remembered token stays
remembered across rotation; the help endpoint cannot tell anyone whether an
account exists; preferences can only ever be the caller's own.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.utils import datetime_from_epoch

from apps.audit.models import AuditLog
from apps.authentication import tasks
from apps.authentication.tokens import REMEMBER_CLAIM, RefreshToken
from apps.authentication.views import PASSWORD_HELP_ACCEPTED
from apps.notifications.models import NotificationType, UserNotification
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

LOGIN = "/api/v1/auth/login/"
REFRESH = "/api/v1/auth/refresh/"
CIVS = "/api/v1/auth/civilizations/"
HELP = "/api/v1/auth/password-help/"
PREFS = "/api/v1/auth/profile/preferences/"

DEFAULT_REFRESH = timedelta(days=7)
REMEMBERED_REFRESH = timedelta(days=30)


def _tenant(code, **extra):
    tenant, _ = Tenant.objects.get_or_create(code=code, defaults={"display_name": code, **extra})
    return tenant


def _user(django_user_model, username, *, role="JUDGE", tenant=None, password="pw-123456", **extra):
    return django_user_model.objects.create_user(
        username=username, password=password, role=role, tenant=tenant, **extra
    )


# ---------------------------------------------------------------------------
# 1. Civilization at login
# ---------------------------------------------------------------------------


class TestTheTenantIsTheUsersNotTheLoginsChoice:
    """Why login takes no `tenant_code`: a user has exactly one tenant."""

    def test_user_reaches_tenant_through_one_foreign_key_and_nothing_else(self, django_user_model):
        """The premise of the decision, pinned. If a membership table or an M2M
        to Tenant appears, a user can belong to more than one tenant and login
        has to learn to choose — this goes red to say so."""
        # Forward fields only: the reverse `tenant_created` etc. are Tenant's
        # own audit FKs pointing at User, not a way for a user to reach a tenant.
        links = [
            f for f in django_user_model._meta.get_fields()
            if getattr(f, "related_model", None) is Tenant and not f.auto_created
        ]
        assert [(f.name, f.many_to_one, f.many_to_many) for f in links] == [("tenant", True, False)]

    def test_a_tenant_code_sent_at_login_cannot_move_the_user(self, api_client, django_user_model, cn_tenant, eu_tenant):
        _user(django_user_model, "cn_judge", tenant=cn_tenant)
        response = api_client.post(
            LOGIN,
            {"username": "cn_judge", "password": "pw-123456", "tenant_code": eu_tenant.code},
            format="json",
        )
        assert response.status_code == 200
        refresh = RefreshToken(response.data["refresh"])
        assert refresh["tenant_code"] == "CN_DIYU"
        assert refresh.access_token["tenant_code"] == "CN_DIYU"
        assert response.data["user"]["tenant"]["code"] == "CN_DIYU"


@pytest.mark.django_db
class TestPublicCivilizationList:
    def test_lists_active_civilization_tenants_in_civilization_order(self, api_client):
        _tenant("GR_HADES")
        _tenant("EG_DUAT")
        _tenant("CN_DIYU")
        _tenant("EU_HEAVEN_HELL")
        response = api_client.get(CIVS)
        assert response.status_code == 200
        assert response.data == [
            {"code": "CN_DIYU", "civilization": "CHINESE"},
            {"code": "EU_HEAVEN_HELL", "civilization": "EUROPEAN"},
            {"code": "EG_DUAT", "civilization": "EGYPTIAN"},
            {"code": "GR_HADES", "civilization": "GREEK"},
        ]

    def test_inactive_deleted_and_unmapped_tenants_are_absent(self, api_client):
        _tenant("CN_DIYU")
        _tenant("EG_DUAT", is_active=False)
        gone = _tenant("GR_HADES")
        gone.delete()
        _tenant("SANDBOX")  # not a civilization: TENANT_CIVILIZATION has no row for it
        codes = [row["code"] for row in api_client.get(CIVS).data]
        assert codes == ["CN_DIYU"]

    def test_rows_carry_nothing_the_login_page_does_not_draw(self, api_client):
        _tenant(
            "CN_DIYU",
            description="internal",
            settings={"secret": "x"},
            api_endpoint="https://internal.example",
            dispatch_enabled=True,
        )
        (row,) = api_client.get(CIVS).data
        assert set(row) == {"code", "civilization"}
        assert "internal" not in str(row) and "secret" not in str(row)

    def test_needs_no_session_and_ignores_a_stale_token(self, api_client):
        _tenant("CN_DIYU")
        response = api_client.get(CIVS, HTTP_AUTHORIZATION="Bearer not-a-token")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# 2. Keep me signed in for 30 days
# ---------------------------------------------------------------------------


def _login(api_client, django_user_model, cn_tenant, **extra):
    _user(django_user_model, "keeper", tenant=cn_tenant)
    response = api_client.post(LOGIN, {"username": "keeper", "password": "pw-123456", **extra}, format="json")
    assert response.status_code == 200, response.data
    return response


def _lifetime(token):
    return timedelta(seconds=token["exp"] - token["iat"])


@pytest.mark.django_db
class TestRememberMe:
    def test_without_remember_the_refresh_token_keeps_the_default_lifetime(self, api_client, django_user_model, cn_tenant):
        refresh = RefreshToken(_login(api_client, django_user_model, cn_tenant).data["refresh"])
        assert _lifetime(refresh) == DEFAULT_REFRESH
        assert REMEMBER_CLAIM not in refresh.payload

    def test_with_remember_the_refresh_token_lives_30_days(self, api_client, django_user_model, cn_tenant):
        response = _login(api_client, django_user_model, cn_tenant, remember=True)
        refresh = RefreshToken(response.data["refresh"])
        assert _lifetime(refresh) == REMEMBERED_REFRESH
        assert refresh[REMEMBER_CLAIM] is True
        # The outstanding row moved with it — `flushexpiredtokens` deletes by it.
        row = OutstandingToken.objects.get(jti=refresh["jti"])
        assert row.expires_at == datetime_from_epoch(refresh["exp"])
        # The access token is unaffected: same 30 minutes, no claim.
        from rest_framework_simplejwt.tokens import AccessToken

        access = AccessToken(response.data["access"])
        assert REMEMBER_CLAIM not in access.payload
        assert _lifetime(access) == timedelta(minutes=30)

    def test_a_remembered_token_is_still_remembered_after_rotation(self, api_client, django_user_model, cn_tenant):
        first = _login(api_client, django_user_model, cn_tenant, remember=True).data["refresh"]
        rotated = api_client.post(REFRESH, {"refresh": first}, format="json")
        assert rotated.status_code == 200
        second = RefreshToken(rotated.data["refresh"])
        assert _lifetime(second) == REMEMBERED_REFRESH
        assert second[REMEMBER_CLAIM] is True
        assert second["tenant_code"] == "CN_DIYU"
        row = OutstandingToken.objects.get(jti=second["jti"])
        assert row.expires_at == datetime_from_epoch(second["exp"])

    def test_an_unremembered_token_rotates_into_an_unremembered_one(self, api_client, django_user_model, cn_tenant):
        first = _login(api_client, django_user_model, cn_tenant).data["refresh"]
        second = RefreshToken(api_client.post(REFRESH, {"refresh": first}, format="json").data["refresh"])
        assert _lifetime(second) == DEFAULT_REFRESH
        assert REMEMBER_CLAIM not in second.payload

    @pytest.mark.parametrize("remember", [True, False])
    def test_rotation_still_blacklists_the_old_token(self, api_client, django_user_model, cn_tenant, remember):
        first = _login(api_client, django_user_model, cn_tenant, remember=remember).data["refresh"]
        assert api_client.post(REFRESH, {"refresh": first}, format="json").status_code == 200
        replay = api_client.post(REFRESH, {"refresh": first}, format="json")
        assert replay.status_code == 401

    def test_logout_blacklists_a_remembered_token(self, api_client, django_user_model, cn_tenant):
        data = _login(api_client, django_user_model, cn_tenant, remember=True).data
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {data['access']}")
        assert api_client.post("/api/v1/auth/logout/", {"refresh": data["refresh"]}, format="json").status_code == 200
        api_client.credentials()
        assert api_client.post(REFRESH, {"refresh": data["refresh"]}, format="json").status_code == 401


# ---------------------------------------------------------------------------
# 3. Forgot password → notify the administrators
# ---------------------------------------------------------------------------


@pytest.fixture
def cast(django_user_model, cn_tenant, eu_tenant):
    """Two tenants, their admins, a global admin, and the accounts that ask."""
    return {
        "judge": _user(django_user_model, "cn_judge", tenant=cn_tenant),
        "cn_admin": _user(django_user_model, "cn_admin", role="ADMIN", tenant=cn_tenant),
        "cn_admin_2": _user(django_user_model, "cn_admin_2", role="ADMIN", tenant=cn_tenant),
        "cn_admin_off": _user(django_user_model, "cn_admin_off", role="ADMIN", tenant=cn_tenant, is_active=False),
        "cn_moderator": _user(django_user_model, "cn_mod", role="MODERATOR", tenant=cn_tenant),
        "eu_admin": _user(django_user_model, "eu_admin", role="ADMIN", tenant=eu_tenant),
        "global_admin": _user(django_user_model, "root", role="ADMIN", tenant=None),
        "inactive": _user(django_user_model, "cn_gone", tenant=cn_tenant, is_active=False),
        "soul": _user(django_user_model, "soul_x", role="SOUL", tenant=cn_tenant),
    }


def _ask(api_client, username, ip="10.0.0.1"):
    return api_client.post(HELP, {"username": username}, format="json", REMOTE_ADDR=ip)


def _recipients(user):
    return set(
        UserNotification.objects.filter(
            notification_type=NotificationType.PASSWORD_HELP_REQUESTED, related_id=str(user.pk)
        ).values_list("user__username", flat=True)
    )


@pytest.fixture
def eager():
    """Run the task in-process, the way the worker would."""
    with patch.object(tasks.notify_password_help, "delay", side_effect=tasks.notify_password_help.run) as delay:
        yield delay


@pytest.mark.django_db
class TestPasswordHelpNeverSaysWhetherAnAccountExists:
    """The guard. Mutation-proved: see cloud-reports/auth-account.md."""

    @pytest.mark.parametrize("username", ["cn_judge", "nobody_here", "cn_gone", "soul_x"])
    def test_the_response_is_identical_for_every_kind_of_username(self, api_client, cast, eager, username):
        response = _ask(api_client, username)
        assert response.status_code == 200
        assert response.data == PASSWORD_HELP_ACCEPTED
        assert response.content == _ask(api_client, "reference_unknown", ip="10.0.0.2").content

    def test_known_and_unknown_run_the_same_queries_and_never_read_the_user_table(self, api_client, cast):
        """Timing class. The work that differs happens in the worker; the
        request path must not touch the user table at all, so a known and an
        unknown username cost the same statements."""
        runs = {}
        with patch.object(tasks.notify_password_help, "delay") as delay:
            for username in ("cn_judge", "nobody_here"):
                with CaptureQueriesContext(connection) as queries:
                    _ask(api_client, username, ip=f"10.1.0.{len(runs) + 1}")
                runs[username] = [q["sql"] for q in queries.captured_queries]
        assert len(runs["cn_judge"]) == len(runs["nobody_here"])
        user_table = connection.ops.quote_name("authentication_user")
        touched = [sql for sql in runs["cn_judge"] + runs["nobody_here"] if "authentication_user" in sql or user_table in sql]
        assert touched == []
        # Both enqueued, with the same shape.
        assert [call.args[0] for call in delay.call_args_list] == ["cn_judge", "nobody_here"]
        assert [len(call.args) for call in delay.call_args_list] == [3, 3]

    def test_there_is_no_per_username_limit(self, api_client, cast, eager):
        """One username from many clients: every request is accepted and every
        one reaches the worker. The old 3-per-hour username counter let anyone
        lock a colleague out of their own help request."""
        answers = [_ask(api_client, "cn_judge", ip=f"10.2.0.{i}") for i in range(12)]
        assert [r.status_code for r in answers] == [200] * 12
        assert {r.content for r in answers} == {_ask(api_client, "nobody_here", ip="10.2.1.1").content}
        assert eager.call_count == 13
        # Case variants are the same account to the worker (the lookup is exact,
        # so only the exact spelling notifies), and none of them is refused.
        assert [_ask(api_client, n, ip=f"10.2.2.{i}").status_code for i, n in enumerate(["CN_JUDGE", "Cn_Judge"])] == [200, 200]

    def test_per_ip_limit_refuses_known_and_unknown_alike(self, api_client, cast, eager):
        for i in range(5):
            assert _ask(api_client, f"user_{i}", ip="10.3.0.1").status_code == 200
        known = _ask(api_client, "cn_judge", ip="10.3.0.1")
        unknown = _ask(api_client, "nobody_here", ip="10.3.0.1")
        assert known.status_code == 429
        assert (known.status_code, known.content) == (unknown.status_code, unknown.content)
        # Refused before the worker: the sixth request named nobody to anyone.
        assert [call.args[0] for call in eager.call_args_list] == [f"user_{i}" for i in range(5)]

    def test_per_ip_throttle(self, api_client, cast, eager):
        codes = [_ask(api_client, f"user_{i}", ip="10.5.0.1").status_code for i in range(6)]
        assert codes == [200] * 5 + [429]
        # Another client is unaffected.
        assert _ask(api_client, "user_x", ip="10.5.0.2").status_code == 200

    def test_a_down_broker_still_delivers(self, api_client, cast):
        with patch.object(tasks.notify_password_help, "delay", side_effect=ConnectionError("broker down")):
            assert _ask(api_client, "cn_judge").data == PASSWORD_HELP_ACCEPTED
        assert _recipients(cast["judge"]) == {"cn_admin", "cn_admin_2", "cn_mod"}

    def test_blank_username_is_a_400_without_counting(self, api_client, cast, eager):
        assert _ask(api_client, "  ").status_code == 400


@pytest.mark.django_db
class TestPasswordHelpReachesTheRightAdministrators:
    def test_the_active_admins_and_moderators_of_the_users_own_tenant_and_nobody_else(
        self, api_client, django_user_model, cast, eager
    ):
        _user(django_user_model, "cn_mod_off", role="MODERATOR", tenant=cast["judge"].tenant, is_active=False)
        _user(django_user_model, "eu_mod", role="MODERATOR", tenant=cast["eu_admin"].tenant)
        _ask(api_client, "cn_judge")
        # The tenant's admins AND its realm lead (殿主). Not the EU admin or the
        # EU realm lead (tenant isolation), not the global admin (the tenant has
        # its own), not the inactive admin or the inactive realm lead.
        assert _recipients(cast["judge"]) == {"cn_admin", "cn_admin_2", "cn_mod"}

    def test_the_moderator_gets_the_same_notification_as_the_admins_but_its_own_text(self, api_client, cast, eager):
        _ask(api_client, "cn_judge")
        mod = UserNotification.objects.get(user=cast["cn_moderator"])
        admin = UserNotification.objects.get(user=cast["cn_admin"])
        fields = ("title", "notification_type", "related_resource", "related_id")
        assert [getattr(mod, f) for f in fields] == [getattr(admin, f) for f in fields]

    @pytest.mark.parametrize("locale", ["zh-Hans", "en", "egy"])
    def test_only_an_admin_is_sent_to_user_management_a_moderator_is_sent_to_an_admin(
        self, api_client, cast, eager, locale
    ):
        """User management is ADMIN only (`UserViewSet`), so a 殿主 told to
        reset the password there would be told to do what they cannot
        (2026-09-25 decision). Both the stored zh-Hans text and the read-time
        render in every locale; presence AND absence of each instruction."""
        from apps.notifications.messages import MESSAGES

        pack = MESSAGES[locale]
        to_admin = pack["password_help_requested"]["body"].replace("{{username}}", "cn_judge")
        to_moderator = pack["password_help_requested_moderator"]["body"].replace("{{username}}", "cn_judge")
        assert to_admin != to_moderator
        tasks.notify_password_help.run("cn_judge")
        expected = {"cn_admin": to_admin, "cn_admin_2": to_admin, "cn_mod": to_moderator}
        users = {"cn_admin": cast["cn_admin"], "cn_admin_2": cast["cn_admin_2"], "cn_mod": cast["cn_moderator"]}
        for name, body in expected.items():
            # A real token carrying the tenant: `force_authenticate` has none,
            # and TenantPermission refuses a MODERATOR without it.
            listed = officer_client(users[name]).get("/api/v1/notifications/", HTTP_ACCEPT_LANGUAGE=locale).data
            rows = listed["results"] if isinstance(listed, dict) else listed
            assert [r["message"] for r in rows] == [body], (locale, name)
        if locale == "zh-Hans":
            stored = {n.user.username: n.message for n in UserNotification.objects.select_related("user")}
            assert stored == expected
            assert "用户管理" not in stored["cn_mod"] and "联系管理员" in stored["cn_mod"]
            assert "用户管理" in stored["cn_admin"] and "联系管理员" not in stored["cn_admin"]

    def test_the_global_admin_fallback_gets_the_admin_text(self, django_user_model, cast):
        _user(django_user_model, "gr_judge", tenant=_tenant("GR_HADES"))
        tasks.notify_password_help.run("gr_judge")
        note = UserNotification.objects.get(user=cast["global_admin"])
        assert "kind" not in note.params and "用户管理" in note.message

    def test_a_tenant_with_only_a_moderator_notifies_the_moderator_not_the_global_admins(
        self, api_client, django_user_model, cast
    ):
        hades = _tenant("GR_HADES")
        _user(django_user_model, "gr_mod", role="MODERATOR", tenant=hades)
        asker = _user(django_user_model, "gr_judge", tenant=hades)
        tasks.notify_password_help.run("gr_judge")
        assert _recipients(asker) == {"gr_mod"}

    def test_a_moderator_asking_is_not_their_own_recipient(self, api_client, cast):
        tasks.notify_password_help.run("cn_mod")
        assert _recipients(cast["cn_moderator"]) == {"cn_admin", "cn_admin_2"}

    def test_the_notification_names_the_account_and_renders_per_locale(self, api_client, cast, eager):
        _ask(api_client, "cn_judge")
        note = UserNotification.objects.filter(user=cast["cn_admin"]).get()
        assert note.params == {"username": "cn_judge"}
        assert "cn_judge" in note.message and note.related_resource == "user"
        api_client.force_authenticate(cast["cn_admin"])
        listed = api_client.get("/api/v1/notifications/", HTTP_ACCEPT_LANGUAGE="en").data
        rows = listed["results"] if isinstance(listed, dict) else listed
        assert rows[0]["title"] == "Password help requested"

    def test_an_audit_row_is_written_for_an_existing_account(self, api_client, cast, eager):
        _ask(api_client, "cn_judge", ip="10.9.9.9")
        row = AuditLog.objects.get(resource="password_help")
        assert row.resource_id == str(cast["judge"].pk)
        assert row.tenant.code == "CN_DIYU"
        assert row.user is None
        assert row.ip_address == "10.9.9.9"
        assert sorted(row.changes["notified_admin_ids"]) == sorted(
            [cast["cn_admin"].pk, cast["cn_admin_2"].pk, cast["cn_moderator"].pk]
        )

    @pytest.mark.parametrize("username", ["nobody_here", "cn_gone", "soul_x"])
    def test_unknown_inactive_and_soul_accounts_notify_nobody_and_audit_nothing(self, api_client, cast, eager, username):
        # A known account first, as the positive control: the absence below
        # is only evidence if the same path demonstrably writes when it should.
        _ask(api_client, "cn_judge", ip="10.6.0.1")
        _ask(api_client, username, ip="10.6.0.2")
        helped = UserNotification.objects.filter(notification_type=NotificationType.PASSWORD_HELP_REQUESTED)
        assert set(helped.values_list("related_id", flat=True)) == {str(cast["judge"].pk)}
        audited = AuditLog.objects.filter(resource="password_help")
        assert list(audited.values_list("resource_id", flat=True)) == [str(cast["judge"].pk)]

    def test_a_tenant_without_admins_falls_back_to_the_global_admins(self, api_client, django_user_model, cast):
        lonely = _user(django_user_model, "gr_judge", tenant=_tenant("GR_HADES"))
        tasks.notify_password_help.run("gr_judge")
        assert _recipients(lonely) == {"root"}

    def test_an_admin_asking_is_not_their_own_recipient(self, api_client, cast):
        tasks.notify_password_help.run("cn_admin")
        assert _recipients(cast["cn_admin"]) == {"cn_admin_2", "cn_mod"}

    def test_a_global_admin_asking_reaches_the_other_global_admins(self, django_user_model, cast):
        _user(django_user_model, "root_2", role="ADMIN", tenant=None)
        tasks.notify_password_help.run("root")
        assert _recipients(cast["global_admin"]) == {"root_2"}


# ---------------------------------------------------------------------------
# 4. Preferences
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPreferences:
    def test_unset_reads_as_null(self, api_client, judge_user):
        api_client.force_authenticate(judge_user)
        response = api_client.get(PREFS)
        assert response.status_code == 200
        assert response.data == {"default_view": None}

    @pytest.mark.parametrize("view", ["operator", "admin"])
    def test_patch_stores_and_get_reads_it_back(self, api_client, judge_user, view):
        api_client.force_authenticate(judge_user)
        assert api_client.patch(PREFS, {"default_view": view}, format="json").data == {"default_view": view}
        assert api_client.get(PREFS).data == {"default_view": view}
        judge_user.refresh_from_db()
        assert judge_user.preferences == {"default_view": view}

    def test_null_clears_it(self, api_client, judge_user):
        api_client.force_authenticate(judge_user)
        api_client.patch(PREFS, {"default_view": "operator"}, format="json")
        assert api_client.patch(PREFS, {"default_view": None}, format="json").data == {"default_view": None}

    def test_an_unknown_value_is_refused(self, api_client, judge_user):
        api_client.force_authenticate(judge_user)
        assert api_client.patch(PREFS, {"default_view": "/admin"}, format="json").status_code == 400
        judge_user.refresh_from_db()
        assert judge_user.preferences == {}

    def test_anonymous_gets_401(self, api_client):
        assert api_client.get(PREFS).status_code == 401
        assert api_client.patch(PREFS, {"default_view": "admin"}, format="json").status_code == 401


@pytest.mark.django_db
class TestPreferencesAreOnlyEverYourOwn:
    """The ownership guard. Mutation-proved: see cloud-reports/auth-account.md."""

    def test_writing_mine_leaves_everyone_elses_alone(self, api_client, judge_user, admin_user):
        admin_user.preferences = {"default_view": "admin"}
        admin_user.save(update_fields=["preferences"])
        api_client.force_authenticate(judge_user)
        api_client.patch(PREFS, {"default_view": "operator"}, format="json")
        admin_user.refresh_from_db()
        judge_user.refresh_from_db()
        assert admin_user.preferences == {"default_view": "admin"}
        assert judge_user.preferences == {"default_view": "operator"}

    def test_reading_returns_mine_not_someone_elses(self, api_client, judge_user, admin_user):
        admin_user.preferences = {"default_view": "admin"}
        admin_user.save(update_fields=["preferences"])
        api_client.force_authenticate(judge_user)
        assert api_client.get(PREFS).data == {"default_view": None}

    @pytest.mark.parametrize("field", ["user", "user_id", "id", "username"])
    def test_naming_another_user_in_the_body_is_refused(self, api_client, judge_user, admin_user, field):
        api_client.force_authenticate(judge_user)
        target = admin_user.username if field == "username" else admin_user.pk
        response = api_client.patch(PREFS, {field: target, "default_view": "operator"}, format="json")
        assert response.status_code == 400
        admin_user.refresh_from_db()
        judge_user.refresh_from_db()
        assert admin_user.preferences == {}
        assert judge_user.preferences == {}

    def test_there_is_no_per_user_url(self, api_client, judge_user, admin_user):
        api_client.force_authenticate(judge_user)
        assert api_client.get(f"{PREFS}{admin_user.pk}/").status_code == 404
