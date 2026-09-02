"""
Workflow service — creates ApprovalWorkflow instances from judgment verdicts.
Routes to civilization-specific approval templates.
"""
import logging

from django.db import DatabaseError, transaction

from apps.judgment.models import Judgment
from apps.souls.models import Civilization
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    CaseType,
    NodeStatus,
    NodeType,
    WorkflowTemplate,
)
from apps.workflow.node_shape import normalize_template_node

logger = logging.getLogger(__name__)


# 模板表住在 `apps/workflow/templates.py`,这里重导出。
#
# 它们本来就在这个文件里,占了前 461 行 —— 而这个文件是 1125 行,是仓库里最大的
# 生产文件。拆走的是数据,留下的是逻辑;两者的改动理由不同(加一个文明要动表,
# 改审批人解析要动类)。
#
# **重导出是为了不动 64 处 import**,不是说表住在这里。要改表请去 templates.py。
from apps.workflow.templates import (  # noqa: F401
    NODE_LABEL_SEPARATOR,
    PRESET_NODES_THAT_NAME_NO_ACTOR,
    TEMPLATE_NODES_WITHOUT_AN_APPROVER,
    VALID_CASE_TYPES_BY_CIVILIZATION,
    WORKFLOW_TEMPLATES,
    _designates_nobody,
    _named_person,
)


