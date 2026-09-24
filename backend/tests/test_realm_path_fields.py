"""行程拓扑所需的数据:realm 的拓扑列、judgment/disposition 的 realm_id、灵魂的 path。

契约与取舍见 云端报告 realm-path-fields(已移出仓库,存于项目记忆目录)。这个文件守五件事:

1. 种子:拓扑列只落在神话数据支持的行上,**其余是 NULL** —— 每条都同时断言
   「该有的有」与「不该有的没有」;
2. judgment/0024 的回填:只有逐字等于某一殿名字的 `court` 才映射,其余留空;
3. 每条移动灵魂的流程在自己的事务里写 / 关 path 行,回滚一起回滚;
4. path 的租户隔离:别的租户的那一站看不见;
5. 序列化与 schema 的形状。
"""
import io
from importlib import import_module

import pytest
import yaml
from django.core.management import call_command

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, Verdict
from apps.realms.models import CommediaRegion, GreekFork, Realm, RealmKind, SoulPathEntry
from apps.realms.path import SoulPathService
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

backfill = import_module("apps.judgment.migrations.0024_backfill_judgment_realm")


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


def _realm(code):
    return Realm.all_objects.get(realm_code=code)


def _court(n):
    return Realm.all_objects.get(realm_code__startswith=f"DY_COURT_{n:02d}_")


def _path(soul):
    return list(SoulPathEntry.all_objects.filter(soul=soul).order_by("sequence"))


def _open(soul):
    return [e for e in _path(soul) if e.left_at is None]


def _at_stop(home, away, name):
    """`plan.at_stop`, but FAILED: its PASSED home sentence is 天堂, which is eternal
    and so refuses a stop after it (CrossJudgmentOpenError)."""
    soul, p = plan.planned(home, [(away, plan.stop_realm(away), 10)], name=name, verdict=Verdict.FAILED)
    plan.serve(soul, p, 1)
    record = plan.arrive(soul, p, 2)
    return soul, p, record


# ── 1. 种子 ─────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_ten_courts_carry_their_number_and_are_halls_and_nothing_else_chinese_is(seeded):
    chinese = {r.realm_code: r for r in Realm.objects.filter(civilization="CHINESE")}
    courts = {code: r for code, r in chinese.items() if code.startswith("DY_COURT_")}
    assert sorted((r.order, r.kind) for r in courts.values()) == [(n, RealmKind.HALL) for n in range(1, 11)]
    for code, r in courts.items():
        assert r.order == int(code[9:11]), code
    others = {code: (r.order, r.kind) for code, r in chinese.items() if code not in courts}
    assert others and set(others.values()) == {(None, None)}, others


@pytest.mark.django_db
def test_european_rows_carry_region_and_level_where_dante_gives_one(seeded):
    eu = {r.realm_code: r for r in Realm.objects.filter(civilization="EUROPEAN")}
    circles = {f"EU_HELL_{c}": n for n, c in enumerate(
        ("1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH", "9TH"), start=1)}
    for code, n in circles.items():
        assert (eu[code].region, eu[code].level) == (CommediaRegion.INFERNO, n), code
    terraces = sorted((r.level, code) for code, r in eu.items() if code.startswith("EU_PURGATORY_T"))
    assert [lvl for lvl, _ in terraces] == list(range(1, 8))
    assert all(eu[c].region == CommediaRegion.PURGATORIO for _, c in terraces)
    assert (eu["EU_EARTHLY_PARADISE"].region, eu["EU_EARTHLY_PARADISE"].level) == (CommediaRegion.PURGATORIO, 8)
    # 有 region、没有 level:渡口在地狱篇里,但不在任何一层上;山与天堂是整体。
    assert (eu["EU_ACHERON"].region, eu["EU_ACHERON"].level) == (CommediaRegion.INFERNO, None)
    assert (eu["EU_PURGATORY"].region, eu["EU_PURGATORY"].level) == (CommediaRegion.PURGATORIO, None)
    assert (eu["EU_HEAVEN"].region, eu["EU_HEAVEN"].level) == (CommediaRegion.PARADISO, None)
    # 没有 ring / bolgia 被种成 realm,所以 sublevel 一行都没有。
    assert {r.sublevel for r in eu.values()} == {None}


