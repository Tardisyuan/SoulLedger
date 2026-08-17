"""One spelling for a template node, and the reader that produces it.

WHY THIS MODULE EXISTS
----------------------
``WorkflowTemplate.nodes_json`` was written in two different shapes and read in
two different shapes, and each writer was paired with the reader that could not
read it:

===============================  =====================================  =========================================
writer                           what it stores                         who could read it
===============================  =====================================  =========================================
``WorkflowTemplateNodeSerializer``  ``node_name/node_type/court_code/``  the editor (``WorkflowEditor.tsx``)
(every save from /workflow)         ``approver_role/approver_type/``
                                    ``node_order``
``seed_workflow_templates``         ``name/court/type/order/actor``      ``WorkflowService.create_from_judgment``
(``WORKFLOW_TEMPLATES`` verbatim)
===============================  =====================================  =========================================

So a template a *user* actually saved crashed workflow creation
(``KeyError: 'name'`` at ``services.py``'s ``node_def["name"]``, surfacing as a
500 from ``apps/judgment/services.py:189``), and a template the *seeder* wrote
crashed the API that lists it (``KeyError: 'node_name'`` out of
``rest_framework/fields.py``, a 500 from ``GET
/api/v1/workflow/templates/{id}/``). Measured both ways before this module
existed; ``tests/test_workflow_node_shape.py`` holds both as regressions.

THE CANONICAL SHAPE IS THE SERIALIZER'S, i.e. ``node_name / node_order /
node_type / court_code`` (+ ``approver_type`` / ``approver_role``). Not a coin
toss:

* It is what ``WorkflowTemplate.nodes_json``'s own model docstring already
  documents as the stored shape — ``{ id, node_name, node_type, court_code,
  approver_role, approver_type, node_order }``.
* It is what the nodes *become*: ``ApprovalNode``'s columns are spelled exactly
  this way, so the shape that ends the journey needs no translation at the one
  place a mistranslation costs a 500.
* It is the only shape that arrives through a validating boundary.
  ``WorkflowTemplateNodeSerializer`` checks ``node_type`` against a choice list;
  the other shape's ``type`` is free text (the frontend presets put 「分流」,
  「初审」 … there) copied unvalidated into a ``choices``-constrained column.
* It is strictly the richer of the two: ``approver_type``/``approver_role`` have
  no counterpart in the other shape, and a non-empty ``approver_role`` is one of
  only two things ``ApprovalNode.designates_approver`` accepts. Dropping it in
  translation would silently produce nodes nobody can approve.
* It is what every row a user has ever saved is already in — the API is the only
  path that writes ``nodes_json`` from outside this repository's own code.

The other shape is not deleted, it is *read*. ``WORKFLOW_TEMPLATES`` in
``services.py`` keeps its ``name/court/type/order`` spelling because it also
carries ``actor``, which the canonical shape has no field for and which
``_resolve_approver`` and ``workflow/0011``'s backfill both depend on; renaming
its four other keys would buy one shape in exchange for touching every doc
comment, both excuse tables and four test files, and would still leave ``actor``
outside the schema. Instead every entry point runs the node dict through
``normalize_template_node`` first.

WHY NORMALIZE RATHER THAN MIGRATE THE STORED ROWS
-------------------------------------------------
Because we cannot see them. The production database (192.168.2.115) is not
reachable from where this was written — ``nc -z -w 3 192.168.2.115 5432`` →
no route to host — and the local dev SQLite has ``0`` rows in
``workflow_workflowtemplate``. The last actual measurement is the one recorded
in ``workflow/0011``'s docstring, 2026-08-15 against the live database:
``WorkflowTemplate`` 7 rows, ``nodes_json`` **empty array on every one of
them** — and an empty ``nodes_json`` is excluded by ``create_from_judgment``'s
own ``.exclude(nodes_json=[])``, so not one of those rows ever reaches a
reader. A data migration would therefore be rewriting rows whose shape nobody
here can verify, to fix a crash that normalization fixes for *any* shape,
including shapes written after the migration ran. Normalizing is correct
without knowing the answer; migrating requires knowing it. The query an
operator can run to check is in ``tests/test_workflow_node_shape.py``'s module
docstring.

The same answer, for the same reason, covers ``node_type`` — added later, when
the frontend presets turned out to hold Chinese step names there. Reasoned, not
measured, because the sandbox still cannot reach 192.168.2.115:

* Only three things write ``WorkflowTemplate.nodes_json``. The API has validated
  ``node_type`` against a five-member ``ChoiceField`` since ``14a4c44``, the
  commit that introduced the app — so the one path a user can drive has never
  been able to store 「分流」; it answered 400 instead, which *is* the defect
  being fixed. ``seed_workflow_templates`` writes ``WORKFLOW_TEMPLATES``, whose
  ``type`` is a real ``NodeType`` member. The third is a hand-written UPDATE.
* Only three things write ``ApprovalNode.node_type``. ``ApprovalNodeSerializer``
  is a ``ModelSerializer``, so the column's ``choices`` validate it.
  ``create_from_judgment`` and ``create_appeal_workflow`` copy it from a
  template with no validation at all — that is the hole — but their input is one
  of the two above.
* The last real measurement (``workflow/0011``'s docstring, 2026-08-15, live
  database): ``WorkflowTemplate`` 7 rows with ``nodes_json`` empty on every one,
  ``ApprovalNode`` 30 rows, all of them the three 十殿审判流程 workflows built
  from ``WORKFLOW_TEMPLATES`` — i.e. ``TRIAL``×9 + ``FINAL`` each.

So a migration would rewrite rows this reasoning says cannot exist, and would
still leave the unvalidated copy in ``create_from_judgment`` open for the next
hand-written row. Normalizing closes the copy for any stored value, past or
future. An operator with database access can check both halves::

    -- template rows whose stored node_type is outside NodeType
    SELECT id, name, civilization, case_type,
           jsonb_path_query_array(nodes_json::jsonb,
               '$[*] ? (!(@.node_type == "TRIAL" || @.node_type == "EVALUATION"
                       || @.node_type == "APPEAL" || @.node_type == "FINAL"
                       || @.node_type == "EXECUTION"))') AS bad_nodes
    FROM workflow_workflowtemplate
    WHERE jsonb_array_length(nodes_json::jsonb) > 0;

    -- approval nodes that already carry one
    SELECT node_type, count(*)
    FROM workflow_approvalnode
    WHERE node_type NOT IN ('TRIAL','EVALUATION','APPEAL','FINAL','EXECUTION')
    GROUP BY node_type;

If the second query returns rows, that is the case this reasoning ruled out and
the finding to bring back — those are already-created nodes, which normalization
does *not* reach (it runs when a workflow is built, not on rows already built),
and they would need a data migration of their own. The first query's rows are
already handled: they normalize on read.
"""

