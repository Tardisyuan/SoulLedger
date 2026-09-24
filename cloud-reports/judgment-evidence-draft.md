# feat(judgment): 证据采信与判词草稿自动保存

> **THIS BRANCH CONTAINS MIGRATIONS** — `backend/apps/judgment/migrations/0023_evidence_admission_and_verdict_draft.py`.

Branch `feat/judgment-evidence-draft`, from `main` @ `4e0b778`.
The maintainer decision holds: the 5-second undo after 落判 is **not** built, and the timing of the conclude flow is untouched.

## Model and migrations

Migration `judgment/0023` (additive only, no data step):

| Change | Why |
|---|---|
| `EvidenceAdmission` (new table): `judgment` FK CASCADE, `record` FK → `souls.SoulRecord` **RESTRICT**, `admitted` bool, `reason` text, `tenant`, AuditUserFields | One ruling per (judgment, record). **Not a flag on the record**, because the same deed can be admitted in one case and not in another (an amendment case, a reopened retrial, a second court reading the same life); a column on `SoulRecord` would let the second ruling overwrite the first. Same shape as `JudgmentCitation`. |
| `UniqueConstraint(judgment, record) WHERE is_deleted = false` | One live ruling per record per case (reversing a ruling updates it). |
| `CheckConstraint admitted OR reason <> ''` | A not-admitted ruling without a reason is refused by the DB as well as the service. |
| `Judgment.draft_verdict` (nullable, `Verdict` choices), `draft_saved_at`, `draft_version` (uint, default 0) | What the draft was missing (see below). |

Semantics: **no row means admitted**. A row is written when an officer rules. Reversing a ruling keeps the row with `admitted=True` and clears the reason, so who reversed it stays on the row. `record` is RESTRICT: hard-deleting a record a court has ruled on is refused, while deleting the soul (which cascades to both the record and the judgment) still works.

Only MERIT and DEMERIT records of **the judgment's soul, in the judgment's `cycle`**, can be ruled on. JUDGMENT/DISPOSITION entries score nothing.

## Endpoints

| Method / path | Body | Answers |
|---|---|---|
| `PUT /api/v1/judgment/{id}/evidence/{record_id}/` | `{"admitted": bool, "reason": "…"}` | 200 `{admission, admitted_balance}` · 400 no reason when not admitting, or the record is not evidence in this case · 409 `{"code": "concluded"}` · 404 another tenant's judgment · 403 without `judgment.execute` |
| `PATCH /api/v1/judgment/{id}/draft/` | `{"version": n, "notes"?: "…", "draft_verdict"?: "FAILED" \| … \| null}` | 200 `{notes, draft_verdict, draft_version, draft_saved_at}` · 409 `{"code": "draft_conflict", "current": {…}}` · 409 `{"code": "concluded", "current": null}` · 400 without `version` |
| `GET /api/v1/judgment/{id}/` (changed) | — | Now `JudgmentDetail`: the list fields, plus `evidence_admissions[]` and `admitted_balance`. The list endpoint does **not** carry the balance, because computing it walks the soul's ledger. |

`admitted_balance` = `{reading_kind, balance, not_admitted_count, not_admitted_net, reason_code}`.

**Permissions.** Both writes map to `judgment.execute`, the same codename `conclude` maps to (`JudgmentViewSet.extra_permissions`). Both go through the same `get_object()` tenant/data scoping. Today conclude has **no per-judge assignment check**: any holder of `judgment.execute` in the tenant (ADMIN, JUDGE, MODERATOR) may conclude, so "the officer allowed to conclude" means exactly that set. See the open questions.

**Freeze.** Both writes are refused once `verdict` is set or `is_final` is true. The ruling locks the judgment row (`select_for_update`) before checking. The draft write is a single conditional `UPDATE … WHERE verdict IS NULL AND NOT is_final`. So a ruling or save that races `conclude/` either lands before the verdict or is refused after it.

Core additions: types `JudgmentDetail`, `AdmittedBalance`, `EvidenceAdmission`, `EvidenceRulingResult`, `JudgmentDraft`, `JudgmentDraftConflict` (taken from the generated schema), and the draft fields on `Judgment`. Calls `judgmentApi.ruleEvidence` / `judgmentApi.saveDraft` (`judgmentApi.get` now returns `JudgmentDetail`). Hooks `useRuleEvidence(id)`, which invalidates only this detail, and `useSaveJudgmentDraft(id)`, which writes the saved draft into the cached detail with no refetch and no toast. **No page UI was changed.**

## Admitted balance: arithmetic

`LedgerService.get_admitted_balance(soul, cycle, not_admitted_ids)` repeats `get_ledger_summary`'s arithmetic record for record:

- the same decay anchor and rate (`_get_decay_anchor`, `_decay_rate_for`, `_get_record_age_years`, `_decay_weight`);
- the same `inherited_merit` / `inherited_demerit` base;
- unrounded accumulation, rounded once;
- the balance is **read off `get_civilization_reading`**, not recomputed.