@pytest.mark.django_db
def test_egypt_has_one_judgment_hall_and_no_hour_or_gate(seeded):
    eg = list(Realm.objects.filter(civilization="EGYPTIAN"))
    assert {r.realm_code for r in eg if r.is_judgment_hall is True} == {"EG_HALL_TWO_TRUTHS"}
    assert {r.is_judgment_hall for r in eg if r.realm_code != "EG_HALL_TWO_TRUTHS"} == {False}
    # 十二时与十二门是拉的夜行,不是死者的路(realms.py EGYPTIAN_REALMS 上方的说明)。
    assert {(r.hour, r.gate) for r in eg} == {(None, None)}
    # 其他三个文明不回答这个问题:NULL,不是 False。
    assert set(Realm.objects.exclude(civilization="EGYPTIAN").values_list("is_judgment_hall", flat=True)) == {None}


@pytest.mark.django_db
def test_greek_roads_fork_left_and_right_off_the_meadow_and_nothing_takes_the_middle(seeded):
    meadow = _realm("EU_PLATO_MEADOW")
    assert (_realm("GR_TARTARUS").fork, _realm("GR_TARTARUS").parent_realm_id) == (GreekFork.LEFT, meadow.pk)
    isles = _realm("GR_ISLES_OF_THE_BLESSED")
    assert (isles.fork, isles.parent_realm_id) == (GreekFork.RIGHT, meadow.pk)
    assert (meadow.fork, meadow.parent_realm_id) == (None, None)
    assert not Realm.all_objects.filter(fork=GreekFork.MIDDLE).exists()
    assert set(Realm.objects.exclude(civilization="GREEK").values_list("fork", flat=True)) == {None}


@pytest.mark.django_db
def test_topology_columns_stay_on_their_own_civilization(seeded):
    """每个文明的列只在那个文明上有值。"""
    per_civ = {
        "order": "CHINESE", "kind": "CHINESE", "level": "EUROPEAN", "region": "EUROPEAN",
        "fork": "GREEK", "is_judgment_hall": "EGYPTIAN",
    }
    for column, civ in per_civ.items():
        stray = Realm.objects.exclude(civilization=civ).exclude(**{f"{column}__isnull": True})
        assert list(stray.values_list("realm_code", flat=True)) == [], column
        assert Realm.objects.filter(civilization=civ, **{f"{column}__isnull": False}).exists(), column
    assert set(Realm.objects.values_list("capacity", flat=True)) == {None}


@pytest.mark.django_db
def test_reseeding_changes_nothing(seeded):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    realm_line = next(line for line in out.getvalue().splitlines() if line.strip().startswith("realms "))
    assert "created=0" in realm_line and "updated=0" in realm_line, realm_line


@pytest.mark.django_db
def test_a_null_topology_column_is_filled_without_update_and_a_different_one_is_not(seeded):
    """realms/0019 adds the columns empty: filling them is not overwriting anyone."""
    first, fifth = _court(1), _court(5)
    Realm.all_objects.filter(pk=first.pk).update(order=None, kind=None)
    Realm.all_objects.filter(pk=fifth.pk).update(order=7)

    call_command("seed_mythology", stdout=io.StringIO())
    first.refresh_from_db()
    fifth.refresh_from_db()
    assert (first.order, first.kind) == (1, RealmKind.HALL)
    assert fifth.order == 7, "a value somebody set was overwritten without --update"

    call_command("seed_mythology", "--update", stdout=io.StringIO())
    fifth.refresh_from_db()
    assert fifth.order == 5


# ── 2. judgment/0024 回填 ──────────────────────────────────────────────


def _judgment(soul, court, *, civilization="CHINESE", tenant=None, realm=None):
    return Judgment.all_objects.create(
        soul=soul, court=court, civilization=civilization, tenant=tenant or soul.tenant, realm=realm,
    )


@pytest.fixture
def cases(seeded):
    from django.apps import apps as registry

    cn = plan.tenant("CN_DIYU")
    eu = plan.tenant("EU_HEAVEN_HELL")
    soul = Soul.objects.create(name="回填", tenant=cn, current_state=SoulState.JUDGING)
    eu_soul = Soul.objects.create(name="欧魂", tenant=eu, current_state=SoulState.JUDGING)
    rows = {
        # 映射
        "name_local": _judgment(soul, "第一殿"),
        "name_zh": _judgment(soul, "第三殿宋帝王"),
        "realm_code": _judgment(soul, "DY_COURT_05_YANLUO"),
        "padded": _judgment(soul, "  第十殿 "),
        # 不映射
        "arabic": _judgment(soul, "第1殿"),
        "king_only": _judgment(soul, "秦广王"),
        "relative": _judgment(soul, "本殿"),
        "blank": _judgment(soul, ""),
        "not_a_court": _judgment(soul, "待审所"),
        "european": _judgment(eu_soul, "第一殿", civilization="EUROPEAN"),
        # 中国租户里、却标着 EUROPEAN 的审判:两列互相矛盾,不替它选一边。
        "civilization_mismatch": _judgment(soul, "第四殿", civilization="EUROPEAN"),
        "other_tenant": _judgment(eu_soul, "第二殿"),
        "already_set": _judgment(soul, "第一殿", realm=_court(9)),
    }
    return registry, rows


