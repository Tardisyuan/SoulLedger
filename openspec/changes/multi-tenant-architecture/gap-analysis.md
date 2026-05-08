# SoulLedger Multi-Tenant Architecture — Gap Analysis

> **Review Date:** 2026-05-09
> **Reviewer:** Hermes Agent (Critical Review)
> **Files Reviewed:** SPEC.md, dispatch-design.md, permission-design.md, design.md, tasks.md

---

## Executive Summary

The SPEC.md (~1500 lines) and supporting documents provide a solid architectural foundation for SoulLedger's multi-tenant soul management system. However, **critical gaps exist in cross-tenant authentication mechanics, state machine consistency between dispatch lifecycle and Soul.state, reincarnation after dispatch, and edge case handling**. The dispatch-design.md and SPEC.md have **naming inconsistencies** (approve vs dispatch_confirm, TENANT_ADMIN vs DISPATCH_JUDGE role naming) that would cause implementation conflicts.

---

## I. CRITICAL GAPS — Must Fix Before Implementation

### CG-1: Cross-Tenant API Authentication/Authorization Not Defined

**Files:** SPEC.md §6.11, dispatch-design.md §4

**Problem:** When tenant A's judge needs to review tenant B's soul during cross-tenant judgment, how does the judge authenticate against tenant B's API? The JWT is issued by tenant A, but tenant B's Django instance needs to validate it. There is no mechanism described for:
- Token validation across tenants (shared secret? token exchange? service tokens?)
- How a tenant B judge sees tenant A's soul data during joint review
- Whether cross-tenant API calls use the same `/api/v1/dispatch/` prefix or different tenant-specific prefixes

**Suggested Fix:** Define a cross-tenant authentication strategy:
```
Option A: Service account tokens — ADMIN generates service tokens for cross-tenant API access
Option B: Token forwarding — judge uses their JWT; target tenant's middleware validates via shared secret
Option C: Delegation — source tenant issues a limited proxy token for the specific judgment session
```
Document the flow: "Tenant A's judge calls POST /api/v1/cross-tenant-judgments/{id}/participate/ — the request hits tenant B's Django which validates the JWT from a shared secret."

---

### CG-2: State Machine Inconsistency — dispatch lifecycle vs Soul.state

**Files:** SPEC.md §4.2 vs dispatch-design.md §3.2

**Problem:** Two incompatible state machine descriptions:

**SPEC.md §4.2:**
```
DISPOSED → PENDING_DISPATCH → DISPATCHED → REINCARNATING → ALIVE
```

**dispatch-design.md §3.2:**
```
null → PENDING_DISPATCH → DISPATCHED → COMPLETED → return_to_source() → null
```

Key contradictions:
1. SPEC says DISPATCHED → REINCARNATING; dispatch-design says DISPATCHED → COMPLETED
2. dispatch-design introduces `COMPLETED` state not in SPEC's Soul.state enum (ALIVE/JUDGING/DISPOSED/REINCARNATING/LOST)
3. dispatch-design shows `return_to_source()` but SPEC §4.2 shows no return — soul stays in target tenant for reincarnation
4. `dispatch_confirm()` in dispatch-design vs `approve()` in SPEC naming mismatch

**Suggested Fix:** Choose ONE canonical state machine. Recommend keeping Soul.state unchanged (ALIVE/JUDGING/DISPOSED/REINCARNATING/LOST) and tracking dispatch progress via `dispatch_status` only. Clarify:
- Does soul go to REINCARNATING in source or target tenant after dispatch completes?
- Is there a `COMPLETED` dispatch_status that is distinct from REINCARNATING?
- Does `return_to_source()` exist, and if so, what triggers it?

---

### CG-3: Reincarnation After Dispatch — Source vs Target Tenant

**Files:** SPEC.md §4.2, §5.3.2

**Problem:** The SPEC states:
- "跨租户轮回：灵魂在外派目标租户的地域完成轮回，不是来源租户" (§4.2)
- But ADR-006 says "目标租户轮回完成 → 灵魂返回来源租户" (Section 14 of ADR-006)

These directly contradict each other. Additionally, when soul reincarnates in target tenant, does it use target tenant's Realm pool? If the soul was CN_DIYU but reincarnates in EU_HEAVEN_HELL, does it get a European realm or does it return to Chinese轮回?