The only difference is that the not-admitted records are left out. With nothing excluded it equals `reading["balance"]`, and a test pins this, including with a non-zero carry-over.

- **CHINESE** (the reading `kind` is `BALANCE`): `balance` is an int; `not_admitted_net` is the signed sum of the excluded records' decayed weights (merit +, demerit −), rounded to 2 places. This is the "±X" in 「采信后余额（未采信 N 条 ±X）」.
- **EGYPTIAN / EUROPEAN / GREEK**: `balance: null`, `not_admitted_net: null`, `reason_code: "BALANCE_NOT_APPLICABLE"`, and `reading_kind` set to `THRESHOLD` / `GUILT_AND_PENALTY` / `SENTENCE`. That is the existing convention: `JudgmentQueueContext` shows "not applicable" whenever `reading.kind !== "BALANCE"`. Netting excluded items would be the very subtraction those readings refuse. `not_admitted_count` is still returned, because it is a fact about admission, not a reading.
- **Unmapped tenant**: `reading_kind: "UNAVAILABLE"`, and the reading's own `reason_code: "TENANT_NOT_MAPPED"`.
- **A judgment from an earlier life** (`judgment.cycle != soul.life_index`): `balance: null`, `reason_code: "NOT_CURRENT_LIFE"`. The carry-over is stored only for the current life, so re-summing an old life on today's base would be a wrong figure.

The two new codes are constants in `apps/ledger/readings.py`. They are deliberately **not** in `UNAVAILABLE_REASON_CODES`, because they don't mean a reading is missing.

## Is conclude affected? No, and that is an explicit, tested choice

Conclude **does** use the ledger, but never the admitted figure. Where it reads the ledger (`backend/apps/disposition/services.py`, `DispositionService._route_to_realm`, reached from `JudgmentConclusionService.conclude_judgment` → `DispositionService.create_from_judgment`):

- line 181: `karma = soul.karmic_balance`, the full denormalised balance;
- CHINESE + FAILED: `LedgerService.get_unoffset_demerit(soul)` (full ledger, 不可折 partition) picks the court, falling back to `abs(karma)` when it is None (`_route_chinese`, `severity = …`);
- EUROPEAN: `soul.demerit_score` (culpa, full ledger);
- EGYPTIAN STANDARD PURGATORY/RETRY: `karma >= 50` → Aaru (`_route_egyptian`);
- GREEK: no ledger figure.

None of this was changed. `tests/test_judgment_evidence_and_draft.py::test_conclude_routing_ignores_admission` pins it. A soul whose only record is a 95-point demerit is ruled "not admitted" (admitted balance 0), and a FAILED verdict still routes to the same court as before, not to the mildest one. If admission should reach routing, that test is where the change starts.

Conclude also still writes `notes` from its own payload, so the submitted text wins over the last autosave (tested).

## Draft concurrency design

- **`notes` already is the draft.** Before conclusion, the detail page's textarea seeds from `judgment.notes` (the `notesTouched` guard in `app/judgment/[id]/page.tsx`), and conclude overwrites it. Until now nothing saved it server-side except conclude. So the autosave **writes `notes`**, and only adds `draft_verdict`, `draft_saved_at` and `draft_version`. `verdict` cannot double as the draft verdict, because a non-null `verdict` *means* concluded (`open_judgments`). The `notesTouched` guard keeps working unchanged: the server stays the source until the field is touched, and `useSaveJudgmentDraft` writes into the cached detail rather than refetching.
- **A dedicated `draft_version`, not AuditUserFields' `version`.** `version` increments on every save of the row (archive, a `court` edit…), which would give an officer in mid-sentence a false 409. `draft_version` moves only when draft content changes.
- **Precondition = one conditional UPDATE**: `UPDATE … SET …, draft_version = draft_version + 1 WHERE id = ? AND draft_version = <expected> AND verdict IS NULL AND NOT is_final`. Two saves against the same version cannot both match on any database. The loser gets **409 `draft_conflict` with `current`** (the text and version that beat it), so the client can show it rather than retry blind. This follows the `expected_version` → 409 + current precedent in `apps/perm/views.py`.
- **Idempotent**: a save whose fields already equal the stored ones is a 200 no-op returning the stored state, whatever version it carries. A retried request whose first attempt landed doesn't conflict with itself, and it overwrites nothing.
- **The plain `PATCH /judgment/{id}/` also moves `draft_version` when it changes `notes`** (`perform_update`), so an autosave loaded before such a write gets a 409 instead of replacing it. The draft fields are read-only on the plain PATCH.
- **Audit**: custom actions are not `perform_*`, so `AuditUserViewSetMixin` does not set the author for them. Both new actions set it themselves, and the tests assert `create_user` / `update_user`.

## Mutation proofs (run, then restored)