def _realm_of(rows):
    return {
        key: (Judgment.all_objects.get(pk=j.pk).realm.realm_code
              if Judgment.all_objects.get(pk=j.pk).realm_id else None)
        for key, j in rows.items()
    }


@pytest.mark.django_db
def test_backfill_maps_exact_court_names_and_nothing_else(cases):
    registry, rows = cases
    backfill.forwards(registry, None)
    got = _realm_of(rows)
    assert {k: v for k, v in got.items() if v is not None} == {
        "name_local": "DY_COURT_01_QINGUANG",
        "name_zh": "DY_COURT_03_SONGDI",
        "realm_code": "DY_COURT_05_YANLUO",
        "padded": "DY_COURT_10_ZHUANLUN",
        "already_set": "DY_COURT_09_PINGDENG",  # 不被替换
    }
    assert sorted(k for k, v in got.items() if v is None) == sorted(
        ["arabic", "king_only", "relative", "blank", "not_a_court", "european", "civilization_mismatch",
         "other_tenant"]
    )


@pytest.mark.django_db
def test_backfill_reverse_clears_only_what_forward_set(cases):
    registry, rows = cases
    backfill.forwards(registry, None)
    backfill.backwards(registry, None)
    got = _realm_of(rows)
    assert {k: v for k, v in got.items() if v is not None} == {"already_set": "DY_COURT_09_PINGDENG"}


@pytest.mark.django_db
def test_backfill_drops_a_name_two_courts_share(cases):
    registry, rows = cases
    Realm.all_objects.filter(pk=_court(2).pk).update(name_local="第一殿")
    backfill.forwards(registry, None)
    got = _realm_of(rows)
    assert got["name_local"] is None, "an ambiguous court name was resolved anyway"
    assert got["name_zh"] == "DY_COURT_03_SONGDI"


@pytest.mark.django_db
def test_backfill_ignores_a_retired_court(cases):
    registry, rows = cases
    Realm.all_objects.filter(pk=_court(1).pk).update(is_deleted=True)
    backfill.forwards(registry, None)
    assert _realm_of(rows)["name_local"] is None


@pytest.mark.django_db
def test_the_seed_writes_no_judgments_so_the_backfill_maps_none_there(seeded):
    """报告里「种子数据里能回填几条」的出处:种子不建审判,答案是 0。"""
    assert Judgment.all_objects.count() == 0


def test_judgment_0024_round_trip(migration_round_trip):
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")._base_manager.create(code="CN_DIYU", display_name="地府")
        realm = state.get_model("realms", "Realm")
        court = realm._base_manager.create(
            realm_code="DY_COURT_01_QINGUANG", civilization="CHINESE", realm_type="HELL", tier=1,
            name_local="第一殿", name_zh="第一殿秦广王", name_en="First Court", tenant=tenant,
        )
        soul = state.get_model("souls", "Soul")._base_manager.create(name="往返", tenant=tenant, home_tenant=tenant)
        judgment = state.get_model("judgment", "Judgment")
        for court_text in ("第一殿", "第1殿"):
            judgment._base_manager.create(soul=soul, civilization="CHINESE", court=court_text, tenant=tenant)
        assert court.pk

    def snapshot(state):
        judgment = state.get_model("judgment", "Judgment")
        return snapshot_rows(
            judgment._base_manager.all(), key="court",
            fields={"realm": lambda j: j.realm.realm_code if j.realm_id else None},
        )

    def check_forward(state):
        got = snapshot(state)
        assert got["第一殿"]["realm"] == "DY_COURT_01_QINGUANG"
        assert got["第1殿"]["realm"] is None

    migration_round_trip(
        before=("judgment", "0023_judgment_realm"),
        after=("judgment", "0024_backfill_judgment_realm"),
        seed=seed, snapshot=snapshot, check_forward=check_forward,
    )


# ── 3. 流程写 path ──────────────────────────────────────────────────────


