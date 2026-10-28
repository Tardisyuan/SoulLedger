"""`ApprovalWorkflow.manually_started`(2026-10-29):手动发起(`POST /workflows/start/`)的流程不替它挂着的审判
做决定(`MANUAL_FLOWS_DECIDE_THE_JUDGMENT`)。

存量回填:手动发起每次都写一行审计 `resource="workflow.start"`、`resource_id` = 流程 id(`views.start`),
所以那些行就是手动发起的流程。其余(结案建的、申诉流程、转生申请)保持 False,行为不变。
"""
import uuid

from django.db import migrations, models


def backfill(apps, schema_editor):
    AuditLog = apps.get_model("audit", "AuditLog")
    ApprovalWorkflow = apps.get_model("workflow", "ApprovalWorkflow")
    db = schema_editor.connection.alias
    started = []
    for resource_id in (AuditLog._default_manager.using(db).filter(resource="workflow.start")
                        .values_list("resource_id", flat=True)):
        try:
            started.append(uuid.UUID(str(resource_id)))
        except ValueError:
            continue
    for start in range(0, len(started), 500):
        ApprovalWorkflow._default_manager.using(db).filter(pk__in=started[start:start + 500]).update(
            manually_started=True)


class Migration(migrations.Migration):

    dependencies = [
        ("audit", "0011_impersonation"),
        ("workflow", "0026_b43_workflow_segments"),
    ]

    operations = [
        migrations.AddField(
            model_name="approvalworkflow",
            name="manually_started",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
