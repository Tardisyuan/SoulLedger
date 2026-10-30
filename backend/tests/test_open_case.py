"""`JudgmentService.open_case`: the case-opening rules in one place (cq-backend 第 8 条, 2026-10-30).

`POST /judgment/` and a sentence plan's REOPEN open their case through it. The view-level behaviour (400 bodies,
hall rules) stays pinned by `test_a_judgment_is_heard_by_the_souls_own_tenant.py`; the REOPEN 409 by
`test_sentence_plan_phase3.py`. Here: the rules themselves, and that the API door really goes through them.
"""
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.judgment.models import Judgment, JudgmentKind
from apps.judgment.services import JudgmentService, OpenCaseRefusedError
from apps.souls.models import Soul, SoulState

User = get_user_model()


def _soul(tenant, state=SoulState.JUDGING):
    return Soul.objects.create(name="开案之魂", tenant=tenant, current_state=state)


def _open(soul, **kw):
    return JudgmentService.open_case(soul, civilization=soul.civilization, **kw)


@pytest.mark.django_db
def test_one_open_case_per_soul_except_for_admin(eu_tenant, eu_admin_user):
    soul = _soul(eu_tenant)
    first = _open(soul)
    with pytest.raises(OpenCaseRefusedError) as exc:
        _open(soul)
    assert exc.value.code == "open_case"
    assert exc.value.open_ids == [str(first.pk)]
    assert Judgment.objects.filter(soul=soul).count() == 1
    # ADMIN repairs a stuck case (2026-09-12): it may open a second one.
    _open(soul, actor=eu_admin_user)
    assert Judgment.objects.filter(soul=soul).count() == 2


@pytest.mark.django_db
def test_in_tenant_is_checked_against_the_locked_soul(eu_tenant, cn_tenant):
    soul = _soul(eu_tenant)
    with pytest.raises(OpenCaseRefusedError) as exc:
        _open(soul, in_tenant=cn_tenant)
    assert exc.value.code == "not_in_tenant"
    assert not Judgment.objects.filter(soul=soul).exists()
    assert _open(soul, in_tenant=eu_tenant).tenant_id == eu_tenant.pk


@pytest.mark.django_db
def test_a_living_soul_enters_judgment_and_a_judging_one_does_not_move(eu_tenant):
    alive = _soul(eu_tenant, SoulState.ALIVE)
    _open(alive)
    alive.refresh_from_db()
    assert alive.current_state == SoulState.JUDGING

    disposed = _soul(eu_tenant, SoulState.DISPOSED)
    case = _open(disposed, kind=JudgmentKind.REOPEN)
    disposed.refresh_from_db()
    assert disposed.current_state == SoulState.DISPOSED
    assert case.kind == JudgmentKind.REOPEN


@pytest.mark.django_db
def test_the_case_is_filed_where_the_caller_says_or_else_in_the_souls_hall(eu_tenant, cn_tenant):
    soul = _soul(eu_tenant)
    assert _open(soul).tenant_id == eu_tenant.pk
    other = _soul(eu_tenant)
    assert _open(other, tenant=cn_tenant).tenant_id == cn_tenant.pk


@pytest.mark.django_db
def test_post_judgment_goes_through_open_case(eu_tenant):
    judge = User.objects.create_user(username="oc_eu_judge", password="x", role="JUDGE", tenant=eu_tenant)
    token = RefreshToken.for_user(judge)
    token["tenant_code"] = eu_tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    soul = _soul(eu_tenant)

    with mock.patch.object(JudgmentService, "open_case", wraps=JudgmentService.open_case) as open_case:
        response = client.post("/api/v1/judgment/", {"soul": str(soul.pk)}, format="json")
    assert response.status_code == 201, response.data
    assert open_case.call_count == 1
    assert open_case.call_args.kwargs["in_tenant"] == eu_tenant
    assert open_case.call_args.kwargs["create_user"] == judge
    case = Judgment.objects.get(soul=soul)
    assert (case.tenant_id, case.create_user_id) == (eu_tenant.pk, judge.pk)

    # The second is a 400 with the same words (the serializer asks first; open_case again under the lock).
    again = client.post("/api/v1/judgment/", {"soul": str(soul.pk)}, format="json")
    assert again.status_code == 400
    assert again.data["soul"] == ["This soul already has an open case. Conclude it before opening another."]