**Suggested Fix:** Decide and document: "After dispatch punishment completes, the soul [returns to source tenant for reincarnation / stays in target tenant for reincarnation]." If returning, specify the mechanism (who triggers return, what state transition).

---

### CG-4: CrossTenantJudgment Lifecycle — What Happens on REJECTED?

**Files:** SPEC.md §6.11.2, dispatch-design.md §3.1

**Problem:** SPEC §6.11.2 shows:
```
PROPOSED → IN_REVIEW → APPROVED/REJECTED
         ↓
    verdict 判决
         ↓
   → 执行处置或外派
```

If the judgment is REJECTED, what happens to the soul? Does it:
- Return to JUDGING in source tenant for a normal (non-cross-tenant) judgment?
- Stay in DISPOSED awaiting source tenant's local disposition?
- Something else?

The dispatch-design §3.1 test scenario shows REJECTED judgment → "S1 在 CN_DIYU 正常审判" which implies it goes back to normal judgment flow. But this is not formally specified.

**Suggested Fix:** Add to SPEC §6.11.2: "If CrossTenantJudgment.status = REJECTED, the soul returns to JUDGING state in the source tenant for standard disposition processing."

---

### CG-5: Karma Records After Dispatch — Who Owns Them?

**Files:** SPEC.md §3.5, §5

**Problem:** When a soul is dispatched from tenant A to tenant B:
- SoulRecord.tenant is set at creation time (derived from Soul.tenant)
- But if soul.dispatched_to_tenant = B, the karma records were created under tenant A's context
- If tenant B's judge needs to see karma during punishment execution, do they see tenant A's records?
- When soul returns (if it returns), do karma records stay with source or move with soul?

**Suggested Fix:** Define karma record ownership policy:
- "Karma records remain owned by source tenant (Soul.tenant) even after dispatch"
- "Target tenant judges can VIEW karma during cross-tenant judgment but cannot MODIFY"
- Or: "Karma records are COPIED to target tenant at dispatch time for local access"

---

## II. IMPORTANT REFINEMENTS — Should Clarify Before Implementation

### IG-1: Missing Pagination and Filtering Spec for List Endpoints

**Files:** SPEC.md §6

**Problem:** All list endpoints (GET /souls/, GET /dispatch/, GET /cross-tenant-judgments/) lack pagination/filtering specification:
- No page/page_size query params defined
- No filtering by state, date range, tenant (for ADMIN) defined
- No ordering specified

**Suggested Fix:** Add to SPEC §6: "All list endpoints support `?page=1&page_size=20&ordering=-created_at&state=JUDGING`."

---

### IG-2: Timeout for Cross-Tenant Judgments Not Specified

**Files:** SPEC.md §5.5, dispatch-design.md §3.1

**Problem:** If a cross-tenant judgment has 3 tenants involved and one judge's vote is still pending after 30 days, what happens?
- Is there a timeout?
- Does the judgment auto-conclude with majority?
- Does it stay IN_REVIEW forever?
- Is there a reminder/escalation?

**Suggested Fix:** Add to SPEC §5.5 or dispatch-design.md §3: "CrossTenantJudgment votes have a 7-day timeout per participant. If a participant does not vote within 7 days, they are automatically marked as ABSTAIN. The CHAIRMAN can extend the timeout."

---

### IG-3: Concurrent Operations Not Handled

**Files:** SPEC.md §4, dispatch-design.md §3.3

**Problem:** No mention of race conditions:
1. Two judges from different tenants try to conclude the same CrossTenantJudgment simultaneously — who wins?
2. Two dispatch proposals for the same soul (soul is in DISPOSED state) — is this prevented?
3. Soul is being dispatched while a local judge tries to execute disposition locally

**Suggested Fix:** Add concurrency handling section:
- "Use SELECT FOR UPDATE on Soul during state transitions to prevent concurrent modifications"
- "A soul in PENDING_DISPATCH or DISPATCHED state cannot accept another dispatch proposal"
- "Concurrent conclude_judgment() calls: first writer wins, second gets 409 Conflict"

---

### IG-4: Target Tenant Realm Full — Dispatch Rejection?

**Files:** SPEC.md §5.3.2, §5.3.4

