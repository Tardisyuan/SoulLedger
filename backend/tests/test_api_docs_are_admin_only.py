"""`/api/schema/` and `/api/docs/` list every route and field; only ADMIN may read them.

Same rule as `/health/detailed/` (`apps/core/health.py`), and not relaxed under DEBUG.
The schema gates and `schema:generate` use `SchemaGenerator` / `manage.py spectacular`,
never these HTTP routes (`test_committed_schema_matches_the_backend.py`).
"""
import pytest

PATHS = ["/api/schema/", "/api/docs/"]


@pytest.mark.django_db
@pytest.mark.parametrize("path", PATHS)
def test_anonymous_is_refused(api_client, path):
    assert api_client.get(path).status_code in (401, 403)


@pytest.mark.django_db
@pytest.mark.parametrize("path", PATHS)
def test_a_non_admin_officer_is_refused(api_client, judge_user, path):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(judge_user).access_token
    assert api_client.get(path, HTTP_AUTHORIZATION=f"Bearer {token}").status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("path", PATHS)
def test_admin_reads_them(api_client, auth_headers, path):
    assert api_client.get(path, **auth_headers).status_code == 200
