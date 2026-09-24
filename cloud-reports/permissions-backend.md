# 权限矩阵的部分保存与冲突检测、角色删除保护 —— 后端报告

Branch `feat/permissions-backend`, from `main` @ `4e0b778`.

**Migrations: none.** No model changed. `makemigrations --check --dry-run` → "No changes detected".

## Endpoint shapes

All new endpoints use the module's existing permission-management gate, `[IsAuthenticated, IsAdminPermission]` (ADMIN only). They are not tenant-filtered. Roles are global rows, and ADMIN is tenant-exempt everywhere, so a template in any tenant that names a role counts as a reference to that role. Each template ref carries `tenant_id` so the page can tell them apart.

### `POST /api/v1/perm/role-permissions/changes/`: per-cell save

```jsonc
// request
{ "changes": [ { "role": "JUDGE", "permission_id": 12, "action": "grant" | "revoke" }, ... ],   // 1..2000, one per cell
  "expected_versions": { "JUDGE": 7 } }                                                        // optional, per role
// 200 (always 200 once the body is valid; the per-cell status is the answer)
{ "saved": 2, "unchanged": 0, "refused": 1, "failed": 0,
  "results": [ { "index": 0, "role": "JUDGE", "permission_id": 12, "codename": "ledger.manage",
                 "action": "grant", "status": "saved" | "unchanged" | "refused" | "failed",
                 "code": null | "role_not_found" | "permission_not_found" | "version_conflict" | "database_error",
                 "detail": null | "..." } ],
  "versions": { "JUDGE": 8 } }       // each existing role named in the request, after the call
```
- A 400 means nothing was written. It covers a malformed body and a cell that appears twice.
- To show 「已存 2 项，失败 1 项」 and highlight the right cells, read `saved`/`failed`/`refused` and use each result's `(role, permission_id)` or `index`.
- `unchanged` means the cell was already in the requested state, so no row was written.

### `POST /api/v1/perm/role-permissions/impact/`: "what breaks" (read-only)

The request body is the same as for `changes/`; `expected_versions` is ignored.
```jsonc
{ "required_codenames": ["workflow.approve"],
  "conflicts": [ { "template_id": "uuid", "template_name": "跨文明移交 · 两级", "tenant_id": 1,
                   "civilization": "CHINESE", "is_active": true,
                   "step_order": 2, "step_name": "复核", "approver_roles": ["JUDGE"],
                   "caused_by": [ { "index": 1, "role": "JUDGE", "permission_id": 7, "codename": "workflow.approve" } ] } ] }
```

### Role table
- **`GET /api/v1/perm/roles/`**: each row gains three fields. The list endpoint computes them with annotations plus one template scan, not per-row queries.
  - `member_count`: every non-deleted holder, active or not. This is the number DELETE refuses over.
  - `permission_count`: RolePermission rows, i.e. the ticks the matrix shows.
  - `workflow_template_count`.
  - `user_count` is unchanged and still counts active holders only.
- **`PUT /api/v1/perm/roles/<pk>/`**: sending a `name` different from the current one is a 400 `{"name": ["A role's code cannot be changed after creation; ..."]}` (error code `immutable`). Sending the current name back is accepted.
- **`DELETE /api/v1/perm/roles/<pk>/`**: every refusal is now a 400 with a `code`:
  - `builtin_role`
  - `role_in_use` + `user_count`
  - `role_referenced_by_workflow_templates` + `templates: [{template_id, template_name, tenant_id, civilization, is_active, steps: [{step_order, step_name}]}]` (new)
  - Otherwise the role is soft-deleted into the recycle bin together with its grants, as before (`cascade_soft_delete`).
- **`POST /api/v1/perm/roles/<pk>/copy/`** (复制为新角色):
  - Body: `{name, display_name, scope?, organization?}`. `scope`/`organization` default to the source role's.
  - Returns 201 with the new Role.
  - A taken or binned name is a 400, using the same `_role_name_taken` check as create.
  - It copies the source's RolePermission rows, including `conditions` and `data_scope`, and writes one PERMISSION_CHANGE audit row (`copied_from`).
  - It does **not** copy `parent`, FieldPermission or RowLevelDataScope.

## Save semantics: per-cell savepoints (not all-or-nothing + dry-run)

The implementation is in `apps/perm/matrix.py`, whose module docstring explains the reasoning in full.

