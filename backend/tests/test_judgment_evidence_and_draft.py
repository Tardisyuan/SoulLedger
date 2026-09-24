"""Evidence admission (采信) and the verdict-text draft (判词草稿) of a judgment.

What is held here, and why each is a separate test:

1. ADMISSION IS PER JUDGMENT. The same record can be admitted in one case and
   not in another; the ruling lives on `EvidenceAdmission`, never on the record.
2. NOT ADMITTING NEEDS A REASON, at the service, at the API and in the DB.
3. RULINGS AND THE DRAFT FREEZE WHEN THE CASE IS CONCLUDED (409).
4. THE ADMITTED BALANCE IS THE LEDGER'S OWN ARITHMETIC minus the excluded
   records — equal to `get_ledger_summary`'s balance when nothing is excluded —
   and exists only where the reading is a BALANCE.
5. CONCLUDE DOES NOT READ THE ADMITTED BALANCE. Routing stays on the full
   ledger; an explicit decision, pinned so changing it has to be deliberate.
6. A STALE DRAFT VERSION IS A 409 carrying what beat it; a replay is a no-op.
7. TENANT ISOLATION AND PERMISSIONS, tested with JUDGE users — ADMIN bypasses
   tenant scoping and would pass against an unscoped implementation.
"""
import pytest
from django.db import IntegrityError, transaction

from apps.disposition.services import DispositionService
from apps.judgment.models import EvidenceAdmission, Judgment, Verdict
from apps.judgment.services import (
    EvidenceAdmissionService,
    EvidenceRefusedError,
    JudgmentFrozenError,
)
from apps.ledger.models import SoulRecord
from apps.ledger.services import LedgerService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


def _tenant(code):
    tenant, _ = Tenant.objects.get_or_create(code=code, defaults={"display_name": code})
    return tenant


def _soul(tenant, name="待判之魂"):
    return Soul.objects.create(
        name=name, birth_date="1900-01-01", current_state=SoulState.JUDGING, tenant=tenant,
    )


def _record(soul, record_type, weight, description="deed"):
    return SoulRecord.objects.create(
        soul=soul, tenant=soul.tenant, record_type=record_type, description=description, weight=weight,
    )


def _judgment(soul):
    return Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="第一殿", tenant=soul.tenant,
    )


def _user(django_user_model, username, role, tenant):
    user, _ = django_user_model.objects.get_or_create(
        username=username, defaults={"role": role, "tenant": tenant},
    )
    return user


def _grant(role_name, *codenames):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})
    for codename in codenames:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "judgment"}
        )
        RolePermission.objects.get_or_create(role=role, permission=permission)


def _login(client, user):
    """A real caller: role grants in the DB and a `tenant_code` claim, as
    tests/test_judgment_statutes.py's `judge_headers` does."""
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


JUDGE_CODENAMES = ("judgment.read", "judgment.create", "judgment.execute")


def _rule_url(judgment, record):
    return f"/api/v1/judgment/{judgment.id}/evidence/{record.id}/"


def _draft_url(judgment):
    return f"/api/v1/judgment/{judgment.id}/draft/"


@pytest.fixture
def cn_case(cn_tenant):
    soul = _soul(cn_tenant)
    merit = _record(soul, "MERIT", 30, "修桥铺路")
    demerit = _record(soul, "DEMERIT", 20, "杀生")
    return _judgment(soul), merit, demerit


@pytest.fixture
def judge_client(api_client, judge_user):
    _grant("JUDGE", *JUDGE_CODENAMES)
    return _login(api_client, judge_user)


