"""Every call of `is_tenant_exempt(...)` outside tests, classified (stage 1A, docs/ARCHITECTURE-tenant-sharding.md §7.5).
Read by `tests/test_tenant_exempt_sites_are_classified.py`.

Why: until 2026-11-15 `is_tenant_exempt` answered True for any hall-less ADMIN, and each caller treated that as
"sees every hall". Now it answers True for SYSTEM_ADMIN only; a hall-less ADMIN is a civilization administrator.
Each caller therefore had to decide what the civilization ADMIN gets there, and a new caller must decide too.

Entry: (file under backend/, count, tag, reason) -- one row per (file, tag). The scanner counts calls per file;
it cannot see a tag, so it compares its count with the sum over that file's tags. The reason names each call's
function (`function: why`, joined with ` ‖ `) as a pointer for the reader; nothing checks the function names,
so a rename inside a file stays green (the same rule as tests/tenancy_unscoped_sites.py, 2026-11-13).

Tags:
  SYSTEM_ONLY   only SYSTEM_ADMIN gets the exemption; a civilization ADMIN takes the hall-bound branch
                (usually: nothing, or 403) because the thing is not any one civilization's
  CIVILIZATION  a civilization ADMIN gets its own branch beside the call (`reaches_hall`, `is_hall_less_admin`,
                `scope_to_tenant` / `within_reach`'s civilization filter): its civilization's halls, and no
                hall-less rows
"""

TAGS = {"SYSTEM_ONLY", "CIVILIZATION"}

SITES = [
    ("apps/core/tenant.py", 6, "CIVILIZATION",
     "is_hall_less_admin / admin_hall_ids / reaches_hall / within_reach / scope_to_tenant / tenant_aggregate_filter: "
     "the helpers themselves; each answers SYSTEM_ADMIN first and the civilization ADMIN in the next branch"),
    ("apps/core/shard_reads.py", 2, "CIVILIZATION",
     "current_context: SYSTEM_ADMIN reads every shard (FANOUT); a civilization ADMIN reads its civilization's "
     "shard (the next branch) | acting_alias (stage 4): SYSTEM_ADMIN writes on every master (MASTER), a civilization "
     "ADMIN on its civilization's master (the next branch)"),
    ("apps/core/viewer.py", 1, "CIVILIZATION",
     "viewer_tenant_id: SEE_ALL for SYSTEM_ADMIN; the civilization's hall pks for a civilization ADMIN (`sees`)"),
    ("apps/core/viewsets.py", 1, "CIVILIZATION",
     "DataScopeViewSetMixin.get_queryset: a civilization ADMIN falls through to scope_to_tenant (its halls)"),
    ("apps/core/permissions.py", 2, "CIVILIZATION",
     "TenantPermission.has_permission: civilization ADMIN passes, rows narrowed below ‖ "
     "TenantPermission.has_object_permission: `_civilization_reaches` (row's hall in its civilization)"),
    ("apps/core/permissions.py", 1, "SYSTEM_ONLY",
     "IsGlobalAdminPermission: creating halls, roles and the matrix, assistant provider -- every civilization's"),
    ("apps/core/tenant_fields.py", 1, "CIVILIZATION",
     "same_tenant_or_404_message: a civilization ADMIN may name a row of any hall of its civilization"),
    ("apps/core/recycle_bin_views.py", 2, "CIVILIZATION",
     "_bin_scope: the civilization's hall pks ‖ RecycleBinViewSet.list: tenant = those pks, tenantless types hidden"),
    ("apps/sentence_plan/views.py", 3, "CIVILIZATION",
     "SentencePlanPartyPermission.has_object_permission: home or a node in its civilization ‖ "
     "SentencePlanViewSet.get_queryset: node-side read over its civilization's codes ‖ "
     "withdraw: the filing hall's code is one of its civilization's"),
    ("apps/perm/checker.py", 1, "SYSTEM_ONLY",
     "check_permission: GLOBAL_ONLY_CODENAMES (menu.manage, system.cross_civilization)"),
    ("apps/dispatch/views.py", 1, "SYSTEM_ONLY",
     "hide_others_drafts: others' drafts stay hidden from a civilization ADMIN, as from its halls' ADMINs"),
    ("apps/dispatch/views.py", 3, "CIVILIZATION",
     "DispatchRecordViewSet.get_queryset: either party in its civilization ‖ create: the source hall is "
     "its civilization's ‖ CrossTenantJudgmentViewSet.get_queryset: initiator or a participant in it"),
    ("apps/scheduler/views.py", 1, "SYSTEM_ONLY",
     "rebuild: re-syncs every hall's scheduled rows"),
    ("apps/social/moderation_views.py", 1, "SYSTEM_ONLY",
     "copy word list: copying between halls is cross-civilization configuration"),
    ("apps/social/moderation_views.py", 1, "CIVILIZATION",
     "SocialMuteViewSet.get_queryset: a civilization ADMIN takes the next branch, `scope_to_tenant` over the souls -- "
     "its civilization's halls"),
    ("apps/soul_assist/admin_views.py", 1, "SYSTEM_ONLY",
     "IsAdminRole: the assistant's provider and keys are global (the per-hall switch is IsAnyAdmin + _own_hall_id)"),
    ("apps/souls/views.py", 1, "CIVILIZATION",
     "SoulViewSet.get_queryset: a civilization ADMIN goes through scope_to_tenant (its halls)"),
    ("apps/workflow/segments.py", 1, "CIVILIZATION",
     "foreign_workflows: a civilization ADMIN gets workflows with a segment in any of its halls, above the call"),
    ("apps/menus/views.py", 1, "SYSTEM_ONLY",
     "MenuViewSet.all: the menu tree is shared by every hall"),
    ("apps/authentication/serializers.py", 2, "SYSTEM_ONLY",
     "UserCreateSerializer.validate: only SYSTEM_ADMIN appoints a civilization ADMIN (sets `civilization`) ‖ "
     "may_assign_role: only SYSTEM_ADMIN may give the SYSTEM_ADMIN role"),
    ("apps/authentication/serializers.py", 1, "CIVILIZATION",
     "UserCreateSerializer.validate: a civilization ADMIN creates in a hall of its civilization (branch above)"),
    ("apps/authentication/civilization_move.py", 1, "SYSTEM_ONLY",
     "migrate: only SYSTEM_ADMIN moves an account to another civilization (user decision 2026-11-16)"),
    ("apps/authentication/views.py", 1, "CIVILIZATION",
     "LoginLogViewSet.get_queryset: its civilization's halls' users"),
    ("apps/authentication/user_admin.py", 1, "CIVILIZATION",
     "_admin_target_refusal: a civilization ADMIN acts on a hall ADMIN of its civilization"),
]
