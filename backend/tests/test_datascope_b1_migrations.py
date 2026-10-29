"""数据范围 B1 的迁移链:org/0010–0011(根)→ authentication/0028(用户机构)→ souls/0054–0055、
judgment/0049–0050(owner_org 回填)→ dispatch/0013–0014(source_owner_org)、perm/0029(RoleDataScope)。

升级:每殿恰好一个根、顶层挂其下且层级重算、无殿机构不动;用户机构为空 / 跨殿 → 殿根(ADMIN、SOUL 不动);
回填各情形(创建人无机构、机构跨殿、court 匹配、暂居灵魂);有殿数据 owner_org 空值为 0、无殿保持空。
降级:回到 org/0009 时根删掉、原顶层回到顶层、层级复原、新列消失。

种子用历史模型(这时 Soul 还没有 owner_org 列)。`migration_round_trip` 只借它的 marker 与收尾的
「迁回最新」;这条链的终点不止一个,所以直接用 `migrate_to`。
"""
from tests.migration_roundtrip import migrate_to

BEFORE = [("org", "0009_recompute_organization_levels")]
AFTER = [
    ("dispatch", "0014_backfill_source_owner_org"),
    ("judgment", "0050_backfill_judgment_owner_org"),
    ("perm", "0029_roledatascope"),
]


def _seed(apps):
    Tenant = apps.get_model("tenants", "Tenant")
    Org = apps.get_model("org", "Organization")
    User = apps.get_model("authentication", "User")
    Soul = apps.get_model("souls", "Soul")
    Judgment = apps.get_model("judgment", "Judgment")
    Dispatch = apps.get_model("dispatch", "DispatchRecord")
    t, m, b = Tenant._base_manager, Org._base_manager, User._base_manager

    cn = t.create(code="CN_DIYU", display_name="Chinese Diyu", hall_name="中国地府")
    eu = t.create(code="EU_HEAVEN_HELL", display_name="欧洲")
    bare = t.create(code="NEW_HALL", display_name="新殿", declared_civilization="GREEK")

    diyu = m.create(name="地府", code="DIYU", category="CHINESE", tenant=cn, level=0)
    first = m.create(name="第一殿-秦广王", code="DIYU_01", category="CHINESE", tenant=cn, parent=diyu, level=1)
    heaven = m.create(name="天堂", code="HEAVEN", category="EUROPEAN", tenant=eu, level=0)
    hell = m.create(name="地狱", code="HELL", category="EUROPEAN", tenant=eu, level=0)
    m.create(name="无殿", code="ORPHAN", category="CHINESE", level=0)

    b.create(username="m_admin", role="ADMIN", tenant=cn)
    b.create(username="m_soul", role="SOUL", tenant=cn)
    b.create(username="m_none", role="JUDGE", tenant=cn)
    b.create(username="m_cross", role="JUDGE", tenant=cn, organization=heaven)
    b.create(username="m_ok", role="JUDGE", tenant=cn, organization=first)
    b.create(username="m_hallless", role="JUDGE")
    eu_judge = b.create(username="m_eu", role="JUDGE", tenant=eu, organization=hell)

    s, j = Soul._base_manager, Judgment._base_manager
    by_ok = b.get(username="m_ok")
    s.create(name="ok", tenant=cn, home_tenant=cn, create_user=by_ok)
    s.create(name="cross", tenant=cn, home_tenant=cn, create_user=eu_judge)
    s.create(name="anon", tenant=cn, home_tenant=cn)
    s.create(name="hallless", tenant=None)
    guest = s.create(name="guest", tenant=eu, home_tenant=cn, create_user=by_ok)
    s.create(name="bare", tenant=bare, home_tenant=bare)
    soul = s.get(name="ok")
    j.create(soul=soul, tenant=cn, court="第一殿", case_number="M-1", create_user=eu_judge)
    j.create(soul=soul, tenant=cn, court="", case_number="M-2", create_user=by_ok)
    j.create(soul=soul, tenant=cn, court="无此殿", case_number="M-3")
    j.create(soul=soul, tenant=None, court="第一殿", case_number="M-4")
    Dispatch._base_manager.create(source_tenant=cn, target_tenant=eu, soul=guest, status="EXECUTED", tenant=cn)
    Dispatch._base_manager.create(source_tenant=cn, target_tenant=eu, soul=soul, status="RETURNED", tenant=cn)