@pytest.fixture
def cn(seeded):
    return plan.tenant("CN_DIYU")


@pytest.mark.django_db
def test_opening_a_case_in_a_court_puts_the_soul_there_and_moving_the_case_moves_it(cn):
    judge = officer_client(plan.officer("cn_judge", "JUDGE", cn))
    soul = Soul.objects.create(name="过堂", tenant=cn, current_state=SoulState.ALIVE)
    resp = judge.post("/api/v1/judgment/", {"soul": str(soul.pk), "court": "第一殿", "realm_id": str(_court(1).pk)},
                      format="json")
    assert resp.status_code == 201, resp.data
    assert str(resp.data["realm_id"]) == str(_court(1).pk)
    # Filing the case is the death (ALIVE -> JUDGING): 待审所 first, then the court.
    holding, entry = _path(soul)
    assert (holding.realm_id, holding.sequence) == (_realm("DY_00_PURGATORY").pk, 1)
    assert holding.left_at is not None and holding.left_at == entry.entered_at
    assert (entry.realm_id, entry.sequence, entry.left_at, entry.tenant_id) == (_court(1).pk, 2, None, cn.pk)

    moved = judge.patch(f"/api/v1/judgment/{resp.data['id']}/", {"realm_id": str(_court(2).pk)}, format="json")
    assert moved.status_code == 200, moved.data
    _, first, second = _path(soul)
    assert first.left_at is not None and first.left_at == second.entered_at
    assert (second.realm_id, second.sequence, second.left_at) == (_court(2).pk, 3, None)

    # A PATCH that does not touch the realm is not a move.
    assert judge.patch(f"/api/v1/judgment/{resp.data['id']}/", {"notes": "x"}, format="json").status_code == 200
    assert len(_path(soul)) == 3


@pytest.mark.django_db
def test_a_case_with_no_realm_writes_only_the_death_station(cn):
    judge = officer_client(plan.officer("cn_judge", "JUDGE", cn))
    soul = Soul.objects.create(name="无殿", tenant=cn, current_state=SoulState.ALIVE)
    assert judge.post("/api/v1/judgment/", {"soul": str(soul.pk), "court": "第一殿"}, format="json").status_code == 201
    # Only the death station (待审所); no court, so no second stop.
    assert [(e.realm_id, e.left_at) for e in _path(soul)] == [(_realm("DY_00_PURGATORY").pk, None)]
    soul.refresh_from_db()
    assert soul.current_state == SoulState.JUDGING


@pytest.mark.django_db
def test_a_verdict_moves_the_soul_from_the_court_to_its_destination(cn):
    soul, case = plan.open_case(cn, name="判决")
    Judgment.all_objects.filter(pk=case.pk).update(realm=_court(1))
    SoulPathService.enter(soul, _court(1), tenant_id=cn.pk)
    case.refresh_from_db()
    case.conclude(Verdict.FAILED, "")
    disposition = Disposition.all_objects.get(judgment=case)
    assert disposition.destination_realm_id is not None
    court, sentence = _path(soul)
    assert court.realm_id == _court(1).pk and court.left_at is not None
    assert (sentence.realm_id, sentence.left_at, sentence.tenant_id) == (
        disposition.destination_realm_id, None, disposition.tenant_id)


@pytest.mark.django_db
def test_a_refused_conclusion_leaves_no_path_behind(cn):
    """同一事务:结案被拒(灵魂不在 JUDGING)时,path 行随处置一起回滚。"""
    from apps.judgment.services import JudgmentNotConcludableError

    soul, case = plan.open_case(cn, name="拒", state=SoulState.ALIVE)
    with pytest.raises(JudgmentNotConcludableError):
        case.conclude(Verdict.FAILED, "")
    assert _path(soul) == []
    assert not Disposition.all_objects.filter(soul=soul).exists()


@pytest.mark.django_db
def test_executing_a_term_leaves_the_realm(cn):
    soul, p = plan.planned(cn, name="刑满", verdict=Verdict.FAILED)
    [entry] = _open(soul)
    assert plan.serve(soul, p, 1) is True
    [entry] = _path(soul)
    assert entry.left_at is not None
    assert _open(soul) == []


