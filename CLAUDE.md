# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

# Core Principle

Implement first. Verify second. Review last.

Priority:

1. Understand
2. Implement
3. Verify
4. Review
5. Report

Never:

Review → Review → Review → Implement

Working code is more valuable than perfect code.

---

# Completion Criteria

A task is NOT complete because code was written.

A task is complete only when:

- implementation finished
- validation executed
- evidence collected

Without validation:

Use:

- implemented but not verified
- likely fixed
- requires validation

Do NOT use:

- fixed
- resolved
- verified
- production ready

---

# Verification Policy

Every code change requires validation.

Backend:

``` bash
cd backend
python -m pytest --tb=short -q
```

Frontend:

``` bash
cd frontend
npm run lint
npm run build
npm test
npx tsc --noEmit
```

After push:

``` bash
gh run list --limit 3
```

---

# Verification Truthfulness

Never claim success without evidence.

Required evidence:

Build:

- command
- exit code

Tests:

- command
- passed count

Runtime:

- request sample
- response sample

---

# Root Cause Rule

Before fixing:

1. Symptom
2. Root cause
3. Proposed fix

Do not patch symptoms only.

---

# Change Impact Analysis

Before editing:

Identify:

- callers
- consumers
- tests
- documentation

After editing:

Verify affected modules.

---

# Technical Debt

P0

- security vulnerability
- deployment blocker
- data corruption
- production outage

Must fix now.

P1

- functional issue
- incomplete feature
- performance issue

Next milestone.

P2

- code quality
- naming
- refactor

As needed.

---

# Review Rules

Review only when:

- explicitly requested
- milestone closure
- security review

Maximum:

- 2 review rounds
- 1 architecture review per milestone

If same issue appears twice:

Upgrade to P0.

---

# Report Rules

Do not generate report files unless explicitly requested.

Default output:

- issue list
- fix list
- validation result

Maximum:

- one report per milestone

---

# Large Refactor Rule

Before changing more than 3 files:

1. identify dependencies
2. identify tests
3. identify rollback plan

---

# Agent Usage

Use agents for:

- cross-module changes
- security audits
- performance investigations
- large refactors

Avoid agents for:

- small fixes
- single-file changes
- configuration updates

---

# Self Improvement

Claude may propose improvements.

Claude may NOT directly modify CLAUDE.md.

Required workflow:

1. detect recurring issue
2. create proposal
3. provide evidence
4. wait for approval

Only approved changes may enter CLAUDE.md.

---

# Default Behaviour

When uncertain:

1. inspect code
2. gather evidence
3. implement
4. verify

Never assume.
