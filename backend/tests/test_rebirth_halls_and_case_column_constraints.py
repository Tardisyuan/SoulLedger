"""be-domain 1.4 / 1.5 / 1.6(2026-11-14):转世记录的来源殿 / 目标殿与一世一条、`Judgment` 文明专属列的三条约束、
「一魂一件未结案」的计数命令。

写入点(`complete_rebirth` 填 from / to)的断言在 `test_rebirth_cross_civilization_target.py` 里,跟着跨文明转世那两条走。

都不是 PG-only:唯一约束与 CHECK 在 SQLite 上同样执行。PG 才有的差别只有一条 —— 同一事务里先改外键列再 ADD CONSTRAINT
会报 pending trigger events,所以回填(reincarnation/0017)与唯一约束(0018)分成两个迁移;这条由下面的迁移测试在
真 PostgreSQL 上跑时覆盖(`migration` 标记),不另写 skipif。
"""
import io

import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction

from apps.judgment.models import Judgment
from apps.reincarnation.models import Reincarnation
from apps.souls.models import Soul


def _case(tenant, civilization="CHINESE"):
    soul = Soul.objects.create(name="约束", tenant=tenant)
    return Judgment.objects.create(soul=soul, civilization=civilization, court="—", tenant=tenant)


# ── 一世一条转世记录 ──────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_one_rebirth_row_per_soul_and_cycle(cn_tenant):
    """变异:去掉 `reincarnation_one_per_soul_cycle` → 第二条写得进去,红。"""
    soul = Soul.objects.create(name="一世一记", tenant=cn_tenant)
    Reincarnation.objects.create(soul=soul, tenant=cn_tenant, cycle_count=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        Reincarnation.objects.create(soul=soul, tenant=cn_tenant, cycle_count=1)
    # 下一世、别的灵魂同一世都照常。
    Reincarnation.objects.create(soul=soul, tenant=cn_tenant, cycle_count=2)
    other = Soul.objects.create(name="另一个", tenant=cn_tenant)
    Reincarnation.objects.create(soul=other, tenant=cn_tenant, cycle_count=1)
    assert Reincarnation.all_objects.filter(soul=soul).count() == 2


# ── 文明专属列 ────────────────────────────────────────────────────────────────────

RULES = [
    ({"duat_stage": "NAMELESS"}, "EGYPTIAN"),
    ({"weighing_result": "HEAVIER"}, "EGYPTIAN"),
    ({"heart_weight": 3}, "EGYPTIAN"),
    ({"untimely": True}, "CHINESE"),
]


@pytest.mark.django_db
@pytest.mark.parametrize("fields, owner", RULES)
def test_a_civilization_specific_column_is_refused_on_another_civilizations_case(cn_tenant, fields, owner):
    """变异:删掉对应那条 CheckConstraint → 错文明那一笔写得进去,红。"""
    wrong = "GREEK" if owner == "CHINESE" else "CHINESE"
    case = _case(cn_tenant, civilization=wrong)
    with pytest.raises(IntegrityError), transaction.atomic():
        Judgment.all_objects.filter(pk=case.pk).update(**fields)
    # 同一列在本文明的案子上照常写。
    right = _case(cn_tenant, civilization=owner)
    Judgment.all_objects.filter(pk=right.pk).update(**fields)
    right.refresh_from_db()
    assert all(getattr(right, name) == value for name, value in fields.items())


# ── 迁移 reincarnation/0017:回填与重新编号 ───────────────────────────────────────


def test_0017_backfills_the_halls_and_renumbers_duplicate_cycles(migration_round_trip, capsys):
    """来源殿 = 行的 tenant;目标殿 = 事件载荷的 to_tenant,没有就同来源殿,载荷的殿已不在 / 行无殿 → 空。
    重号的灵魂按时间重编为 1..n,别的灵魂不动。
    变异:回填里把 `if code is None: continue` 去掉(没有迁籍的行也去查事件)→ r_same 的 to 成了空,红;
    去掉重编号 → dup 仍是 [1, 1],红(随后 0018 也会失败)。"""
    import datetime as dt

    from django.utils import timezone

    from tests.migration_roundtrip import migrate_to

    before = [("reincarnation", "0016_reincarnation_from_to_tenant")]
    after = [("reincarnation", "0017_backfill_from_to_tenant")]
    state = migrate_to(before)
    halls = state.get_model("tenants", "Tenant")._base_manager
    cn = halls.create(code="CN_DIYU", display_name="地府")
    gr = halls.create(code="GR_HADES", display_name="冥府")
    souls = state.get_model("souls", "Soul")._base_manager
    rows = state.get_model("reincarnation", "Reincarnation")._base_manager
    events = state.get_model("events", "SoulEvent")._base_manager

    def rebirth(name, tenant, cycle=1, to=..., at=None):
        soul = souls.create(name=name, tenant=tenant or cn, home_tenant=tenant or cn)
        row = rows.create(soul=soul, tenant=tenant, cycle_count=cycle)
        if to is not ...:
            payload = {"reincarnation_id": str(row.pk), "cycle_count": cycle}
            if to != "missing-key":
                payload["to_tenant"] = to
            events.create(soul=soul, tenant=tenant, event_type="REINCARNATION_COMPLETED", payload=payload)
        return row

    r_same = rebirth("同殿", cn, to=None)
    r_old = rebirth("旧事件", cn, to="missing-key")
    r_none = rebirth("无事件", cn)
    r_moved = rebirth("迁籍", cn, to="GR_HADES")
    r_gone = rebirth("殿已不在", cn, to="NO_SUCH_HALL")
    r_bare = rebirth("无殿", None)
    dup_soul = souls.create(name="重号", tenant=cn, home_tenant=cn)
    now = timezone.now()
    first = rows.create(soul=dup_soul, tenant=cn, cycle_count=1)
    second = rows.create(soul=dup_soul, tenant=cn, cycle_count=1)
    third = rows.create(soul=dup_soul, tenant=cn, cycle_count=3)
    for row, days in ((first, 3), (second, 2), (third, 1)):
        rows.filter(pk=row.pk).update(reincarnated_at=now - dt.timedelta(days=days))
    untouched_soul = souls.create(name="有缺号不重号", tenant=cn, home_tenant=cn)
    for n in (1, 3):
        rows.create(soul=untouched_soul, tenant=cn, cycle_count=n)

    state = migrate_to(after)
    rows = state.get_model("reincarnation", "Reincarnation")._base_manager
    halls_of = {r.pk: (r.from_tenant_id, r.to_tenant_id) for r in rows.all()}
    assert halls_of[r_same.pk] == (cn.pk, cn.pk)
    assert halls_of[r_old.pk] == (cn.pk, cn.pk)
    assert halls_of[r_none.pk] == (cn.pk, cn.pk)
    assert halls_of[r_moved.pk] == (cn.pk, gr.pk)
    assert halls_of[r_gone.pk] == (cn.pk, None)
    assert halls_of[r_bare.pk] == (None, None)
    assert list(rows.filter(soul_id=dup_soul.pk).order_by("reincarnated_at").values_list("pk", "cycle_count")) == [
        (first.pk, 1), (second.pk, 2), (third.pk, 3)]
    assert sorted(rows.filter(soul_id=untouched_soul.pk).values_list("cycle_count", flat=True)) == [1, 3]
    out = capsys.readouterr().out
    assert "2 row(s) left with from_tenant/to_tenant NULL" in out
    assert f"soul {dup_soul.pk} cycle_count [1, 1, 3] renumbered to [1, 2, 3]" in out
    assert str(untouched_soul.pk) not in out

    state = migrate_to(before)
    names = {f.name for f in state.get_model("reincarnation", "Reincarnation")._meta.get_fields()}
    assert {"from_tenant", "to_tenant"} <= names  # 0017 的反向是 noop;两列由 0016 的反向删


# ── 迁移 judgment/0054:存量违反时拒绝迁移 ───────────────────────────────────────


def test_0054_refuses_to_migrate_over_violating_rows_and_names_them(migration_round_trip):
    """变异:预检里不 raise → 加约束那一步自己失败(SQLite 重建表、PG 的 ADD CONSTRAINT),报的是不点名的
    IntegrityError 而不是 RuntimeError,`pytest.raises` 那一段红。"""
    from tests.migration_roundtrip import migrate_to

    before = [("judgment", "0053_judgment_pending_idx")]
    after = [("judgment", "0054_civilization_specific_columns")]
    state = migrate_to(before)
    tenant = state.get_model("tenants", "Tenant")._base_manager.create(code="CN_DIYU", display_name="地府")
    soul = state.get_model("souls", "Soul")._base_manager.create(name="预检", tenant=tenant, home_tenant=tenant)
    rows = state.get_model("judgment", "Judgment")._base_manager
    fine = rows.create(soul=soul, tenant=tenant, case_number="P-1", civilization="EGYPTIAN", duat_stage="NAMELESS",
                       weighing_result="LIGHTER", heart_weight=0)
    bad = rows.create(soul=soul, tenant=tenant, case_number="P-2", civilization="CHINESE", duat_stage="NAMELESS")
    rows.create(soul=soul, tenant=tenant, case_number="P-3", civilization="EUROPEAN", untimely=True)

    with pytest.raises(RuntimeError) as refused:
        migrate_to(after)
    message = str(refused.value)
    assert "judgment_duat_stage_only_egyptian: 1 row(s)" in message and str(bad.pk) in message
    assert "judgment_untimely_only_chinese: 1 row(s)" in message
    assert "judgment_weighing_only_egyptian" not in message and str(fine.pk) not in message

    # 改过之后迁得过去(也让 fixture 收尾时能迁到最新)。
    state = migrate_to(before)
    rows = state.get_model("judgment", "Judgment")._base_manager
    rows.filter(case_number="P-2").update(duat_stage="")
    rows.filter(case_number="P-3").update(untimely=False)
    state = migrate_to(after)
    names = {c.name for c in state.get_model("judgment", "Judgment")._meta.constraints}
    assert {"judgment_duat_stage_only_egyptian", "judgment_weighing_only_egyptian",
            "judgment_untimely_only_chinese"} <= names


# ── 一魂一件未结案:只数不改 ────────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_overlap_count_names_only_souls_with_more_than_one_open_case(cn_tenant):
    """变异:`filter(n__gt=1)` 改成 `n__gte=1` → 只有一件的灵魂也被数进来,红。"""
    from apps.judgment.models import JudgmentKind

    two = _case(cn_tenant)
    second = Judgment.objects.create(soul=two.soul, civilization="CHINESE", court="—", tenant=cn_tenant)
    Judgment.all_objects.filter(pk=second.pk).update(kind=JudgmentKind.AMENDMENT)
    one = _case(cn_tenant)
    closed = Judgment.objects.create(soul=one.soul, civilization="CHINESE", court="—", tenant=cn_tenant)
    Judgment.all_objects.filter(pk=closed.pk).update(verdict="PASSED", is_final=True)

    out = io.StringIO()
    call_command("count_open_case_overlaps", stdout=out)
    text = out.getvalue()
    assert "any kind: 1 soul(s) with more than one open case, 2 open case(s) among them" in text
    assert "ORIGINAL only: 0 soul(s)" in text  # 第二件是 AMENDMENT:建议的约束不拦它
    assert str(two.soul_id) in text and str(one.soul_id) not in text