# ---------------------------------------------------------------------------
# 1–2. Ruling, per judgment, with a reason
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestRuling:
    def test_not_admitting_requires_a_reason(self, judge_client, cn_case):
        judgment, _, demerit = cn_case
        for body in ({"admitted": False}, {"admitted": False, "reason": "   "}):
            response = judge_client.put(_rule_url(judgment, demerit), body, format="json")
            assert response.status_code == 400, response.data
        assert not EvidenceAdmission.all_objects.exists()

    def test_not_admit_then_admit_again_keeps_one_row(self, judge_client, cn_case, judge_user):
        judgment, _, demerit = cn_case
        response = judge_client.put(
            _rule_url(judgment, demerit), {"admitted": False, "reason": "证人翻供"}, format="json",
        )
        assert response.status_code == 200, response.data
        assert response.data["admission"]["admitted"] is False
        assert response.data["admission"]["reason"] == "证人翻供"
        row = EvidenceAdmission.objects.get(judgment=judgment, record=demerit)
        assert row.tenant_id == judgment.tenant_id
        assert row.create_user_id == judge_user.pk

        response = judge_client.put(_rule_url(judgment, demerit), {"admitted": True}, format="json")
        assert response.status_code == 200, response.data
        assert EvidenceAdmission.all_objects.filter(judgment=judgment, record=demerit).count() == 1
        row.refresh_from_db()
        # Reversed, not deleted: the reason goes, the row (and who reversed it) stays.
        assert row.admitted is True and row.reason == ""

    def test_the_same_record_can_be_ruled_differently_in_two_judgments(self, cn_case):
        judgment, _, demerit = cn_case
        # A concluded earlier case on the same soul and life, then this one.
        other = _judgment(judgment.soul)
        EvidenceAdmissionService.rule(other, demerit.pk, admitted=True)
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        assert EvidenceAdmission.objects.get(judgment=other, record=demerit).admitted is True
        assert EvidenceAdmission.objects.get(judgment=judgment, record=demerit).admitted is False
        # And nothing was written on the record itself.
        assert not hasattr(SoulRecord, "admitted")

    def test_the_database_refuses_a_refusal_without_reason(self, cn_case):
        judgment, _, demerit = cn_case
        with pytest.raises(IntegrityError), transaction.atomic():
            EvidenceAdmission.objects.create(
                judgment=judgment, record=demerit, admitted=False, reason="", tenant=judgment.tenant,
            )

    def test_a_non_scoring_record_is_not_evidence(self, cn_case):
        judgment, _, _ = cn_case
        note = _record(judgment.soul, "JUDGMENT", 1)
        with pytest.raises(EvidenceRefusedError):
            EvidenceAdmissionService.rule(judgment, note.pk, admitted=False, reason="x")

    def test_another_souls_record_is_not_evidence(self, cn_case, cn_tenant):
        judgment, _, _ = cn_case
        stranger = _record(_soul(cn_tenant, "旁人"), "DEMERIT", 5)
        with pytest.raises(EvidenceRefusedError):
            EvidenceAdmissionService.rule(judgment, stranger.pk, admitted=False, reason="x")

    def test_a_record_from_another_life_is_not_evidence(self, cn_case):
        judgment, _, _ = cn_case
        earlier = _record(judgment.soul, "DEMERIT", 5)
        SoulRecord.all_objects.filter(pk=earlier.pk).update(cycle=judgment.cycle + 1)
        with pytest.raises(EvidenceRefusedError):
            EvidenceAdmissionService.rule(judgment, earlier.pk, admitted=False, reason="x")


# ---------------------------------------------------------------------------
# 3. Frozen after conclude
# ---------------------------------------------------------------------------


def _conclude(judgment):
    Judgment.all_objects.filter(pk=judgment.pk).update(verdict=Verdict.FAILED, is_final=True)


@pytest.mark.django_db
class TestFrozenAfterConclude:
    def test_ruling_is_refused_with_409_and_nothing_is_written(self, judge_client, cn_case):
        judgment, _, demerit = cn_case
        _conclude(judgment)
        response = judge_client.put(
            _rule_url(judgment, demerit), {"admitted": False, "reason": "晚了"}, format="json",
        )
        assert response.status_code == 409, response.data
        assert response.data["code"] == "concluded"
        assert not EvidenceAdmission.all_objects.exists()

    def test_reversing_an_existing_ruling_is_refused_too(self, cn_case):
        judgment, _, demerit = cn_case
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        _conclude(judgment)
        with pytest.raises(JudgmentFrozenError):
            EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=True)
        assert EvidenceAdmission.objects.get(judgment=judgment, record=demerit).admitted is False

    def test_a_verdict_alone_freezes_even_without_is_final(self, cn_case):
        judgment, _, demerit = cn_case
        Judgment.all_objects.filter(pk=judgment.pk).update(verdict=Verdict.PASSED)
        with pytest.raises(JudgmentFrozenError):
            EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="x")

    def test_draft_save_is_refused_with_409(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        _conclude(judgment)
        response = judge_client.patch(
            _draft_url(judgment), {"version": 0, "notes": "改判词"}, format="json",
        )
        assert response.status_code == 409, response.data
        assert response.data["code"] == "concluded"
        judgment.refresh_from_db()
        assert judgment.notes == ""

    def test_conclude_through_the_api_then_everything_is_frozen(self, judge_client, cn_case):
        judgment, _, demerit = cn_case
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        response = judge_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/", {"verdict": "FAILED", "notes": "判"}, format="json",
        )
        assert response.status_code == 200, response.data
        response = judge_client.put(_rule_url(judgment, demerit), {"admitted": True}, format="json")
        assert response.status_code == 409


