"""Reference data carries its English in its own columns; the source column stays the record.

What this holds: a new record with no English is valid and reads as the source; a rename leaves the English alone;
a built flow copies the template's English; nothing reaches a column wider than PostgreSQL allows (SQLite would not say);
and the corpus and souls' own names stay out.
"""
import importlib
import re

import pytest

from apps.actors.models import Actor
from apps.actors.mythology.english import ACTOR_DESCRIPTION_EN, REALM_DESCRIPTION_EN
from apps.judgment.models import Statute
from apps.menus.models import Menu
from apps.menus.serializers import MenuSerializer
from apps.notifications import messages
from apps.org.management.commands.init_organizations import INITIAL_ORGANIZATIONS, ORGANIZATION_NAME_EN
from apps.org.models import Organization
from apps.org.serializers import OrganizationSerializer
from apps.perm.english import PERMISSION_NAME_EN
from apps.perm.models import DEFAULT_PERMISSIONS, Permission
from apps.realms.models import Realm
from apps.souls.models import Civilization, Soul
from apps.tenants.models import Tenant
from apps.workflow.english import NAME_EN
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, CaseType, WorkflowSegment, WorkflowTemplate
from apps.workflow.node_shape import normalize_template_node
from apps.workflow.serializers import WorkflowTemplateNodeSerializer
from apps.workflow.templates import PRESET_FLOWS, WORKFLOW_TEMPLATES, formal_template, seed_template

CJK = re.compile(r"[㐀-鿿]")
BACKFILL = importlib.import_module("apps.workflow.migrations.0030_backfill_english")


def _width(model, field):
    return model._meta.get_field(field).max_length


# ── template nodes ──────────────────────────────────────────────────


def test_a_node_keeps_its_english_through_normalization_and_invents_none():
    assert normalize_template_node({"node_name": "终审", "name_en": "Final review"})["name_en"] == "Final review"
    assert "name_en" not in normalize_template_node({"node_name": "一个新节点"})


def test_the_serializer_takes_a_nodes_english_and_does_not_require_it():
    with_english = WorkflowTemplateNodeSerializer(data={"node_name": "甲", "name_en": "Alpha"})
    assert with_english.is_valid(), with_english.errors
    assert with_english.validated_data["node_name"] == "甲"
    assert with_english.validated_data["name_en"] == "Alpha"
    without = WorkflowTemplateNodeSerializer(data={"node_name": "乙"})
    assert without.is_valid(), without.errors
    assert without.validated_data["name_en"] == ""


def test_a_built_in_template_has_english_beside_its_source():
    name, nodes = seed_template(Civilization.CHINESE, CaseType.ROUTINE)
    assert name == "十殿审判流程"
    first = nodes[0]
    assert first["node_name"] == "秦广王 · 分流", "English must not replace the name the engine and the lookups read"
    assert first["name_en"] == "King Qinguang · triage"
    template = formal_template(Civilization.CHINESE, CaseType.ROUTINE)
    assert template["name"] == "十殿审判流程"
    assert template["name_en"] == "Ten Courts judgment flow"


def test_every_name_the_code_writes_has_english_that_fits_its_column():
    assert sorted({n for n in _names_in_code() if CJK.search(n) and n not in NAME_EN}) == []
    for source, english in NAME_EN.items():
        assert not CJK.search(english), source
        assert len(english) <= _width(ApprovalNode, "node_name_en"), source


def _names_in_code():
    for table in (WORKFLOW_TEMPLATES, PRESET_FLOWS):
        for template in table.values():
            yield template["name"]
            for node in template["nodes"]:
                yield node.get("name") or node.get("node_name")


# ── the backfill ────────────────────────────────────────────────────


def test_the_backfill_names_what_it_knows_and_leaves_the_rest_blank():
    assert BACKFILL.english("十殿审判流程") == "Ten Courts judgment flow"
    assert BACKFILL.english("转生申请: ACZJ689D8Q") == "Rebirth application: ACZJ689D8Q"
    assert BACKFILL.english("转生申请申诉: ACZJ689D8Q") == "Rebirth application appeal: ACZJ689D8Q"
    assert BACKFILL.english("CHINESE 审批流程") == "CHINESE approval flow"
    assert BACKFILL.english("一个管理员写的名字") == ""


def test_the_backfill_does_not_touch_english_someone_entered_and_reverses_cleanly():
    nodes = [
        {"node_name": "终审", "node_order": 1},
        {"name": "终审", "order": 2},
        {"node_name": "终审", "name_en": "Entered by hand"},
        {"node_name": "一个管理员写的名字"},
    ]
    filled = BACKFILL.with_english_nodes(nodes)
    assert [n.get("name_en") for n in filled] == ["Final review", "Final review", "Entered by hand", None]
    assert filled[0]["node_name"] == "终审"
    assert all("name_en" not in n for n in BACKFILL.without_english_nodes(filled))


@pytest.mark.django_db
def test_every_seeded_menu_and_permission_has_english():
    """A later migration that adds a menu or a permission has to bring its English."""
    assert list(Menu.objects.filter(name_en="").values_list("name", flat=True)) == []
    assert list(Permission.objects.filter(name_en="").values_list("codename", flat=True)) == []


# ── fallback and rename ─────────────────────────────────────────────


