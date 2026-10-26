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
* the Greek flow is Gorgias 524a as the user read it on 2026-10-19: one judge or the other, never both. An
  automatic 通知 step routes on the soul's ``origin_region`` (Europe → Aeacus, Asia → Rhadamanthus, 不详 →
  Minos directly); Aeacus's or Rhadamanthus's PASS ends the flow (the soul takes its road), a FAIL (in doubt)
  goes to Minos (``on_fail``); Minos's PASS completes, his FAIL ends the flow REJECTED.

Stations, courts, types and actors are ``WORKFLOW_TEMPLATES``' (courts respelled by ``COURT_SPELLING``). European and Greek ROUTINE have no
entry there (they fell to the one-node generic flow); theirs are the frontend presets
``EUROPEAN_ROUTINE`` / ``GREEK_ROUTINE`` (``packages/core/src/config/workflow-templates.ts``), types
mapped as ``workflow-node-types.ts`` maps them, ``actor`` set because the cast has each person. The Greek
preset carries the same graph (its ``routes``: a routing step, the three judges and a 结束).

Matched on (tenant, civilization, case_type, name). Create-only by default, like ``seed_mythology``:
an existing row that differs is reported and left alone; ``--update`` publishes the seed as a new
version (the old one stays in the history), unless the row has an unpublished draft. A live template
of the same hall and case type under another name is never touched and never shadowed: the pair is
skipped. Nothing else is touched — the empty test templates are not this command's to delete.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.souls.models import CIVILIZATION_TENANT
from apps.tenants.models import Tenant
from apps.workflow import versioning
from apps.workflow.models import WorkflowTemplate
from apps.workflow.templates import FAIL_ROUTES, seed_template
from apps.workflow.validation import validate_template_nodes


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
