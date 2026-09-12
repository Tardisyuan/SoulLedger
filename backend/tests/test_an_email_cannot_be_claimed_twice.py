"""No write path may put a second account on an address that already has one (BP-04).

`RegisterSerializer.validate_email` refused a taken address. `PATCH
/auth/profile/` did not — `UserSerializer.email` was writable with no check —
and neither did the admin create/update serializers or the CSV import.

Why it matters is the password reset: `reset_password_request` issues a code
only when exactly one account holds the address, and answers 200 either way
(it must not disclose registration). So any logged-in user could PATCH their
own email to a victim's address, and from then on the victim's "forgot
password" said "code sent" and sent nothing — silently, permanently.

Case-insensitive, because the registration check already was and because an
address that differs only in case is the same mailbox.
"""
import pytest
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

VICTIM = "victim@example.com"
CLAIMS = [VICTIM, "VICTIM@example.com", "Victim@Example.COM"]


@pytest.fixture
def victim(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="victim", email=VICTIM, password="VictimPass!123",
        role="VIEWER", tenant=cn_tenant,
    )


@pytest.fixture
def attacker(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="attacker", email="attacker@example.com", password="Attacker!123",
        role="VIEWER", tenant=cn_tenant,
    )


@pytest.fixture
def as_attacker(attacker):
    client = APIClient()
    client.force_authenticate(user=attacker)
    return client


@pytest.fixture
def as_admin(admin_user):
    from rest_framework_simplejwt.tokens import RefreshToken

    client = APIClient()
    token = RefreshToken.for_user(admin_user)
    token["tenant_code"] = admin_user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _holders(django_user_model, address):
    return django_user_model.objects.filter(email__iexact=address).count()


@pytest.mark.django_db
class TestProfile:
    @pytest.mark.parametrize("claim", CLAIMS)
    def test_cannot_take_an_address_that_is_already_registered(
        self, as_attacker, attacker, victim, django_user_model, claim
    ):
        res = as_attacker.patch("/api/v1/auth/profile/", {"email": claim}, format="json")
        assert res.status_code == 400, res.data
        assert "email" in res.data
        attacker.refresh_from_db()
        assert attacker.email == "attacker@example.com"
        assert _holders(django_user_model, VICTIM) == 1

    def test_the_victims_reset_still_issues_a_code_after_the_attempt(
        self, as_attacker, victim, api_client
    ):
        as_attacker.patch("/api/v1/auth/profile/", {"email": VICTIM}, format="json")
        ip = "192.0.2.150"
        keys = [f"pwd_reset:{VICTIM}", f"pwd_reset_rate:{VICTIM}",
                f"throttle_password_reset_{ip}", f"throttle_anon_{ip}"]
        cache.delete_many(keys)
        try:
            res = api_client.post(
                "/api/v1/auth/reset-password/", {"email": VICTIM},
                format="json", REMOTE_ADDR=ip,
            )
            assert res.status_code == 200
            assert cache.get(f"pwd_reset:{VICTIM}") is not None, (
                "the victim's reset answered 200 and issued nothing"
            )
        finally:
            cache.delete_many(keys)

    def test_re_casing_ones_own_address_is_not_a_collision(self, as_attacker, attacker):
        res = as_attacker.patch(
            "/api/v1/auth/profile/", {"email": "ATTACKER@example.com"}, format="json"
        )
        assert res.status_code == 200, res.data
        attacker.refresh_from_db()
        assert attacker.email == "ATTACKER@example.com"

    def test_a_fresh_address_is_still_accepted(self, as_attacker, attacker):
        res = as_attacker.patch(
            "/api/v1/auth/profile/", {"email": "fresh@example.com"}, format="json"
        )
        assert res.status_code == 200, res.data
        attacker.refresh_from_db()
        assert attacker.email == "fresh@example.com"

    def test_blank_is_not_a_duplicate_of_blank(self, as_attacker, django_user_model, cn_tenant):
        django_user_model.objects.create_user(
            username="no_mail", password="x", role="VIEWER", tenant=cn_tenant
        )
        res = as_attacker.patch("/api/v1/auth/profile/", {"email": ""}, format="json")
        assert res.status_code == 200, res.data


@pytest.mark.django_db
class TestAdminPaths:
    def test_update_cannot_move_a_user_onto_a_taken_address(
        self, as_admin, attacker, victim, django_user_model
    ):
        res = as_admin.patch(
            f"/api/v1/users/{attacker.id}/", {"email": "Victim@Example.com"}, format="json"
        )
        assert res.status_code == 400, res.data
        assert "email" in res.data
        assert _holders(django_user_model, VICTIM) == 1

    def test_update_may_keep_the_users_own_address(self, as_admin, attacker):
        res = as_admin.patch(
            f"/api/v1/users/{attacker.id}/",
            {"email": "attacker@example.com", "position": "clerk"}, format="json",
        )
        assert res.status_code == 200, res.data

    def test_create_refuses_a_taken_address(self, as_admin, victim, django_user_model):
        res = as_admin.post(
            "/api/v1/users/",
            {"username": "second", "email": "VICTIM@example.com", "password": "Second!12345"},
            format="json",
        )
        assert res.status_code == 400, res.data
        assert "email" in res.data
        assert not django_user_model.objects.filter(username="second").exists()

    def test_csv_import_refuses_a_taken_address(self, as_admin, victim, django_user_model):
        body = (
            "username,email,role,password\n"
            "dup_row,Victim@Example.com,VIEWER,TestPass123\n"
            "ok_row,ok-row@example.com,VIEWER,TestPass123\n"
        )
        upload = SimpleUploadedFile("users.csv", body.encode(), content_type="text/csv")
        res = as_admin.post("/api/v1/users/import_csv/", {"file": upload}, format="multipart")
        assert res.status_code == 200, res.data
        assert res.data["created"] == 1, res.data
        assert any("Row 2" in e and "email" in e for e in res.data["errors"]), res.data
        assert not django_user_model.objects.filter(username="dup_row").exists()
        assert django_user_model.objects.filter(username="ok_row").exists()
        assert _holders(django_user_model, VICTIM) == 1

    def test_csv_import_refuses_a_duplicate_within_the_file(self, as_admin, django_user_model):
        body = (
            "username,email,role,password\n"
            "twin_a,twin@example.com,VIEWER,TestPass123\n"
            "twin_b,TWIN@example.com,VIEWER,TestPass123\n"
        )
        upload = SimpleUploadedFile("users.csv", body.encode(), content_type="text/csv")
        res = as_admin.post("/api/v1/users/import_csv/", {"file": upload}, format="multipart")
        assert res.data["created"] == 1, res.data
        assert _holders(django_user_model, "twin@example.com") == 1


@pytest.mark.django_db
class TestDjangoAdminForm:
    def test_the_change_form_refuses_a_taken_address(self, attacker, victim):
        from django.contrib import admin

        from apps.authentication.models import User

        form_cls = admin.site._registry[User].form
        form = form_cls(instance=attacker)
        form.cleaned_data = {"email": "VICTIM@example.com"}
        with pytest.raises(ValidationError):
            form.clean_email()

    def test_the_change_form_keeps_the_users_own_address(self, attacker, victim):
        from django.contrib import admin

        from apps.authentication.models import User

        form_cls = admin.site._registry[User].form
        form = form_cls(instance=attacker)
        form.cleaned_data = {"email": "Attacker@example.com"}
        assert form.clean_email() == "Attacker@example.com"
