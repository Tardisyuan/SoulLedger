"""Template versions: save writes a draft, publish makes it live, and a workflow
already running keeps the version it started on.

The property worth the most here is the in-flight one, and it holds
*structurally*: `_create_nodes` copies the graph into `ApprovalNode` rows and the
engine never reads the template again. The test below is therefore written
against the defect it guards — a publish that reaches into a running workflow —
and was mutation-proved by adding exactly that (a publish hook that rebuilt the
pending nodes of in-flight workflows from the new version): it went red on the
node names and on `template_version`.
"""
import pytest

from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.workflow import versioning
from apps.workflow.models import (
    ApprovalWorkflowStatus,
    TemplateVersionStatus,
    WorkflowTemplate,
    WorkflowTemplateVersion,
)
from apps.workflow.services import WorkflowService

TEMPLATES = "/api/v1/workflow/templates"


def _nodes(*names):
    return [
        {
            "id": f"n{i}", "node_name": name, "node_type": "TRIAL",
            "court_code": "", "approver_type": "ROLE", "approver_role": "JUDGE",
            "node_order": i,
        }
        for i, name in enumerate(names, start=1)
    ]


def _judgment(tenant, name="魂"):
    soul = Soul.objects.create(name=name, tenant=tenant)
    return Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="—",
        verdict="PASSED", is_final=True, tenant=tenant,
    )


def _template(client, nodes, **extra):
    body = {"name": "版本测试", "civilization": "CHINESE", "case_type": "ROUTINE", "nodes": nodes}
    body.update(extra)
    res = client.post(f"{TEMPLATES}/", body, format="json")
    assert res.status_code == 201, res.data
    return WorkflowTemplate._base_manager.get(pk=res.data["id"]), res


def _login(api_client, user):
    """A real bearer token carrying the tenant, as the frontend sends it.

    `force_authenticate` leaves `request.tenant` unset, and then
    `TenantCreateMixin` writes the template with `tenant=NULL` — a row
    `_resolve_template` (scoped to the judgment's tenant) never finds.
    """
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.fixture
def client(api_client, admin_user):
    return _login(api_client, admin_user)


# ── save writes a draft ────────────────────────────────────────────────


@pytest.mark.django_db
def test_a_saved_template_is_a_draft_and_no_workflow_runs_on_it(client, cn_tenant):
    template, res = _template(client, _nodes("草稿甲", "草稿乙"))

    assert res.data["draft_version"] == 1
    assert res.data["published_version"] is None
    assert [n["node_name"] for n in res.data["nodes"]] == ["草稿甲", "草稿乙"]
    # The engine's column is untouched: absence, not only presence.
    assert template.nodes_json == []
    assert template.published_version_id is None

    workflow = WorkflowService.create_from_judgment(_judgment(cn_tenant))
    names = list(workflow.nodes.values_list("node_name", flat=True))
    assert "草稿甲" not in names and "草稿乙" not in names
    assert workflow.template_version_id is None


@pytest.mark.django_db
def test_publish_makes_the_draft_live(client, cn_tenant):
    template, _ = _template(client, _nodes("甲", "乙"))

    res = client.post(f"{TEMPLATES}/{template.id}/publish/")
    assert res.status_code == 200, res.data
    assert res.data["published_version"] == 1
    assert res.data["draft_version"] is None

    template.refresh_from_db()
    v1 = template.published_version
    assert v1.number == 1 and v1.status == TemplateVersionStatus.PUBLISHED
    assert template.nodes_json == v1.nodes_json
    assert v1.published_by is not None

    workflow = WorkflowService.create_from_judgment(_judgment(cn_tenant))
    assert list(workflow.nodes.order_by("node_order").values_list("node_name", flat=True)) == ["甲", "乙"]
    assert workflow.template_version_id == v1.id


