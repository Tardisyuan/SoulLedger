"""Template versions: the only writer of `WorkflowTemplateVersion` and of
`WorkflowTemplate.nodes_json` / `published_version`.

    save_draft(template, nodes)  -> the template's one DRAFT, created or overwritten
    publish(template)            -> DRAFT -> PUBLISHED; old PUBLISHED -> SUPERSEDED;
                                    template.nodes_json := the draft's graph
    working_nodes(template)      -> what the editor should open: the draft, else
                                    the published graph

Why the engine needs no change to honour this: `_resolve_template` reads
`nodes_json`, and only `publish` writes it. A draft is therefore invisible to
every workflow by construction.

Why a workflow in flight is unaffected by a publish: `_create_nodes` copies the
graph into `ApprovalNode` rows at creation and the engine never reads the
template again. `ApprovalWorkflow.template_version` records which version the
copy came from.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.workflow.models import (
    TemplateVersionStatus,
    WorkflowTemplate,
    WorkflowTemplateVersion,
)


class PublishRejectedError(Exception):
    """The draft fails validation (`apps/workflow/validation.py`); nothing was written."""

    def __init__(self, issues: list[dict]):
        super().__init__(f"{len(issues)} validation issue(s): {issues}")
        self.issues = issues


class NothingToPublishError(Exception):
    """The template has no draft. Publishing is always of a draft."""


def _versions(template: WorkflowTemplate):
    return WorkflowTemplateVersion.objects.filter(template=template)


def draft_of(template: WorkflowTemplate) -> WorkflowTemplateVersion | None:
    return _versions(template).filter(status=TemplateVersionStatus.DRAFT).first()


def working_nodes(template: WorkflowTemplate) -> list:
    """The graph the editor opens: the unpublished draft if there is one."""
    draft = draft_of(template)
    if draft is not None:
        return draft.nodes_json
    return template.nodes_json or []


def _adopt_unversioned(template: WorkflowTemplate) -> None:
    """A template with a live graph and no version row gets its v1 now.

    `0019_backfill_template_v1` did this for every row that existed at deploy.
    Rows written afterwards through the ORM (fixtures, `seed_workflow_templates`,
    a shell) can still arrive with `nodes_json` and no version; without this,
    their first draft would be numbered v1 and the graph that was actually
    running would have no entry in the history at all.
    """
    if template.published_version_id is not None or _versions(template).exists():
        return
    if not template.nodes_json:
        return
    v1 = WorkflowTemplateVersion.objects.create(
        template=template,
        number=1,
        status=TemplateVersionStatus.PUBLISHED,
        nodes_json=template.nodes_json,
        published_at=template.updated_at or timezone.now(),
    )
    WorkflowTemplate._base_manager.filter(pk=template.pk).update(published_version=v1)
    template.published_version = v1


def save_draft(template: WorkflowTemplate, nodes: list, user=None) -> WorkflowTemplateVersion:
    """Write `nodes` as the template's draft. Never touches the published graph.

    "Editing the published version creates a new draft" is this function when
    no draft exists: the new row is numbered one past the highest so far.
    """
    with transaction.atomic():
        # Serialise concurrent saves of one template on its row, so two first
        # saves cannot both compute the same `number`.
        WorkflowTemplate._base_manager.select_for_update().filter(pk=template.pk).first()
        _adopt_unversioned(template)
        draft = draft_of(template)
        if draft is None:
            top = _versions(template).aggregate(m=Max("number"))["m"] or 0
            draft = WorkflowTemplateVersion(template=template, number=top + 1)
        draft.nodes_json = list(nodes)
        draft.status = TemplateVersionStatus.DRAFT
        if user is not None and getattr(user, "is_authenticated", False):
            draft.saved_by = user
        draft.save()
    return draft


def publish(template: WorkflowTemplate, user=None) -> WorkflowTemplateVersion:
    """Make the draft the active version, or refuse and change nothing."""
    from apps.workflow.validation import validate_template_nodes

    with transaction.atomic():
        locked = WorkflowTemplate._base_manager.select_for_update().get(pk=template.pk)
        draft = draft_of(locked)
        if draft is None:
            raise NothingToPublishError()
        issues = validate_template_nodes(draft.nodes_json)
        if issues:
            raise PublishRejectedError(issues)

        _versions(locked).filter(status=TemplateVersionStatus.PUBLISHED).update(
            status=TemplateVersionStatus.SUPERSEDED
        )
        draft.status = TemplateVersionStatus.PUBLISHED
        draft.published_at = timezone.now()
        if user is not None and getattr(user, "is_authenticated", False):
            draft.published_by = user
        draft.save()

        locked.nodes_json = draft.nodes_json
        locked.published_version = draft
        locked.save(update_fields=["nodes_json", "published_version", "updated_at"])

    template.refresh_from_db()
    return draft
