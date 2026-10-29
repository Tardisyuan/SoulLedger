# 审批流引擎——模板版本、审批人预览、超时与驳回到、会签 / 通知 / 条件分支

Branch `feat/workflow-engine`, merged with `main` at `07706a5e`. Built against canvas C
(`web-third/SoulLedger_第三类_C_…dc.html` on `origin/design/refs-2026-09`, read with `git show`,
not merged).

Commits, in the order asked (each can be cut without losing the earlier ones):

| # | commit | item |
|---|--------|------|
| 1 | `00ca435` | template versions + data migration |
| 2 | `6a30c4c` | approver preview |
| 3 | `8fa19b2` | timeout and 驳回到, return cap |
| 4 | `3900993` | 会签 / 通知 / 结束, declarative conditions, graph validation |
| 5 | `d054c0a` | editor (+ zh-Hans copy) |
| 6 | `f1d2715` | en / egy copy |
| — | `93cf706` | merge of `main`; `schema.yml`, `generated/schema.ts`, `egyVocabulary.json` regenerated, not hand-merged |
| — | `27e6c67` | fix found by the full run on the merged tree (see Gates) |

## 1. Template versions

- New `WorkflowTemplateVersion` (`DRAFT` / `PUBLISHED` / `SUPERSEDED`). At most one draft and one
  published version per template — two partial unique constraints, so the rule holds against any writer.
- **Saving writes a draft.** `POST/PATCH /workflow/templates/` with `nodes` goes to
  `versioning.save_draft`; `WorkflowTemplate.nodes_json` is now written *only* by
  `versioning.publish`. The engine keeps reading `nodes_json`, so a draft cannot reach a workflow by
  construction. Metadata edits (name, priority…) without `nodes` do not make a draft.
- **Publishing** (`POST …/publish/`) validates the draft (`apps/workflow/validation.py`), supersedes the
  old published version and copies the graph into `nodes_json`. Invalid → 400 `{error: "invalid_draft", issues}`;
  nothing is written.
- **Editing the published version creates a new draft** (numbered max+1); a second save overwrites the
  same draft.
- **In-flight pinning.** `_create_nodes` copies every node (with routing, timeout, countersign settings)
  into `ApprovalNode` rows and the engine never re-reads the template, so pinning is structural;
  `ApprovalWorkflow.template_version` records which version. Test: publish v2 while a v1 workflow is
  mid-flight; v1 finishes on v1's three nodes, v2 workflows get v2's two. **Mutation-proved**: a publish
  hook that rebuilt the pending nodes of in-flight workflows from the new version → red.
- **History**: `GET …/versions/`, read-only (405 on writes), newest first.
- An ORM-written template with `nodes_json` but no version row (fixtures, `seed_workflow_templates`) is
  adopted as v1 PUBLISHED on its first draft save, so the history never loses the graph that was running.

### Migrations

- `0018_template_versions` (schema): version table, `WorkflowTemplate.published_version`,
  `ApprovalWorkflow.template_version`.
- `0019_backfill_template_v1` (data): every existing template → v1 **PUBLISHED** (not draft: every saved
  template was live before, and filing them as drafts would take every tenant's custom flow out of
  service on deploy). Soft-deleted rows included; empty templates get a v1 with `[]` (still excluded by
  `_resolve_template`). Idempotent (skips templates that already have versions).
  Reverse: deletes all version rows and clears both FKs; `nodes_json` still holds each published graph, so
  the engine behaves exactly as before 0018. A reverse loses unpublished drafts and superseded history.
  **Tested forward → back → forward on SQLite** with the repo's `migration_round_trip` harness.
  **PostgreSQL: reasoned, not run** (no PG here): transactional DDL rolls 0018+0019 back together on
  failure; partial unique indexes are plain `CREATE UNIQUE INDEX … WHERE`; the backfill writes one
  PUBLISHED and no DRAFT per template so it cannot violate them; `nodes_json` is copied through Python
  (jsonb key order may change, nothing reads it); only `status` (max 12, longest value 10) is a varchar written.
- `0020_timeout_and_reject_to`, `0021_countersign_notify_conditions`: AddFields with defaults, plus the
  `NodeStatus` choice change. Longest values vs widths: `COUNTERSIGN` 11/12, `AUTO_REJECT` 11/12,
  `RETURN_LIMIT` 12/20, `TRAVERSED` 9/20.

## 2. Approver preview

`GET /workflow/templates/{id}/approver-preview/?node=<template node id>&civilization=&tenant=`
(`workflow.read`). `preview.py` calls `WorkflowService._resolve_approver` — the method `_create_nodes`
calls — and returns names and roles only (actor name/name_zh/role, role, a sample of ≤10 account
display names + roles, exact count). Reads the working copy (draft else published). Non-ADMIN users
preview in their own tenant only (foreign code → 403); ADMIN defaults to the tenant hosting the requested
civilization. For 会签 nodes it resolves each signer through the same method.

