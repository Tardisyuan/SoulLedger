"""审判队列:认领、释放、改派、暂缓、批量、分组(apps/judgment/claims.py)。

每个调用者都是真 JWT(带 `tenant_code`)过真 URLconf —— ADMIN 绕过租户范围,
所以租户隔离只能用非 ADMIN 来测,`test_judgment_queue.py` 的 `judge_headers` 说过同一件事。

权限走数据库路径:`_grant_judgment_family` 按 ROLE_PERMISSIONS 为 judgment.* 建
Permission 与 RolePermission 行,再额外给 VIEWER 授 `judgment.read` —— VIEWER 默认
到不了这些端点,要测「VIEWER 拿不到功过净值」这条底线,就得先让它进得来。

并发的那一半(两个人同时认领)在 `tests/test_concurrency.py::TestJudgmentClaimConcurrency`:
SQLite 没有行锁可等。这里测的是它在 SQLite 上也看得见的那一半 —— 锁到之后读到
别人的认领,答 409 而不是覆盖。
"""
import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState

BASE = "/api/v1/judgment/"


def _grant_judgment_family(extra=()):
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission

    perms = {}
    for codename, name, category in DEFAULT_PERMISSIONS:
        if codename.startswith("judgment."):
            perms[codename], _ = Permission.objects.get_or_create(
                codename=codename, defaults={"name": name, "category": category}
            )
    grants = {role: [c for c in codes if c in perms] for role, codes in ROLE_PERMISSIONS.items()}
    for role_name, codename in extra:
        grants.setdefault(role_name, []).append(codename)
    for role_name, codenames in grants.items():
        role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name.title()})
        for codename in codenames:
            RolePermission.objects.get_or_create(role=role, permission=perms[codename])
    invalidate_all_permissions()


def _client(user):
    token = RefreshToken.for_user(user)
    if user.tenant is not None:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db, cn_tenant, eu_tenant):
    _grant_judgment_family(extra=[("VIEWER", "judgment.read")])

    def user(name, role, tenant):
        return User.objects.create_user(username=name, password="x", role=role, tenant=tenant)

    users = {
        "a": user("claim_judge_a", "JUDGE", cn_tenant),
        "b": user("claim_judge_b", "JUDGE", cn_tenant),
        "mod": user("claim_moderator", "MODERATOR", cn_tenant),
        "guardian": user("claim_guardian", "GUARDIAN", cn_tenant),
        "viewer": user("claim_viewer", "VIEWER", cn_tenant),
        "eu_judge": user("claim_eu_judge", "JUDGE", eu_tenant),
        "eu_mod": user("claim_eu_moderator", "MODERATOR", eu_tenant),
    }

    class World:
        pass

    w = World()
    w.cn, w.eu = cn_tenant, eu_tenant
    w.users = users
    w.clients = {k: _client(u) for k, u in users.items()}
    return w


def _case(tenant, name="待判之魂", court="第一殿", merit=0, demerit=0, evidence=None):
    soul = Soul.objects.create(
        name=name, birth_date="1900-01-01", current_state=SoulState.JUDGING, tenant=tenant,
        merit_score=merit, demerit_score=demerit,
    )
    return Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court=court, tenant=tenant,
        evidence_json=evidence if evidence is not None else {},
    )


def _post(client, judgment, verb, body=None):
    return client.post(f"{BASE}{judgment.pk}/{verb}/", body or {}, format="json")


def _fresh(judgment):
    return Judgment.all_objects.get(pk=judgment.pk)


