"""Round trips for the nine data migrations of the 2026-11-13 four-civilization audit.

Why this exists: each of them rewrites seeded text "only where it is still the
old value" and claims a reverse. Their own tests call ``forwards`` / ``backwards``
as functions on the current models; none ran the real ``migrate`` both ways and
compared rows. Here every one goes forward -> back -> forward through the
``migration_round_trip`` fixture (``tests/migration_roundtrip.py``), with one
hand-edited value beside the old ones that the migration must leave alone.

Old and new values are read from the migration modules, so a test cannot drift
from the text the migration actually matches on.
"""
from __future__ import annotations

from importlib import import_module

from tests.migration_roundtrip import snapshot_rows

HAND = "手改过的值 / hand-edited"


def _mod(app: str, name: str):
    return import_module(f"apps.{app}.migrations.{name}")


def _rows(state, app: str, model: str, *fields: str):
    """Every row of a historical model, keyed by pk, with `fields` read out."""
    manager = state.get_model(app, model)._base_manager
    return snapshot_rows(
        manager.all(), key=lambda r: str(r.pk), fields={f: f for f in fields}, prefix=f"{model}:",
    )


def _tenant(state, code: str):
    return state.get_model("tenants", "Tenant")._base_manager.create(code=code, display_name=code)


def _get(state, app: str, model: str, **lookup):
    return state.get_model(app, model)._base_manager.get(**lookup)


# ── actors ────────────────────────────────────────────────────────────


def test_actors_0020_round_trip(migration_round_trip):
    fields = ("name_en", "title", "title_zh")

    def seed(state):
        actor = state.get_model("actors", "Actor")._base_manager
        seeded, edited = _tenant(state, "RT_EG_A"), _tenant(state, "RT_EG_B")
        common = {"civilization": "EGYPTIAN", "role": "JUDGE"}
        actor.create(name="Ra", name_en="Ra (Atum)", tenant=seeded, **common)
        actor.create(name="Isis", title="生命女神伊西斯", title_zh="生命女神伊西斯", tenant=seeded, **common)
        actor.create(name="Ra", name_en=HAND, tenant=edited, **common)
        # title hand-edited, title_zh still old: columns are judged one by one.
        actor.create(name="Isis", title=HAND, title_zh="生命女神伊西斯", tenant=edited, **common)
        # Same old value on another civilization's row is not this migration's.
        actor.create(name="Ra", name_en="Ra (Atum)", civilization="GREEK", role="JUDGE", tenant=seeded)

    def check_forward(state):
        assert _get(state, "actors", "Actor", name="Ra", tenant__code="RT_EG_A", civilization="EGYPTIAN").name_en == "Ra"
        isis = _get(state, "actors", "Actor", name="Isis", tenant__code="RT_EG_A")
        assert (isis.title, isis.title_zh) == ("魔法女神伊西斯", "魔法女神伊西斯")
        assert _get(state, "actors", "Actor", name="Ra", tenant__code="RT_EG_B").name_en == HAND
        edited = _get(state, "actors", "Actor", name="Isis", tenant__code="RT_EG_B")
        assert (edited.title, edited.title_zh) == (HAND, "魔法女神伊西斯")
        assert _get(state, "actors", "Actor", name="Ra", civilization="GREEK").name_en == "Ra (Atum)"

    migration_round_trip(
        before=("actors", "0019_dantes_rivers_and_the_acheron_ferryman"),
        after=("actors", "0020_egypt_ra_is_not_atum_and_isis_of_magic"),
        seed=seed, snapshot=lambda s: _rows(s, "actors", "Actor", *fields), check_forward=check_forward,
    )


