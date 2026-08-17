"""A template may say how urgent the procedure it describes is.

The gap
-------
`ApprovalWorkflow.priority` (0=normal, 1=urgent, 2=critical) has always existed
and has always been *instance*-level: whoever creates a workflow passes it, and
nothing else can. So 「this procedure is for urgent cases」 was not expressible
at all — which is why the three 「紧急审判流程」 presets in
`frontend/src/config/workflow-templates.ts` once wrote it into `caseType` as
`"EMERGENCY"`, a `CaseType` member that does not exist, and answered 400 on
every save. `a77a41e` filed them under real case types and left the urgency
homeless. `WorkflowTemplate.priority` is the home.

What this file holds
--------------------
1. **The value survives the round trip through the API.** A template POSTed
   with `priority: 1` must come back as 1 rather than being silently dropped to
   0 — DRF discards keys the serializer does not declare *without complaining*,
   so the failure mode here is a 201 whose payload was thrown away. Read back
   off the row, not off the response.
2. **A workflow built from that template inherits it**, through
   `create_from_judgment` and through the endpoint.
3. **An explicit instance-level priority still wins**, including an explicit
   `0` — which is the case that forced `priority` to become `int | None`. With
   the old `priority: int = 0` signature, "the caller asked for normal" and
   "the caller said nothing" were the same value, so exactly one of the two
   could be honoured and the other would be silently overridden.
4. **The migration table and the presets agree** about which templates are the
   urgent ones.
5. **`0014` round-trips** — forward, reverse, forward, compared as data.

Why a real JWT and not `force_authenticate`
-------------------------------------------
Same reason as `tests/test_workflow_preset_node_types.py::_bearer`:
`force_authenticate` leaves `request.tenant` unset, the created row lands with
`tenant=NULL`, and `_resolve_template`'s tenant filter then skips it — so the
workflow would be built from the hardcoded table and the case would pass while
measuring nothing about the template it just saved.

What "would really fail" means here
-----------------------------------
Every assertion was checked by breaking it; the mutations and their output are
in the task report. Removing `"priority"` from `WorkflowTemplateSerializer`
reddens the round-trip and inheritance cases; putting `.get("priority", 0)`
back in `views.py` reddens the endpoint-inheritance case; making
`_resolve_priority` prefer the template over an explicit value reddens the
override case.
"""
import io
from importlib import import_module

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import CaseType, WorkflowTemplate
from apps.workflow.services import WorkflowService

TEMPLATES = "/api/v1/workflow/templates"
WORKFLOWS = "/api/v1/workflows"

MIGRATION = "apps.workflow.migrations.0014_backfill_emergency_template_priority"

#: `(name, civilization, case_type)` — imported from the migration rather than
#: restated, so this file cannot pass by agreeing with a copy of a table the
#: migration no longer uses. (`import_module` because the module name starts
#: with a digit.)
EMERGENCY_TEMPLATES = import_module(MIGRATION).EMERGENCY_TEMPLATES

#: One saved node, in the shape the serializer accepts. Enough for
#: `_resolve_template` to prefer this template over the hardcoded one — an
#: empty `nodes_json` is deliberately ignored there.
NODES = [{
    "id": "n1", "node_name": "紧急受理", "node_type": "APPEAL",
    "court_code": "酆都", "approver_role": "", "approver_type": "ROLE",
    "node_order": 1,
}]


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization: str) -> Tenant:
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


def _bearer(user) -> dict:
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


def _admin(tenant, username):
    return User.objects.create_user(
        username=username, password="x", role="ADMIN", tenant=tenant
    )


def _judgment(civilization, tenant, name):
    soul = Soul.objects.create(name=name, tenant=tenant)
    return Judgment.objects.create(
        soul=soul, civilization=civilization, court="—",
        verdict="PASSED", is_final=True, tenant=tenant,
    )


def _post_template(client, *, priority, case_type=CaseType.SPECIAL):
    return client.post(
        f"{TEMPLATES}/",
        {
            "name": "紧急审判流程",
            "description": "特殊紧急案件直达酆都",
            "civilization": Civilization.CHINESE,
            "case_type": case_type,
            "priority": priority,
            "is_active": True,
            "nodes": NODES,
        },
        format="json",
    )


# ── the value survives the API ────────────────────────────────────────