# ---------------------------------------------------------------------------
# Claim
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestClaim:
    def test_claiming_an_unclaimed_case_records_the_officer_and_the_time(self, world):
        case = _case(world.cn)
        response = _post(world.clients["a"], case, "claim")
        assert response.status_code == 200, response.data
        assert response.data["claimed_by"] == world.users["a"].pk
        assert response.data["claimed_by_name"] == "claim_judge_a"
        row = _fresh(case)
        assert row.claimed_by_id == world.users["a"].pk
        assert row.claimed_at is not None
        # `judge` is the mythological judge, not the officer; claiming must not touch it.
        assert row.judge_id is None

    def test_a_case_claimed_by_someone_else_is_refused_with_409_and_left_alone(self, world):
        """The race guard's SQLite-visible half: whoever reads the row second sees the
        first claim and is refused, rather than overwriting it."""
        case = _case(world.cn)
        assert _post(world.clients["a"], case, "claim").status_code == 200
        before = _fresh(case).claimed_at

        response = _post(world.clients["b"], case, "claim")
        assert response.status_code == 409, response.data
        assert response.data["code"] == "already_claimed"
        assert response.data["claimed_by"] == world.users["a"].pk
        row = _fresh(case)
        assert row.claimed_by_id == world.users["a"].pk
        assert row.claimed_by_id != world.users["b"].pk
        assert row.claimed_at == before

    def test_claiming_your_own_case_again_is_a_no_op(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        first = _fresh(case)
        response = _post(world.clients["a"], case, "claim")
        assert response.status_code == 200
        second = _fresh(case)
        assert second.claimed_at == first.claimed_at
        assert second.version == first.version

    def test_another_tenants_case_is_404_and_not_written(self, world):
        case = _case(world.cn)
        response = _post(world.clients["eu_judge"], case, "claim")
        assert response.status_code == 404
        assert _fresh(case).claimed_by_id is None

    def test_a_role_without_judgment_execute_is_refused(self, world):
        case = _case(world.cn)
        assert _post(world.clients["guardian"], case, "claim").status_code == 403
        assert _post(world.clients["viewer"], case, "claim").status_code == 403
        assert _fresh(case).claimed_by_id is None

    def test_a_concluded_case_cannot_be_claimed(self, world):
        case = _case(world.cn)
        Judgment.all_objects.filter(pk=case.pk).update(verdict="PASSED", is_final=True)
        response = _post(world.clients["a"], case, "claim")
        assert response.status_code == 409
        assert response.data["code"] == "not_pending"
        assert _fresh(case).claimed_by_id is None

    def test_a_patch_cannot_write_the_claim(self, world):
        """The claim columns go through the row lock or not at all."""
        case = _case(world.cn)
        response = world.clients["mod"].patch(
            f"{BASE}{case.pk}/", {"claimed_by": world.users["b"].pk}, format="json"
        )
        assert response.status_code == 400
        assert "claimed_by" in response.data
        assert _fresh(case).claimed_by_id is None

    def test_each_claim_leaves_an_audit_row_with_before_and_after(self, world, django_capture_on_commit_callbacks):
        """The history of who held a case lives in AuditLog — which only works because
        the writes go through `save()`; a `QuerySet.update()` would bypass the signal."""
        from apps.audit.models import AuditLog

        case = _case(world.cn)
        with django_capture_on_commit_callbacks(execute=True):
            _post(world.clients["a"], case, "claim")
        with django_capture_on_commit_callbacks(execute=True):
            _post(world.clients["a"], case, "release")
        a = str(world.users["a"])  # AuditLog records a FK by the related row's str()
        changes = [
            log.changes["claimed_by"]
            for log in AuditLog.objects.filter(resource_id=str(case.pk)).order_by("create_time")
            if log.changes and "claimed_by" in log.changes
        ]
        assert changes == [[None, a], [a, None]], changes


# ---------------------------------------------------------------------------
# Release
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestRelease:
    def test_the_claimant_releases(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _post(world.clients["a"], case, "release")
        assert response.status_code == 200
        row = _fresh(case)
        assert row.claimed_by_id is None and row.claimed_at is None

    def test_another_judge_cannot_release_it(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _post(world.clients["b"], case, "release")
        assert response.status_code == 403
        assert response.data["code"] == "not_claimant"
        assert _fresh(case).claimed_by_id == world.users["a"].pk

    def test_a_moderator_can_release_someone_elses_claim(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        assert _post(world.clients["mod"], case, "release").status_code == 200
        assert _fresh(case).claimed_by_id is None

    def test_releasing_an_unclaimed_case_is_409(self, world):
        case = _case(world.cn)
        response = _post(world.clients["a"], case, "release")
        assert response.status_code == 409
        assert response.data["code"] == "not_claimed"

    def test_another_tenants_moderator_gets_404(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        assert _post(world.clients["eu_mod"], case, "release").status_code == 404
        assert _fresh(case).claimed_by_id == world.users["a"].pk


# ---------------------------------------------------------------------------
# Reassign
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReassign:
    def test_a_moderator_reassigns_to_another_judge_in_the_tenant(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _post(world.clients["mod"], case, "reassign", {"to": world.users["b"].pk})
        assert response.status_code == 200, response.data
        assert _fresh(case).claimed_by_id == world.users["b"].pk

    def test_a_judge_cannot_reassign(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _post(world.clients["a"], case, "reassign", {"to": world.users["b"].pk})
        assert response.status_code == 403
        assert _fresh(case).claimed_by_id == world.users["a"].pk

    def test_an_officer_in_another_tenant_is_refused_like_a_missing_one(self, world):
        case = _case(world.cn)
        cross = _post(world.clients["mod"], case, "reassign", {"to": world.users["eu_judge"].pk})
        missing = _post(world.clients["mod"], case, "reassign", {"to": 999_999_999})
        assert cross.status_code == missing.status_code == 400
        assert cross.data == missing.data
        assert cross.data["code"] == "invalid_assignee"
        assert _fresh(case).claimed_by_id is None

    def test_an_officer_who_cannot_work_judgments_is_refused(self, world):
        case = _case(world.cn)
        response = _post(world.clients["mod"], case, "reassign", {"to": world.users["guardian"].pk})
        assert response.status_code == 400
        assert response.data["code"] == "invalid_assignee"
        assert _fresh(case).claimed_by_id is None

    def test_another_tenants_moderator_gets_404(self, world):
        case = _case(world.cn)
        response = _post(world.clients["eu_mod"], case, "reassign", {"to": world.users["b"].pk})
        assert response.status_code == 404
        assert _fresh(case).claimed_by_id is None


# ---------------------------------------------------------------------------
# Defer / undefer
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDefer:
    def test_a_reason_is_required(self, world):
        case = _case(world.cn)
        assert _post(world.clients["a"], case, "defer", {}).status_code == 400
        assert _post(world.clients["a"], case, "defer", {"reason": "   "}).status_code == 400
        assert _fresh(case).deferred_at is None

    def test_the_reason_fits_the_column(self, world):
        """500 is the column width; PostgreSQL enforces it and SQLite does not, so the
        boundary has to be the serializer's."""
        case = _case(world.cn)
        assert _post(world.clients["a"], case, "defer", {"reason": "缓" * 501}).status_code == 400
        assert _post(world.clients["a"], case, "defer", {"reason": "缓" * 500}).status_code == 200
        assert len(_fresh(case).defer_reason) == 500

    def test_defer_records_who_when_and_why_and_keeps_the_claim(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _post(world.clients["a"], case, "defer", {"reason": "待补证"})
        assert response.status_code == 200
        row = _fresh(case)
        assert row.deferred_at is not None
        assert row.deferred_by_id == world.users["a"].pk
        assert row.defer_reason == "待补证"
        assert row.claimed_by_id == world.users["a"].pk

    def test_deferring_twice_is_409(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "defer", {"reason": "一"})
        response = _post(world.clients["a"], case, "defer", {"reason": "二"})
        assert response.status_code == 409
        assert response.data["code"] == "already_deferred"
        assert _fresh(case).defer_reason == "一"

    def test_a_judge_cannot_defer_a_case_someone_else_claimed(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _post(world.clients["b"], case, "defer", {"reason": "x"})
        assert response.status_code == 403
        assert _fresh(case).deferred_at is None

    def test_undefer_clears_it(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "defer", {"reason": "待补证"})
        assert _post(world.clients["a"], case, "undefer").status_code == 200
        row = _fresh(case)
        assert (row.deferred_at, row.deferred_by_id, row.defer_reason) == (None, None, "")

    def test_undeferring_a_case_that_is_not_deferred_is_409(self, world):
        case = _case(world.cn)
        response = _post(world.clients["a"], case, "undefer")
        assert response.status_code == 409
        assert response.data["code"] == "not_deferred"

    def test_another_tenant_can_neither_defer_nor_undefer(self, world):
        case = _case(world.cn)
        assert _post(world.clients["eu_judge"], case, "defer", {"reason": "x"}).status_code == 404
        _post(world.clients["a"], case, "defer", {"reason": "x"})
        assert _post(world.clients["eu_judge"], case, "undefer").status_code == 404
        assert _fresh(case).deferred_at is not None

    def test_a_deferred_case_is_not_handed_out_by_next_unless_asked(self, world):
        deferred = _case(world.cn, name="暂缓之魂")
        waiting = _case(world.cn, name="待判之魂")
        _post(world.clients["a"], deferred, "defer", {"reason": "x"})

        default = world.clients["a"].get(f"{BASE}next/")
        assert default.status_code == 200
        assert default.data["judgment"]["id"] == str(waiting.pk)
        assert default.data["total"] == 1

        asked = world.clients["a"].get(f"{BASE}next/", {"include_deferred": "true", "at": str(deferred.pk)})
        assert asked.data["judgment"]["id"] == str(deferred.pk)
        assert asked.data["total"] == 2

        # `at=` alone is a preference, not a way round the default.
        at_only = world.clients["a"].get(f"{BASE}next/", {"at": str(deferred.pk)})
        assert at_only.data["judgment"]["id"] == str(waiting.pk)


# ---------------------------------------------------------------------------
# Concluded cases keep their claim
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_concluded_case_keeps_its_claimant_and_can_no_longer_be_released(world):
    case = _case(world.cn)
    _post(world.clients["a"], case, "claim")
    concluded = world.clients["a"].post(f"{BASE}{case.pk}/conclude/", {"verdict": "PASSED"}, format="json")
    assert concluded.status_code == 200, concluded.data
    assert concluded.data["is_final"] is True
    assert concluded.data["claimed_by"] == world.users["a"].pk

    row = _fresh(case)
    assert row.claimed_by_id == world.users["a"].pk
    assert row.claimed_at is not None

    response = _post(world.clients["a"], case, "release")
    assert response.status_code == 409
    assert response.data["code"] == "not_pending"
    assert _fresh(case).claimed_by_id == world.users["a"].pk


# ---------------------------------------------------------------------------
# Conclude: only the claimant, ADMIN or 殿主 may conclude a claimed case
# ---------------------------------------------------------------------------


def _conclude(client, case):
    return client.post(f"{BASE}{case.pk}/conclude/", {"verdict": "PASSED"}, format="json")


def _nothing_written(case):
    from apps.disposition.models import Disposition

    row = _fresh(case)
    assert row.verdict is None
    assert row.is_final is False
    assert row.concluded_at is None
    assert not Disposition.all_objects.filter(judgment=row).exists()
    assert Soul.all_objects.get(pk=row.soul_id).current_state == SoulState.JUDGING


@pytest.mark.django_db
class TestConcludeRespectsTheClaim:
    def test_the_claimant_concludes(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _conclude(world.clients["a"], case)
        assert response.status_code == 200, response.data
        assert _fresh(case).is_final is True

    def test_another_judge_is_refused_with_409_and_nothing_is_written(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _conclude(world.clients["b"], case)
        assert response.status_code == 409, response.data
        assert response.data["code"] == "claimed_by_other"
        assert response.data["claimed_by"] == world.users["a"].pk
        assert response.data["claimed_by_name"] == "claim_judge_a"
        _nothing_written(case)
        assert _fresh(case).claimed_by_id == world.users["a"].pk

    def test_the_refusal_names_the_display_name_when_there_is_one(self, world):
        world.users["a"].display_name = "崔判官"
        world.users["a"].save(update_fields=["display_name"])
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _conclude(world.clients["b"], case)
        assert response.status_code == 409, response.data
        assert response.data["claimed_by_name"] == "崔判官"

    def test_admin_concludes_someone_elses_case(self, world):
        admin = User.objects.create_user(username="claim_admin", password="x", role="ADMIN", tenant=world.cn)
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _conclude(_client(admin), case)
        assert response.status_code == 200, response.data
        assert _fresh(case).is_final is True

    def test_moderator_concludes_someone_elses_case(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        response = _conclude(world.clients["mod"], case)
        assert response.status_code == 200, response.data
        assert _fresh(case).is_final is True

    def test_an_unclaimed_case_is_concluded_by_any_judge(self, world):
        case = _case(world.cn)
        response = _conclude(world.clients["b"], case)
        assert response.status_code == 200, response.data
        assert _fresh(case).is_final is True

    def test_another_tenants_moderator_gets_404_and_nothing_is_written(self, world):
        case = _case(world.cn)
        _post(world.clients["a"], case, "claim")
        assert _conclude(world.clients["eu_mod"], case).status_code == 404
        assert _conclude(world.clients["eu_judge"], case).status_code == 404
        _nothing_written(case)


# ---------------------------------------------------------------------------
# Batch
# ---------------------------------------------------------------------------


def _batch(client, body):
    return client.post(f"{BASE}batch/", body, format="json")


@pytest.mark.django_db
class TestBatch:
    def test_claims_every_case(self, world):
        cases = [_case(world.cn, name=f"魂{i}") for i in range(3)]
        response = _batch(world.clients["a"], {"operation": "claim", "ids": [str(c.pk) for c in cases]})
        assert response.status_code == 200, response.data
        assert response.data["count"] == 3
        assert all(_fresh(c).claimed_by_id == world.users["a"].pk for c in cases)

    def test_one_refusal_rolls_back_the_whole_batch(self, world):
        cases = [_case(world.cn, name=f"魂{i}") for i in range(3)]
        _post(world.clients["b"], cases[1], "claim")
        response = _batch(world.clients["a"], {"operation": "claim", "ids": [str(c.pk) for c in cases]})
        assert response.status_code == 409, response.data
        assert response.data["code"] == "already_claimed"
        assert response.data["id"] == str(cases[1].pk)
        assert _fresh(cases[0]).claimed_by_id is None
        assert _fresh(cases[2]).claimed_by_id is None
        assert _fresh(cases[1]).claimed_by_id == world.users["b"].pk

    def test_a_defer_batch_rolls_back_too(self, world):
        cases = [_case(world.cn, name=f"魂{i}") for i in range(3)]
        _post(world.clients["a"], cases[2], "defer", {"reason": "先"})
        response = _batch(
            world.clients["a"], {"operation": "defer", "ids": [str(c.pk) for c in cases], "reason": "后"}
        )
        assert response.status_code == 409
        assert [_fresh(c).deferred_at is None for c in cases] == [True, True, False]
        assert _fresh(cases[2]).defer_reason == "先"

    def test_an_id_from_another_tenant_fails_the_whole_batch_with_404(self, world):
        mine = _case(world.cn, name="本殿")
        theirs = _case(world.eu, name="Foreign")
        response = _batch(world.clients["a"], {"operation": "claim", "ids": [str(mine.pk), str(theirs.pk)]})
        assert response.status_code == 404
        assert response.data["missing"] == [str(theirs.pk)]
        assert _fresh(mine).claimed_by_id is None
        assert _fresh(theirs).claimed_by_id is None

    def test_reassign_needs_judgment_assign(self, world):
        cases = [_case(world.cn, name=f"魂{i}") for i in range(2)]
        body = {"operation": "reassign", "ids": [str(c.pk) for c in cases], "to": world.users["b"].pk}
        assert _batch(world.clients["a"], body).status_code == 403
        assert all(_fresh(c).claimed_by_id is None for c in cases)
        assert _batch(world.clients["mod"], body).status_code == 200
        assert all(_fresh(c).claimed_by_id == world.users["b"].pk for c in cases)

    def test_reassign_to_another_tenants_officer_is_refused_for_all(self, world):
        cases = [_case(world.cn, name=f"魂{i}") for i in range(2)]
        body = {"operation": "reassign", "ids": [str(c.pk) for c in cases], "to": world.users["eu_judge"].pk}
        response = _batch(world.clients["mod"], body)
        assert response.status_code == 400
        assert response.data["code"] == "invalid_assignee"
        assert all(_fresh(c).claimed_by_id is None for c in cases)

    def test_the_input_is_validated(self, world):
        case = _case(world.cn)
        client = world.clients["a"]
        assert _batch(client, {"operation": "defer", "ids": [str(case.pk)]}).status_code == 400
        assert _batch(client, {"operation": "reassign", "ids": [str(case.pk)]}).status_code == 400
        assert _batch(client, {"operation": "conclude", "ids": [str(case.pk)]}).status_code == 400
        assert _batch(client, {"operation": "claim", "ids": []}).status_code == 400
        too_many = [str(uuid.uuid4()) for _ in range(101)]
        assert _batch(client, {"operation": "claim", "ids": too_many}).status_code == 400
        assert _fresh(case).claimed_by_id is None

    def test_a_hundred_is_allowed_and_duplicates_count_once(self, world):
        case = _case(world.cn)
        response = _batch(world.clients["a"], {"operation": "claim", "ids": [str(case.pk)] * 100})
        assert response.status_code == 200, response.data
        assert response.data["count"] == 1

    def test_a_role_without_judgment_execute_is_refused(self, world):
        case = _case(world.cn)
        assert _batch(world.clients["guardian"], {"operation": "claim", "ids": [str(case.pk)]}).status_code == 403


# ---------------------------------------------------------------------------
# The list: groups, counts, court, search, balance, evidence, query count
# ---------------------------------------------------------------------------


@pytest.fixture
def four_groups(world):
    """One case per group, plus a concluded unclaimed one and another tenant's case —
    the two that must appear in no group."""
    cases = {
        "mine": _case(world.cn, name="我的", court="第一殿"),
        "unclaimed": _case(world.cn, name="无人", court="第二殿"),
        "others": _case(world.cn, name="别人", court="第一殿"),
        "deferred": _case(world.cn, name="暂缓", court="第一殿"),
        "concluded": _case(world.cn, name="已结", court="第一殿"),
        "foreign": _case(world.eu, name="Foreign", court="第一殿"),
    }
    _post(world.clients["a"], cases["mine"], "claim")
    _post(world.clients["b"], cases["others"], "claim")
    _post(world.clients["a"], cases["deferred"], "claim")
    _post(world.clients["a"], cases["deferred"], "defer", {"reason": "x"})
    Judgment.all_objects.filter(pk=cases["concluded"].pk).update(verdict="PASSED", is_final=True)
    return cases


def _ids(response):
    assert response.status_code == 200, response.data
    return {row["id"] for row in response.data["results"]}


@pytest.mark.django_db
class TestQueueList:
    @pytest.mark.parametrize("group", ["mine", "unclaimed", "others", "deferred"])
    def test_each_group_holds_exactly_its_case(self, world, four_groups, group):
        got = _ids(world.clients["a"].get(BASE, {"group": group}))
        assert got == {str(four_groups[group].pk)}

    def test_groups_are_relative_to_the_caller(self, world, four_groups):
        assert _ids(world.clients["b"].get(BASE, {"group": "mine"})) == {str(four_groups["others"].pk)}
        assert _ids(world.clients["b"].get(BASE, {"group": "others"})) == {str(four_groups["mine"].pk)}

    def test_an_unknown_group_is_400(self, world):
        assert world.clients["a"].get(BASE, {"group": "everything"}).status_code == 400

    def test_counts(self, world, four_groups):
        response = world.clients["a"].get(f"{BASE}queue-counts/")
        assert response.status_code == 200
        assert response.data == {"mine": 1, "unclaimed": 1, "others": 1, "deferred": 1, "total": 4}

    def test_counts_follow_court_and_search_and_ignore_group(self, world, four_groups):
        by_court = world.clients["a"].get(f"{BASE}queue-counts/", {"court": "第一殿", "group": "mine"})
        assert by_court.data == {"mine": 1, "unclaimed": 0, "others": 1, "deferred": 1, "total": 3}
        by_name = world.clients["a"].get(f"{BASE}queue-counts/", {"search": "无人"})
        assert by_name.data == {"mine": 0, "unclaimed": 1, "others": 0, "deferred": 0, "total": 1}

    def test_counts_are_tenant_scoped(self, world, four_groups):
        eu = world.clients["eu_judge"].get(f"{BASE}queue-counts/")
        assert eu.data == {"mine": 0, "unclaimed": 1, "others": 0, "deferred": 0, "total": 1}

    def test_courts_lists_every_court_in_scope_with_pending_counts(self, world, four_groups):
        # 第一殿:mine / others / deferred 三件未结 + 一件已结;第二殿:一件。另一租户的第一殿不算。
        _case(world.cn, name="无殿", court="")
        _case(world.cn, name="仅已结", court="第三殿")
        Judgment.all_objects.filter(court="第三殿").update(verdict="PASSED", is_final=True)
        response = world.clients["a"].get(f"{BASE}courts/", {"court": "第二殿", "page": "2"})
        assert response.status_code == 200, response.data
        # 不分页、不随筛选收窄;空殿不列;只有已结案的殿也列,pending 为 0。
        # 按 court 排,但 CJK 的先后是库的排序规则说了算(PG 与 SQLite 未必同),这里不钉顺序。
        assert sorted(response.data, key=lambda r: r["court"]) == [
            {"court": "第一殿", "pending": 3},
            {"court": "第三殿", "pending": 0},
            {"court": "第二殿", "pending": 1},
        ]

    def test_courts_are_tenant_scoped(self, world, four_groups):
        _case(world.eu, name="Only EU", court="Minos")
        eu = world.clients["eu_judge"].get(f"{BASE}courts/")
        assert eu.data == [{"court": "Minos", "pending": 1}, {"court": "第一殿", "pending": 1}]
        cn = world.clients["a"].get(f"{BASE}courts/")
        assert "Minos" not in {row["court"] for row in cn.data}

    def test_courts_need_the_queue_read(self, world, four_groups):
        assert world.clients["viewer"].get(f"{BASE}courts/").status_code == 200
        assert world.clients["guardian"].get(f"{BASE}courts/").status_code == 403

    def test_court_filter(self, world, four_groups):
        got = _ids(world.clients["a"].get(BASE, {"court": "第二殿"}))
        assert got == {str(four_groups["unclaimed"].pk)}

    def test_civilization_narrows_the_rows_and_the_counts_together(self, world, four_groups):
        # 队列页的「文明」下拉:同一个参数进列表与 queue-counts。
        Judgment.all_objects.filter(pk=four_groups["unclaimed"].pk).update(civilization="EUROPEAN")
        client = world.clients["a"]
        assert _ids(client.get(BASE, {"group": "unclaimed", "civilization": "EUROPEAN"})) == {
            str(four_groups["unclaimed"].pk)
        }
        assert _ids(client.get(BASE, {"group": "unclaimed", "civilization": "CHINESE"})) == set()
        counts = client.get(f"{BASE}queue-counts/", {"civilization": "CHINESE"}).data
        assert counts == {"mine": 1, "unclaimed": 0, "others": 1, "deferred": 1, "total": 3}
        # 另一租户的欧洲案子不因文明筛选漏进来。
        assert str(four_groups["foreign"].pk) not in _ids(client.get(BASE, {"civilization": "EUROPEAN"}))

    def test_the_sort_dropdown_orders_by_waiting_time_both_ways(self, world):
        import datetime as dt

        from django.utils import timezone

        old = _case(world.cn, name="久候")
        new = _case(world.cn, name="新到")
        Judgment.all_objects.filter(pk=old.pk).update(created_at=timezone.now() - dt.timedelta(days=30))
        client = world.clients["a"]

        def order(ordering):
            response = client.get(BASE, {"group": "unclaimed", "ordering": ordering})
            assert response.status_code == 200
            return [row["id"] for row in response.data["results"]]

        assert order("created_at") == [str(old.pk), str(new.pk)]
        assert order("-created_at") == [str(new.pk), str(old.pk)]

    def test_search_by_soul_name_soul_id_and_judgment_id(self, world, four_groups):
        target = four_groups["others"]
        client = world.clients["a"]
        assert _ids(client.get(BASE, {"search": "别"})) == {str(target.pk)}
        assert _ids(client.get(BASE, {"search": str(target.soul_id)})) == {str(target.pk)}
        assert _ids(client.get(BASE, {"search": str(target.pk)})) == {str(target.pk)}
        # Not a UUID: matches nothing, does not 500.
        assert _ids(client.get(BASE, {"search": "not-a-uuid"})) == set()

    def test_search_does_not_reach_another_tenant(self, world, four_groups):
        assert _ids(world.clients["a"].get(BASE, {"search": "Foreign"})) == set()

    def test_the_row_carries_balance_evidence_count_and_the_claim(self, world):
        cn_case = _case(world.cn, name="有功", merit=50, demerit=20, evidence={"证人": "甲", "物证": "乙"})
        _post(world.clients["a"], cn_case, "claim")
        rows = world.clients["a"].get(BASE).data["results"]
        row = next(r for r in rows if r["id"] == str(cn_case.pk))
        assert row["karmic_balance"] == 30
        assert row["evidence_count"] == 2
        assert row["claimed_by"] == world.users["a"].pk
        assert row["claimed_by_name"] == "claim_judge_a"
        assert row["deferred_at"] is None

    def test_a_non_chinese_case_has_no_balance(self, world):
        eu_case = _case(world.eu, name="Dante", merit=50, demerit=20)
        rows = world.clients["eu_judge"].get(BASE).data["results"]
        row = next(r for r in rows if r["id"] == str(eu_case.pk))
        assert "karmic_balance" in row
        assert row["karmic_balance"] is None

    def test_viewer_gets_no_balance(self, world):
        cn_case = _case(world.cn, name="有功", merit=50, demerit=20)
        response = world.clients["viewer"].get(BASE)
        assert response.status_code == 200, response.data
        row = next(r for r in response.data["results"] if r["id"] == str(cn_case.pk))
        assert "karmic_balance" not in row
        # Present for everyone else, so the absence above is the rule and not a typo.
        judge_row = next(r for r in world.clients["a"].get(BASE).data["results"] if r["id"] == str(cn_case.pk))
        assert judge_row["karmic_balance"] == 30
        detail = world.clients["viewer"].get(f"{BASE}{cn_case.pk}/")
        assert "karmic_balance" not in detail.data

    def test_the_list_does_not_query_per_row(self, world):
        def list_queries(n):
            Judgment.all_objects.all().delete()
            for i in range(n):
                case = _case(world.cn, name=f"魂{n}-{i}", evidence={"k": i})
                claimant = "a" if i % 2 else "b"
                _post(world.clients[claimant], case, "claim")
                if i % 3 == 0:
                    _post(world.clients[claimant], case, "defer", {"reason": "x"})
            client = world.clients["a"]
            client.get(BASE)  # warm the permission cache
            with CaptureQueriesContext(connection) as ctx:
                response = client.get(BASE, {"group": "mine"})
                response = client.get(BASE)
            assert response.status_code == 200
            assert len(response.data["results"]) == n
            return len(ctx.captured_queries)

        assert list_queries(2) == list_queries(8)