def test_actors_0021_round_trip(migration_round_trip):
    changes = _mod("actors", "0021_cn_ghost_emperors_and_ox_head").CHANGES
    fields = sorted({field for _lookup, cols in changes for field, _old, _new in cols} | {"name", "title_zh"})

    def seed(state):
        actor = state.get_model("actors", "Actor")._base_manager
        seeded, edited = _tenant(state, "RT_CN_A"), _tenant(state, "RT_CN_B")
        for lookup, cols in changes:
            old = {field: was for field, was, _new in cols}
            # The centre is found by title, so its name comes from the old values.
            actor.create(**{"civilization": "CHINESE", "role": "JUDGE", "tenant": seeded, **lookup, **old})
        # Hand-edited: the ox keeps a re-typed title; the centre a re-typed name.
        actor.create(name="牛头", title=HAND, title_zh="牛头马面", civilization="CHINESE", role="GUIDE", tenant=edited)
        actor.create(name=HAND, name_zh="周文", title_zh="中央鬼帝", civilization="CHINESE", role="JUDGE", tenant=edited)

    def check_forward(state):
        for lookup, cols in changes:
            row = _get(state, "actors", "Actor", tenant__code="RT_CN_A", **lookup)
            for field, _old, new in cols:
                assert getattr(row, field) == new, f"{lookup}.{field} was not rewritten"
        ox = _get(state, "actors", "Actor", tenant__code="RT_CN_B", name="牛头")
        assert (ox.title, ox.title_zh) == (HAND, "牛头")
        centre = _get(state, "actors", "Actor", tenant__code="RT_CN_B", title_zh="中央鬼帝")
        assert (centre.name, centre.name_zh) == (HAND, "周乞")

    migration_round_trip(
        before=("actors", "0020_egypt_ra_is_not_atum_and_isis_of_magic"),
        after=("actors", "0021_cn_ghost_emperors_and_ox_head"),
        seed=seed, snapshot=lambda s: _rows(s, "actors", "Actor", *fields), check_forward=check_forward,
    )


# ── org (`code` is globally unique: the hand edit sits on another column) ──


def test_org_0015_round_trip(migration_round_trip):
    renames = _mod("org", "0015_egypt_org_names_follow_the_docs").RENAMES

    def seed(state):
        org = state.get_model("org", "Organization")._base_manager
        hall, apep = renames["DUAT_HALL"], renames["DUAT_APEP"]
        org.create(code="DUAT_HALL", name=hall["name"][0], name_en=hall["name_en"][0])
        org.create(code="DUAT_APEP", name=HAND, name_en=apep["name_en"][0])
        org.create(code="RT_OTHER", name=hall["name"][0], name_en=hall["name_en"][0])

    def check_forward(state):
        hall = _get(state, "org", "Organization", code="DUAT_HALL")
        assert (hall.name, hall.name_en) == ("两真之殿", "Hall of Two Truths")
        apep = _get(state, "org", "Organization", code="DUAT_APEP")
        assert (apep.name, apep.name_en) == (HAND, "Realm of Apep, Amduat")
        other = _get(state, "org", "Organization", code="RT_OTHER")
        assert (other.name, other.name_en) == ("真理大厅", "Hall of Ma'at")

    migration_round_trip(
        before=("org", "0014_alter_organization_category"),
        after=("org", "0015_egypt_org_names_follow_the_docs"),
        seed=seed, snapshot=lambda s: _rows(s, "org", "Organization", "code", "name", "name_en"),
        check_forward=check_forward,
    )


def test_org_0016_round_trip(migration_round_trip):
    def seed(state):
        org = state.get_model("org", "Organization")._base_manager
        org.create(code="DIYU_PAN_GUAN_04", name="陆之道", name_en=HAND)
        org.create(code="RT_OTHER", name="陆之道", name_en="Lu Zhidao")

    def check_forward(state):
        judge = _get(state, "org", "Organization", code="DIYU_PAN_GUAN_04")
        assert (judge.name, judge.name_en) == ("陆判", HAND)
        other = _get(state, "org", "Organization", code="RT_OTHER")
        assert (other.name, other.name_en) == ("陆之道", "Lu Zhidao")

    migration_round_trip(
        before=("org", "0015_egypt_org_names_follow_the_docs"),
        after=("org", "0016_cn_judge_lu"),
        seed=seed, snapshot=lambda s: _rows(s, "org", "Organization", "code", "name", "name_en"),
        check_forward=check_forward,
    )


# ── realms ────────────────────────────────────────────────────────────