**Problem:** Edge case: Soul is dispatched to tenant B, but tenant B's target realm (e.g., Hell tier 3) is at full capacity. What happens?
- Does dispatch auto-reject?
- Does it queue?
- Does it dispatch to an alternate realm?

**Suggested Fix:** Add to dispatch workflow: "Before approving dispatch, target tenant judge should verify target realm has capacity. If full, reject with alternative_target suggestion."

---

### IG-5: Soul Recall After Dispatch

**Files:** SPEC.md §4.2, dispatch-design.md §3.2

**Problem:** Soul is in DISPATCHED state (already moved to target tenant). What if source tenant needs to recall it?
- Is recall possible?
- What state does it return to?
- Can target tenant refuse to release?

**Suggested Fix:** Add to SPEC §4.3: "DISPATCHED souls can be recalled by source tenant ADMIN before punishment execution begins. Recall triggers SOUL_RETURNED event, sets dispatch_status=null, and returns soul to DISPOSED state."

---

### IG-6: Error Response Documentation Missing

**Files:** SPEC.md §6

**Problem:** No error response format defined. What does the API return on:
- 400 Bad Request (validation error)?
- 401 Unauthorized?
- 403 Forbidden (wrong tenant)?
- 404 Not Found?
- 409 Conflict (state transition error)?

