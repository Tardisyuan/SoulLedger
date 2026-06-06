# Social Domain Mismatch Report

**Date**: 2026-06-04
**Audit**: 6-agent parallel review

---

## Audit Scores

| Audit | Score | Status |
|-------|-------|--------|
| A: Domain Correctness | 3/10 | Critical — Backend has no social domain |
| B: Cache Design | 7/10 | Good — broken key fixed |
| C: Mutation Safety | 5.5/10 | Needs Work — race conditions |
| D: Type Consistency | 6/10 | Adequate — unsafe casts |
| E: Scalability | N/A | Rate-limited |
| F: Event Alignment | 3/10 | Critical — No social events in backend |

**Overall: 4.9/10** — Frontend models are well-designed but backend counterpart is missing.

---

## Critical Findings

### 1. Backend Has No Social Domain (BLOCKER)
- No `apps/social/` directory in backend
- No Post, Comment, Reaction, Follow Django models
- No serializers, views, or URL routes
- All frontend API calls to `/social/*` will return 404

### 2. No Social Event Types in Backend
- `EventType` enum has zero social event types
- No `POST_CREATED`, `COMMENT_CREATED`, `REACTION_ADDED`, `USER_FOLLOWED`
- EventBus has no `"social"` domain registered
- `hydrateSocialEvent` is dead code (never wired)

### 3. WSClient Message Format Misaligned
- Backend sends: `{"domain": "workflow", "event": "WORKFLOW_APPROVED", ...}`
- WSClient switches on `data.type` (undefined in backend messages)
- Social events would never reach `hydrateSocialEvent`

---

## Fixed Issues

| Issue | Status |
|-------|--------|
| `socialKeys.profile.all` undefined | ✅ Fixed — added `all` property |
| `SocialEvent.event` was `string` | ✅ Fixed — now `SocialEventType` union |
| Broken cache invalidation in useUpdateProfile | ✅ Fixed |

---

## Remaining Issues

| # | Issue | Severity | Fix Required |
|---|-------|----------|--------------|
| 1 | Backend social domain missing | CRITICAL | Build apps/social/ |
| 2 | Social event types missing from EventType | CRITICAL | Add 9 event types |
| 3 | No social domain in EventBus | CRITICAL | Register in configure_default_handlers() |
| 4 | WSClient switches on `data.type` not `data.domain` | HIGH | Update WSClient routing |
| 5 | hydrateSocialEvent never wired to WebSocket | HIGH | Add to WebSocketContext |
| 6 | useUserReactions placeholder calls wrong API | MEDIUM | Fix or remove |
| 7 | snapshotPost/rollbackPost imported but unused | LOW | Use consistently or remove |
| 8 | No staleTime on social queries | MEDIUM | Add 60s staleTime |

---

## Backend Requirements for Social Domain

### Models Needed
| Model | Fields | Indexes |
|-------|--------|---------|
| Post | id, author_id, content, visibility, media_url, comment_count, reaction_count, tenant_id | (tenant, time), (author, time) |
| Comment | id, post_id, author_id, parent_id, content, tenant_id | (post, time), (parent) |
| Reaction | id, user_id, post_id, comment_id, reaction_type, tenant_id | (user, post), (user, comment) |
| Follow | id, follower_id, following_id, tenant_id | (follower, following), (following, follower) |
| UserProfile | id, user_id, bio, avatar_url, followers_count, following_count, post_count | (user_id) |

### Event Types Needed
```
POST_CREATED, POST_UPDATED, POST_DELETED
COMMENT_CREATED, COMMENT_DELETED
REACTION_ADDED, REACTION_REMOVED
USER_FOLLOWED, USER_UNFOLLOWED
```

### API Endpoints Needed
| Endpoint | Method | Description |
|----------|--------|-------------|
| /social/posts/ | GET/POST | List/Create posts |
| /social/posts/{id}/ | GET/PATCH/DELETE | Read/Update/Delete post |
| /social/posts/{id}/comments/ | GET/POST | List/Create comments |
| /social/posts/{id}/reactions/ | POST/DELETE | Toggle/Remove reaction |
| /social/follows/ | POST | Follow user |
| /social/follows/{id}/ | DELETE | Unfollow user |
| /social/feed/ | GET | Get feed |
| /social/users/{id}/profile/ | GET/PATCH | Read/Update profile |

---

## Frontend-Backend Alignment Checklist

| Frontend | Backend | Aligned |
|----------|---------|---------|
| PostModel fields | Post model fields | ❌ No backend |
| CommentModel fields | Comment model fields | ❌ No backend |
| ReactionModel fields | Reaction model fields | ❌ No backend |
| FollowModel fields | Follow model fields | ❌ No backend |
| SocialEvent types | EventType enum | ❌ No social events |
| socialKeys cache keys | API endpoint paths | ❌ No endpoints |
| hydrateSocialEvent | EventBus domain | ❌ No social domain |
| WSClient message routing | Consumer message format | ❌ Misaligned |

---

## Recommendation

**Do NOT start M13 frontend social UI until backend social domain is built.**

The frontend models and state management are well-designed internally, but they have zero backend counterpart. All API calls will 404, all events will never arrive, and all real-time hydration is dead code.

**Build order:**
1. Backend: apps/social/ (models, serializers, views, URLs)
2. Backend: Add social event types to EventType
3. Backend: Register social domain in EventBus
4. Frontend: Fix WSClient message routing
5. Frontend: Wire hydrateSocialEvent into WebSocketContext
6. Frontend: Build social UI pages
