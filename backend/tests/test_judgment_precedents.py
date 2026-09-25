"""「据 · 先例」:`GET /judgment/{id}/precedents/` 的排序、范围与 VIEWER 余额扣留。

排序规则写在 `apps/judgment/precedents.py` 的 docstring 里;这里每条规则一条测试,
并各自构造「只有这一条规则能分出先后」的数据。
"""
import pytest
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, JudgmentCitation, Statute, Verdict
from apps.judgment.serializers import JudgmentPrecedentSerializer
from apps.realms.models import Realm
from apps.souls.models import Soul


def _client(api_client, user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.fixture
def judge(api_client, judge_user):
    return _client(api_client, judge_user)


def _soul(tenant, name, balance):
    merit, demerit = (balance, 0) if balance >= 0 else (0, -balance)
    return Soul.objects.create(name=name, tenant=tenant, merit_score=merit, demerit_score=demerit)


def _judgment(tenant, name, *, balance=0, court="", verdict=Verdict.FAILED, civ="CHINESE", concluded_days_ago=1):
    soul = _soul(tenant, name, balance)
    return Judgment.objects.create(
        soul=soul, tenant=tenant, civilization=civ, court=court, verdict=verdict,
        is_final=verdict is not None,
        concluded_at=timezone.now() - timezone.timedelta(days=concluded_days_ago) if verdict else None,
    )


def _statute(tenant, code):
    return Statute.objects.create(civilization="CHINESE", corpus="HELL_LAW", code=code, tenant=tenant)


def _cite(judgment, *statutes):
    for statute in statutes:
        JudgmentCitation.objects.create(judgment=judgment, statute=statute, tenant=judgment.tenant)


def _url(judgment, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"/api/v1/judgment/{judgment.pk}/precedents/" + (f"?{query}" if query else "")


def _names(response):
    assert response.status_code == 200, response.content
    return [row["name"] for row in response.json()]


@pytest.mark.django_db
class TestRanking:
    def test_same_court_beats_a_closer_balance(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", balance=0, court="第五殿", verdict=None)
        _judgment(cn_tenant, "other court, same balance", balance=0, court="第二殿")
        _judgment(cn_tenant, "same court, far balance", balance=500, court="第五殿")
        assert _names(judge.get(_url(target))) == ["same court, far balance", "other court, same balance"]

    def test_then_the_closest_balance(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", balance=-40, court="第五殿", verdict=None)
        _judgment(cn_tenant, "far", balance=100, court="第五殿")
        _judgment(cn_tenant, "near below", balance=-45, court="第五殿")
        _judgment(cn_tenant, "nearer above", balance=-38, court="第五殿")
        assert _names(judge.get(_url(target))) == ["nearer above", "near below", "far"]

    def test_then_shared_cited_statutes(self, judge, cn_tenant):
        a, b, c = _statute(cn_tenant, "P_A"), _statute(cn_tenant, "P_B"), _statute(cn_tenant, "P_C")
        target = _judgment(cn_tenant, "target", balance=10, verdict=None)
        _cite(target, a, b)
        one = _judgment(cn_tenant, "shares one", balance=10)
        _cite(one, a, c)
        two = _judgment(cn_tenant, "shares two", balance=10)
        _cite(two, a, b)
        _judgment(cn_tenant, "shares none", balance=10)
        body = judge.get(_url(target)).json()
        assert [row["name"] for row in body] == ["shares two", "shares one", "shares none"]
        assert [row["shared_statutes"] for row in body] == [2, 1, 0]

    def test_an_empty_court_is_not_a_court_match(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", balance=0, court="", verdict=None)
        _judgment(cn_tenant, "blank court far", balance=90, court="")
        _judgment(cn_tenant, "named court near", balance=1, court="第三殿")
        body = judge.get(_url(target)).json()
        assert [row["name"] for row in body] == ["named court near", "blank court far"]
        assert {row["same_court"] for row in body} == {False}

    def test_limit(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", verdict=None)
        for i in range(8):
            _judgment(cn_tenant, f"p{i}", balance=i)
        assert len(judge.get(_url(target)).json()) == 5
        assert len(judge.get(_url(target, limit=2)).json()) == 2
        assert len(judge.get(_url(target, limit=500)).json()) == 8
        assert judge.get(_url(target, limit="x")).status_code == 400


@pytest.mark.django_db
class TestConcludedBalanceSnapshot:
    """The balance a precedent is ranked on is the one frozen at its conclusion
    (`Judgment.concluded_balance`); only a case concluded before the column
    existed (null) falls back to the soul's balance today."""

    def test_the_snapshot_not_todays_balance_ranks_and_is_shown(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", balance=0, verdict=None)
        # Today both souls read 500; at conclusion one read 2 and one 300.
        near = _judgment(cn_tenant, "near at conclusion", balance=500)
        far = _judgment(cn_tenant, "far at conclusion", balance=500)
        Judgment.all_objects.filter(pk=near.pk).update(concluded_balance=2)
        Judgment.all_objects.filter(pk=far.pk).update(concluded_balance=300)
        body = judge.get(_url(target)).json()
        assert [row["name"] for row in body] == ["near at conclusion", "far at conclusion"]
        assert [row["balance"] for row in body] == [2, 300]

    def test_a_null_snapshot_falls_back_to_the_current_balance(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", balance=0, verdict=None)
        old = _judgment(cn_tenant, "older case", balance=3)
        snap = _judgment(cn_tenant, "snapshotted", balance=0)
        Judgment.all_objects.filter(pk=snap.pk).update(concluded_balance=90)
        body = judge.get(_url(target)).json()
        assert old.concluded_balance is None
        assert [(row["name"], row["balance"]) for row in body] == [("older case", 3), ("snapshotted", 90)]

    def test_a_concluded_target_is_compared_on_its_own_snapshot(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", balance=0)
        Judgment.all_objects.filter(pk=target.pk).update(concluded_balance=100)
        _judgment(cn_tenant, "at zero", balance=0)
        _judgment(cn_tenant, "at a hundred", balance=100)
        assert _names(judge.get(_url(target))) == ["at a hundred", "at zero"]


@pytest.mark.django_db
class TestScope:
    def test_only_concluded_same_civilization_other_souls_unarchived(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", verdict=None)
        _judgment(cn_tenant, "kept")
        _judgment(cn_tenant, "open case", verdict=None)
        _judgment(cn_tenant, "greek", civ="GREEK")
        archived = _judgment(cn_tenant, "archived")
        archived.archive(reason="test")
        Judgment.objects.create(
            soul=target.soul, tenant=cn_tenant, civilization="CHINESE", verdict=Verdict.PASSED,
            is_final=True, concluded_at=timezone.now(),
        )
        assert _names(judge.get(_url(target))) == ["kept"]

    def test_never_another_tenant(self, judge, cn_tenant, eu_tenant):
        target = _judgment(cn_tenant, "target", balance=0, court="第五殿", verdict=None)
        _judgment(cn_tenant, "mine", balance=900)
        _judgment(eu_tenant, "theirs, identical", balance=0, court="第五殿")
        assert _names(judge.get(_url(target))) == ["mine"]

    def test_admin_gets_the_judgments_tenant_not_everyone(self, api_client, admin_user, cn_tenant, eu_tenant):
        admin = _client(api_client, admin_user)
        target = _judgment(eu_tenant, "target", verdict=None)
        _judgment(eu_tenant, "eu precedent")
        _judgment(cn_tenant, "cn case")
        assert _names(admin.get(_url(target))) == ["eu precedent"]

    def test_another_tenants_judgment_is_a_404(self, judge, eu_tenant):
        target = _judgment(eu_tenant, "target", verdict=None)
        assert judge.get(_url(target)).status_code == 404


@pytest.mark.django_db
class TestShapeAndViewer:
    def test_row_shape_with_destination(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", balance=5, court="第五殿", verdict=None)
        precedent = _judgment(cn_tenant, "precedent", balance=-7, court="第五殿", verdict=Verdict.FAILED)
        realm = Realm.objects.create(realm_code="PREC_REALM", name_local="刀山", name_en="Mountain of Knives",
                                     civilization="CHINESE", tenant=cn_tenant)
        Disposition.objects.create(soul=precedent.soul, judgment=precedent, destination_realm=realm, tenant=cn_tenant)
        (row,) = judge.get(_url(target)).json()
        assert row["id"] == str(precedent.pk)
        assert row["soul"] == str(precedent.soul_id)
        assert row["name"] == "precedent"
        assert row["verdict"] == "FAILED"
        assert row["balance"] == -7
        assert row["realm_code"] == "PREC_REALM"
        assert row["realm_name"]
        assert row["same_court"] is True

    def test_no_disposition_means_no_destination(self, judge, cn_tenant):
        target = _judgment(cn_tenant, "target", verdict=None)
        _judgment(cn_tenant, "no disposition")
        (row,) = judge.get(_url(target)).json()
        assert row["realm_code"] is None and row["realm_name"] is None

    def test_viewer_cannot_read_precedents(self, api_client, viewer_user, cn_tenant):
        target = _judgment(cn_tenant, "target", verdict=None)
        viewer = _client(api_client, viewer_user)
        assert viewer.get(_url(target)).status_code == 403

    def test_the_serializer_withholds_balance_from_viewer(self, rf, viewer_user, judge_user, cn_tenant):
        """The endpoint refuses VIEWER today; the serializer is the second floor,
        the same one SoulSerializer keeps for `karmic_balance`."""
        _judgment(cn_tenant, "p", balance=42)
        from apps.judgment.precedents import precedents_for

        target = _judgment(cn_tenant, "target", verdict=None)
        (row,) = precedents_for(target)
        for user, expected in ((viewer_user, None), (judge_user, 42)):
            request = rf.get("/")
            request.user = user
            data = JudgmentPrecedentSerializer(row, context={"request": request}).data
            assert data["balance"] == expected, user.role