@pytest.mark.django_db
def test_a_template_posted_as_urgent_is_stored_as_urgent(seeded):
    """THE regression: the field must not be silently discarded.

    Asserted against the stored row rather than the response body, because a
    serializer that dropped the key would answer 201 with the *model default*
    echoed back for it — the response is not independent evidence.
    """
    tenant = _tenant(Civilization.CHINESE)
    client = APIClient(**_bearer(_admin(tenant, "prio_post_admin")))

    response = _post_template(client, priority=1)

    assert response.status_code == 201, response.data
    stored = WorkflowTemplate.all_objects.get(pk=response.data["id"])
    assert stored.priority == 1, (
        "the template was accepted and stored at priority "
        f"{stored.priority} — the field was dropped between the request and "
        "the row. Check that 'priority' is in WorkflowTemplateSerializer.Meta."
    )
    assert stored.tenant_id == tenant.id
    # Absence: the value came from the request, not from a default that happens
    # to be right. A second template posted without the key stays at 0.
    silent = client.post(
        f"{TEMPLATES}/",
        {"name": "常规", "civilization": Civilization.CHINESE,
         "case_type": CaseType.ROUTINE, "nodes": NODES},
        format="json",
    )
    assert silent.status_code == 201, silent.data
    assert WorkflowTemplate.all_objects.get(pk=silent.data["id"]).priority == 0


@pytest.mark.django_db
def test_the_stored_priority_is_readable_back_through_both_serializers(seeded):
    """Detail *and* list. The list screen is where a template is picked."""
    tenant = _tenant(Civilization.CHINESE)
    client = APIClient(**_bearer(_admin(tenant, "prio_read_admin")))
    created = _post_template(client, priority=2)

    detail = client.get(f"{TEMPLATES}/{created.data['id']}/")
    assert detail.status_code == 200
    assert detail.data["priority"] == 2

    listed = client.get(f"{TEMPLATES}/")
    assert listed.status_code == 200
    rows = {str(row["id"]): row for row in listed.data}
    assert rows[str(created.data["id"])]["priority"] == 2


# ── a workflow built from it inherits it ──────────────────────────────


@pytest.mark.django_db
def test_a_workflow_built_from_an_urgent_template_is_urgent(seeded):
    """The point of the column: the default reaches the instance."""
    tenant = _tenant(Civilization.CHINESE)
    client = APIClient(**_bearer(_admin(tenant, "prio_build_admin")))
    _post_template(client, priority=1)

    judgment = _judgment(Civilization.CHINESE, tenant, "急件魂")
    workflow = WorkflowService.create_from_judgment(
        judgment, case_type=CaseType.SPECIAL
    )

    assert workflow.workflow_name == "紧急审判流程", (
        "the stored template was not the one used, so this case would be "
        "measuring the hardcoded table's priority instead"
    )
    assert workflow.priority == 1