- **One transaction per role.** Each role runs in its own transaction, which locks the role row (`select_for_update`) and checks `expected_versions` under that lock.
- **One savepoint per cell.** If a cell fails, only that savepoint rolls back; the other cells of the same role still commit.
- **Version bump.** The role's `version` goes up once per role that saved anything, the same unit `assign` bumps.
- **Cache invalidation after commit.** It runs in `transaction.on_commit`, only for roles whose transaction committed. Before commit, another connection still reads the old grants and could re-cache them. A cell that rolled back has no row change, so whatever the cache holds for it is still true.
- **Audit.** Each cell is written with `.create()` or a queryset `.delete()` rather than the bulk forms, so the existing `_invalidate_permission_cache` signal writes a per-grant PERMISSION_CHANGE row for both grants and revokes. That covers the half `bulk_create` loses.

**Why not all-or-nothing + dry-run.**
- The refusals that exist are all about state: the rows existing, and the role's version. A dry run answers them for one moment, and the save can disagree a second later. `version_conflict` can only be decided under the lock.
- All-or-nothing would also mean one stale role blocks every other role's cells. The page's current per-role loop (`useMatrixSave.ts`, `savedBeforeFailure`) exists because partial success is what actually happens.

## Which refusal rules exist (and which do not)

Only rules that `assign_role_permissions` already enforces are encoded:

| code | existing rule |
|---|---|
| `role_not_found` | assign's 404 |
| `permission_not_found` | assign's 400 "Permission IDs not found" |
| `version_conflict` | assign's 409 (`expected_version`), applied per role |
| `database_error` | not a rule: the cell's savepoint rolled back |

**「彻底删除仅限 ADMIN」 does not exist as a rule.**
- `recycle_bin.hard_delete` is ADMIN-only only by **default grant** (`ROLE_PERMISSIONS`).
- `RecycleBinViewSet` gates it by codename alone, so granting it to JUDGE works today.

Other "rules" that appear only as comments are listed under open questions.

## How workflow steps map to roles

- **Storage.** `WorkflowTemplate.nodes_json` stores the steps; `normalize_template_node` reads either of the two stored shapes. A step names its approver in one of three ways:
  - `approver_type="ROLE"` + `approver_role`
  - an actor name (the `actor` key, or the label before 「 · 」)
  - nobody (SYSTEM)
- **Resolution.** `WorkflowService._resolve_approver` turns a step into approver columns. It tries the actor name first, then the role, then falls back to SYSTEM.
- **Who can approve.**
  - `approve_node` requires the codename `workflow.approve`; that is its only `extra_permissions` entry.
  - `ApprovalNode.can_approve` then requires `user.role == approver_role` for ROLE nodes, or `user.actor == approver_actor` for ACTOR nodes.
  - ADMIN gets no identity bypass.
- **The impact probe asks the real functions** rather than keeping a second copy of the rules:
  - It reads the required codenames from `ApprovalWorkflowViewSet.extra_permissions["approve_node"]`.
  - It resolves each step with `_resolve_approver` itself. A ROLE step whose label names a cast member therefore counts as the ACTOR step it would become.
  - Approver roles are `{approver_role}` for a ROLE step, the roles of the active users linked to the actor for an ACTOR step, and none for SYSTEM.
  - It reports a step when some approver role could approve before the changes and none can after. `caused_by` lists the revokes in the request that remove a required codename from one of those roles.
  - `before` comes from `check_permission`. ADMIN and SOUL short-circuit in the checker, so no change to their rows moves the answer.
- **Delete and counts use the stored reference.** `role_template_references` counts any step with `approver_type == "ROLE"` and a non-empty `approver_role` equal to the role. Deleting the role breaks that configured fallback even where an actor currently resolves first.
- **The design's example doesn't match this codebase.** There is no `OPERATOR` role and no 「落判」 codename. The only grant whose revocation can orphan a step is `workflow.approve`. The built-in roles are the `UserRole` values: ADMIN, MODERATOR, JUDGE, GUARDIAN, VIEWER (plus SOUL, which the role table cannot hold).

## Behaviour change to flag: role rename is gone

