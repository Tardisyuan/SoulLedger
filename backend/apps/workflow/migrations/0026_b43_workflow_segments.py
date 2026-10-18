"""第四十三批:审批流程按域分段(选站 / 加减站 / 跨域审判并入)。

只加表与可空列:存量流程没有分段,节点 `segment` 为空,引擎照旧走(`ApprovalWorkflow._enter` 只在节点有段且
该段还没选站时停在门口)。不需要数据迁移。
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tenants", "0015_tenant_dispatch_enabled_default_true"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("workflow", "0025_b37_workflow_number_unique"),
    ]

    operations = [
        migrations.CreateModel(
            name="WorkflowSegment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("order", models.PositiveSmallIntegerField()),
                ("civilization", models.CharField(max_length=30)),
                ("name", models.CharField(help_text="该域默认流程的名字", max_length=255)),
                ("state", models.CharField(
                    choices=[
                        ("LOCAL_PICKED", "本域(生成时选站)"),
                        ("AWAITING_PICK", "等待外域选站"),
                        ("PICKED", "外域已选站"),
                        ("SKIPPED", "跨域审判取消,整段跳过"),
                    ],
                    max_length=20,
                )),
                ("picked_at", models.DateTimeField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1)),
                ("gate_reached_at", models.DateTimeField(blank=True, null=True)),
                ("last_reminded_at", models.DateTimeField(blank=True, null=True)),
                ("overdue_notified_at", models.DateTimeField(blank=True, null=True)),
                ("default_node_count", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("picked_by", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+", to=settings.AUTH_USER_MODEL,
                )),
                ("tenant", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="workflow_segments",
                    to="tenants.tenant",
                )),
                ("workflow", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="segments",
                    to="workflow.approvalworkflow",
                )),
            ],
            options={
                "ordering": ["workflow", "order"],
                "constraints": [
                    models.UniqueConstraint(fields=("workflow", "order"), name="uniq_wf_segment_order"),
                ],
            },
        ),
        migrations.AddField(
            model_name="approvalnode",
            name="segment",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="nodes", to="workflow.workflowsegment",
            ),
        ),
        migrations.AddField(
            model_name="approvalnode",
            name="skip_kind",
            field=models.CharField(
                blank=True,
                choices=[("AT_PICK", "选站时跳过"), ("LATER", "中途跳过"), ("CANCELLED", "跨域审判取消")],
                max_length=12, null=True,
            ),
        ),
        migrations.AddField(
            model_name="approvalnode",
            name="skipped_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="approvalnode",
            name="skip_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="approvalnode",
            name="is_required",
            field=models.BooleanField(default=False),
        ),
    ]
