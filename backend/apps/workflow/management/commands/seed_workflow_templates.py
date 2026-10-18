"""
The formal approval templates of the four halls, with their return rules (2026-10-19).

One ``WorkflowTemplate`` row per hall and case type, in the hall's own tenant, published through
``versioning`` (so each row has a v1 the editor's history shows, and the publish validator has passed
it). ``_resolve_template`` prefers such a row over ``WORKFLOW_TEMPLATES`` for the hall's own segment
and for the segment a hall runs inside another hall's workflow (``segments.foreign_realms``).

What the rows say is ``local-gates/流程退回规则草案.md`` as approved, with the user's lore corrections
of 2026-10-19:

* a first station's FAIL ends the flow; a middle station's goes back one station;
* 十殿's final FAIL goes back to court 1, 秦广王: the 孽镜台 stands beside court 1, not court 5
  (docs/11);
* 埃及称重 has no returns at all — the heart is weighed once (verify-egyptian.md §2) — and neither
  have 末日审判 or 天堂申诉: every FAIL there ends the flow;
* an appeal's final FAIL ends the flow (the appeal fails);
* the Greek 分区审判 FAIL goes to Minos (``on_fail``), Gorgias 524a.

Stations, courts, types and actors are ``WORKFLOW_TEMPLATES``' (courts respelled by ``COURT_SPELLING``). European and Greek ROUTINE have no
entry there (they fell to the one-node generic flow); theirs are the frontend presets
``EUROPEAN_ROUTINE`` / ``GREEK_ROUTINE`` (``packages/core/src/config/workflow-templates.ts``), types
mapped as ``workflow-node-types.ts`` maps them, ``actor`` set because the cast has each person.

Matched on (tenant, civilization, case_type, name). Create-only by default, like ``seed_mythology``:
an existing row that differs is reported and left alone; ``--update`` publishes the seed as a new
version (the old one stays in the history), unless the row has an unpublished draft. A live template
of the same hall and case type under another name is never touched and never shadowed: the pair is
skipped. Nothing else is touched — the empty test templates are not this command's to delete.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.souls.models import CIVILIZATION_TENANT, Civilization
from apps.tenants.models import Tenant
from apps.workflow import versioning
from apps.workflow.models import CaseType, NodeType, WorkflowTemplate
from apps.workflow.node_shape import normalize_template_node
from apps.workflow.services import WORKFLOW_TEMPLATES
from apps.workflow.validation import validate_template_nodes

C, EU, EG, GR = Civilization.CHINESE, Civilization.EUROPEAN, Civilization.EGYPTIAN, Civilization.GREEK

#: Flows ``WORKFLOW_TEMPLATES`` does not have: the presets, in its spelling.
PRESET_FLOWS = {
    (EU, CaseType.ROUTINE): {
        "name": "末日审判流程",
        "nodes": [
            {"name": "Christ · 私审判", "court": "天堂", "type": NodeType.TRIAL, "order": 1, "actor": "Christ"},
            {"name": "Michael · 引领入光", "court": "天堂", "type": NodeType.EXECUTION, "order": 2, "actor": "Michael"},
            {"name": "Christ · 公审判", "court": "天堂", "type": NodeType.FINAL, "order": 3, "actor": "Christ"},
        ],
    },
    (GR, CaseType.ROUTINE): {
        "name": "希腊冥界流程",
        "nodes": [
            {"name": "Aeacus · 分区审判（欧洲亡魂）", "court": "岔路口草地", "type": NodeType.TRIAL, "order": 1,
             "actor": "Aeacus"},
            {"name": "Rhadamanthus · 分区审判（亚洲亡魂）", "court": "岔路口草地", "type": NodeType.TRIAL, "order": 2,
             "actor": "Rhadamanthus"},
            {"name": "Minos · 终裁（另二人存疑时）", "court": "岔路口草地", "type": NodeType.FINAL, "order": 3,
             "actor": "Minos"},
        ],
    },
}


#: One spelling per court across the rows this command writes (2026-10-19): ``WORKFLOW_TEMPLATES`` spells the
#: European appeal's court ``Heaven`` while the 末日审判 preset says 天堂 — the same court. The rows take the
#: presets' 天堂; screens show either spelling in the reader's language (``courtLabel`` in packages/core).
COURT_SPELLING = {"Heaven": "天堂"}


def _back(*pairs):
    return {order: ("reject_to", target) for order, target in pairs}


#: (civilization, case_type) -> {station: (field, target station)}. A station not listed ends the flow
#: on FAIL. Also the list of rows this command writes.
FAIL_ROUTES = {
    (C, CaseType.ROUTINE): {**_back(*((i, i - 1) for i in range(2, 10))), 10: ("reject_to", 1)},
    (C, CaseType.APPEAL): _back((2, 1), (3, 2)),
    (C, CaseType.CROSS_REALM): _back((2, 1), (3, 2), (4, 3)),
    (EG, CaseType.ROUTINE): {},
    (EG, CaseType.HEART_WEIGHING): {},
    (EG, CaseType.APPEAL): _back((2, 1)),
    (EU, CaseType.ROUTINE): {},
    (EU, CaseType.APPEAL): {},
    (EU, CaseType.CANONIZATION): _back((2, 1), (3, 2)),
    (EU, CaseType.PURGATORY_REVIEW): _back((2, 1), (3, 2)),
    (GR, CaseType.ROUTINE): {1: ("on_fail", 3), 2: ("on_fail", 3)},
}


def seed_template(civilization, case_type) -> tuple[str, list[dict]]:
    """The name and canonical nodes (ids ``n1``…, edges by id, as the editor saves them) for one pair."""
    key = (civilization, case_type)
    source = PRESET_FLOWS.get(key) or WORKFLOW_TEMPLATES[key]
    nodes = []
    for position, raw in enumerate(source["nodes"], start=1):
        node = normalize_template_node(raw, position)
        node["node_type"] = str(node["node_type"])
        node["court_code"] = COURT_SPELLING.get(node.get("court_code") or "", node.get("court_code") or "")
        node["id"] = f"n{node['node_order']}"
        nodes.append(node)
    for order, (field, target) in FAIL_ROUTES[key].items():
        nodes[order - 1][field] = f"n{target}"
    return source["name"], nodes


class Command(BaseCommand):
    help = "Seed each hall's formal workflow templates (with return rules); create-only unless --update"

    def add_arguments(self, parser):
        parser.add_argument("--update", action="store_true",
                            help="publish the seed as a new version where an existing row differs")

    def handle(self, *args, update=False, **options):
        tenants = {t.code: t for t in Tenant.objects.filter(code__in=set(CIVILIZATION_TENANT.values()))}
        counts = {"created": 0, "updated": 0, "unchanged": 0, "skipped": 0}
        for civilization, case_type in FAIL_ROUTES:
            name, nodes = seed_template(civilization, case_type)
            issues = validate_template_nodes(nodes)
            if issues:
                raise CommandError(f"{name} ({civilization}/{case_type}) fails publish validation: {issues}")
            tenant = tenants.get(CIVILIZATION_TENANT[civilization])
            label = f"{name} ({civilization}/{case_type})"
            if tenant is None:
                self.stdout.write(f"  Skipped: {label} — no tenant {CIVILIZATION_TENANT[civilization]}")
                counts["skipped"] += 1
                continue
            with transaction.atomic():
                outcome = self._seed(tenant, civilization, case_type, name, nodes, update)
            counts[outcome] += 1
            self.stdout.write(f"  {outcome.capitalize()}: {label} @ {tenant.code}")
        self.stdout.write(self.style.SUCCESS(
            "\nDone: " + ", ".join(f"{n} {k}" for k, n in counts.items())))

    def _seed(self, tenant, civilization, case_type, name, nodes, update) -> str:
        rows = WorkflowTemplate.objects.filter(tenant=tenant, civilization=civilization, case_type=case_type)
        row = rows.filter(name=name).first()
        if row is None:
            other = rows.filter(is_active=True).exclude(nodes_json=[]).first()
            if other is not None:
                self.stdout.write(f"    a live template 「{other.name}」 already serves this pair; left alone")
                return "skipped"
            row = WorkflowTemplate.objects.create(
                name=name, civilization=civilization, case_type=case_type, tenant=tenant, is_active=True)
            versioning.save_draft(row, nodes)
            versioning.publish(row)
            return "created"
        if row.is_active and row.nodes_json == nodes:
            return "unchanged"
        if not update:
            self.stdout.write("    differs from the seed; --update publishes the seed as a new version")
            return "skipped"
        if versioning.draft_of(row) is not None:
            self.stdout.write("    has an unpublished draft; publish or discard it first")
            return "skipped"
        versioning.save_draft(row, nodes)
        versioning.publish(row)
        if not row.is_active:
            WorkflowTemplate.objects.filter(pk=row.pk).update(is_active=True)
        return "updated"