#: canonical key -> the legacy key that means the same thing.
#: ``actor`` is deliberately absent: it is not a rename of anything, it is a
#: field the canonical shape does not have, and it is carried through untouched.
LEGACY_NODE_KEYS = {
    "node_name": "name",
    "node_order": "order",
    "node_type": "type",
    "court_code": "court",
}

#: ``NodeType.values``, spelled out for the same reason the ``"TRIAL"`` default
#: below is: this module has to stay importable from a migration, where the
#: model layer is exactly what one must not import. ``tests/test_workflow_node_shape.py``
#: asserts this tuple equals ``NodeType.values`` and equals the choice list on
#: ``WorkflowTemplateNodeSerializer.node_type``, so the three cannot drift.
NODE_TYPE_VALUES = ("TRIAL", "EVALUATION", "APPEAL", "FINAL", "EXECUTION")

#: Keys carried through as-is when present. ``actor`` is what ``_resolve_approver``
#: prefers over the label; ``approver_type``/``approver_role`` are what the
#: editor lets a user set per node; ``id`` is the editor's own node handle.
CARRIED_NODE_KEYS = ("id", "actor", "approver_type", "approver_role")


def normalize_template_node(node_def: dict, position: int = 1) -> dict:
    """Return ``node_def`` in the canonical shape, whichever shape it arrived in.

    Idempotent — a canonical node in is the same node out — so it is safe to
    call at more than one boundary, which it is: the serializer's
    ``to_representation``, both ``WorkflowService`` node loops, and
    ``_resolve_approver`` (which is also called directly, with raw
    ``WORKFLOW_TEMPLATES`` nodes, from ``tests/test_workflow_preset_approvers.py``).

    The result contains **only** canonical keys. That is the point: after
    normalization ``node["name"]`` raises instead of quietly reading a key that
    is absent from every row the API ever wrote, which is the exact failure this
    module was written for. A missing label normalizes to ``""`` rather than
    raising, because a nameless node should produce a ``SYSTEM`` node (nobody is
    named, so nobody is designated), not a 500 — ``_resolve_approver`` already
    treats an empty label that way.

    ``position`` supplies ``node_order`` only when the node carries neither
    spelling of it; callers pass the node's 1-based index, so a template whose
    nodes never recorded an order still comes out in the order it was written.
    """
    normalized = {}
    for canonical, legacy in LEGACY_NODE_KEYS.items():
        if canonical in node_def:
            normalized[canonical] = node_def[canonical]
        elif legacy in node_def:
            normalized[canonical] = node_def[legacy]

    normalized.setdefault("node_name", "")
    normalized.setdefault("node_order", position)
    # "TRIAL" rather than NodeType.TRIAL: this module is import-safe from a
    # migration, where importing the model layer is how a historical state gets
    # read through today's fields. The value is asserted equal to NodeType.TRIAL
    # in tests/test_workflow_node_shape.py so the two cannot drift.
    #
    # A node_type that is not a NodeType member is treated the same as a missing
    # one. `ApprovalNode.node_type` is a `choices`-constrained column and
    # `create_from_judgment` copies this value into it with `objects.create()`,
    # which runs no `full_clean()` — so an out-of-range value lands in the column
    # and stays there, where it renders as 「未识别取值」 and is missed by every
    # `node_type=` filter. The frontend presets held Chinese step names in this
    # key (「分流」, 「初审」 …); the fix for that is the mapping table in
    # `frontend/src/config/workflow-node-types.ts`, applied before the value ever
    # leaves the browser, and the serializer's ChoiceField still refuses such a
    # value on the way in. This clause is not that fix and does not replace it —
    # it is for rows that are *already stored*, which no boundary check can reach
    # and which `apps/workflow/migrations/0011`'s measurement could not rule out
    # (see this module's closing section). Coercing rather than raising follows
    # the rule already set two lines up: a malformed stored node should degrade
    # to the safest node, not 500 a judgment that has nothing to do with it.
    normalized.setdefault("node_type", "TRIAL")
    if normalized["node_type"] not in NODE_TYPE_VALUES:
        normalized["node_type"] = "TRIAL"
    normalized.setdefault("court_code", "")

    for key in CARRIED_NODE_KEYS:
        if key in node_def:
            normalized[key] = node_def[key]

    return normalized
