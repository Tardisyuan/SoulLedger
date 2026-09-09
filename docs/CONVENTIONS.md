# CONVENTIONS.md

> **已被取代（2026-09-06）。** 这份文件最后一次改动是 2026-08-14，此后仓库改成了
> npm workspaces、Tailwind 4、Base UI，六个 hook 搬进了 `packages/core`。下面的条目
> 有一部分因此失真（例如 §Components 的 `lib/api/users.ts` 路径、`PageSection` +
> `TableSkeleton` 的页面骨架），且这份文件从不区分「有执法机制的规则」与「只是一句话」。
>
> 现行版本已按前后端拆成两份，每条都标注了执法机制：
>
> - [`CONVENTIONS-backend.md`](CONVENTIONS-backend.md)
> - [`CONVENTIONS-frontend.md`](CONVENTIONS-frontend.md)
>
> 本文件保留为历史记录，不再更新。**读它之前先读上面两份。**

# Backend Conventions

## Python

- PEP8
- Type hints required
- Services pattern preferred
- Keep business logic outside ViewSets

## Models

Use:

- AuditUserFields
- version field
- soft delete

Avoid:

- fat serializers
- business logic in views

## Permissions

All protected endpoints must use:

- CodenameViewSetMixin

Never:

- trust frontend permissions

---

# Frontend Conventions

## Components

PascalCase

Example:

UserCard.tsx

## Hooks

camelCase

Example:

useUserProfile.ts

## Query Keys

Always use factories.

Never hardcode strings.

Good:

usersKeys.list()

Bad:

["users"]

---

# API Layer

One client per backend app.

Example:

lib/api/users.ts

lib/api/social.ts

---

# Testing

Backend:

- unit tests
- API tests

Frontend:

- component tests
- integration tests

Critical flows:

- authentication
- workflow approval
- dispatch approval
- social interactions

must be covered.

---

# Git

Commit format:

type(scope): description

Examples:

feat(social): add reaction system

fix(dispatch): correct approval flow

refactor(events): simplify event handler

---

# Performance

Avoid:

- N+1 queries
- unnecessary rerenders
- duplicate API requests

Always:

- select_related
- prefetch_related
- React Query cache
- pagination
