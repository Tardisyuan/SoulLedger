"""The user CSV export must not hand a spreadsheet formula over as data (DB-02).

The ledger export neutralised formula cells since 2026-08-29 (see
`test_ledger_export_cannot_carry_a_formula.py`); the user export beside it did
not. Its cells are worse-placed than the ledger's: `username` is chosen by
whoever registers — `/auth/register/` is AllowAny — and `email` by whoever
edits their own profile, while the file is opened by an administrator on their
own machine.

The rule now lives in `apps/core/csv_safe.py` and both exports use it, so a
third export has one function to call rather than a pattern to rediscover.
"""
import csv
import io

import pytest

DANGEROUS = ['=HYPERLINK("http://evil","click")', "+1+1", "-1+1", "@SUM(A1:A9)", "\tcmd", "\rcmd"]
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


@pytest.fixture
def export(api_client, admin_user):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(admin_user)
    token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    def run():
        res = api_client.get("/api/v1/users/export_csv/")
        assert res.status_code == 200, res.status_code
        return list(csv.reader(io.StringIO(res.content.decode())))

    return run


@pytest.mark.django_db
@pytest.mark.parametrize("payload", DANGEROUS)
def test_a_username_that_looks_like_a_formula_leaves_as_text(
    export, django_user_model, cn_tenant, payload
):
    django_user_model.objects.create_user(
        username=payload, email="x" + payload.strip() + "@example.com",
        password="x", role="VIEWER", tenant=cn_tenant,
    )
    rows = export()
    offending = [c for row in rows[1:] for c in row if c[:1] in FORMULA_START]
    assert offending == [], f"these cells evaluate on open: {offending!r}"


@pytest.mark.django_db
def test_an_email_that_looks_like_a_formula_leaves_as_text(export, django_user_model, cn_tenant):
    django_user_model.objects.create_user(
        username="mailer", email="=1+1@example.com", password="x", role="VIEWER", tenant=cn_tenant,
    )
    rows = export()
    row = next(r for r in rows[1:] if r[0] == "mailer")
    assert row[1] == "'=1+1@example.com", row


@pytest.mark.django_db
def test_the_value_is_still_recoverable_and_ordinary_values_are_untouched(
    export, django_user_model, cn_tenant
):
    """Presence as well as absence: blanking the cell would pass the test above."""
    django_user_model.objects.create_user(
        username="=cmd", email="plain@example.com", password="x", role="VIEWER", tenant=cn_tenant,
    )
    rows = export()
    header, body = rows[0], rows[1:]
    assert header == ["username", "email", "role", "is_active", "tenant", "create_time"]
    row = next(r for r in body if r[0].endswith("=cmd"))
    assert row[0] == "'=cmd", row
    assert row[1] == "plain@example.com", row  # an innocent cell gets no apostrophe
    assert row[2] == "VIEWER" and row[3] == "True" and row[4] == cn_tenant.code, row


def test_the_ledger_and_the_user_export_share_one_rule():
    """Two copies of this function is how the second export went unprotected."""
    from apps.authentication import views as auth_views
    from apps.core.csv_safe import csv_safe
    from apps.ledger import views as ledger_views

    assert not hasattr(ledger_views, "_csv_safe"), "a private copy is back in apps/ledger"
    assert auth_views.csv_safe is csv_safe
    assert ledger_views.csv_safe is csv_safe
