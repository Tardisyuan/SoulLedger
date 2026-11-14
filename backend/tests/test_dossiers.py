"""卷宗读模型 `GET /api/v1/dossiers/{judgment_id}/` 与案台行 `GET /api/v1/dossiers/`(apps/judgment/dossier.py)。

真 JWT 过真 URLconf(同 test_judgment_claim.py):ADMIN 绕过租户,租户隔离只能用非 ADMIN 测。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.judgment.dossier import court_ordinal, spine_now
from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from tests.conftest import sign_in

BASE = "/api/v1/dossiers/"


def _grant(extra=()):
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission

    perms = {
        codename: Permission.objects.get_or_create(codename=codename, defaults={"name": name, "category": category})[0]
        for codename, name, category in DEFAULT_PERMISSIONS
        if codename.startswith(("judgment.", "soul."))
    }
    grants = {role: [c for c in codes if c in perms] for role, codes in ROLE_PERMISSIONS.items()}
    for role_name, codename in extra:
        grants.setdefault(role_name, []).append(codename)
    for role_name, codenames in grants.items():
        role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name.title()})
        for codename in codenames:
            RolePermission.objects.get_or_create(role=role, permission=perms[codename])
    invalidate_all_permissions()


@pytest.fixture
def world(db, cn_tenant, eu_tenant):
    # MODERATOR 只多给 judgment.read:读得到案子、读不到灵魂(没有 soul.read)。
    _grant(extra=[("MODERATOR", "judgment.read")])
    users = {
        "a": User.objects.create_user(username="dossier_a", password="x", role="JUDGE", tenant=cn_tenant),
        "b": User.objects.create_user(username="dossier_b", password="x", role="JUDGE", tenant=cn_tenant),
        "mod": User.objects.create_user(username="dossier_mod", password="x", role="MODERATOR", tenant=cn_tenant),
        "eu": User.objects.create_user(username="dossier_eu", password="x", role="JUDGE", tenant=eu_tenant),
    }

    class World:
        pass

    w = World()
    w.cn, w.eu, w.users = cn_tenant, eu_tenant, users
    w.clients = {k: sign_in(APIClient(), u) for k, u in users.items()}
    return w


def _case(tenant, court="第一殿"):
    soul = Soul.objects.create(name="卷宗之魂", birth_date="1900-01-01", current_state=SoulState.JUDGING, tenant=tenant)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court=court, tenant=tenant)


@pytest.mark.django_db
class TestDossier:
    def test_one_dossier_carries_the_case_its_soul_where_it_is_and_what_i_may_do(self, world):
        case = _case(world.cn)
        r = world.clients["a"].get(f"{BASE}{case.pk}/")
        assert r.status_code == 200, r.content
        d = r.json()
        assert d["id"] == str(case.pk)
        assert d["judgment"]["case_number"] == case.case_number
        assert "citations" not in d["judgment"]  # 全文不再内嵌,引用行在顶层
        assert d["citations"] == []
        assert d["soul"]["id"] == str(case.soul_id) and d["soul_redacted"] is False
        assert d["phase"] == "UNCLAIMED"
        assert d["whereabouts"]["hall"] == "CN_DIYU"
        assert d["whereabouts"]["spine"] == {"civ": "cn", "at": "hall", "n": 1}
        assert d["actions"]["claim"] is True and d["actions"]["release"] is False
        assert d["actions"]["refusals"] == {"release": "not_claimed"}

    def test_another_halls_case_is_404(self, world):
        case = _case(world.cn)
        assert world.clients["eu"].get(f"{BASE}{case.pk}/").status_code == 404
        rows = world.clients["eu"].get(BASE).json()["results"]
        assert str(case.pk) not in {row["id"] for row in rows}

    def test_without_soul_read_the_soul_is_withheld_and_says_so(self, world):
        case = _case(world.cn)
        d = world.clients["mod"].get(f"{BASE}{case.pk}/").json()
        assert d["soul"] is None and d["soul_redacted"] is True and d["whereabouts"] is None
        assert d["actions"]["claim"] is False and d["actions"]["refusals"]["claim"] == "permission_denied"

    def test_a_case_claimed_by_another_is_hearing_and_not_mine_to_claim(self, world):
        case = _case(world.cn)
        assert world.clients["b"].post(f"/api/v1/judgment/{case.pk}/claim/").status_code == 200
        d = world.clients["a"].get(f"{BASE}{case.pk}/").json()
        assert d["phase"] == "HEARING"
        assert d["actions"]["claim"] is False and d["actions"]["refusals"]["claim"] == "already_claimed"
        assert d["actions"]["refusals"]["conclude"] == "claimed_by_other"

    def test_an_unchanged_dossier_is_304_and_a_claim_changes_its_etag(self, world):
        case = _case(world.cn)
        client = world.clients["a"]
        first = client.get(f"{BASE}{case.pk}/")
        etag = first["ETag"]
        assert etag.startswith('W/"')
        again = client.get(f"{BASE}{case.pk}/", HTTP_IF_NONE_MATCH=etag)
        assert again.status_code == 304 and again.content == b""
        client.post(f"/api/v1/judgment/{case.pk}/claim/")
        after = client.get(f"{BASE}{case.pk}/", HTTP_IF_NONE_MATCH=etag)
        assert after.status_code == 200 and after["ETag"] != etag

    def test_one_dossier_costs_a_fixed_number_of_queries(self, world):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from apps.souls.record_models import SoulRecord

        case = _case(world.cn)
        with SoulRecord.batch():  # 五条记录只带最近三条,而且不逐条再查
            for year in range(1901, 1906):
                SoulRecord.objects.create(soul=case.soul, record_type="MERIT", weight=1, description="d", event_year=year)
        client = world.clients["a"]
        d = client.get(f"{BASE}{case.pk}/").json()
        assert [r["event_date"]["year"] for r in d["soul"]["records"]] == [1905, 1904, 1903]
        # 码名查询(perm_permission / perm_rolepermission)不算:命中与否取决于权限缓存(Redis)此刻热不热,
        # 同一份代码实测 13 与 21 都出现过。剩下的是卷宗自己的:用户、数据范围、案子、引用、灵魂、记录、转世、联审、
        # 所在站,加四次字段规则(案子、灵魂、记录权重各一,与条数无关)。
        with CaptureQueriesContext(connection) as ctx:
            assert client.get(f"{BASE}{case.pk}/").status_code == 200
        own = [q["sql"] for q in ctx.captured_queries if '"perm_permission"' not in q["sql"]]
        assert len(own) == 13, "\n".join(own)

    def test_the_desk_row_is_slim(self, world):
        case = _case(world.cn)
        rows = world.clients["a"].get(BASE, {"group": "unclaimed"}).json()["results"]
        row = next(r for r in rows if r["id"] == str(case.pk))
        assert set(row) == {
            "id", "case_number", "soul", "soul_name", "civilization", "court", "source",
            "deadline_at", "is_overdue", "claimed_by", "claimed_by_name", "deferred_at", "stale_since",
        }


def test_the_spine_reads_the_same_as_the_frontends_spine_now():
    assert court_ordinal("第五殿") == 5 and court_ordinal(" fifth court ") == 5 and court_ordinal("城隍") is None
    assert spine_now("CHINESE", "JUDGING", "", "第三殿", None) == {"civ": "cn", "at": "hall", "n": 3}
    assert spine_now("CHINESE", "DEAD", "WANGXIANG_TERRACE", "", None) == {"civ": "cn", "at": "pre", "n": 3}
    assert spine_now("CHINESE", "SERVING", "EIGHTEEN_HELLS", "第七殿", None) == {"civ": "cn", "at": "hell", "n": 7}
    assert spine_now("CHINESE", "REINCARNATING", "", "", None) == {"civ": "cn", "at": "rebirth"}
    assert spine_now("EUROPEAN", "SERVING", "", "", "EU_HELL_7TH") == {"civ": "eu", "at": "circle", "n": 7}
    assert spine_now("EUROPEAN", "DEAD", "", "", None) is None
    assert spine_now("EGYPTIAN", "DEAD", "", "", "EG_DUAT_GATE") == {"civ": "eg", "at": "gate"}
    assert spine_now("GREEK", "SERVING", "", "", "GR_PLATO_MEADOW") == {"civ": "gr", "at": "asphodel"}
    assert spine_now("GREEK", "JUDGING", "", "", None) == {"civ": "gr", "at": "fork"}