| Mutation in `apps/judgment/services.py` | Result |
|---|---|
| A: `_assert_open` returns immediately, and the conditional UPDATE drops `verdict IS NULL AND NOT is_final` | **5 failed** / 33 passed: every `TestFrozenAfterConclude` test goes red |
| B: the version pre-check is deleted **and** `draft_version=` is dropped from the conditional UPDATE (last-write-wins) | **2 failed** / 36 passed: `test_stale_version_is_409_with_what_beat_it`, `test_a_plain_patch_of_notes_moves_the_draft_version` |
| C: only the version pre-check is deleted | 38 passed. This is expected: the conditional UPDATE alone still returns the 409. The pre-check is a fast path, and the UPDATE is the guard. |

## Open questions

1. **Should conclude route on the admitted evidence?** It doesn't today, on purpose (see above). Changing it would alter which court a FAILED Chinese soul goes to, and the Egyptian `karma >= 50` → Aaru branch. It needs a maintainer decision, and probably a per-cosmology one.
2. **"Only the officer allowed to conclude"** = holders of `judgment.execute` in the tenant, because conclude has no per-judge check (`Judgment.judge` is not enforced anywhere). If only the seated judge should conclude, rule or draft, that check belongs on conclude first.
3. **The admitted balance on a concluded judgment is live, not a snapshot.** Decay keeps moving it after 落判. If the desk should show the figure *as at* conclusion, it needs to be stored at conclude time. That is a change to the conclude flow, so it was left alone.
4. **Conclude's full `judgment.save()`** writes back the draft columns it loaded. An autosave that lands between conclude's `get_object()` and its save can see `draft_version` reverted by one. The draft is frozen from then on and `notes` comes from conclude's payload, so nothing user-visible is lost. Fixing it means `update_fields` on conclude, which is the flow this task was told not to touch.
5. **The plain `PATCH /judgment/{id}/` of `notes` is itself still last-write-wins.** It bumps `draft_version` so autosaves notice it, but it takes no precondition. No client uses it today; it could be refused for `notes` on open cases.
6. **Pre-existing, not changed:** `cite_statute` / `uncite` are also custom actions and write `JudgmentCitation` rows with `create_user = None` (same cause as above).
7. The row lock in `EvidenceAdmissionService.rule` and the race-safety of the conditional UPDATE are PostgreSQL properties that the SQLite suite cannot exercise. The PostgreSQL run in `CLAUDE.md` was not possible here (no access to 115).

## Gates

Environment: Python 3.11 `backend/.venv` from `requirements.lock` + `requirements-dev.txt`; node v20.19.5; `npx -y npm@11 ci` + `npm rebuild …`, then `git checkout -- package-lock.json`. A throwaway `redis-server` ran on port 6399 (`--save '' --appendonly no`), with REDIS_URL / CELERY_BROKER_URL / CELERY_RESULT_BACKEND pointed at `/0` `/1` `/2`. Backend prefix: `SECRET_KEY=ci-test-key-not-for-production DEBUG=true DATABASE_URL="sqlite:///:memory:"`.

| Gate | Command | Exit | Result |
|---|---|---|---|
| Full pytest | `cd backend && <prefix> REDIS_URL=… CELERY_*=… .venv/bin/python -m pytest --tb=short -q` | **0** | **4506 passed, 24 skipped** (37m37s) |
| New tests alone | `.venv/bin/python -m pytest tests/test_judgment_evidence_and_draft.py -q --no-cov` | 0 | 38 passed |
| ruff | `cd backend && .venv/bin/ruff check .` | **0** | All checks passed (the first full run flagged import order in the generated migration; fixed with `ruff --fix`, an import-order-only change made after the pytest run) |
| migrations | `<prefix> .venv/bin/python manage.py makemigrations --check --dry-run` | **0** | No changes detected (after 0023) |
| schema: spectacular | `<prefix> .venv/bin/python manage.py spectacular --validate --fail-on-warn --file …` | **0** | **0 warnings / 0 errors**; output byte-identical to the committed `packages/core/openapi/schema.yml` |
| schema: backend tests | `pytest tests/test_schema_has_no_warnings.py tests/test_committed_schema_matches_the_backend.py tests/test_declared_response_shapes_match_the_views.py` | 0 | 9 passed |
| schema: TS | `npm run schema:generate --workspace @soulledger/core` | 0 | regenerated `src/api/generated/schema.ts` (pinned by core's `generatedSchemaIsCurrent.test.ts`, below) |
| core typecheck | `npm run --workspace packages/core typecheck` | **0** | — |
| core lint | `npm run --workspace packages/core lint` | **0** | — |
| core test | `npm run --workspace packages/core test` | **0** | 12 files, 118 passed |
| frontend tsc | `cd frontend && npx tsc --noEmit` | **0** | — |
| frontend lint | `cd frontend && npm run lint` | 0 | — |
| frontend coverage | `cd frontend && npm run test:coverage` | **0** | 168 suites, **3122 passed**; thresholds held. The first run was red for a real reason: `domainDisplayContract.test.tsx` requires every string-union API field in `ENUM_FIELDS`, so `draft_verdict` was added there. |

Not run: the PostgreSQL pass, E2E (no UI change), and pip-audit (no dependency change).
