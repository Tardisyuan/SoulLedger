"""The app's locale must reach the backend, and the backend must answer in it.

Why this file exists
--------------------
Three serializers pick a name from `Accept-Language`:

    apps/realms/serializers.py:52     RealmLocalizedSerializer.get_display_name
    apps/actors/serializers.py:25     _locale_from_context
    apps/judgment/serializers.py:26   (realm_options on the judgment queue)

Measured 2026-09-10: **nothing ever sent that header.** `packages/core/src/api/
client.ts` sets `Authorization` and `X-Tenant-ID` and nothing else; a
case-insensitive grep for `accept-language` across `frontend/` and
`packages/core/` (excluding comments and tests) returned zero hits. No backend
test sent it either. So `lang` was always the default `"en"`, `name_egy` was
unreachable over HTTP from this application, and the entire `egy` branch of
`Realm.get_localized_name` was dead code that `test_coverage_boost.py` kept
green by calling the model method directly.

What that looked like on screen: a user reading the app in `egy` saw
`Mekher Tepy - Aalu` on `/realms` (that page reads the message bundle, not the
API) and `幽冥边境` or `First Circle - Limbo` everywhere the API supplies the
name — chosen by the *browser's* language preference, which has nothing to do
with the locale the user picked in the app.

This file pins both halves, because either alone is worthless: the backend
honouring a header nobody sends, or the frontend sending a header the backend
ignores.

The frontend half is a source-text assertion for the same reason
`test_frontend_page_size.py` is one — a pytest test cannot run the axios client,
and what decayed here is a literal.

What "would really fail" means here
-----------------------------------
Each assertion was checked by breaking it:

* removing the `Accept-Language` line from `client.ts` reddens
  `test_the_client_sends_the_locale_it_renders_in`;
* changing `Realm.get_localized_name`'s `egy` branch to fall through to
  `name_en` reddens `test_an_egy_request_gets_the_egyptian_name`;
* sending no header at all (the state before this change) reddens nothing in
  the old suite and reddens `test_an_egy_request_gets_the_egyptian_name` here,
  which is the whole point — the old suite could not see this.
"""

import re
from pathlib import Path

import pytest

from apps.actors.models import Actor, ActorRole
from apps.realms.models import Realm

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIENT_TS = REPO_ROOT / "packages" / "core" / "src" / "api" / "client.ts"


@pytest.fixture
def egyptian_realm(cn_tenant):
    """A realm whose four name columns are all different, so the assertion can
    tell which column answered rather than which two happen to coincide."""
    return Realm.objects.create(
        realm_code="TEST_LOCALE_REALM",
        name_local="本地名",
        name_zh="中文名",
        name_en="English Name",
        name_egy="Egyptian Name",
        civilization="EGYPTIAN",
        tenant=cn_tenant,
    )


class TestTheFrontendSendsIt:
    def test_the_client_sends_the_locale_it_renders_in(self):
        src = CLIENT_TS.read_text(encoding="utf-8")
        # Strip comments: this repo's comments quote the very literals its
        # guards look for, and a guard that reads its own explanation as the
        # subject is a shape this codebase has hit before.
        code = re.sub(r"/\*[\s\S]*?\*/", "", src)
        code = re.sub(r"(^|[^:])//[^\n]*", r"\1", code)

        assert "Accept-Language" in code, (
            "packages/core/src/api/client.ts does not send Accept-Language, so "
            "every locale-aware serializer on the backend answers in 'en' "
            "regardless of the locale the user chose."
        )

    def test_the_header_carries_the_active_locale_not_a_constant(self):
        """A hard-coded `Accept-Language: en` would satisfy the test above and
        change nothing. The value has to come from the locale the app is in."""
        src = CLIENT_TS.read_text(encoding="utf-8")
        code = re.sub(r"/\*[\s\S]*?\*/", "", src)
        code = re.sub(r"(^|[^:])//[^\n]*", r"\1", code)
        line = next(
            (ln for ln in code.splitlines() if "Accept-Language" in ln), ""
        )
        assert not re.search(r'Accept-Language"?\]?\s*=\s*["\'][a-zA-Z-]+["\']', line), (
            f"Accept-Language is set to a literal: {line.strip()!r}"
        )


@pytest.mark.django_db
class TestTheBackendAnswersInIt:
    def test_the_probe_realm_has_four_distinct_names(self, egyptian_realm):
        """Non-vacuity: if two columns held the same string, a wrong pick would
        still look right."""
        names = {
            egyptian_realm.name_local,
            egyptian_realm.name_zh,
            egyptian_realm.name_en,
            egyptian_realm.name_egy,
        }
        assert len(names) == 4

    @pytest.mark.parametrize(
        "header,expected_attr",
        [
            ("egy", "name_egy"),
            ("zh-Hans", "name_zh"),
            ("en", "name_en"),
        ],
    )
    def test_an_egy_request_gets_the_egyptian_name(
        self, api_client, auth_headers, egyptian_realm, header, expected_attr
    ):
        res = api_client.get(
            f"/api/v1/realms/{egyptian_realm.id}/?localized=true",
            HTTP_ACCEPT_LANGUAGE=header,
            **auth_headers,
        )
        assert res.status_code == 200, res.data
        assert res.data["display_name"] == getattr(egyptian_realm, expected_attr), (
            f"Accept-Language: {header} should resolve to {expected_attr}"
        )

    def test_an_actor_answers_in_the_requested_locale(
        self, api_client, auth_headers, cn_tenant, egyptian_realm
    ):
        actor = Actor.objects.create(
            name="Locale Probe",
            name_zh="区域探针",
            name_en="Locale Probe EN",
            name_egy="Locale Probe EGY",
            role=ActorRole.JUDGE,
            realm=egyptian_realm,
            tenant=cn_tenant,
        )
        res = api_client.get(
            "/api/v1/actors/", HTTP_ACCEPT_LANGUAGE="egy", **auth_headers
        )
        assert res.status_code == 200, res.data
        rows = res.data["results"] if isinstance(res.data, dict) else res.data
        row = next(r for r in rows if str(r["id"]) == str(actor.id))
        assert row["display_name"] == "Locale Probe EGY"