Test: builds the workflow for real and asserts preview == assignment node by node over five cases
(explicit actor, actor via label, excused joint bench, ROLE, nobody). Mutation-checked: a preview that
re-implemented resolution from the `actor` key only went red on 「阎罗王 · 四审」.

## 3. Timeout and 驳回到

- **驳回到** (`ApprovalNode.reject_to`): on FAIL, the decided nodes from the target up to this one are
  re-opened (their decisions move into `decision_history`), the target becomes current. Only an earlier
  node of the same workflow is honoured. Checked before `on_fail`; publish refuses a node with both.
- **Loop cap**: `MAX_REJECT_RETURNS = 3` per workflow. The FAIL that would exceed it ends the workflow
  REJECTED with `end_reason = "RETURN_LIMIT"`. **Mutation-proved** (cap check removed → the 4th FAIL
  loops back, test red). The comments that said "a decided node never returns to PENDING, so no cycle
  guard is needed" were rewritten: the cap is what keeps that true in bounded form.
- **Timeout** per node: hours + action — `ESCALATE` (re-designate to `timeout_role`; for 会签, only the
  unsigned slots), `AUTO_REJECT` (through `complete_node`, so 驳回到 and the cap apply), `NOTIFY`
  (remind designated users). Fires once per activation (`activated_at` / `timed_out_at`; all
  `current_node` assignments go through `_make_current`, and a return restarts the clock).
- **Timeouts fire only when something runs them**: `manage.py process_workflow_timeouts [--now]` or the
  celery task `workflow.process_timeouts`. **No scheduler was added**; the task is deliberately *not* in
  `apps/scheduler/registry.py`, and a test pins that absence. Documented in `timeouts.py`, the command,
  and under the timeout field in the editor.

## 4. 会签 / 通知 / 条件

- `NodeKind`: `APPROVAL` / `COUNTERSIGN` / `NOTIFY` / `END`. New `NodeStatus.TRAVERSED` for nodes the
  engine passes through without a decision (通知, 结束).
- **会签**: each signer is resolved by `_resolve_approver` into a slot. Rule: n signers, threshold k
  (default n); passes when approvals ≥ k, fails as soon as rejections > n − k, otherwise stays PENDING.
  One user, one signature. The timeout's auto-reject decides the whole node.
- **通知**: on arrival, notifies whoever it designates (after commit) and moves on.
- **结束**: added because it was necessary, not requested — see below.
- **Conditions**: PASS branches `[{id, when: [{fact, op, value}], target}]`, tried before `on_pass`.
  Facts: `balance` (merit − demerit, integer; lt/lte/gt/gte/eq), `civilization`, `verdict` (in/not_in over
  enum members). Declarative, no string is parsed, no eval of any kind. **Mutation-proved** (`lt` → `<=`:
  the balance-0 soul takes the 「余额 < 0」 branch, red).
- **Validation (publish)**: empty / unsatisfiable condition sets, pairwise overlapping sets (exact: every
  clause set is an integer interval × enum subsets), malformed clauses, dangling/self routes, 会签 without
  signers, threshold out of range, 结束 with exits, and — for graph templates — `unreachable`, `no_exit`,
  `no_end`.

**Why 结束 exists (a design decision worth checking).** The engine's default PASS successor is "the
first PENDING node by order" (pinned by `test_workflow_conditional_routing.py`). Under that rule a branch
not taken is picked up later anyway, so conditions would be meaningless. A template that uses a 结束
node or any condition is therefore a *graph*: every non-结束 node needs an explicit PASS exit, and
reaching 结束 completes the workflow (unreached nodes stay PENDING under the terminal status). Linear
templates — every existing one — behave exactly as before, and the graph rules don't run on them (the
order is every node's exit there).

## 5. Editor

- Palette by kind: □ 审批 · ⧉ 会签 · ✉ 通知 · ■ 结束. ▷ 开始 and ◇ 条件 from the canvas are not palette
  entries: the entry is the first node and a condition lives on an edge.
- Node form: kind, signers + threshold, timeout hours/action/role, 驳回到 (earlier nodes only).
- Inspector: kind, signers, timeout summary, exits; approver preview (for the *saved* node — a node
  changed since the last save says 「存草稿后才能预览」 instead of querying); 出口 · 条件 editor on each PASS
  edge; read-only version history.
- Toolbar: 「草稿 v4 · 已发布 v3」 badge; 存草稿 (blocked only by `name_empty` / `self_route` /
  `duplicate_route`, which a draft cannot hold) and 发布 (blocked by every issue and by an empty canvas).
  发布 saves then publishes, in that order.
- `workflowValidation.ts` mirrors `validation.py` rule-for-rule, same codes; its header comment, which
  said the design rules don't apply, is rewritten.
- < 1024 px keeps the read-only view: no 存草稿, no 发布, conditions not editable (e2e asserts both buttons absent).
- Detail page knows `TRAVERSED`.

## 6. Copy (zh-Hans / en / egy) and egy gaps