def _realm(state, tenant, code, civilization, description):
    return state.get_model("realms", "Realm")._base_manager.create(
        realm_code=code, civilization=civilization, realm_type="HELL", tier=1,
        name_local=code, name_zh=code, description=description, tenant=tenant,
    )


def test_realms_0036_round_trip(migration_round_trip):
    descriptions = _mod("realms", "0036_european_acheron_and_seventh_terrace_descriptions").DESCRIPTIONS

    def seed(state):
        seeded, edited = _tenant(state, "RT_EU_A"), _tenant(state, "RT_EU_B")
        for code, (old, _new) in descriptions.items():
            _realm(state, seeded, code, "EUROPEAN", old)
            _realm(state, edited, code, "EUROPEAN", HAND)

    def check_forward(state):
        for code, (_old, new) in descriptions.items():
            assert _get(state, "realms", "Realm", realm_code=code, tenant__code="RT_EU_A").description == new
            assert _get(state, "realms", "Realm", realm_code=code, tenant__code="RT_EU_B").description == HAND

    migration_round_trip(
        before=("realms", "0035_hall_of_two_truths_egy_name"),
        after=("realms", "0036_european_acheron_and_seventh_terrace_descriptions"),
        seed=seed, snapshot=lambda s: _rows(s, "realms", "Realm", "realm_code", "description"),
        check_forward=check_forward,
    )


def test_realms_0037_round_trip(migration_round_trip):
    migration = _mod("realms", "0037_cn_ninth_court_great_avici")

    def seed(state):
        seeded, edited = _tenant(state, "RT_CN_A"), _tenant(state, "RT_CN_B")
        _realm(state, seeded, migration.CODE, "CHINESE", migration.OLD)
        _realm(state, edited, migration.CODE, "CHINESE", HAND)
        _realm(state, seeded, "DY_COURT_08_DUSHI", "CHINESE", migration.OLD)

    def check_forward(state):
        code = migration.CODE
        assert _get(state, "realms", "Realm", realm_code=code, tenant__code="RT_CN_A").description == migration.NEW
        assert _get(state, "realms", "Realm", realm_code=code, tenant__code="RT_CN_B").description == HAND
        assert _get(state, "realms", "Realm", realm_code="DY_COURT_08_DUSHI").description == migration.OLD

    migration_round_trip(
        before=("realms", "0036_european_acheron_and_seventh_terrace_descriptions"),
        after=("realms", "0037_cn_ninth_court_great_avici"),
        seed=seed, snapshot=lambda s: _rows(s, "realms", "Realm", "realm_code", "description"),
        check_forward=check_forward,
    )


# ── tenants (`code` is unique: the untouched row is another tenant with the old text) ──


def test_tenants_0022_round_trip(migration_round_trip):
    migration = _mod("tenants", "0022_egypt_description_names_seeded_stations")

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")._base_manager
        tenant.create(code="EG_DUAT", display_name="Duat", description=migration.OLD)
        tenant.create(code="RT_EG_COPY", display_name="Copy", description=migration.OLD)

    def check_forward(state):
        assert _get(state, "tenants", "Tenant", code="EG_DUAT").description == migration.NEW
        assert _get(state, "tenants", "Tenant", code="RT_EG_COPY").description == migration.OLD

    migration_round_trip(
        before=("tenants", "0021_hall_name_egy_wesekhet_maaty"),
        after=("tenants", "0022_egypt_description_names_seeded_stations"),
        seed=seed, snapshot=lambda s: _rows(s, "tenants", "Tenant", "code", "description"),
        check_forward=check_forward,
    )


def test_tenants_0022_leaves_a_hand_edited_description_alone(migration_round_trip):
    """The same trip with EG_DUAT's description re-typed: nothing may move.

    A second test because `Tenant.code` is unique — the hand-edited EG_DUAT
    cannot stand beside the seeded one — and by hand because the harness
    refuses a forward pass that changes nothing. The fixture is requested for
    its teardown (schema back to latest) and the `migration` marker.
    """
    from tests.migration_roundtrip import migrate_to

    state = migrate_to([("tenants", "0021_hall_name_egy_wesekhet_maaty")])
    state.get_model("tenants", "Tenant")._base_manager.create(code="EG_DUAT", display_name="Duat", description=HAND)
    state = migrate_to([("tenants", "0022_egypt_description_names_seeded_stations")])
    assert _get(state, "tenants", "Tenant", code="EG_DUAT").description == HAND
    state = migrate_to([("tenants", "0021_hall_name_egy_wesekhet_maaty")])
    assert _get(state, "tenants", "Tenant", code="EG_DUAT").description == HAND


