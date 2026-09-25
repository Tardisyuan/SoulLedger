"""Every template that exists before versioning becomes v1, PUBLISHED.

What this writes
----------------
One ``WorkflowTemplateVersion`` per ``WorkflowTemplate`` row — soft-deleted rows
included, because ``_base_manager`` is used and a restored template should come
back with a history — with ``number=1``, ``status=PUBLISHED``, and a copy of the
row's own ``nodes_json``. The template's ``published_version`` then points at it.

Why PUBLISHED and not DRAFT
---------------------------
Before this migration every saved template was live: ``_resolve_template`` read
``nodes_json`` directly. Filing those rows as drafts would silently take every
tenant's custom flow out of service on deploy — the next judgment would fall back
to ``WORKFLOW_TEMPLATES``. v1 PUBLISHED is the only reading under which nothing
that ran yesterday runs differently today.

``nodes_json`` is **not** written. It already is the published graph, and after
this migration it is equal to v1's copy by construction. That is also what makes
the reverse safe.

Empty templates
---------------
A row with ``nodes_json=[]`` still gets a v1 (with ``[]``). ``_resolve_template``
keeps excluding empty graphs, so this changes nothing at run time; it only means
"every template has a version" holds without an exception clause.

Idempotent
----------
A template that already has any version row is skipped, so re-running after a
partial failure (or after a fake-reverse) does not collide with
``uniq_wf_tmpl_version_number``.

Reverse
-------
Deletes every version row and clears ``published_version`` (``SET_NULL`` also
clears ``ApprovalWorkflow.template_version``). ``nodes_json`` still holds each
template's published graph, so the engine behaves exactly as before 0018. What a
reverse loses is only what cannot exist before 0018: unpublished drafts and the
superseded history. Say so before rolling back a database that has been edited
since.

PostgreSQL (reasoned; there is no PostgreSQL in the environment this was written in)
-----------------------------------------------------------------------------------
* Django runs this inside the migration's transaction; PostgreSQL has
  transactional DDL, so a failure here also rolls back 0018's table if they are
  applied in one ``migrate`` run — no half state.
* The partial unique indexes from 0018 are ordinary ``CREATE UNIQUE INDEX …
  WHERE status = 'DRAFT'`` on PostgreSQL. This migration writes exactly one
  PUBLISHED row per template and no DRAFT, so it cannot violate them.
* ``nodes_json`` is ``jsonb``; the copy goes through Python, so the stored value
  is re-serialised, not string-copied. Key order inside objects may differ from
  the source row (jsonb does not preserve it); nothing reads order of keys.
* No ``varchar`` is written except ``status`` (max 12, longest value 10).
"""
from django.db import migrations


def forwards(apps, schema_editor):
    WorkflowTemplate = apps.get_model("workflow", "WorkflowTemplate")
    Version = apps.get_model("workflow", "WorkflowTemplateVersion")
    db = schema_editor.connection.alias

    already = set(
        Version.objects.using(db).values_list("template_id", flat=True).distinct()
    )
    for template in WorkflowTemplate._base_manager.using(db).exclude(id__in=already):
        version = Version.objects.using(db).create(
            template_id=template.id,
            number=1,
            status="PUBLISHED",
            nodes_json=template.nodes_json if isinstance(template.nodes_json, list) else [],
            published_at=template.updated_at,
        )
        WorkflowTemplate._base_manager.using(db).filter(id=template.id).update(
            published_version_id=version.id
        )


def backwards(apps, schema_editor):
    WorkflowTemplate = apps.get_model("workflow", "WorkflowTemplate")
    ApprovalWorkflow = apps.get_model("workflow", "ApprovalWorkflow")
    Version = apps.get_model("workflow", "WorkflowTemplateVersion")
    db = schema_editor.connection.alias

    ApprovalWorkflow._base_manager.using(db).update(template_version_id=None)
    WorkflowTemplate._base_manager.using(db).update(published_version_id=None)
    Version.objects.using(db).all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0018_template_versions"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