egy uses only words in the closed vocabulary (`npx jest egyLexiconRules`: 22/22). Main choices: 模板
Pet-Sesh, 版本 Hemet-Sesh, 草稿 Sesh Tepy, 发布 Sesh, 会签 Sesen Hena, 通知 Sedjem, 结束 Pehwy, 驳回到 Khesef Er,
条件 Setep, 余额 Unemu Tepy, 文明 Aset Ahamet, 判决 Sheemtet, 小时 Unut, 转交上级 Hab Er Hery.

Could not be expressed, or only approximately:
- **存草稿 / 草稿已保存** keep `Sau Pet-Sesh` / `Pet-Sesh Sau Seth`: those two keys are pinned by the
  finalized revision table; the literal would be `Sau Sesh Tepy`.
- **转交上级**: `Seshem` (the lexicon's word for escalation) is reserved for keys whose zh says 推进/越级/升级;
  used `Hab Er Hery` ("send to the superior").
- **超时** has no word; `Unut Khetem` ("hours closed").
- **condition / 条件** has no word; `Setep` (select/filter) stands in.
- **comparison operators** (小于、属于…) have no words; egy shows the symbols `< ≤ > ≥ = ∈ ∉`.
- **是 / 否** on condition edges: `Maat` / `Nen`.
- **已替换 (superseded)**: `Khetem Seth` ("closed").
- **已经过 (TRAVERSED)**: `Shem Seth` ("went").
- **the timeout hint** cannot name `process_workflow_timeouts` (non-lexicon tokens); egy says only that
  timeouts are not automatic.

## Gates (on the merged tree)

| gate | command | exit | result |
|------|---------|------|--------|
| backend pytest (SQLite), full, `93cf706` | `.venv/bin/python -m pytest --tb=short -q` | 1 | 5097 passed / **3 failed** / 26 skipped; coverage 94.05% |
| backend, after the fix `27e6c67` | workflow + verdict-bundle + schema tests | 0 | 293 passed |
| backend pytest (SQLite), full, `27e6c67` | same | 0 | **5100 passed / 0 failed / 26 skipped**; coverage 94.05% (includes the schema gates: 0 warnings / 0 errors) |
| ruff | `.venv/bin/ruff check .` | 0 | clean |
| makemigrations | `manage.py makemigrations --check --dry-run` | 0 | no changes |
| schema gate | `test_schema_has_no_warnings`, `test_committed_schema_matches_the_backend`, `test_declared_response_shapes_match_the_views` (in the full run); schema.yml regenerated and byte-identical to a fresh `spectacular` | — | 0 warnings / 0 errors |
| core typecheck / lint / test | `npm run --workspace packages/core …` | 0 / 0 / 0 | vitest 145 passed |
| frontend tsc | `npx tsc --noEmit` | 0 | — |
| frontend lint | `npm run lint` | 0 | 0 warnings |
| frontend test:coverage (`27e6c67`) | `npm run test:coverage` | 0 | 187 suites / 3059 tests; all files 80.92/74.04/71.95/81.84 |
| build | `npm run build` | 0 | — |
| playwright chromium | `npx playwright test --project=chromium` | 0 | 153 passed, 1 skipped |
| playwright mobile-chrome | `--project=mobile-chrome` | 0 | 149 passed, 5 skipped |
| playwright firefox | — | — | **not run**: no firefox in this environment |

The 3 failures were `test_the_workflow_picker_invents_nothing[en|zh-Hans|egy]`: I had added
`workflow.verdicts.notified`, but that namespace is the approval picker's vocabulary and may only hold
verdicts `WorkflowNodeActionSerializer` accepts. Fixed in `27e6c67`: notify nodes carry an empty verdict
(`TRAVERSED` is the record) and the key is gone. Playwright was run on `93cf706`; `27e6c67` touches only a
verdict string, two detail-page map entries and one bundle key per locale.

Playwright ran with `executablePath: /opt/pw-browsers/chromium` through a throwaway config wrapper (the
installed chromium revision is 1194; playwright 1.63 expects 1243). The wrapper was not committed.
No PostgreSQL run: the PG-only tests were not exercised. One PG hazard was caught locally by the repo's
`lock_join_guard` (FOR UPDATE with a nullable `select_related`) and fixed with `of=("self",)`.

## Open questions

1. **结束 / graph semantics** (§4) is my decision, needed to make conditions mean anything. Worth a
   product look: should a *linear* template with `on_pass` skips also stop reviving skipped nodes?
2. **The cap** is 3 returns per workflow, a module constant. Per-template? Configurable?
3. **Timeout scheduling**: timeouts are inert until someone runs the command. When beat is deployed,
   register `workflow.process_timeouts` in the scheduler registry and remove the absence test.
4. **Approver preview of unsaved edits**: the preview reads the saved working copy. Previewing an unsaved
   node would need a POST (a node definition in the body); I kept the endpoint a GET.
5. **Notifications** for timeouts / 会签 / 通知 reuse `WORKFLOW_ASSIGNED` (and existing EventService
   plumbing) rather than new notification types.
6. `WorkflowEditor.tsx` is now ~1680 lines, most of them comments; not split (no defect to justify it).