# ── judgment ──────────────────────────────────────────────────────────


def test_judgment_0052_round_trip(migration_round_trip):
    m = _mod("judgment", "0052_european_corpus_corrections")
    fields = ("code", "text_zh", "text_en", "payload_json")

    def seed(state):
        statute = state.get_model("judgment", "Statute")._base_manager
        seeded, edited = _tenant(state, "RT_EU_A"), _tenant(state, "RT_EU_B")

        def make(tenant, code, **extra):
            statute.create(tenant=tenant, code=code, civilization="EUROPEAN", corpus="INFERNO", **extra)

        # The old text sits inside a longer sentence: the migration replaces by substring.
        make(seeded, "EU-INF-C9", payload_json={
            "aristotelian_class": m.ARISTOTLE[0], "conjecture": m.TREACHERY_CONJECTURE[0], "kept": 1,
        })
        for n in (1, 2, 3, 4):
            make(seeded, f"EU-INF-C9-Z{n}", payload_json={"aristotelian_class": m.ARISTOTLE[0]})
        make(seeded, "EU-INF-C3", text_zh=f"贪食者:{m.SNOW_ZH[0]}。", text_en=f"Gluttons: {m.SNOW_EN[0]}.",
             payload_json={"contrapasso_zh": m.SNOW_ZH[0], "contrapasso_en": m.SNOW_EN[0]})
        make(seeded, "EU-DS-T7", text_zh=f"第七层:{m.FLAME_ZH[0]}。", text_en=f"Lust. {m.FLAME_TEXT_EN[0]}",
             payload_json={"purgation_zh": m.FLAME_ZH[0], "purgation_en": m.FLAME_PAYLOAD_EN[0]})
        # Hand-edited rows; the third circle keeps an old English column beside a re-typed Chinese one.
        make(edited, "EU-INF-C9", payload_json={"aristotelian_class": HAND, "conjecture": HAND})
        make(edited, "EU-INF-C3", text_zh=HAND, text_en=f"Gluttons: {m.SNOW_EN[0]}.",
             payload_json={"contrapasso_zh": HAND})
        # The old words on an article outside CHANGES stay.
        make(seeded, "EU-INF-C8", payload_json={"aristotelian_class": m.ARISTOTLE[0]})

    def check_forward(state):
        def row(tenant, code):
            return _get(state, "judgment", "Statute", tenant__code=tenant, code=code)

        c9 = row("RT_EU_A", "EU-INF-C9").payload_json
        assert c9 == {"aristotelian_class": m.ARISTOTLE[1], "conjecture": m.TREACHERY_CONJECTURE[1], "kept": 1}
        for n in (1, 2, 3, 4):
            assert row("RT_EU_A", f"EU-INF-C9-Z{n}").payload_json == {"aristotelian_class": m.ARISTOTLE[1]}
        c3 = row("RT_EU_A", "EU-INF-C3")
        assert (c3.text_zh, c3.text_en) == (f"贪食者:{m.SNOW_ZH[1]}。", f"Gluttons: {m.SNOW_EN[1]}.")
        assert c3.payload_json == {"contrapasso_zh": m.SNOW_ZH[1], "contrapasso_en": m.SNOW_EN[1]}
        t7 = row("RT_EU_A", "EU-DS-T7")
        assert (t7.text_zh, t7.text_en) == (f"第七层:{m.FLAME_ZH[1]}。", f"Lust. {m.FLAME_TEXT_EN[1]}")
        assert t7.payload_json == {"purgation_zh": m.FLAME_ZH[1], "purgation_en": m.FLAME_PAYLOAD_EN[1]}

        assert row("RT_EU_B", "EU-INF-C9").payload_json == {"aristotelian_class": HAND, "conjecture": HAND}
        edited = row("RT_EU_B", "EU-INF-C3")
        assert (edited.text_zh, edited.text_en) == (HAND, f"Gluttons: {m.SNOW_EN[1]}.")
        assert edited.payload_json == {"contrapasso_zh": HAND}
        assert row("RT_EU_A", "EU-INF-C8").payload_json == {"aristotelian_class": m.ARISTOTLE[0]}

    migration_round_trip(
        before=("judgment", "0051_v4_fail_reasons_deadline_doc_tz"),
        after=("judgment", "0052_european_corpus_corrections"),
        seed=seed, snapshot=lambda s: _rows(s, "judgment", "Statute", *fields), check_forward=check_forward,
    )