@pytest.mark.django_db
def test_a_new_record_needs_no_english():
    menu = Menu.objects.create(name="新菜单", path="/new-menu")
    assert menu.name_en == ""
    template = WorkflowTemplate.objects.create(name="新模板", civilization=Civilization.CHINESE)
    assert (template.name_en, template.description_en) == ("", "")
    organization = Organization.objects.create(name="新机构", code="NEW_ORG_EN")
    assert organization.name_en == ""


@pytest.mark.django_db
def test_a_rename_keeps_the_english_and_a_write_never_puts_english_into_the_name():
    menu = Menu.objects.create(name="旧名", name_en="Old name", path="/renamed")
    serializer = MenuSerializer(menu, data={"name": "新名"}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    menu.refresh_from_db()
    assert (menu.name, menu.name_en) == ("新名", "Old name")

    serializer = MenuSerializer(menu, data={"name_en": "New name"}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    menu.refresh_from_db()
    assert (menu.name, menu.name_en) == ("新名", "New name")


@pytest.mark.django_db
def test_an_organization_serializer_returns_both_columns():
    organization = Organization.objects.create(name="第一殿-秦广王", name_en="First Court · King Qinguang", code="EN_ORG_1")
    data = OrganizationSerializer(organization).data
    assert data["name"] == "第一殿-秦广王"
    assert data["name_en"] == "First Court · King Qinguang"


# ── what copies a name ──────────────────────────────────────────────


@pytest.mark.django_db
def test_a_built_flow_copies_the_templates_english():
    from apps.workflow.services import WorkflowService

    tenant = Tenant.objects.create(code="EN_COPY", display_name="English copy")
    soul = Soul.objects.create(name="屈原", tenant=tenant)
    workflow = ApprovalWorkflow.objects.create(soul=soul, workflow_name="模板", workflow_name_en="Template", tenant=tenant)
    template = {"name": "模板", "name_en": "Template", "nodes": [
        {"node_name": "有英文", "name_en": "Has English", "node_order": 1, "node_type": "TRIAL", "court_code": "第一殿"},
        {"node_name": "没英文", "node_order": 2, "node_type": "FINAL", "court_code": "第一殿"},
    ]}
    WorkflowService._create_nodes(workflow, template, Civilization.CHINESE, enter=False)
    built = list(workflow.nodes.order_by("node_order").values_list("node_name", "node_name_en"))
    assert built == [("有英文", "Has English"), ("没英文", "")]


def test_the_copies_have_columns_wide_enough_for_what_they_copy():
    assert _width(ApprovalWorkflow, "workflow_name_en") >= _width(WorkflowTemplate, "name_en")
    assert _width(ApprovalNode, "node_name_en") >= _width(ApprovalNode, "node_name")
    assert _width(WorkflowSegment, "name_en") >= _width(WorkflowTemplate, "name_en")


def test_an_english_notification_reads_the_english_where_there_is_some():
    params = {"soul": "屈原", "workflow": "十殿审判流程", "workflow_en": "Ten Courts judgment flow",
              "node": "新节点", "node_en": ""}
    _title, body = messages.render("en", "workflow_node_passed", params)
    assert "Ten Courts judgment flow" in body
    assert "十殿审判流程" not in body
    assert "新节点" in body, "a node with no English shows its source"
    _title, chinese = messages.render("zh-Hans", "workflow_node_passed", params)
    assert "十殿审判流程" in chinese


# ── seeds and widths ────────────────────────────────────────────────


def test_every_default_permission_has_english_that_fits():
    assert [row[0] for row in DEFAULT_PERMISSIONS if row[0] not in PERMISSION_NAME_EN] == []
    assert max(len(v) for v in PERMISSION_NAME_EN.values()) <= _width(Permission, "name_en")


def test_every_seeded_organization_has_english_that_fits():
    assert [o["name"] for o in INITIAL_ORGANIZATIONS if o["name"] not in ORGANIZATION_NAME_EN] == []
    assert max(len(v) for v in ORGANIZATION_NAME_EN.values()) <= _width(Organization, "name_en")


def test_the_menu_backfill_fits_its_column():
    module = importlib.import_module("apps.menus.migrations.0035_backfill_english")
    for english in [*module.BY_PATH.values(), *module.BY_GROUP_NAME.values()]:
        assert len(english) <= _width(Menu, "name_en"), english


def test_seeded_descriptions_have_english_free_of_chinese():
    for table in (ACTOR_DESCRIPTION_EN, REALM_DESCRIPTION_EN):
        assert [source[:40] for source, english in table.items() if CJK.search(english)] == []


# ── what stays out ──────────────────────────────────────────────────


@pytest.mark.parametrize("column", ["name_en", "description_en"])
def test_a_souls_name_is_their_own(column):
    assert column not in {f.name for f in Soul._meta.concrete_fields}


def test_the_corpus_got_no_new_english_column():
    columns = {f.name for f in Statute._meta.concrete_fields}
    # `title_en` / `text_en` are older than this work and hold what the sources give.
    assert not {"condition_en", "display_text_en", "source_notes_en", "contrapasso_en", "sinners_en"} & columns


def test_realm_and_actor_kept_the_english_name_they_had():
    assert {"name_en", "title_en", "description_en"} <= {f.name for f in Actor._meta.concrete_fields}
    realm_columns = {f.name for f in Realm._meta.concrete_fields}
    assert {"name_en", "description_en"} <= realm_columns
    assert "name_en_2" not in realm_columns
    assert {"display_name_en", "description_en"} <= {f.name for f in Tenant._meta.concrete_fields}
