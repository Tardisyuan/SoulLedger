"""
Seed workflow templates from hardcoded dict into WorkflowTemplate model.
"""
from django.core.management.base import BaseCommand

from apps.tenants.models import Tenant
from apps.workflow.models import WorkflowTemplate
from apps.workflow.node_shape import normalize_template_node
from apps.workflow.services import WORKFLOW_TEMPLATES


class Command(BaseCommand):
    help = "Seed workflow templates from hardcoded definitions"

    def handle(self, *args, **options):
        # Use the first tenant as default, or create a system-wide one
        tenant = Tenant.objects.first()

        created_count = 0
        for (civilization, case_type), template_data in WORKFLOW_TEMPLATES.items():
            obj, created = WorkflowTemplate.objects.update_or_create(
                civilization=civilization,
                case_type=case_type,
                defaults={
                    "name": template_data["name"],
                    # Normalized, not verbatim. This command used to store
                    # WORKFLOW_TEMPLATES' own `name/court/type/order` spelling,
                    # which is not the shape `nodes_json` is documented to hold
                    # (see the model field) nor the shape the API can render —
                    # `GET /api/v1/workflow/templates/{id}/` 500'd on every row
                    # this command wrote. `actor` is carried through unchanged;
                    # the canonical shape has no field for it, and it is what
                    # `_resolve_approver` prefers over the node label.
                    "nodes_json": [
                        normalize_template_node(node, position)
                        for position, node in enumerate(template_data["nodes"], start=1)
                    ],
                    "is_active": True,
                    "tenant": tenant,
                },
            )
            if created:
                created_count += 1
                self.stdout.write(f"  Created: {obj.name} ({civilization}/{case_type})")
            else:
                self.stdout.write(f"  Updated: {obj.name} ({civilization}/{case_type})")

        self.stdout.write(self.style.SUCCESS(f"\nDone: {created_count} created, {len(WORKFLOW_TEMPLATES) - created_count} updated"))