@pytest.mark.django_db
def test_editing_the_published_version_creates_a_new_draft(client, cn_tenant):
    template, _ = _template(client, _nodes("甲"))
    client.post(f"{TEMPLATES}/{template.id}/publish/")

    res = client.patch(f"{TEMPLATES}/{template.id}/", {"nodes": _nodes("甲改")}, format="json")
    assert res.status_code == 200
    assert res.data["draft_version"] == 2
    assert res.data["published_version"] == 1
    # The working copy is the draft; the live graph is still v1's.
    assert [n["node_name"] for n in res.data["nodes"]] == ["甲改"]
    template.refresh_from_db()
    assert [n["node_name"] for n in template.nodes_json] == ["甲"]

    # A second save overwrites the same draft rather than numbering a v3.
    client.patch(f"{TEMPLATES}/{template.id}/", {"nodes": _nodes("甲再改")}, format="json")
    assert template.versions.count() == 2

    client.post(f"{TEMPLATES}/{template.id}/publish/")
    statuses = dict(template.versions.values_list("number", "status"))
    assert statuses == {1: TemplateVersionStatus.SUPERSEDED, 2: TemplateVersionStatus.PUBLISHED}


@pytest.mark.django_db
def test_metadata_edits_without_nodes_do_not_make_a_draft(client):
    template, _ = _template(client, _nodes("甲"))
    client.post(f"{TEMPLATES}/{template.id}/publish/")
    res = client.patch(f"{TEMPLATES}/{template.id}/", {"name": "改名"}, format="json")
    assert res.status_code == 200
    assert res.data["draft_version"] is None
    assert template.versions.count() == 1


# ── in flight ─────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_in_flight_workflow_finishes_on_its_own_version(client, cn_tenant):
    """Publish v2 while a v1 workflow is mid-flight; v1 finishes on v1's nodes."""
    template, _ = _template(client, _nodes("一审", "二审", "三审"))
    client.post(f"{TEMPLATES}/{template.id}/publish/")
    v1 = WorkflowTemplate._base_manager.get(pk=template.pk).published_version

    running = WorkflowService.create_from_judgment(_judgment(cn_tenant, "先来的"))
    first = running.nodes.get(node_order=1)
    assert running.complete_node(first.id, "PASSED")

    # v2: different names, different length.
    client.patch(f"{TEMPLATES}/{template.id}/", {"nodes": _nodes("新一", "新二")}, format="json")
    assert client.post(f"{TEMPLATES}/{template.id}/publish/").status_code == 200

    running.refresh_from_db()
    for order in (2, 3):
        node = running.nodes.get(node_order=order)
        assert running.complete_node(node.id, "PASSED")
        running.refresh_from_db()

    assert running.status == ApprovalWorkflowStatus.COMPLETED
    names = list(running.nodes.order_by("node_order").values_list("node_name", flat=True))
    assert names == ["一审", "二审", "三审"]
    assert "新一" not in names
    assert running.template_version_id == v1.id

    later = WorkflowService.create_from_judgment(_judgment(cn_tenant, "后来的"))
    assert list(later.nodes.order_by("node_order").values_list("node_name", flat=True)) == ["新一", "新二"]
    assert later.template_version.number == 2


# ── refusals ──────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_publish_without_a_draft_is_refused(client):
    template, _ = _template(client, _nodes("甲"))
    client.post(f"{TEMPLATES}/{template.id}/publish/")
    res = client.post(f"{TEMPLATES}/{template.id}/publish/")
    assert res.status_code == 400
    assert res.data["error"] == "no_draft"


@pytest.mark.django_db
def test_an_invalid_draft_is_not_published_and_nothing_changes(client):
    template, _ = _template(client, _nodes("甲"))
    client.post(f"{TEMPLATES}/{template.id}/publish/")
    bad = _nodes("好", "坏")
    bad[1]["on_pass"] = "n2"  # routes to itself
    client.patch(f"{TEMPLATES}/{template.id}/", {"nodes": bad}, format="json")

    res = client.post(f"{TEMPLATES}/{template.id}/publish/")
    assert res.status_code == 400
    assert res.data["error"] == "invalid_draft"
    assert {"node": "n2", "code": "self_route", "field": "on_pass"} in res.data["issues"]

    template.refresh_from_db()
    assert [n["node_name"] for n in template.nodes_json] == ["甲"]
    assert template.published_version.number == 1
    assert versioning.draft_of(template).number == 2


@pytest.mark.django_db
def test_a_viewer_cannot_publish(api_client, admin_user, viewer_user):
    template, _ = _template(_login(api_client, admin_user), _nodes("甲"))
    _login(api_client, viewer_user)
    assert api_client.post(f"{TEMPLATES}/{template.id}/publish/").status_code == 403
    template.refresh_from_db()
    assert template.published_version_id is None