"The role `code` is immutable after creation" reverses the 2026-09-12 user decision (BP-07, 「允许改名并级联」).
- `RoleCreateUpdateSerializer.validate_name` now refuses a different name on update, for every role.
- The rename cascade in `update_delete_role` (User.role, Menu.roles, both cache names, audit row) could no longer be reached, so it was removed along with `_rename_role_in_menus`.
- The three rename tests in `tests/test_custom_roles_can_be_held_renamed_and_binned.py` were replaced by one refusal test. The built-in-rename test now expects the immutability message.
- **Frontend not touched.** `RoleFormModal` still lets a custom role's name be edited, and saving a changed name now gets a 400. The drawer redesign should make `name` read-only when editing.

## Open questions (candidate rules, not implemented)

1. **Should 「彻底删除 / 恢复 仅限 ADMIN」 become a server rule?** It is written as intent in `DEFAULT_PERMISSIONS` comments and `RecycleBinViewSet`'s docstring ("ADMIN-only"), but nothing enforces it. If yes, the save would refuse granting `recycle_bin.*` to non-ADMIN roles (code e.g. `admin_only_permission`).
2. **Should MODERATOR be forbidden `workflow.approve` / `workflow.advance` / `user.manage`?** `ROLE_PERMISSIONS` has a long comment saying so (separation of duties, tenant escape), and `test_matrix_snapshot.py` asserts the default. The matrix can grant them today.
3. **Revoking from ADMIN:** the row is written, but `check_permission` still answers True (short-circuit). Should the save refuse it, or mark it `effective: false`? Today it just saves.
4. **Should `changes/` refuse a revoke that `impact/` flags** unless the client sends an acknowledgement? Today the pre-check is advisory.
5. **Should in-flight workflows count?** `impact/` only analyses templates. Live `ApprovalWorkflow`s with PENDING ROLE nodes are equally affected.
6. **Copy scope:** should "copy as new role" also copy FieldPermission / RowLevelDataScope rows?
7. **Inactive templates** (`is_active=False`) block a role delete like active ones. Should they?
8. **Restoring a template from the recycle bin** can bring back a reference to a role deleted since. Nothing checks that.

## Gates (Python 3.11 `backend/.venv`, Node v20.19.5, throwaway Redis on 127.0.0.1:6399 db 0/1/2)

| gate | command | exit | result |
|---|---|---|---|
| full pytest | `cd backend && DATABASE_URL=sqlite:///:memory: REDIS_URL=…6399/0 CELERY_*=…/1,/2 .venv/bin/python -m pytest --tb=short -q` | 0 | **4488 passed, 24 skipped** (36m16s) |
| ruff | `cd backend && .venv/bin/ruff check .` | 0 | clean |
| migrations | `cd backend && .venv/bin/python manage.py makemigrations --check --dry-run` | 0 | No changes detected |
| schema gate | `cd backend && .venv/bin/python manage.py spectacular --validate --fail-on-warn --file …` | 0 | **0 warnings / 0 errors**; output byte-identical to the committed `packages/core/openapi/schema.yml` (`cmp` exit 0); `schema.ts` regenerated with `npm run schema:generate --workspace @soulledger/core` (+303 lines, no deletions: existing enum names kept via `ENUM_NAME_OVERRIDES`) |
| core typecheck | `npm run --workspace packages/core typecheck` | 0 | clean |
| core lint | `npm run --workspace packages/core lint` | 0 | 0 warnings |
| core test | `npm run --workspace packages/core test` | 0 | 12 files / **118 passed** (incl. `generatedSchemaIsCurrent`) |
| frontend tsc | `cd frontend && npx tsc --noEmit` | 0 | clean |
| frontend test:coverage | `cd frontend && npm run test:coverage` | 0 | 169 suites / **3125 passed**, thresholds met; `usePermissionMatrix.ts` 100% |

The full pytest run happened before one test file was rewritten to satisfy ruff: two nested `with` blocks were merged into one, with no change in meaning. That file was re-run on its own afterwards: 21 passed.

**Mutation proofs** (each guard broken, the suite run, the change reverted; `tests/test_perm_matrix_and_role_table.py`, 21 tests):

| mutation | result |
|---|---|
| impact probe ignores proposed changes | 2 failed |
| ROLE steps resolve to no approver | 2 failed |
| referenced-template delete refusal removed | 1 failed |
| per-cell savepoint removed | 1 failed |
| restored | 21 passed |

**Not run:** the PostgreSQL path. There is no database host in this environment. The version check relies on `select_for_update`, which SQLite ignores, so the lock itself is unverified here.
