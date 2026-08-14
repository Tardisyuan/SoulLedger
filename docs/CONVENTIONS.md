# CONVENTIONS.md

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