# ---------------------------------------------------------------------------
# 4. Admitted balance
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAdmittedBalance:
    def test_nothing_excluded_equals_the_ledger_balance(self, cn_case):
        judgment, _, _ = cn_case
        LedgerService._invalidate_cache(judgment.soul)
        summary = LedgerService.get_ledger_summary(judgment.soul)
        result = EvidenceAdmissionService.admitted_balance(judgment)
        assert summary["reading"]["kind"] == "BALANCE"
        assert result == {
            "reading_kind": "BALANCE",
            "balance": summary["reading"]["balance"],
            "not_admitted_count": 0,
            "not_admitted_net": 0.0,
            "reason_code": None,
        }
        assert result["balance"] == 10  # 30 merit − 20 demerit, undecayed at age 0

    def test_excluding_a_demerit_raises_the_balance_by_its_weight(self, cn_case):
        judgment, _, demerit = cn_case
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        result = EvidenceAdmissionService.admitted_balance(judgment)
        assert result["balance"] == 30
        assert result["not_admitted_count"] == 1
        assert result["not_admitted_net"] == -20.0

    def test_excluding_a_merit_lowers_it_and_the_net_is_signed(self, cn_case):
        judgment, merit, demerit = cn_case
        EvidenceAdmissionService.rule(judgment, merit.pk, admitted=False, reason="伪证")
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="伪证")
        result = EvidenceAdmissionService.admitted_balance(judgment)
        assert result["balance"] == 0
        assert result["not_admitted_count"] == 2
        assert result["not_admitted_net"] == 10.0

    def test_a_reversed_ruling_counts_as_admitted(self, cn_case):
        judgment, _, demerit = cn_case
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=True)
        assert EvidenceAdmissionService.admitted_balance(judgment)["balance"] == 10

    def test_inherited_carry_over_is_the_base_as_in_the_summary(self, cn_case):
        judgment, _, demerit = cn_case
        Soul.all_objects.filter(pk=judgment.soul_id).update(inherited_merit=7, inherited_demerit=2)
        judgment.soul.refresh_from_db()
        LedgerService._invalidate_cache(judgment.soul)
        assert (EvidenceAdmissionService.admitted_balance(judgment)["balance"]
                == LedgerService.get_ledger_summary(judgment.soul)["reading"]["balance"] == 15)
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        assert EvidenceAdmissionService.admitted_balance(judgment)["balance"] == 35

    @pytest.mark.parametrize("code,kind", [
        ("EG_DUAT", "THRESHOLD"),
        ("EU_HEAVEN_HELL", "GUILT_AND_PENALTY"),
        ("GR_HADES", "SENTENCE"),
    ])
    def test_no_balance_where_the_reading_is_not_a_balance(self, code, kind):
        soul = _soul(_tenant(code))
        _record(soul, "MERIT", 30)
        demerit = _record(soul, "DEMERIT", 20)
        judgment = _judgment(soul)
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        assert EvidenceAdmissionService.admitted_balance(judgment) == {
            "reading_kind": kind,
            "balance": None,
            "not_admitted_count": 1,
            "not_admitted_net": None,
            "reason_code": "BALANCE_NOT_APPLICABLE",
        }

    def test_an_unmapped_tenant_carries_the_readings_own_reason(self):
        soul = _soul(_tenant("ZZ_NOWHERE"))
        _record(soul, "DEMERIT", 20)
        result = EvidenceAdmissionService.admitted_balance(_judgment(soul))
        assert result["reading_kind"] == "UNAVAILABLE"
        assert result["balance"] is None
        assert result["reason_code"] == "TENANT_NOT_MAPPED"

    def test_a_judgment_from_an_earlier_life_gets_no_figure(self, cn_case):
        judgment, _, _ = cn_case
        Judgment.all_objects.filter(pk=judgment.pk).update(cycle=judgment.cycle + 1)
        judgment.refresh_from_db()
        result = EvidenceAdmissionService.admitted_balance(judgment)
        assert result["balance"] is None
        assert result["reason_code"] == "NOT_CURRENT_LIFE"

    def test_detail_returns_it_and_the_list_does_not(self, judge_client, cn_case):
        judgment, _, demerit = cn_case
        EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
        detail = judge_client.get(f"/api/v1/judgment/{judgment.id}/")
        assert detail.status_code == 200
        assert detail.data["admitted_balance"]["balance"] == 30
        assert detail.data["admitted_balance"]["not_admitted_count"] == 1
        assert [a["record"] for a in detail.data["evidence_admissions"]] == [demerit.pk]
        listed = judge_client.get("/api/v1/judgment/")
        row = next(r for r in listed.data["results"] if r["id"] == str(judgment.id))
        assert "admitted_balance" not in row

    def test_the_ruling_response_carries_the_new_balance(self, judge_client, cn_case):
        judgment, _, demerit = cn_case
        response = judge_client.put(
            _rule_url(judgment, demerit), {"admitted": False, "reason": "不采信"}, format="json",
        )
        assert response.data["admitted_balance"]["balance"] == 30


