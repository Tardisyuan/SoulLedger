"""GET /api/v1/app-version/ -- anonymous, validated, unrestricted by default."""
import random

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

URL = "/api/v1/app-version/"
EMPTY = {"min_supported": "", "latest": "", "store_url": ""}


@pytest.mark.parametrize("app", ["soul", "officer"])
@pytest.mark.parametrize("platform", ["ios", "android"])
def test_unconfigured_means_no_restriction(app, platform):
    response = APIClient().get(URL, {"app": app, "platform": platform})
    assert response.status_code == 200
    assert response.json() == EMPTY


def test_configured_values_are_returned_per_app_and_platform():
    policy = {a: {p: dict(EMPTY) for p in ("ios", "android")} for a in ("soul", "officer")}
    policy["officer"]["ios"] = {"min_supported": "1.2.0", "latest": "1.3.0", "store_url": "https://example.test/x"}
    with override_settings(APP_VERSION_POLICY=policy):
        hit = APIClient().get(URL, {"app": "officer", "platform": "ios"}).json()
        other = APIClient().get(URL, {"app": "officer", "platform": "android"}).json()
    assert hit == policy["officer"]["ios"]
    assert other == EMPTY


@pytest.mark.parametrize("query", [
    {}, {"app": "soul"}, {"platform": "ios"},
    {"app": "nope", "platform": "ios"}, {"app": "soul", "platform": "windows"},
])
def test_unknown_or_missing_input_is_400(query):
    assert APIClient().get(URL, query).status_code == 400


def test_it_is_throttled_for_anonymous_callers():
    # Random address: the throttle counter lives in the cache and outlives a run.
    client = APIClient(REMOTE_ADDR=f"10.{random.randint(1, 250)}.{random.randint(1, 250)}.{random.randint(1, 250)}")
    codes = [client.get(URL, {"app": "soul", "platform": "ios"}).status_code for _ in range(65)]
    assert codes[0] == 200 and 429 in codes
