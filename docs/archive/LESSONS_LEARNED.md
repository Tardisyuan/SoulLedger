# LESSONS_LEARNED.md

# M12 Lessons

## Review Loops Are Expensive

Problem:

Too many review cycles.

Result:

Large amount of reports.
Small amount of implementation.

Rule:

Implement first.
Review later.

---

## Verification Beats Assumption

Problem:

Issues marked fixed without execution.

Result:

False GO decisions.

Rule:

No validation.
No completion claim.

---

## Runtime Validation Matters

Static analysis is insufficient.

Always run:

- tests
- build
- runtime verification

before closure.

---

## Repeated Findings Indicate Process Failure

If same issue appears multiple times:

Do not generate another report.

Fix it.

---

## WebSocket Requires End-to-End Validation

Checking code is not enough.

Verify:

- connection
- authentication
- reconnection
- cache invalidation

---

## React Query Requires Consistent Keys

Inconsistent cache keys cause silent failures.

Use factories.

Never hardcode keys.

---

## Large Refactors Need Impact Analysis

Before changing architecture:

Identify:

- consumers
- dependencies
- rollback strategy

---

# M13 Goals

Focus:

- Social UI
- User experience
- Feature completion

Avoid:

- unnecessary architecture rewrites
- report generation loops
- speculative optimizations

Priority:

Working features
>
Perfect design