@pytest.mark.django_db
def test_an_eternal_sentence_is_never_left(seeded):
    eg = plan.tenant("EG_DUAT")
    soul, p = plan.planned(eg, name="永居", verdict=Verdict.PASSED)
    disposition = Disposition.all_objects.get(soul=soul)
    assert disposition.is_eternal, "precondition: the Egyptian PASSED destination is eternal"
    assert plan.serve(soul, p, 1) is True
    soul.refresh_from_db()
    assert soul.current_state == SoulState.SETTLED
    [entry] = _path(soul)
    assert (entry.realm_id, entry.left_at) == (disposition.destination_realm_id, None)


@pytest.mark.django_db
def test_an_unrouted_verdict_closes_the_court_and_invents_no_destination(cn):
    soul, case = plan.open_case(cn, name="无处")
    SoulPathService.enter(soul, _court(1), tenant_id=cn.pk)
    Realm.all_objects.filter(civilization="CHINESE").exclude(pk=_court(1).pk).update(is_deleted=True)
    case.conclude(Verdict.FAILED, "")
    assert Disposition.all_objects.get(judgment=case).destination_realm_id is None
    [entry] = _path(soul)
    assert entry.left_at is not None


@pytest.mark.django_db
def test_a_greek_retry_on_the_meadow_is_not_a_second_visit(seeded):
    gr = plan.tenant("GR_HADES")
    meadow = _realm("EU_PLATO_MEADOW")
    soul, case = plan.open_case(gr, name="再审")
    SoulPathService.enter(soul, meadow, tenant_id=gr.pk)
    case.conclude(Verdict.RETRY, "")
    assert Disposition.all_objects.get(judgment=case).destination_realm_id == meadow.pk
    [entry] = _path(soul)
    assert (entry.realm_id, entry.left_at) == (meadow.pk, None)


@pytest.mark.django_db
def test_rebirth_leaves_whatever_realm_is_still_open(cn):
    from apps.reincarnation.services import ReincarnationService

    soul = Soul.objects.create(name="转世", tenant=cn, current_state=SoulState.REINCARNATING)
    SoulPathService.enter(soul, _court(10), tenant_id=cn.pk)
    ReincarnationService.complete_rebirth(soul)
    [entry] = _path(soul)
    assert entry.left_at is not None


@pytest.mark.django_db
def test_a_dispatch_leaves_home_enters_the_stop_abroad_and_the_return_leaves_it(seeded):
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    soul, p, _record = _at_stop(cn, eg, name="调拨")
    home, abroad = _path(soul)
    assert home.tenant_id == cn.pk and home.left_at is not None
    stop = Disposition.all_objects.get(soul=soul, tenant=eg)
    assert (abroad.realm_id, abroad.tenant_id, abroad.left_at) == (stop.destination_realm_id, eg.pk, None)

    assert plan.serve(soul, p, 2) is True
    soul.refresh_from_db()
    assert not soul.is_residing, "precondition: serving the stop sends the soul home"
    assert _open(soul) == []
    assert len(_path(soul)) == 2


@pytest.mark.django_db
def test_a_manual_dispatch_leaves_the_realm_and_records_no_arrival(seeded):
    from apps.dispatch.services import DispatchService

    cn, eu = plan.tenant("CN_DIYU"), plan.tenant("EU_HEAVEN_HELL")
    soul = Soul.objects.create(name="手调", tenant=cn, current_state=SoulState.DISPOSED)
    SoulPathService.enter(soul, _court(3), tenant_id=cn.pk)
    record = DispatchService.propose(cn, eu, soul, None, "manual")
    DispatchService.approve(record, "approver")
    DispatchService.execute(record, "executor")
    [entry] = _path(soul)
    assert entry.left_at is not None


# ── path service ──────────────────────────────────────────────────────