**Suggested Fix:** Add error response schema:
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Human readable message",
  "details": { "field": ["error1", "error2"] }
}
```

---

### IG-7: Field-Level Visibility for dispatch_status Incomplete

**Files:** SPEC.md §6.X.2, permission-design.md §2.3

**Problem:** SPEC §6.X.2 shows dispatch_status visible to TENANT_ADMIN and JUDGE but hidden from GUARDIAN and VIEWER. However:
- dispatch_status is also visible to DISPATCH_JUDGE (the role that approves dispatches)
- The permission matrix in SPEC §6.X.2 does not mention DISPATCH_JUDGE at all

**Suggested Fix:** Update permission matrices to explicitly include DISPATCH_JUDGE role and its field-level visibility.

---

### IG-8: UI/UX for Cross-Tenant Judgment Session Unclear

**Files:** SPEC.md §7, dispatch-design.md §3.1

**Problem:** How does the frontend display a joint judgment session where judges from 3 tenants participate?
- Do all judges see the same UI simultaneously (real-time)?
- What language do they use?
- How do they vote (one-click or discussion first)?
- Is there a chat/messaging system for deliberation?

**Suggested Fix:** Add a section to SPEC §7 or a new UI spec doc: "Cross-judgment session UI: judges from multiple tenants see a shared session view. Language defaults to source tenant's language. Voting is one-click per judge. No built-in chat — judges use external communication."

---

## III. INCONSISTENCIES FOUND — Contradictions Between Sections

### INC-1: Role Naming — TENANT_ADMIN vs DISPATCH_JUDGE vs DISPATCH_JUDGE Role Visibility

**Files:** SPEC.md §3.3, §6.X.1, dispatch-design.md §5.1, permission-design.md §2

**Problem:** Multiple naming conventions for the same concept:
- SPEC §3.3 User model: ADMIN / JUDGE / GUARDIAN / VIEWER / DISPATCH_JUDGE
- SPEC §6.X.1 permission section: TENANT_ADMIN (not ADMIN) / JUDGE / GUARDIAN / VIEWER / ADMIN
- dispatch-design §5.1: DISPATCH_JUDGE
- permission-design §2: TENANT_ADMIN / JUDGE / GUARDIAN / VIEWER / ADMIN (no DISPATCH_JUDGE mentioned)

CONFUSION: Is ADMIN a global role (TENANT_ADMIN of each tenant) or a separate role? In some places it seems ADMIN = global read-only, in others TENANT_ADMIN = per-tenant admin.

**Suggested Fix:** Standardize on:
- **ADMIN** = global read-only (cross-tenant stats only)
- **TENANT_ADMIN** = per-tenant full CRUD (阎罗王/撒旦/奥西里斯)
- **DISPATCH_JUDGE** = can participate in foreign tenant's cross-tenant judgments
- Keep JUDGE, GUARDIAN, VIEWER as-is

---

### INC-2: API Endpoints — /dispatch/ vs /dispatch/judgments/ vs /dispatch/records/

**Files:** SPEC.md §6.11, dispatch-design.md §4

**Problem:** SPEC §6.11.1 uses:
- POST /api/v1/dispatch/propose/
- GET /api/v1/dispatch/{id}/
- POST /api/v1/dispatch/{id}/approve/

dispatch-design.md §4 uses:
- POST /api/v1/dispatch/judgments/
- GET /api/v1/dispatch/records/
- POST /api/v1/dispatch/records/{id}/confirm/

These are clearly different API designs. Which is current?

**Suggested Fix:** Pick one. The SPEC.md version (/dispatch/propose/, /dispatch/{id}/approve/) is more RESTful. dispatch-design.md appears to be an older version or alternative design.

---

### INC-3: State Transition Naming — approve() vs dispatch_confirm()

**Files:** SPEC.md §4.3, dispatch-design.md §3.3

**Problem:** SPEC §4.3 says "PENDING_DISPATCH → DISPATCHED (approve())" but dispatch-design.md §3.3 says "PENDING_DISPATCH → dispatch_confirm() → DISPATCHED". Same operation, different names.

**Suggested Fix:** Use `approve()` consistently as the event that moves from PENDING_DISPATCH to DISPATCHED.

---

### INC-4: dispatch_status ENUM Values Inconsistent

**Files:** SPEC.md §3.4 vs dispatch-design.md §2.1

**Problem:** SPEC §3.4 dispatch_status values:
- null / PENDING_DISPATCH / DISPATCHED / COMPLETED

dispatch-design.md §2.1 dispatch_status values:
- null / PENDING_DISPATCH / DISPATCHED / COMPLETED

These actually match. BUT SPEC.md §4.4 and §4.2 talk about "REINCARNATING" as the target state after dispatch, while dispatch-design §3.2 shows "COMPLETED → return_to_source()".

**Suggested Fix:** Clarify dispatch_status = COMPLETED meaning: "Soul has finished punishment, awaiting return to source tenant." Then Soul.state moves to REINCARNATING in source tenant after return.

---

### INC-5: dispatch_enabled Field — Present But Not Used

**Files:** SPEC.md §3.2, §9 (Milestone 3)

**Problem:** Tenant.dispatch_enabled is defined in §3.2 and listed as a task in M3 ("dispatch_enabled: 是否允许接收外派灵魂"), but:
- There is no logic in SPEC showing how dispatch_enabled is checked
- If dispatch_enabled=False, does that mean the tenant can't receive dispatches?
- Should the propose_dispatch() check target_tenant.dispatch_enabled before creating the record?

**Suggested Fix:** Add to dispatch workflow: "Before creating DispatchRecord, verify target_tenant.dispatch_enabled = true. If false, return error: 'Target tenant not accepting dispatches.'"

---

### INC-6: Cancel Transition Destination

**Files:** SPEC.md §4.2, §4.3

**Problem:** SPEC §4.2 diagram shows "cancel() → 返回 DISPOSED (本地处置)" but §4.3 table says PENDING_DISPATCH can go to DISPOSED via reject/cancel. However, if the soul was originally in JUDGING (before conclude), canceling dispatch might mean it stays in JUDGING, not DISPOSED.

**Suggested Fix:** Clarify cancel() behavior: "cancel() is only valid from PENDING_DISPATCH. It reverts Soul.state to what it was before propose_dispatch() was called (typically DISPOSED, but if the soul never concluded judgment, it returns to JUDGING)."

---

## IV. NICE-TO-HAVE REFINEMENTS — Can Defer

### NH-1: Future Independent Deployment API Mechanics Unclear
dispatch-design.md §6 shows the architecture but doesn't specify the API contract for when tenants are on separate servers. What happens to the dispatch workflow in split-mode?

### NH-2: Notification System Not Specified
How do DISPATCH_JUDGE users get notified of incoming cross-tenant judgment invitations? Email? In-app notification? Nothing?

### NH-3: Audit Trail for State Transitions
SoulEvent model exists but which events specifically are recorded? Not all state transitions may generate events.

### NH-4: Settings Drawer, Theme, Personal Center Are Optional
These UI features in §7.X are marked optional but are listed in M4 milestone. Either implement them or remove from milestone.

---

## V. RECOMMENDATION: Which Gaps to Address Now vs Later

### Address in M3 (Current Milestone):

| Gap | Reason |
|-----|--------|
| **CG-1**: Cross-tenant auth | Without this, dispatch module cannot work at all |
| **CG-2**: State machine consistency | Implementation will be blocked without clear state model |
| **INC-1**: Role naming standardization | Will cause confusion across all subsequent development |
| **INC-2**: API endpoints choice | Need one canonical API design before coding |
| **INC-3**: approve() vs dispatch_confirm() naming | Code consistency issue |
| **INC-5**: dispatch_enabled check | Safety check needed in dispatch flow |
| **IG-1**: Pagination spec | All list endpoints need this before implementation |

### Address in M4/M5:

| Gap | Reason |
|-----|--------|
| CG-3: Reincarnation after dispatch | M5 (dispatch) depends on this |
| CG-4: REJECTED judgment → soul fate | M5 dispatch module uses this |
| CG-5: Karma record ownership | M5 dispatch needs this policy |
| IG-2: Judgment timeout | M5 cross-tenant judgment uses this |
| IG-3: Concurrent operations | M5 dispatch race conditions |
| IG-4: Realm full handling | M5 dispatch edge case |
| IG-5: Soul recall | M5 dispatch enhancement |
| IG-6: Error responses | M5 API completeness |
| IG-7: DISPATCH_JUDGE in permission matrix | M5 dispatch permissions |
| IG-8: Cross-tenant judgment UI | M5 frontend |
| INC-4: COMPLETED vs REINCARNATING | M5 state clarification |
| INC-6: Cancel destination | M5 dispatch behavior |

### Can Defer to M6+:

| Gap | Reason |
|-----|--------|
| NH-1: Independent deployment API | Future architecture, not in current scope |
| NH-2: Notification system | Not in current SPEC |
| NH-3: Audit trail details | Can be added later |
| NH-4: Settings drawer/theme | Marked optional in spec |

---

## VI. SUMMARY TABLE

| ID | Severity | Section | Issue | Blocking M3? |
|----|----------|---------|-------|--------------|
| CG-1 | CRITICAL | SPEC §6.11 | Cross-tenant auth undefined | YES |
| CG-2 | CRITICAL | SPEC §4.2, dispatch-design §3.2 | State machine inconsistency | YES |
| CG-3 | CRITICAL | SPEC §4.2, ADR-006 | Reincarnation destination unclear | YES (for M5) |
| CG-4 | CRITICAL | SPEC §6.11.2 | REJECTED judgment fate undefined | YES (for M5) |
| CG-5 | CRITICAL | SPEC §3.5 | Karma ownership after dispatch undefined | YES (for M5) |
| IG-1 | IMPORTANT | SPEC §6 | No pagination specified | YES |
| IG-2 | IMPORTANT | SPEC §5.5 | No judgment timeout | No |
| IG-3 | IMPORTANT | SPEC §4 | No concurrent operation handling | No |
| IG-4 | IMPORTANT | SPEC §5.3 | Realm full handling missing | No |
| IG-5 | IMPORTANT | SPEC §4 | Soul recall not defined | No |
| IG-6 | IMPORTANT | SPEC §6 | No error response format | No |
| IG-7 | IMPORTANT | SPEC §6.X.2 | DISPATCH_JUDGE missing from matrix | No |
| IG-8 | IMPORTANT | SPEC §7 | Cross-tenant judgment UI unclear | No |
| INC-1 | INCONSISTENCY | SPEC §3.3, §6.X.1 | Role naming TENANT_ADMIN vs ADMIN | YES |
| INC-2 | INCONSISTENCY | SPEC §6.11, dispatch-design §4 | API endpoints mismatch | YES |
| INC-3 | INCONSISTENCY | SPEC §4.3, dispatch-design §3.3 | approve() vs dispatch_confirm() | YES |
| INC-4 | INCONSISTENCY | SPEC §4.2, dispatch-design §3.2 | COMPLETED vs REINCARNATING | No |
| INC-5 | INCONSISTENCY | SPEC §3.2 | dispatch_enabled check missing | No |
| INC-6 | INCONSISTENCY | SPEC §4.2, §4.3 | Cancel destination unclear | No |

---

*End of Gap Analysis*