@pytest.mark.django_db
def test_the_endpoint_lets_the_template_decide_when_no_priority_is_sent(seeded):
    """`views.create_from_judgment` must not turn silence into an explicit 0.

    This is the case `request.data.get("priority", 0)` broke: the default made
    every request that omitted the field look like a caller asking for normal,
    which outranks the template — so the column would have had no effect at all
    through the only endpoint that creates workflows.
    """
    tenant = _tenant(Civilization.CHINESE)
    client = APIClient(**_bearer(_admin(tenant, "prio_endpoint_admin")))
    _post_template(client, priority=2)
    judgment = _judgment(Civilization.CHINESE, tenant, "端到端急件魂")

    response = client.post(
        f"{WORKFLOWS}/create_from_judgment/",
        {"judgment_id": str(judgment.id), "case_type": CaseType.SPECIAL},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["priority"] == 2, response.data


@pytest.mark.django_db
def test_an_explicit_priority_outranks_the_template(seeded):
    """Instance-level beats template-level — including an explicit 0.

    The `0` half is the whole reason the parameter is `int | None`: it is the
    value the old signature could not tell from silence.
    """
    tenant = _tenant(Civilization.CHINESE)
    client = APIClient(**_bearer(_admin(tenant, "prio_override_admin")))
    _post_template(client, priority=1)

    louder = WorkflowService.create_from_judgment(
        _judgment(Civilization.CHINESE, tenant, "更急的魂"),
        case_type=CaseType.SPECIAL, priority=2,
    )
    assert louder.priority == 2

    quieter = WorkflowService.create_from_judgment(
        _judgment(Civilization.CHINESE, tenant, "其实不急的魂"),
        case_type=CaseType.SPECIAL, priority=0,
    )
    assert quieter.priority == 0, (
        "an explicitly requested 0 was overridden by the template's 1. That is "
        "the case `priority: int = 0` could not express, and honouring the "
        "template here would mean no caller can ever ask for normal."
    )

    # …and over HTTP, where a sent 0 must survive the same distinction.
    response = APIClient(**_bearer(_admin(tenant, "prio_zero_admin"))).post(
        f"{WORKFLOWS}/create_from_judgment/",
        {
            "judgment_id": str(_judgment(Civilization.CHINESE, tenant, "HTTP 普通魂").id),
            "case_type": CaseType.SPECIAL,
            "priority": 0,
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    assert response.data["priority"] == 0, response.data


@pytest.mark.django_db
def test_a_template_that_says_nothing_leaves_the_entry_point_s_floor(seeded):
    """No stored template, no explicit value: 0 for a judgment, 1 for an appeal.

    The appeal floor is not new — `create_appeal_workflow` has always defaulted
    to 1 — and it is asserted here so that widening the parameter to
    `int | None` cannot have quietly moved it to 0 for every appeal.
    """
    tenant = _tenant(Civilization.CHINESE)
    judgment = _judgment(Civilization.CHINESE, tenant, "无模板魂")
    assert WorkflowService.create_from_judgment(judgment).priority == 0

    # Built without a judgment: `ApprovalWorkflow.judgment` is a OneToOne, so
    # an appeal cannot be chained onto a workflow that has one.
    from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

    original = ApprovalWorkflow.objects.create(
        soul=Soul.objects.create(name="被驳回的魂", tenant=tenant),
        workflow_name="原流程", case_type=CaseType.ROUTINE,
        status=ApprovalWorkflowStatus.REJECTED, tenant=tenant,
    )
    assert WorkflowService.create_appeal_workflow(original).priority == 1


# ── the migration table against the presets ───────────────────────────


def test_the_migration_backfills_exactly_the_presets_marked_urgent():
    """`0014` and `workflow-templates.ts` must name the same three templates.

    The migration freezes its own copy of the signatures, deliberately — a
    migration records what was true when it ran and the presets are live code.
    Two copies with no comparison between them is how this repository's
    milestone numbering ended up in five conflicting places, so the comparison
    is here.

    The presets are read as text: pytest has no TypeScript toolchain (same
    reason as `tests/test_workflow_template_cast.py`). A parse that finds
    nothing raises rather than comparing two empty sets.
    """
    import re
    from pathlib import Path

    presets_ts = (
        Path(__file__).resolve().parents[2]
        / "frontend" / "src" / "config" / "workflow-templates.ts"
    )
    source = presets_ts.read_text(encoding="utf-8")

    #: One preset block: `  KEY: {` … up to the next one.
    starts = [(m.group(1), m.start()) for m in
              re.finditer(r'^  ([A-Z][A-Z_]*): \{$', source, re.MULTILINE)]
    assert starts, (
        f"no preset headers found in {presets_ts.name}; the presets are parsed "
        f"as text and have to stay one key per line at two-space indent"
    )

    bounds = [s for _, s in starts] + [len(source)]
    marked = set()
    seen_priorities = 0
    for index, (key, _) in enumerate(starts):
        block = source[bounds[index]:bounds[index + 1]]
        fields = dict(re.findall(
            r'^    (civilization|caseType|name): "([^"]*)",$', block, re.MULTILINE
        ))
        priority = re.search(r'^    priority: (\d+),$', block, re.MULTILINE)
        assert priority is not None, (
            f"preset {key} has no `priority:` line. The field is required on "
            f"the WorkflowTemplate interface precisely so that a new preset "
            f"cannot become a normal-priority one by omission."
        )
        seen_priorities += 1
        if int(priority.group(1)) != 0:
            marked.add((fields["name"], fields["civilization"], fields["caseType"]))

    assert seen_priorities == len(starts) == 17, (
        f"parsed {seen_priorities} priorities across {len(starts)} presets"
    )
    assert marked == {tuple(row) for row in EMERGENCY_TEMPLATES}, (
        f"the presets marked urgent and 0014's backfill table disagree.\n"
        f"  only in the presets:   {sorted(marked - {tuple(r) for r in EMERGENCY_TEMPLATES})}\n"
        f"  only in the migration: {sorted({tuple(r) for r in EMERGENCY_TEMPLATES} - marked)}"
    )


# ── the migration itself ──────────────────────────────────────────────


@pytest.mark.django_db
def test_the_migration_writes_nothing_to_an_empty_database(db):
    """The guard every data migration in this repo carries."""
    from django.apps import apps

    clear_current_tenant()
    assert WorkflowTemplate.all_objects.count() == 0
    import_module(MIGRATION).forwards(apps, None)
    assert WorkflowTemplate.all_objects.count() == 0


@pytest.mark.django_db
def test_the_migration_leaves_a_template_somebody_already_decided_alone(db):
    """`priority=0` is part of the signature, on purpose.

    A 「紧急审判流程」 already sitting at 2 is somebody's decision; the backfill
    exists to fill in silence, not to overwrite an answer.
    """
    from django.apps import apps

    clear_current_tenant()
    tenant = Tenant.objects.create(code="PRIO_T1", display_name="Priority")
    decided = WorkflowTemplate.objects.create(
        name="紧急审判流程", civilization=Civilization.CHINESE,
        case_type=CaseType.SPECIAL, priority=2, tenant=tenant, nodes_json=NODES,
    )
    unrelated = WorkflowTemplate.objects.create(
        # Same name, different case type — not one of the three signatures.
        name="紧急审判流程", civilization=Civilization.CHINESE,
        case_type=CaseType.ROUTINE, priority=0, tenant=tenant, nodes_json=NODES,
    )

    import_module(MIGRATION).forwards(apps, None)

    decided.refresh_from_db()
    unrelated.refresh_from_db()
    assert decided.priority == 2
    assert unrelated.priority == 0, (
        "a template matching only on name was swept in; the signature is "
        "(name, civilization, case_type)"
    )


def test_workflow_0014_round_trip(migration_round_trip):
    """forward -> reverse -> forward through real `migrate`, compared as rows.

    See `tests/migration_roundtrip.py` for why "the reverse ran" is not the
    assertion that matters.

    `before` is `0013`, the AddField — so the column exists at both ends of the
    trip and the snapshot can read it in either state. `0013` itself has no
    data half to round-trip (see its docstring); this is the migration that
    decides values.
    """
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        template_model = state.get_model("workflow", "WorkflowTemplate")

        tenant = tenant_model._base_manager.create(
            code="PRIO_RT", display_name="Priority round trip"
        )
        for name, civilization, case_type in EMERGENCY_TEMPLATES:
            template_model._base_manager.create(
                name=name, civilization=civilization, case_type=case_type,
                priority=0, tenant=tenant, nodes_json=NODES,
            )
        # Two rows the migration must not touch: a template already decided at
        # 2, and one whose case type is not in the table.
        template_model._base_manager.create(
            name="紧急审判流程", civilization="CHINESE", case_type="SPECIAL",
            priority=2, tenant=tenant, nodes_json=NODES,
        )
        template_model._base_manager.create(
            name="十殿审判流程", civilization="CHINESE", case_type="ROUTINE",
            priority=0, tenant=tenant, nodes_json=NODES,
        )

    def snapshot(state):
        template_model = state.get_model("workflow", "WorkflowTemplate")
        return snapshot_rows(
            template_model._base_manager.all(),
            # Keyed on the primary key, not on the columns being compared: a
            # key containing `priority` would make a changed value read as one
            # row vanishing and another appearing, instead of as the field
            # difference it is.
            key=lambda t: str(t.id),
            fields={
                "priority": "priority",
                "name": "name",
                "civilization": "civilization",
                "case_type": "case_type",
            },
            prefix="template:",
        )

    def check_forward(state):
        template_model = state.get_model("workflow", "WorkflowTemplate")
        for name, civilization, case_type in EMERGENCY_TEMPLATES:
            rows = template_model._base_manager.filter(
                name=name, civilization=civilization, case_type=case_type
            ).exclude(priority=2)
            assert [row.priority for row in rows] == [1], (
                f"{civilization}/{case_type} is at "
                f"{[row.priority for row in rows]} after the forward pass"
            )
        assert template_model._base_manager.filter(
            name="十殿审判流程", priority=0
        ).count() == 1, "a template outside the table was backfilled"
        assert template_model._base_manager.filter(priority=2).count() == 1, (
            "the already-decided template was overwritten"
        )

    def check_reverse(state):
        template_model = state.get_model("workflow", "WorkflowTemplate")
        assert template_model._base_manager.filter(priority=1).count() == 0, (
            "the reverse left rows at 1"
        )

    migration_round_trip(
        before=("workflow", "0013_add_workflow_template_priority"),
        after=("workflow", "0014_backfill_emergency_template_priority"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