class WorkflowService:
    """
    Creates approval workflow instances from concluded judgments.
    Routes to civilization-specific templates.
    """

    @classmethod
    def _resolve_approver(cls, node_def: dict, civilization: str, tenant_id) -> dict:
        """Turn the person a template node names into approver columns.

        Returns the kwargs ``ApprovalNode.objects.create`` should get:
        ``{"approver_type": "ACTOR", "approver_actor": <Actor>}`` when the named
        actor is on this tenant's bench, and ``{"approver_type": "SYSTEM"}``
        otherwise.

        Or ``{"approver_type": "ROLE", "approver_role": …}`` when the node
        names no person but *does* carry a role somebody typed into the editor —
        see "the role a node carries" below.

        **The node is normalized first** (``normalize_template_node``), so this
        reads one spelling whichever the caller holds — a raw
        ``WORKFLOW_TEMPLATES`` entry, a row the API serializer wrote, or an
        already-normalized dict from the loops below. It matters most here:
        reading the label is what makes preset-built nodes approvable at all
        (below), and reading it under a key half the rows lack would re-break
        that in silence, because every test of it in
        ``tests/test_workflow_preset_approvers.py`` hands this the other shape.

        **The name comes from the ``actor`` key, or failing that from the node's
        own label.** The second half is not a convenience either: nodes built
        from a *preset* have no ``actor`` key at all — ``workflow-templates.ts``
        writes ``name/court/type/order``, /workflow saves that as
        ``WorkflowTemplate.nodes_json``, and ``create_from_judgment`` prefers a
        stored template over ``WORKFLOW_TEMPLATES``. Reading only the ``actor``
        key therefore made *every* preset-built node ``SYSTEM``, and since
        ``7fe9a28`` a ``SYSTEM`` node can be decided by nobody: a workflow
        created from a preset was stuck from birth, while its labels named
        Christ and Michael, both of whom the cast supplies. Measured in
        ``e7e87e7``::

            1.'Christ · 私审判' SYSTEM None   2.'Michael · 引领入光' SYSTEM None
            3.'Christ · 公审判' SYSTEM None

        The label is probed the way ``tests/test_workflow_template_cast.py``
        probes it — the part before 「 · 」, or the whole string when there is no
        separator (see ``_named_person``). That file asserts that every preset
        node names somebody the cast can supply; the assertion is only worth
        something if this resolves the same substring, so the two probes are
        compared in ``tests/test_workflow_preset_approvers.py`` instead of being
        written the same way twice and hoped over.

        **A node recorded as naming nobody is not probed at all**, whichever of
        the two tables records it (see ``_designates_nobody``). 「四十二神官 ·
        否定告白」 is a forty-two-member bench and 「十殿联审」 is ten kings
        sitting jointly; ``approver_actor`` is a single FK, so resolving either
        would file a joint session as one being's decision — a quieter and worse
        error than the stuck flow this fallback fixes. The exclusion is checked
        against an ``Actor`` deliberately created to answer to an excused label,
        so it is a rule rather than an accident of who is currently seeded.

        Falling back to ``SYSTEM`` is the fail-closed direction, not a
        convenience: since ``can_approve`` became ``approve_node``'s only gate,
        a ``SYSTEM`` node cannot be decided by anyone and has to go through the
        audited ``escalate``. The alternative — creating the node as ``ACTOR``
        with ``approver_actor=NULL`` — looks like it designates someone and
        designates no one, which is the exact shape the guard was written to
        refuse.

        Lookup is over every name the cast records, scoped to the workflow's own
        tenant and civilization: the four name columns first, then the aliases
        on ``powers_json["aliases"]`` — see
        ``apps/actors/models.py::resolve_actor_by_any_name``. The columns have
        to be plural because the cast is spelled two ways: the Chinese kings'
        ``name`` is the Chinese (秦广王) while the Egyptian gods' is the English
        (``Osiris``), with the Chinese in ``name_zh``.

        The alias pass is the part that is *recorded* rather than lucky. Until
        ``EGYPTIAN_ACTOR_ALIASES`` existed, a template naming 「欧西里斯」 —
        which is what the heart-weighing template calls itself, while the seeder
        spells the same god 「奥西里斯」 — resolved to nobody, and the reason the
        node worked at all was that the ``actor`` key beside it happened to say
        ``"Osiris"``. That correspondence was an inference living in a comment.
        It is now a row in the database, and this is what reads it.

        The alias pass runs in Python, not as a ``powers_json`` lookup. JSON
        containment lookups are backend-specific (they are unsupported on
        SQLite, which is what the test suite runs on), and the candidate set is
        one civilization's cast for one tenant — tens of rows. ``seeding.py``
        makes the same choice for ``assessor_index`` and says the same thing.

        The tenant scope matters because ``Actor.name`` is not globally unique —
        it is unique per ``(name, civilization)`` per tenant, and an unscoped
        ``.get()`` would raise MultipleObjectsReturned the first time two
        tenants seed the same pantheon.

        **The role a node carries is the last thing tried, not the first.**
        A node saved from /workflow can set ``approver_type="ROLE"`` with an
        ``approver_role`` — and a non-empty ``approver_role`` is one of exactly
        two things ``designates_approver`` accepts, so discarding it would hand
        the user back the un-approvable node ``e7e87e7`` measured, arriving
        through a different key. It is tried *after* the name because naming a
        person is the more specific designation and because ``"ROLE"`` is what
        ``WorkflowEditor.getTemplateNodes`` defaults **every** node to
        (``approver_type ?? "ROLE"``, ``approver_role`` usually ``""``) — an
        empty role is a default, not a decision, and honouring the default
        ahead of the label would have unpicked ``625f4d1`` for every template
        the editor has ever saved. An empty role designates nobody, so it falls
        through to ``SYSTEM`` exactly as before.
        """
        node_def = normalize_template_node(node_def)
        node_name = node_def["node_name"]
        actor_name = node_def.get("actor")
        excused = not actor_name and _designates_nobody(node_name)
        if not actor_name and not excused:
            actor_name = _named_person(node_name)

        if actor_name:
            from apps.actors.models import Actor, resolve_actor_by_any_name

            actor = resolve_actor_by_any_name(
                Actor._base_manager.filter(
                    civilization=civilization, tenant_id=tenant_id, is_deleted=False
                ),
                actor_name,
            )
            if actor is not None:
                return {"approver_type": "ACTOR", "approver_actor": actor}

        role = node_def.get("approver_role") or ""
        if node_def.get("approver_type") == "ROLE" and role:
            return {"approver_type": "ROLE", "approver_role": role}

        return {"approver_type": "SYSTEM"}

    @classmethod
    def validate_civilization_case_type(cls, civilization: str, case_type: str) -> str | None:
        """
        Validate that case_type is appropriate for the given civilization.

        Args:
            civilization: The civilization code
            case_type: The case type to validate

        Returns:
            Error message if invalid, None if valid
        """
        valid_types = VALID_CASE_TYPES_BY_CIVILIZATION.get(civilization, set())
        if case_type not in valid_types:
            return (
                f"Case type '{case_type}' is not valid for civilization '{civilization}'. "
                f"Valid types: {', '.join(sorted(t.value for t in valid_types))}"
            )
        return None

    @classmethod
    def _generic_template(cls, civilization: str) -> dict:
        """The one-node flow a pair with no template of its own falls back to.

        It exists so that "no template" is a flow nobody can *read* anything
        into rather than a flow nobody can *move*: 审批节点 designates nobody
        (it is listed in ``TEMPLATE_NODES_WITHOUT_AN_APPROVER``) and so has to
        go through the audited ``escalate``, which is a visible cost. A
        node-less workflow, by contrast, is silently stuck — see
        ``_resolve_template``.
        """
        return {
            "name": f"{civilization} 审批流程",
            "nodes": [
                {"name": "审批节点", "court": civilization, "type": NodeType.TRIAL, "order": 1},
            ],
        }

    @classmethod
    def _resolve_template(
        cls, civilization: str, case_type: str, tenant
    ) -> tuple[dict, int | None]:
        """The template for this pair, and the priority it declares (if any).

        **BOTH ENTRY POINTS RESOLVE A TEMPLATE THROUGH THIS METHOD, AND THAT IS
        THE POINT OF IT EXISTING.** They used to resolve one in two different
        ways, and the difference was not a nuance:

        * ``create_from_judgment`` looked in the database first, then in
          ``WORKFLOW_TEMPLATES``, then fell back to a generic single node;
        * ``create_appeal_workflow`` looked *only* in ``WORKFLOW_TEMPLATES``
          and had no fallback at all.

        ``WORKFLOW_TEMPLATES`` carried an ``APPEAL`` entry for the Chinese
        only, so a European or Egyptian appeal raised through the second door
        got an ``ApprovalWorkflow`` with **zero nodes**: ``status=PENDING``,
        ``current_node=None``, and therefore un-advanceable (``advance_to_next``
        finds nothing), un-approvable (``approve_node`` 404s on "Node not
        found") and un-escalatable (``escalate`` needs a next node too). A row
        that can only be deleted.

        Two independent causes, and both are closed here rather than one:
        the *structural* one is that a second lookup existed at all, and the
        *content* one is that the hardcoded table had no European or Egyptian
        appeal to find. ``WORKFLOW_TEMPLATES`` now carries both — ported from
        the presets, which were already sourced — so those two appeals get
        their own flows rather than a generic 审批节点 that moves but says
        nothing.

        This was a latent defect, not an outage: ``create_appeal_workflow`` has
        no production caller anywhere in the backend (only tests reach it). It
        is repaired because the two doors are meant to answer the same question
        the same way — the same reason ``8b5aa00`` gave that method the
        case-type validation this one already ran.

        **The second element is the template's own priority**, or ``None`` when
        the template that won has nothing to say about it. Only a stored
        ``WorkflowTemplate`` row can say anything: ``WORKFLOW_TEMPLATES`` and
        the generic fallback are code, and a hardcoded urgency there would be a
        default nobody could see or change. ``None`` is not ``0`` —
        ``_resolve_priority`` distinguishes "this template asks for normal" from
        "this template does not say", and only the first outranks a floor.

        A DB template only wins if it actually defines nodes. Without that
        check an active template with ``nodes_json=[]`` shadows the hardcoded
        default and yields a workflow with no steps — which is exactly what
        happened: seven empty templates left over from testing sat on
        CHINESE/ROUTINE, so every Chinese routine judgment silently got an
        empty shell instead of 十殿审判流程. An unconfigured template should
        fall through to something that works, not override it.

        The query is scoped to ``tenant``. ``WorkflowTemplate`` is a genuinely
        per-tenant resource (``WorkflowTemplateViewSet`` enforces DataScope +
        tenant on every other path, and the model even used to carry a
        ``unique_workflow_template_tenant_name`` constraint) — it is not a
        shared/global resource the way ``Menu`` or the RBAC Permission/Role
        tables turned out to be. Without this filter, a tenant with no custom
        template for the pair could silently pick up another tenant's active
        template instead of falling through to the hardcoded default.

        **The returned template always has at least one node.** That is the
        invariant the callers rely on to be unable to build a node-less
        workflow, and ``tests/test_workflow_appeal_nodes.py`` asserts it over
        every ``(civilization, case_type)`` pair the validator admits — not
        only the ones that happen to have entries today.
        """
        # THE SAVEPOINT IS LOAD-BEARING, AND SO IS THE NARROWED EXCEPT.
        #
        # This used to be a bare `except Exception: pass` around the query.
        # `apps/judgment/services.py` wraps its steps 1-4 in
        # `transaction.atomic()` and step 3 calls `create_from_judgment`, which
        # calls this **before** its own inner atomic -- so this query runs
        # inside the judgment's transaction. On PostgreSQL a failed statement
        # poisons that transaction, and swallowing the failure only defers the
        # report to an unrelated line. Reproduced on a PostgreSQL clone:
        #
        #     inner except swallowed: DataError
        #     FOLLOW-UP QUERY RAISED TransactionManagementError:
        #         An error occurred in the current transaction.
        #
        # The error surfaces against a statement that had nothing to do with
        # the fault -- the same shape as `apps/perm/migrations/0017`, where a
        # missing column was reported as "current transaction is aborted"
        # against an innocent line. On SQLite the swallow is a genuine no-op,
        # which is why the whole suite is blind to it.
        #
        # `atomic()` here opens a savepoint: a failure rolls back to it and the
        # outer transaction stays usable. `DatabaseError` rather than
        # `Exception`, because a TypeError or an AttributeError in this block is
        # a bug in this code and must not be turned into "fall back to the
        # built-in template" -- that fallback would produce a workflow with the
        # wrong nodes and no indication anything went wrong.
        try:
            with transaction.atomic():
                db_template = (
                    WorkflowTemplate.objects.filter(
                        civilization=civilization,
                        case_type=case_type,
                        is_active=True,
                        tenant=tenant,
                    )
                    .exclude(nodes_json=[])
                    .first()
                )
            if db_template and db_template.nodes_json:
                return (
                    {"name": db_template.name, "nodes": db_template.nodes_json},
                    db_template.priority,
                )
        except DatabaseError:
            logger.warning(
                "Stored workflow template lookup failed for "
                "(%s, %s); falling back to the built-in template",
                civilization,
                case_type,
                exc_info=True,
            )

        template = WORKFLOW_TEMPLATES.get((civilization, case_type))
        if template and template["nodes"]:
            return template, None

        return cls._generic_template(civilization), None

    @classmethod
    def _resolve_priority(
        cls, explicit: int | None, template_priority: int | None, floor: int
    ) -> int:
        """Which of the two priorities wins, in one place.

        **Explicitly passed instance-level priority > template default > the
        entry point's floor.** The case that forces the argument to be
        ``int | None`` rather than ``int`` is the first ``>``: with a
        ``priority: int = 0`` signature, "the caller asked for normal" and "the
        caller said nothing" arrive as the same value, so honouring the
        template would have silently overridden every explicit ``0`` and
        honouring the argument would have made the template column dead on
        arrival. Only ``None`` distinguishes them, so ``None`` is the default
        and ``0`` means somebody chose it.

        The same reasoning is why ``views.ApprovalWorkflowViewSet``
        ``.create_from_judgment`` no longer reads
        ``request.data.get("priority", 0)``: that call turned *every* request
        that omitted the field into an explicit 0, which would have won here
        and left the template column with no effect whatsoever through the one
        endpoint that creates workflows. It now reads ``.get("priority")``, so
        an absent field arrives as ``None`` and a sent ``0`` still arrives as
        ``0``.

        ``floor`` is the entry point's own answer when nobody else has one: 0
        for ``create_from_judgment``, 1 for ``create_appeal_workflow``. The
        second is not a new decision — that method's signature has always
        defaulted to 1, on the reading that raising an appeal is itself the
        urgent act — and keeping it means this change does not quietly
        de-prioritise every appeal ever created.
        """
        if explicit is not None:
            return explicit
        if template_priority is not None:
            return template_priority
        return floor

    @classmethod
    def _create_nodes(cls, workflow: ApprovalWorkflow, template: dict, civilization: str):
        """Create ``template``'s nodes on ``workflow``; return the first one.

        Shared by both entry points for the same reason ``_resolve_template``
        is: the two loops were near-identical — same fields, same verdicts, same
        approver resolution — differing only in which template they were handed
        and in whether they ran at all. A duplicate is where the next divergence
        goes, and the divergence that had already happened was the whole defect.

        Nodes are normalized first, because ``template["nodes"]`` is one of two
        shapes — a stored ``nodes_json`` is what the API serializer wrote,
        ``WORKFLOW_TEMPLATES`` and the fallback are ``name/court/type/order`` —
        and this read only the second, so ``node_def["name"]`` raised KeyError
        (a 500 from ``apps/judgment/services.py:189``) for every template a user
        had actually saved. ``apps/workflow/node_shape.py`` has the rest.

        Raises:
            ValueError: if the template produced no nodes at all. By
                construction ``_resolve_template`` cannot return an empty one,
                so this is a guard against a *future* caller passing a template
                from somewhere else — it is the last place a node-less workflow
                could still be built, and it refuses inside the caller's
                transaction so nothing half-built is left behind.
        """
        first_node = None
        # Template-local node id -> the row it produced, so the routing edges
        # below can be resolved after every node exists. A template names its
        # targets by its OWN ids; the ApprovalNode pks do not exist until this
        # loop runs, which is why routing cannot be wired inside it.
        by_template_id: dict[str, ApprovalNode] = {}
        routing_defs: list[tuple[ApprovalNode, dict]] = []

        for position, raw_node_def in enumerate(template["nodes"], start=1):
            node_def = normalize_template_node(raw_node_def, position)
            node = ApprovalNode.objects.create(
                workflow=workflow,
                node_name=node_def["node_name"],
                node_order=node_def["node_order"],
                node_type=node_def["node_type"],
                court_code=node_def["court_code"],
                status=NodeStatus.PENDING,
                required_verdicts=["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"],
                # Was a hardcoded `approver_type="SYSTEM"`, which is why all 30
                # nodes in the live database designate nobody and why the
                # identity check `4ceffe8` added could not refuse a single one
                # of them. Backfilling the existing rows
                # (0011_backfill_ten_court_approvers) without fixing this would
                # have closed the hole for exactly as long as it took someone
                # to create the next workflow.
                **cls._resolve_approver(node_def, civilization, workflow.tenant_id),
            )
            if first_node is None:
                first_node = node
            template_id = node_def.get("id")
            if template_id:
                by_template_id[str(template_id)] = node
            if node_def.get("on_pass") or node_def.get("on_fail"):
                routing_defs.append((node, node_def))

        # ── Wire the routing edges ─────────────────────────────────────
        #
        # Second pass, because an edge can point forwards or backwards and the
        # target may not have been created yet on the first.
        #
        # An edge naming an id this template does not define is DROPPED, not
        # raised on. A template is user-authored data that can outlive the node
        # it referenced — deleting a node in the editor leaves any edge into it
        # dangling — and refusing to instantiate the whole workflow would turn
        # a stale reference into an un-judgeable soul. A dropped edge falls back
        # to the order-based default, which is the behaviour the flow had before
        # anyone drew the edge.
        for node, node_def in routing_defs:
            updates = []
            for field in ("on_pass", "on_fail"):
                target_id = node_def.get(field)
                target = by_template_id.get(str(target_id)) if target_id else None
                if target is not None and target.pk != node.pk:
                    setattr(node, field, target)
                    updates.append(field)
            if updates:
                node.save(update_fields=updates)

        if first_node is None:
            raise ValueError(
                f"template {template.get('name')!r} defines no nodes; an "
                f"approval workflow with no nodes cannot be advanced, approved "
                f"or escalated. Use WorkflowService._resolve_template, which "
                f"always answers with at least one node."
            )

        workflow.current_node = first_node
        workflow.status = ApprovalWorkflowStatus.IN_PROGRESS
        workflow.save()
        return first_node

    @classmethod
    def create_from_judgment(
        cls,
        judgment: Judgment,
        case_type: str | None = None,
        is_appeal: bool = False,
        priority: int | None = None,
    ) -> ApprovalWorkflow | None:
        """
        Create an ApprovalWorkflow instance from a Judgment.

        Args:
            judgment: The concluded judgment
            case_type: Override case type (auto-detected from judgment if not provided)
            is_appeal: Whether this is an appeal workflow
            priority: Workflow priority (0=normal, 1=urgent, 2=critical).
                **None means "not specified"**, which is not the same as 0:
                an unspecified priority falls through to the template's own
                ``WorkflowTemplate.priority`` and only then to 0, while an
                explicit 0 wins over the template. See ``_resolve_priority``
                for why the parameter had to stop defaulting to 0 for the
                template column to mean anything at all.

        Returns:
            Created ApprovalWorkflow or None if no template matches

        Raises:
            ValueError: If case_type is not valid for the civilization
        """
        soul = judgment.soul
        civilization = soul.civilization

        # Determine case type
        if case_type is None:
            if is_appeal:
                case_type = CaseType.APPEAL
            elif civilization == Civilization.CHINESE:
                case_type = CaseType.ROUTINE
            elif civilization == Civilization.EGYPTIAN:
                case_type = CaseType.HEART_WEIGHING
            else:
                case_type = CaseType.ROUTINE  # European default

        # Validate case_type for civilization
        validation_error = cls.validate_civilization_case_type(civilization, case_type)
        if validation_error:
            raise ValueError(validation_error)

        # Look up template: DB first, then the hardcoded table, then a generic
        # one-node flow. `create_appeal_workflow` calls the same method — see
        # `_resolve_template` for what the two doors used to do differently and
        # what that cost.
        template, template_priority = cls._resolve_template(
            civilization, case_type, judgment.tenant
        )
        priority = cls._resolve_priority(priority, template_priority, floor=0)

        with transaction.atomic():
            # Create workflow
            workflow = ApprovalWorkflow.objects.create(
                judgment=judgment,
                soul=soul,
                workflow_name=template["name"],
                case_type=case_type,
                priority=priority,
                status=ApprovalWorkflowStatus.PENDING,
                is_appeal=is_appeal,
                tenant=judgment.tenant,
            )

            # Create nodes, and refuse a template that has none — see
            # `_create_nodes`. Inside the transaction, so a refusal leaves no
            # half-built workflow behind.
            cls._create_nodes(workflow, template, civilization)

        # Inside the request's own transaction but outside the atomic block
        # above, so a template that refuses to build leaves no event behind.
        cls.announce(workflow, created=True)
        return workflow

    @staticmethod
    def announce(workflow, created: bool = False, node=None) -> None:
        """Emit the workflow's own events onto the soul's timeline, and tell the
        approver a node is waiting for them.

        WHY THIS EXISTS AS OF 2026-08-30. `apps/events/services.py` has carried
        `log_workflow_created`, `log_workflow_approved`, `log_workflow_rejected`
        and `notify_workflow_assigned` since M12 Phase 2, and **`apps/workflow/`
        imported nothing from `apps/events/` at all**. Excluding tests, the four
        were definitions with no callers; `RealtimeEventPublisher.publish_workflow`
        and `event_bus.publish_workflow` had none either.

        The visible consequence was a hole in the record: `EventType.WORKFLOW_*`
        never appeared in `SoulEvent`, so a soul's timeline ran from
        JUDGMENT_CONCLUDED straight to DISPOSITION_CREATED with the ten-court
        approval chain -- the part with the names and the verdicts in it --
        absent. And no approver was ever told a node was waiting.

        Six tests in `tests/test_workflow_events.py` and
        `test_event_bus_integration.py` called these methods directly and
        passed. That is the shape this repo keeps finding: **a test exercising a
        function that production never calls.** The tests were honest about the
        function; nothing was checking that anybody called it.

        Called from the two places a workflow's state actually changes: here,
        and `approve_node` in views.py. Deliberately NOT from `complete_node` in
        models.py -- that method is invoked inside a `select_for_update` block,
        and an event emitted there would be published from inside a lock the
        caller might still roll back.
        """
        from apps.events.services import EventService

        if created:
            EventService.log_workflow_created(workflow)
        elif node is not None:
            from apps.workflow.models import NodeStatus

            if node.status == NodeStatus.APPROVED:
                EventService.log_workflow_approved(workflow, node=node)
            elif node.status == NodeStatus.REJECTED:
                EventService.log_workflow_rejected(workflow, node=node)

        # Whoever the now-current node names. `None` after a terminal decision,
        # which is the correct time to tell nobody.
        current = workflow.current_node
        if current is None or current.approver_actor_id is None:
            return
        from apps.authentication.models import User

        assignee = User.objects.filter(
            actor_id=current.approver_actor_id, is_active=True
        ).first()
        if assignee is not None:
            EventService.notify_workflow_assigned(assignee, workflow)

    @classmethod
    def create_appeal_workflow(
        cls,
        original_workflow: ApprovalWorkflow,
        priority: int | None = None,
    ) -> ApprovalWorkflow:
        """
        Create an appeal workflow from an existing rejected workflow.

        Args:
            original_workflow: the workflow being appealed against.
            priority: as in ``create_from_judgment`` — **None means "not
                specified"**, and falls through to the stored template's
                ``WorkflowTemplate.priority`` and then to 1. The floor is 1
                rather than 0 because this method's signature has always
                defaulted to 1 (raising an appeal is itself the urgent act);
                the parameter changed from ``int`` to ``int | None`` so that an
                explicit ``priority=0`` is now expressible and distinguishable
                from silence. Every existing caller passing nothing still gets
                1, and ``tests/test_coverage_boost.py`` still gets 2 for
                ``priority=2``.

        Raises:
            ValueError: If APPEAL is not valid for the soul's civilization, or
                if the resolved template defines no nodes (which
                ``_resolve_template`` makes unreachable — see ``_create_nodes``).

        **Why this validates at all.** It did not, and that absence was half of
        the defect the case-type table above records: this method wrote
        ``case_type=CaseType.APPEAL`` for a soul of any civilization while
        ``create_from_judgment`` refused the same pair for two of the three. The
        table is now widened so both answers agree — but agreement between a
        checked path and an unchecked one is a coincidence, not a rule. Whoever
        removes ``APPEAL`` from one of the sets next should find out here as
        well as there, rather than shipping an appeal that only one door
        refuses.

        **This is not a no-op**, and the one case it changes is worth stating.
        For the three civilizations the answer is identical before and after,
        because ``APPEAL`` is now in every set. It differs for a soul whose
        ``civilization`` is ``UNKNOWN_CIVILIZATION`` — a soul whose tenant is
        missing or whose tenant code is not in ``TENANT_CIVILIZATION``. Before,
        that soul got an appeal workflow with **no nodes at all** (there is no
        ``(UNKNOWN, APPEAL)`` template, the node loop never runs, and the
        workflow is left ``PENDING`` with ``current_node=None``); now it raises,
        which is what ``create_from_judgment`` has always done for the same soul
        — ``VALID_CASE_TYPES_BY_CIVILIZATION.get(UNKNOWN, set())`` is empty. A
        node-less approval workflow cannot be advanced, approved or escalated,
        so the change replaces a stuck row with the error that explains it.

        **And the node-less workflow this method built for two of the three
        real civilizations is gone too.** The paragraph above closed the
        ``UNKNOWN`` case by refusing it; the European and Egyptian cases were
        not refused — they were *built*, empty, because this method read only
        ``WORKFLOW_TEMPLATES`` (which had a Chinese appeal and nothing else)
        and, unlike ``create_from_judgment``, had no generic fallback and never
        looked at the tenant's stored ``WorkflowTemplate`` rows at all. Both
        halves are now ``_resolve_template``'s job, which both doors call.
        """
        judgment = original_workflow.judgment
        soul = original_workflow.soul

        validation_error = cls.validate_civilization_case_type(
            soul.civilization, CaseType.APPEAL
        )
        if validation_error:
            raise ValueError(validation_error)

        # The appeal belongs to the tenant the case does. This used to read
        # `judgment.tenant if judgment else None`, and the `None` half was not
        # deliberate — `ApprovalWorkflow.judgment` is nullable, and it has to be
        # for an appeal to be chained at all (the FK is a OneToOne, so every
        # test that reaches this method builds its original *without* one), so the
        # common case here wrote `tenant=NULL`: a row no tenant-scoped read
        # returns, on the same soul whose original workflow does have a tenant.
        # It also decides which stored templates `_resolve_template` may see, so
        # leaving it NULL would have made the template lookup below findable
        # only by an unscoped query. The original workflow's tenant is the one
        # fact always available here.
        tenant = judgment.tenant if judgment else original_workflow.tenant
        template, template_priority = cls._resolve_template(
            soul.civilization, CaseType.APPEAL, tenant
        )
        priority = cls._resolve_priority(priority, template_priority, floor=1)

        # Atomic like create_from_judgment, so that `_create_nodes`' refusal of
        # a node-less template cannot leave the workflow row behind without
        # them. Before this, nothing here was transactional because nothing
        # here could fail — the node loop simply did not run.
        with transaction.atomic():
            appeal_workflow = ApprovalWorkflow.objects.create(
                judgment=judgment,
                soul=soul,
                workflow_name=f"申诉: {original_workflow.workflow_name}",
                case_type=CaseType.APPEAL,
                priority=priority,
                status=ApprovalWorkflowStatus.PENDING,
                is_appeal=True,
                original_workflow=original_workflow,
                tenant=tenant,
            )

            # Same resolution as create_from_judgment, because it is the same
            # method. In the Chinese appeal template only 魏征 · 察查司
            # resolves; the other three name a court relative to a case
            # (原殿/上一殿) or a god with no Actor row (酆都大帝), so they stay
            # SYSTEM. See TEMPLATE_NODES_WITHOUT_AN_APPROVER.
            cls._create_nodes(appeal_workflow, template, soul.civilization)

        return appeal_workflow

    @classmethod
    def get_workflow_stats(cls, workflow: ApprovalWorkflow) -> dict:
        """Get statistics about a workflow's progress."""
        nodes = workflow.nodes.all()
        total = nodes.count()
        # `pending` is derived from `total`, not counted independently.
        # ESCALATED was in neither bucket, so completed + pending did not sum
        # to total -- measured: {'total_nodes': 3, 'completed_nodes': 0,
        # 'pending_nodes': 2} with one escalated node. It was latent only
        # because nothing assigned ESCALATED, and something does now
        # (ApprovalWorkflow.escalate_current_node). Deriving it means a status
        # added later cannot reopen the same gap.
        pending = nodes.filter(status=NodeStatus.PENDING).count()
        approved = total - pending

        return {
            "total_nodes": total,
            "completed_nodes": approved,
            "pending_nodes": pending,
            "progress_percent": (approved / total * 100) if total > 0 else 0,
        }
