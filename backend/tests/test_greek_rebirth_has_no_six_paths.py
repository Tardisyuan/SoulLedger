"""希腊的再生不走六道(2026-10-27 用户决定,审查 G-2)。

docs/01_希腊冥府整体架构.md、04_希腊冥界详解.md:饮忘川之后再生(维吉尔 Aen. 6.703-751),没有六道可择。
所以希腊灵魂的 `reborn` 不带 `rebirth_form`,记成 OTHER(「六道之外」);指定了任何一道是 400,灵魂原地不动。
地府照旧:不带就是人道,带了就是那一道。
"""
import pytest

from apps.reincarnation.models import SIX_PATHS
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

REBORN = "/api/v1/reincarnation/reborn/"


def _disposed(code):
    tenant = Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]
    return Soul.objects.create(name="待转", tenant=tenant, current_state=SoulState.DISPOSED)


def _reborn(admin_user, soul, **extra):
    return officer_client(admin_user).post(REBORN, {"soul_id": str(soul.pk), **extra}, format="json")


def test_a_greek_soul_is_reborn_outside_the_six_paths(admin_user):
    soul = _disposed("GR_HADES")
    assert soul.home_civilization == Civilization.GREEK
    res = _reborn(admin_user, soul)
    assert res.status_code == 201, res.data
    assert res.data["rebirth_form"] == "OTHER"


@pytest.mark.parametrize("form", [str(f) for f in SIX_PATHS])
def test_a_greek_soul_given_a_path_is_refused_and_does_not_move(admin_user, form):
    soul = _disposed("GR_HADES")
    res = _reborn(admin_user, soul, rebirth_form=form)
    assert (res.status_code, res.data["code"]) == (400, "rebirth_form_not_applicable"), res.data
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED
    assert not soul.reincarnations.exists()


def test_a_soul_of_diyu_still_takes_the_path_it_is_given_and_defaults_to_human(admin_user):
    asura = _disposed("CN_DIYU")
    assert _reborn(admin_user, asura, rebirth_form="ASURA").data["rebirth_form"] == "ASURA"
    plain = _disposed("CN_DIYU")
    assert _reborn(admin_user, plain).data["rebirth_form"] == "HUMAN"


# ── 灵魂端的转生申请(2026-10-28 用户决定):希腊灵魂不选一道,申请记 OTHER;选了就拒绝;地府照旧必选。

APPLY = "/api/v1/me/rebirth-applications/"


def _apply(tenant_code, django_capture_on_commit_callbacks, **body):
    from apps.soul_accounts.models import RebirthApplication
    from tests.soul_account_support import rebirth_ready_soul

    tenant = Tenant.objects.get_or_create(code=tenant_code, defaults={"display_name": tenant_code})[0]
    account, client = rebirth_ready_soul(tenant)
    with django_capture_on_commit_callbacks(execute=True):
        res = client.post(APPLY, {"statement": "愿再来", **body}, format="json")
    return res, RebirthApplication.objects.filter(soul=account.soul)


def test_a_greek_soul_applies_without_a_path_and_the_application_records_other(django_capture_on_commit_callbacks):
    res, rows = _apply("GR_HADES", django_capture_on_commit_callbacks)
    assert res.status_code == 201, res.data
    assert res.data["desired_form"] == "OTHER"
    assert rows.get().desired_form == "OTHER"


@pytest.mark.parametrize("form", [str(f) for f in SIX_PATHS])
def test_a_greek_soul_applying_for_a_path_is_refused_and_nothing_is_written(form, django_capture_on_commit_callbacks):
    res, rows = _apply("GR_HADES", django_capture_on_commit_callbacks, desired_form=form)
    assert (res.status_code, res.data["code"]) == (400, "rebirth_form_not_applicable"), res.data
    assert not rows.exists()


def test_a_soul_of_diyu_must_still_choose_a_path(django_capture_on_commit_callbacks):
    res, rows = _apply("CN_DIYU", django_capture_on_commit_callbacks)
    assert (res.status_code, res.data["code"]) == (400, "desired_form_required"), res.data
    assert not rows.exists()
    res, rows = _apply("CN_DIYU", django_capture_on_commit_callbacks, desired_form="ASURA")
    assert res.status_code == 201, res.data
    assert rows.get().desired_form == "ASURA"