# ── history ───────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_version_history_is_listed_newest_first_and_is_read_only(client):
    template, _ = _template(client, _nodes("甲"))
    client.post(f"{TEMPLATES}/{template.id}/publish/")
    client.patch(f"{TEMPLATES}/{template.id}/", {"nodes": _nodes("乙")}, format="json")

    res = client.get(f"{TEMPLATES}/{template.id}/versions/")
    assert res.status_code == 200
    assert [(v["number"], v["status"]) for v in res.data] == [(2, "DRAFT"), (1, "PUBLISHED")]
    assert res.data[1]["nodes"][0]["node_name"] == "甲"

    for method in ("post", "put", "patch", "delete"):
        assert getattr(client, method)(f"{TEMPLATES}/{template.id}/versions/").status_code == 405


@pytest.mark.django_db
def test_a_template_written_without_a_version_is_adopted_as_v1(cn_tenant):
    """ORM-written rows (fixtures, the seeder) still get their live graph into
    the history before the first draft is numbered."""
    template = WorkflowTemplate.objects.create(
        name="旧行", civilization="CHINESE", case_type="ROUTINE",
        tenant=cn_tenant, nodes_json=_nodes("旧"),
    )
    draft = versioning.save_draft(template, _nodes("新"))
    assert draft.number == 2
    template.refresh_from_db()
    assert template.published_version.number == 1
    assert template.published_version.nodes_json[0]["node_name"] == "旧"


@pytest.mark.django_db
def test_at_most_one_draft_per_template_is_a_database_rule(cn_tenant):
    from django.db import IntegrityError, transaction

    template = WorkflowTemplate.objects.create(
        name="约束", civilization="CHINESE", case_type="ROUTINE", tenant=cn_tenant,
    )
    WorkflowTemplateVersion.objects.create(template=template, number=1, status="DRAFT")
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowTemplateVersion.objects.create(template=template, number=2, status="DRAFT")


# ── the data migration ────────────────────────────────────────────────


def test_workflow_0019_round_trip(migration_round_trip):
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        template_model = state.get_model("workflow", "WorkflowTemplate")
        tenant = tenant_model._base_manager.create(code="VER_RT", display_name="Version RT")
        template_model._base_manager.create(
            name="有节点", civilization="CHINESE", case_type="ROUTINE",
            tenant=tenant, nodes_json=_nodes("甲", "乙"),
        )
        template_model._base_manager.create(
            name="空模板", civilization="CHINESE", case_type="SPECIAL",
            tenant=tenant, nodes_json=[],
        )
        template_model._base_manager.create(
            name="已删除", civilization="EUROPEAN", case_type="ROUTINE",
            tenant=tenant, nodes_json=_nodes("丙"), is_deleted=True,
        )

    def snapshot(state):
        template_model = state.get_model("workflow", "WorkflowTemplate")
        version_model = state.get_model("workflow", "WorkflowTemplateVersion")

        def versions(t):
            return sorted(
                (v.number, v.status, [n["node_name"] for n in v.nodes_json])
                for v in version_model.objects.filter(template_id=t.id)
            )

        return snapshot_rows(
            template_model._base_manager.all(),
            key="name",
            fields={
                "nodes": lambda t: [n.get("node_name") for n in t.nodes_json],
                "published": lambda t: (
                    version_model.objects.get(id=t.published_version_id).number
                    if t.published_version_id else None
                ),
                "versions": versions,
            },
        )

    def check_forward(state):
        template_model = state.get_model("workflow", "WorkflowTemplate")
        version_model = state.get_model("workflow", "WorkflowTemplateVersion")
        for t in template_model._base_manager.all():
            v = version_model.objects.get(id=t.published_version_id)
            assert (v.number, v.status) == (1, "PUBLISHED")
            assert v.nodes_json == t.nodes_json

    def check_reverse(state):
        version_model = state.get_model("workflow", "WorkflowTemplateVersion")
        assert version_model.objects.count() == 0

    migration_round_trip(
        before=("workflow", "0018_template_versions"),
        after=("workflow", "0019_backfill_template_v1"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


@pytest.mark.django_db
def test_users_are_named_not_numbered_in_history(client, admin_user):
    template, _ = _template(client, _nodes("甲"))
    client.post(f"{TEMPLATES}/{template.id}/publish/")
    row = client.get(f"{TEMPLATES}/{template.id}/versions/").data[0]
    assert row["published_by_name"] in {admin_user.display_name, admin_user.username}