# ---------------------------------------------------------------------------
# 5. Conclude routes on the full ledger, not the admitted one
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_conclude_routing_ignores_admission(cn_tenant):
    """DECIDED, and pinned: `DispositionService._route_to_realm` reads
    `soul.karmic_balance` / `get_unoffset_demerit` / `demerit_score` — the full
    ledger. Excluding the only demerit from evidence does not change where a
    FAILED soul is sent. If that should change, it changes here on purpose."""
    soul = _soul(cn_tenant)
    demerit = _record(soul, "DEMERIT", 95, "杀人")
    soul.refresh_from_db()
    judgment = _judgment(soul)
    before = DispositionService._route_to_realm(soul, Verdict.FAILED)
    EvidenceAdmissionService.rule(judgment, demerit.pk, admitted=False, reason="不采信")
    assert EvidenceAdmissionService.admitted_balance(judgment)["balance"] == 0
    LedgerService._invalidate_cache(soul)
    assert DispositionService._route_to_realm(soul, Verdict.FAILED) == before
    # And the mildest court would be the answer if it did read the admitted figure.
    assert before != DispositionService.CHINESE_HELL_TIERS[DispositionService.CHINESE_HELL_MIN_TIER]


# ---------------------------------------------------------------------------
# 6. The draft
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDraft:
    def test_save_returns_version_and_saved_at_and_writes_notes(self, judge_client, cn_case, judge_user):
        judgment, _, _ = cn_case
        response = judge_client.patch(
            _draft_url(judgment), {"version": 0, "notes": "查该魂", "draft_verdict": "FAILED"}, format="json",
        )
        assert response.status_code == 200, response.data
        assert response.data["draft_version"] == 1
        assert response.data["draft_saved_at"] is not None
        judgment.refresh_from_db()
        # `notes` IS the draft: the detail page's textarea seeds from it.
        assert judgment.notes == "查该魂"
        assert judgment.draft_verdict == "FAILED"
        assert judgment.verdict is None and judgment.is_final is False
        assert judgment.update_user_id == judge_user.pk

    def test_stale_version_is_409_with_what_beat_it(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        first = judge_client.patch(_draft_url(judgment), {"version": 0, "notes": "甲的判词"}, format="json")
        assert first.status_code == 200
        # Officer B loaded version 0 too.
        second = judge_client.patch(_draft_url(judgment), {"version": 0, "notes": "乙的判词"}, format="json")
        assert second.status_code == 409, second.data
        assert second.data["code"] == "draft_conflict"
        assert second.data["current"]["notes"] == "甲的判词"
        assert second.data["current"]["draft_version"] == 1
        judgment.refresh_from_db()
        assert judgment.notes == "甲的判词"

    def test_a_replay_is_a_no_op_not_a_conflict(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        body = {"version": 0, "notes": "判词", "draft_verdict": "PASSED"}
        first = judge_client.patch(_draft_url(judgment), body, format="json")
        again = judge_client.patch(_draft_url(judgment), body, format="json")
        assert again.status_code == 200, again.data
        assert again.data == first.data

    def test_partial_fields_leave_the_other_alone(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        judge_client.patch(_draft_url(judgment), {"version": 0, "draft_verdict": "PURGATORY"}, format="json")
        response = judge_client.patch(_draft_url(judgment), {"version": 1, "notes": "续写"}, format="json")
        assert response.status_code == 200
        assert response.data["draft_verdict"] == "PURGATORY"
        assert response.data["notes"] == "续写"
        assert response.data["draft_version"] == 2

    def test_version_is_required(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        response = judge_client.patch(_draft_url(judgment), {"notes": "无版本"}, format="json")
        assert response.status_code == 400

    def test_a_plain_patch_of_notes_moves_the_draft_version(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        response = judge_client.patch(f"/api/v1/judgment/{judgment.id}/", {"notes": "旁路"}, format="json")
        assert response.status_code == 200, response.data
        judgment.refresh_from_db()
        assert judgment.draft_version == 1
        stale = judge_client.patch(_draft_url(judgment), {"version": 0, "notes": "覆盖"}, format="json")
        assert stale.status_code == 409

    def test_draft_fields_are_not_writable_through_the_plain_patch(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        judge_client.patch(
            f"/api/v1/judgment/{judgment.id}/", {"draft_verdict": "PASSED", "draft_version": 9}, format="json",
        )
        judgment.refresh_from_db()
        assert judgment.draft_verdict is None and judgment.draft_version == 0

    def test_conclude_still_writes_the_submitted_notes(self, judge_client, cn_case):
        judgment, _, _ = cn_case
        judge_client.patch(_draft_url(judgment), {"version": 0, "notes": "草稿"}, format="json")
        response = judge_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/", {"verdict": "FAILED", "notes": "定稿"}, format="json",
        )
        assert response.status_code == 200, response.data
        assert response.data["notes"] == "定稿"


# ---------------------------------------------------------------------------
# 7. Tenant isolation and permissions
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestIsolationAndPermissions:
    def test_another_tenants_judge_cannot_reach_either_endpoint(
        self, api_client, django_user_model, cn_case, eu_tenant,
    ):
        judgment, _, demerit = cn_case
        _grant("JUDGE", *JUDGE_CODENAMES)
        _login(api_client, _user(django_user_model, "eu_judge", "JUDGE", eu_tenant))
        response = api_client.put(
            _rule_url(judgment, demerit), {"admitted": False, "reason": "越权"}, format="json",
        )
        assert response.status_code == 404
        response = api_client.patch(_draft_url(judgment), {"version": 0, "notes": "越权"}, format="json")
        assert response.status_code == 404
        assert not EvidenceAdmission.all_objects.exists()
        judgment.refresh_from_db()
        assert judgment.notes == "" and judgment.draft_version == 0

    def test_a_record_from_another_tenant_cannot_be_ruled_on(self, judge_client, cn_case, eu_tenant):
        judgment, _, _ = cn_case
        foreign = _record(_soul(eu_tenant, "异域之魂"), "DEMERIT", 5)
        response = judge_client.put(
            _rule_url(judgment, foreign), {"admitted": False, "reason": "x"}, format="json",
        )
        assert response.status_code == 400
        assert not EvidenceAdmission.all_objects.exists()

    @pytest.mark.parametrize("role", ["GUARDIAN", "VIEWER"])
    def test_a_reader_without_judgment_execute_is_refused(self, api_client, django_user_model, cn_case, cn_tenant, role):
        """Granted `judgment.read` so the refusal is about the write codename,
        not about reaching the case at all: the detail (with the balance) is
        readable, the ruling and the draft are not."""
        judgment, _, demerit = cn_case
        _grant(role, "judgment.read")
        _login(api_client, _user(django_user_model, f"u_{role}", role, cn_tenant))
        assert api_client.get(f"/api/v1/judgment/{judgment.id}/").status_code == 200
        response = api_client.put(
            _rule_url(judgment, demerit), {"admitted": False, "reason": "x"}, format="json",
        )
        assert response.status_code == 403
        response = api_client.patch(_draft_url(judgment), {"version": 0, "notes": "x"}, format="json")
        assert response.status_code == 403

    def test_both_actions_require_the_codename_conclude_requires(self):
        from apps.judgment.views import JudgmentViewSet

        perms = JudgmentViewSet.extra_permissions
        assert perms["rule_evidence"] == perms["save_draft"] == perms["conclude"] == ["judgment.execute"]
