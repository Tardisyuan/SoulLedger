"""The two figures on the same dashboard must count the same souls.

`LedgerOverviewStatsView` filtered by tenant. `LedgerExportStatsView` was
`Soul.objects.all()` for ADMIN, unconditionally. Same role, same permission,
same screen, opposite scope -- and the one that crossed tenants was the one
that emits names, civilizations, death dates and scores as a downloadable
file. Measured 2026-08-29:

    CN admin overview -> total_souls=1  tenants=['CN_DIYU']
    CN admin export   -> CSV contained NO-TENANT-SOUL, EG-SOUL-SECRET, CN-SOUL

`apps/core/tenant.py` does name ADMIN as the globally-exempt role, so the old
behaviour was defensible policy rather than an outright bug -- which is why
this was raised as a divergence rather than reported as a leak outright.
Unified downward by decision on 2026-08-30: a reader of either function would
draw the wrong conclusion about the other, and a global exemption is least
defensible on the endpoint that produces a file.

The assertion compares the two endpoints to each other rather than to a fixed
number. A hardcoded expectation would go stale the first time the fixture
changed; "these two agree" is the property, and it is the property that failed.
"""
import csv
import io

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def two_tenants_with_souls(db):
    cn = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "Diyu"}
    )[0]
    eg = Tenant.objects.get_or_create(
        code="EG_DUAT", defaults={"display_name": "Duat"}
    )[0]
    Soul.objects.create(name="CN-SOUL", current_state=SoulState.ALIVE, tenant=cn)
    Soul.objects.create(
        name="EG-SOUL-SECRET", current_state=SoulState.ALIVE, tenant=eg
    )
    admin = User.objects.create_user(
        username="scope_admin", password="x", role="ADMIN", tenant=cn
    )
    return cn, eg, _jwt_client(admin, cn)


@pytest.mark.django_db
def test_the_export_contains_exactly_what_the_overview_counted(two_tenants_with_souls):
    cn, eg, client = two_tenants_with_souls

    overview = client.get("/api/v1/ledger/stats/overview/")
    assert overview.status_code == 200, overview.data
    counted = overview.data["total_souls"]

    export = client.get("/api/v1/ledger/stats/export/")
    assert export.status_code == 200, export.status_code
    body = b"".join(export.streaming_content).decode() if hasattr(
        export, "streaming_content"
    ) else export.content.decode()
    rows = list(csv.reader(io.StringIO(body)))
    exported = [r for r in rows[1:] if r]

    assert len(exported) == counted, (
        f"the overview counted {counted} souls and the export produced "
        f"{len(exported)} rows. Whichever is right, a reader of one of these "
        f"functions draws the wrong conclusion about the other -- and the one "
        f"that disagrees is the one that writes names and death dates to a file."
    )
    names = {r[1] for r in exported}
    assert "EG-SOUL-SECRET" not in names, (
        "the export carried another tenant's soul into a downloadable file"
    )
    assert "CN-SOUL" in names, (
        "the export is empty of the requester's own souls -- scoping it to "
        "nothing would satisfy the assertion above and be an outage"
    )