@pytest.mark.django_db
def test_one_open_entry_per_soul_is_a_database_rule(cn):
    from django.db import IntegrityError, transaction

    soul = Soul.objects.create(name="唯一", tenant=cn)
    SoulPathService.enter(soul, _court(1), tenant_id=cn.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        SoulPathEntry.all_objects.create(
            soul=soul, realm=_court(2), sequence=2, entered_at=_path(soul)[0].entered_at, tenant=cn,
        )


# ── 4. 租户隔离 ─────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_path_endpoint_shows_this_tenants_stops_only(seeded):
    cn, eu = plan.tenant("CN_DIYU"), plan.tenant("EU_HEAVEN_HELL")
    soul = Soul.objects.create(name="隔离", tenant=cn, current_state=SoulState.JUDGING)
    SoulPathService.enter(soul, _court(1), tenant_id=cn.pk)
    foreign = SoulPathService.enter(soul, _realm("EU_HELL_1ST"), tenant_id=eu.pk)
    SoulPathService.enter(soul, _court(2), tenant_id=cn.pk)

    resp = officer_client(plan.officer("cn_judge", "JUDGE", cn)).get(f"/api/v1/souls/{soul.pk}/path/")
    assert resp.status_code == 200, resp.data
    assert [row["realm_code"] for row in resp.data] == [_court(1).realm_code, _court(2).realm_code]
    assert str(foreign.pk) not in {row["id"] for row in resp.data}
    assert [row["sequence"] for row in resp.data] == [1, 3]


@pytest.mark.django_db
def test_another_tenant_cannot_read_the_souls_path_at_all(seeded):
    cn, eu = plan.tenant("CN_DIYU"), plan.tenant("EU_HEAVEN_HELL")
    soul = Soul.objects.create(name="别家", tenant=cn)
    SoulPathService.enter(soul, _court(1), tenant_id=cn.pk)
    resp = officer_client(plan.officer("eu_judge", "JUDGE", eu)).get(f"/api/v1/souls/{soul.pk}/path/")
    assert resp.status_code == 404


@pytest.mark.django_db
def test_while_residing_the_home_tenant_reads_the_stop_abroad(seeded):
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    soul, _p, _record = _at_stop(cn, eg, name="暂居读")
    home = officer_client(plan.officer("cn_judge", "JUDGE", cn))
    rows = home.get(f"/api/v1/souls/{soul.pk}/path/").data
    assert [row["sequence"] for row in rows] == [1, 2]
    away = officer_client(plan.officer("eg_judge", "JUDGE", eg)).get(f"/api/v1/souls/{soul.pk}/path/").data
    assert [row["sequence"] for row in away] == [2], "the residence tenant read the home tenant's stop"


# ── 5. 序列化与 schema ────────────────────────────────────────────────


@pytest.mark.django_db
def test_a_judgment_cannot_point_at_another_tenants_realm(seeded):
    cn = plan.tenant("CN_DIYU")
    soul = Soul.objects.create(name="越界", tenant=cn, current_state=SoulState.ALIVE)
    judge = officer_client(plan.officer("cn_judge", "JUDGE", cn))
    resp = judge.post("/api/v1/judgment/", {"soul": str(soul.pk), "realm_id": str(_realm("EU_HELL_1ST").pk)},
                      format="json")
    assert resp.status_code == 400
    assert "realm_id" in resp.data
    assert _path(soul) == []


@pytest.mark.django_db
def test_disposition_realm_id_is_its_destination(cn):
    soul, p = plan.planned(cn, name="处置", verdict=Verdict.FAILED)
    disposition = Disposition.all_objects.get(soul=soul)
    data = officer_client(plan.officer("cn_judge", "JUDGE", cn)).get(f"/api/v1/disposition/{disposition.pk}/").data
    assert data["realm_id"] == str(disposition.destination_realm_id) == str(data["destination_realm"])


@pytest.mark.django_db
def test_the_realm_list_carries_the_topology(seeded):
    cn = plan.tenant("CN_DIYU")
    rows = officer_client(plan.officer("cn_judge", "JUDGE", cn)).get("/api/v1/realms/?page_size=100").data
    rows = rows.get("results", rows)
    by_code = {row["realm_code"]: row for row in rows}
    first = by_code[_court(1).realm_code]
    assert (first["order"], first["kind"], first["fork"], first["level"]) == (1, "HALL", None, None)
    assert {"parent_realm", "is_eternal", "capacity", "sublevel", "region", "hour", "gate",
            "is_judgment_hall"} <= set(first)


def test_the_committed_schema_describes_the_new_shapes():
    from tests.test_committed_schema_matches_the_backend import COMMITTED

    schemas = yaml.safe_load(COMMITTED.read_text(encoding="utf-8"))["components"]["schemas"]
    assert set(schemas["SoulPathEntry"]["properties"]) == {
        "id", "sequence", "realm_id", "realm_code", "entered_at", "left_at"}
    assert "realm_id" in schemas["Judgment"]["properties"]
    assert "realm_id" in schemas["Disposition"]["properties"]
    for name in ("Realm", "RealmList"):
        assert {"order", "kind", "level", "region", "hour", "fork"} <= set(schemas[name]["properties"]), name
    assert schemas["GreekForkEnum"]["enum"] == ["LEFT", "MIDDLE", "RIGHT"]
    assert schemas["RealmKindEnum"]["enum"] == ["HALL", "GATE", "LAYER", "PATH"]