# ── workflow ──────────────────────────────────────────────────────────


def test_workflow_0031_round_trip(migration_round_trip):
    """Only the backend's old spelling is seeded: the migration's docstring says
    the front end's ("42审判者 …") cannot be told apart on the way back and is
    restored as the backend's, so a row carrying it does not round-trip by design
    (`test_workflow_egyptian_node_reading.py` covers what the reverse does to it).
    """
    m = _mod("workflow", "0031_egypt_the_forty_two_are_assessors_panguan")
    old = "四十二神官 · 否定告白"

    def nodes(name):
        return [
            {"node_name": name, "name": name, "name_en": m.NEW_EN, "node_order": 1},
            {"node_name": "欧西里斯 · 终审", "node_order": 2},
        ]

    def seed(state):
        tenant = _tenant(state, "RT_EG_A")
        soul = state.get_model("souls", "Soul")._base_manager.create(name="往返判官魂", tenant=tenant)
        workflow = state.get_model("workflow", "ApprovalWorkflow")._base_manager.create(
            workflow_name="欧西里斯称重流程", soul=soul, case_type="HEART_WEIGHING", tenant=tenant,
        )
        node = state.get_model("workflow", "ApprovalNode")._base_manager
        for order, name in enumerate((old, HAND, "欧西里斯 · 终审"), start=1):
            node.create(
                workflow=workflow, node_name=name, node_name_en=m.NEW_EN, court_code="Hall of Two Truths",
                node_order=order, node_type="REVIEW", approver_type="SYSTEM", status="PENDING",
            )
        template = state.get_model("workflow", "WorkflowTemplate")._base_manager
        seeded = template.create(
            name="称心", civilization="EGYPTIAN", case_type="HEART_WEIGHING", tenant=tenant, nodes_json=nodes(old),
        )
        template.create(
            name="手改", civilization="EGYPTIAN", case_type="ROUTINE", tenant=tenant, nodes_json=nodes(HAND),
        )
        state.get_model("workflow", "WorkflowTemplateVersion")._base_manager.create(
            template=seeded, number=1, status="DRAFT", nodes_json=nodes(old),
        )

    def snapshot(state):
        return {
            **_rows(state, "workflow", "ApprovalNode", "node_order", "node_name", "node_name_en"),
            **_rows(state, "workflow", "WorkflowTemplate", "name", "nodes_json"),
            **_rows(state, "workflow", "WorkflowTemplateVersion", "number", "nodes_json"),
        }

    def check_forward(state):
        names = {
            n.node_order: n.node_name for n in state.get_model("workflow", "ApprovalNode")._base_manager.all()
        }
        assert names == {1: m.NEW, 2: HAND, 3: "欧西里斯 · 终审"}
        assert _get(state, "workflow", "WorkflowTemplate", name="称心").nodes_json == nodes(m.NEW)
        assert _get(state, "workflow", "WorkflowTemplate", name="手改").nodes_json == nodes(HAND)
        assert _get(state, "workflow", "WorkflowTemplateVersion", number=1).nodes_json == nodes(m.NEW)

    migration_round_trip(
        before=("workflow", "0030_backfill_english"),
        after=("workflow", "0031_egypt_the_forty_two_are_assessors_panguan"),
        seed=seed, snapshot=snapshot, check_forward=check_forward,
    )