def _orgs(apps):
    Org = apps.get_model("org", "Organization")
    return {o.code: (o.parent.code if o.parent_id else None, o.level, o.tenant_id) for o in Org._base_manager.all()}


def test_b1_chain_up_and_down(migration_round_trip):
    state = migrate_to(BEFORE)
    _seed(state)
    before = _orgs(state)

    state = migrate_to(AFTER)
    Org = state.get_model("org", "Organization")
    User = state.get_model("authentication", "User")
    Soul = state.get_model("souls", "Soul")
    Judgment = state.get_model("judgment", "Judgment")
    Dispatch = state.get_model("dispatch", "DispatchRecord")
    Tenant = state.get_model("tenants", "Tenant")
    orgs = _orgs(state)
    tid = {t.code: t.pk for t in Tenant._base_manager.all()}

    # 每殿恰好一个活根,名称用殿名;现有顶层挂其下、层级重算;无殿机构不动。
    for code, pk in tid.items():
        assert Org._base_manager.filter(tenant_id=pk, parent__isnull=True, is_deleted=False).count() == 1, code
    root = {c: Org._base_manager.get(code=f"ROOT_{c}") for c in tid}
    assert (root["CN_DIYU"].name, root["CN_DIYU"].category) == ("中国地府", "CHINESE")
    assert (root["NEW_HALL"].name, root["NEW_HALL"].category) == ("新殿", "GREEK")
    assert orgs["DIYU"][:2] == ("ROOT_CN_DIYU", 1)
    assert orgs["DIYU_01"][:2] == ("DIYU", 2)
    assert orgs["HEAVEN"][:2] == orgs["HELL"][:2] == ("ROOT_EU_HEAVEN_HELL", 1)
    assert orgs["ORPHAN"] == before["ORPHAN"]

    # 用户:空 / 跨殿 → 殿根;同殿的不动;ADMIN、SOUL、无殿不动。
    org_of = dict(User._base_manager.values_list("username", "organization__code"))
    assert org_of["m_none"] == org_of["m_cross"] == "ROOT_CN_DIYU"
    assert org_of["m_ok"] == "DIYU_01"
    assert org_of["m_eu"] == "HELL"
    assert org_of["m_admin"] is org_of["m_soul"] is org_of["m_hallless"] is None

    # 灵魂:创建人机构(同殿)> 殿根;暂居的按暂居殿;无殿保持空。
    owner = dict(Soul._base_manager.values_list("name", "owner_org__code"))
    assert owner == {
        "ok": "DIYU_01", "cross": "ROOT_CN_DIYU", "anon": "ROOT_CN_DIYU", "hallless": None,
        "guest": "ROOT_EU_HEAVEN_HELL", "bare": "ROOT_NEW_HALL",
    }
    # 审判:court 前缀 > 创建人机构 > 殿根。
    case = dict(Judgment._base_manager.values_list("case_number", "owner_org__code"))
    assert case == {"M-1": "DIYU_01", "M-2": "DIYU_01", "M-3": "ROOT_CN_DIYU", "M-4": None}
    assert not Soul._base_manager.filter(tenant__isnull=False, owner_org__isnull=True).exists()
    assert not Judgment._base_manager.filter(tenant__isnull=False, owner_org__isnull=True).exists()

    # 暂居中的调拨记原属殿根;已回归的不填。
    src = dict(Dispatch._base_manager.values_list("status", "source_owner_org__code"))
    assert src == {"EXECUTED": "ROOT_CN_DIYU", "RETURNED": None}
    assert state.get_model("perm", "RoleDataScope")._base_manager.count() == 0

    # 降级:根删掉,原树、层级复原;新列消失。
    state = migrate_to(BEFORE)
    assert _orgs(state) == before
    assert not state.get_model("org", "Organization")._base_manager.filter(code__startswith="ROOT_").exists()
    soul_fields = {f.name for f in state.get_model("souls", "Soul")._meta.get_fields()}
    assert "owner_org" not in soul_fields
    org_of = dict(state.get_model("authentication", "User")._base_manager.values_list("username", "organization__code"))
    assert org_of["m_none"] is None and org_of["m_ok"] == "DIYU_01"
