"""Every unique key in the schema (column, UniqueConstraint, unique_together)
and what kind it is -- guard G5 in docs/ARCHITECTURE-tenant-sharding.md 4.1.
Read by `tests/test_global_uniqueness_inventory.py`, which derives the same
table from the models.

Key:   "app.Model:column_or_constraint_name"
Value: (kind, one-line reason)

  GLOBAL_VALUE  unique over the whole database -- what a per-tenant database
                split would silently weaken. 23 today; each has a guarantee
                (a UNIQUE index, plus a generator for soul_code / case_number / workflow number).
  PER_PARENT    unique within one parent row; a placement rule for sharding.
  PER_TENANT    tenant is part of the key; NOT global.

Dropping a GLOBAL_VALUE key must fail the test that reads this file; add one
only together with a plan for how it stays unique across databases.

STRATEGY (stage 1B): how each GLOBAL_VALUE stays unique once SHARD rows live in
four databases. "key": (strategy, one-line reason).

  CONTROL      the row stays in the control database (CONTROL or REFERENCE
               placement, tests/tenancy_placement.py); its UNIQUE index still
               covers every row. Never valid for a SHARD-placed key.
  RANDOM       unique by construction without coordination: a random token,
               a uuid, a hash of one, or an id assigned outside our databases.
  PARTITIONED  a per-database sequence whose ranges cannot meet (a prefix per
               hall / per database); stage 4 checks prefixes do not cross
               civilizations.
  REGISTRY     claimed first in a control-database registry (stage 4:
               GlobalCode(kind, value, tenant_id), or for the WF number the control
               counter row), then written to the shard. apps/tenants/global_codes.py
               SERVED_KEYS names what serves each one.
"""

STRATEGY = {
    'authentication.MfaRememberedDevice:token_hash': ('CONTROL', 'officer MFA device: control table'),
    'authentication.User:unique_user_email_among_live_rows': ('CONTROL', 'User stays in control (D1)'),
    'authentication.User:username': ('CONTROL', 'User stays in control (D1)'),
    'authentication.OfficerDeviceLogin:credential_hash': ('CONTROL', 'officer login identity: control table'),
    'chat.ChatIdentity:localpart': ('RANDOM', 'HMAC-SHA256 of the SoulAccount pk (control-allocated, global), 96 bits kept'),
    'chat.ChatIdentity:matrix_user_id': ('RANDOM', '@<localpart>:<server>; unique wherever the localpart is'),
    'chat.Conversation:room_id': ('RANDOM', 'assigned by the Matrix homeserver, outside our databases'),
    'death_sync.ExternalApiKey:key_hash': ('RANDOM', 'hash of a random API key; finding the hall by key is a lookup problem (stage 3), not a uniqueness one'),
    'judgment.Judgment:case_number': ('PARTITIONED', '<prefix>-<year>-<n> from a counter per prefix-year; a hall prefix must not be shared across civilizations (stage 4 check)'),
    'officer_app.OfficerPushDevice:token': ('CONTROL', 'officer device: control table'),
    'org.Organization:code': ('REGISTRY', 'free text chosen by an administrator; claimed in the control registry before the shard write (stage 4)'),
    'perm.Permission:unique_permission_codename_alive': ('CONTROL', 'RBAC stays in control (D1)'),
    'perm.Role:unique_role_name_alive': ('CONTROL', 'RBAC stays in control (D1)'),
    'scheduler.TaskRun:celery_task_id': ('RANDOM', 'Celery task id, a uuid4'),
    'social.ModerationScore:social_moderation_score_one_per_row': ('RANDOM', '(kind, object_id) with object_id a uuid4 pk'),
    'soul_assist.HelpChunk:help_chunk_one_per_entry': ('CONTROL', 'global help corpus: control table'),
    'soul_push.PushDevice:token': ('CONTROL', 'follows SoulAccount into control'),
    'soul_accounts.SoulDeviceLogin:credential_hash': ('CONTROL', 'follows SoulAccount into control'),
    'soul_accounts.SoulMfaDevice:token_hash': ('CONTROL', 'follows SoulAccount into control'),
    'souls.Soul:soul_code': ('REGISTRY', 'the soul login name; claimed in the control registry before the shard write (stage 4)'),
    'workflow.ApprovalWorkflow:number': ('REGISTRY', 'one global WF sequence: the WF counter row stays in control and a shard bumps it there (autocommit) before writing; format unchanged, gaps allowed (gap 4b)'),
    'tenants.GlobalCode:global_code_one_claim_per_value': ('CONTROL', 'the stage-4 registry itself: a control table'),
    'tenants.ShardOutbox:message_id': ('RANDOM', 'uuid4 drawn by the sender'),
    'tenants.ShardInbox:message_id': ('RANDOM', 'the outbox row\'s uuid4; unique per target master is the saga\'s idempotence'),
    'tenants.Tenant:code': ('CONTROL', 'REFERENCE: the master is the control database, shards hold copies (D4)'),
}

UNIQUE_KEYS = {
    'authentication.MfaRememberedDevice:token_hash': ('GLOBAL_VALUE', 'hash of the remembered-device cookie token'),
    'authentication.User:unique_user_email_among_live_rows': ('GLOBAL_VALUE', 'officer e-mail, case-insensitive, live rows only; deactivating frees the address'),
    'authentication.User:username': ('GLOBAL_VALUE', 'login name of every officer / soul account; one namespace over all halls'),
    'chat.ChatIdentity:localpart': ('GLOBAL_VALUE', 'Matrix localpart, one namespace over all halls (chat is cross-hall)'),
    'chat.ChatIdentity:matrix_user_id': ('GLOBAL_VALUE', 'Matrix user id, one namespace over all halls'),
    'chat.Conversation:room_id': ('GLOBAL_VALUE', 'Matrix room id'),
    'death_sync.DeathRegistrationRequest:uniq_death_reg_idempotency': ('PER_TENANT', '(tenant, source_system, idempotency_key): two halls may send the same explicit X-Idempotency-Key'),
    'death_sync.ExternalApiKey:key_hash': ('GLOBAL_VALUE', 'hash of an API key; the key alone selects the tenant on the machine-to-machine path'),
    'judgment.Judgment:case_number': ('GLOBAL_VALUE', 'printed case number; generated from JudgmentCaseCounter keyed by <prefix>-<year>, so two halls sharing a prefix cannot repeat a number'),
    'officer_app.OfficerPushDevice:token': ('GLOBAL_VALUE', 'push token of an officer device'),
    'org.Organization:code': ('GLOBAL_VALUE', 'organization code'),
    'org.Organization:organizations_one_live_root_per_tenant': ('PER_TENANT', 'one live root unit per hall (datascope B1); the hall is the key'),
    'perm.Permission:unique_permission_codename_alive': ('GLOBAL_VALUE', 'permission codename, global RBAC table'),
    'perm.Role:unique_role_name_alive': ('GLOBAL_VALUE', 'role name, global RBAC table'),
    'perm.RoleDataScope:perm_role_data_scope_unique_live': ('PER_PARENT', 'one live scope row per (role, resource); lives with its global role row'),
    'realms.Realm:unique_realm_tenant_code': ('PER_TENANT', '(tenant, realm_code) since 2026-10-27: a created hall gets its own copy of its civilization\'s realms; lookups ask within a hall (realm_by_code)'),
    'scheduler.TaskRun:celery_task_id': ('GLOBAL_VALUE', 'Celery task id'),
    'social.ModerationScore:social_moderation_score_one_per_row': ('GLOBAL_VALUE', '(kind, object_id): one AI pre-screen score per post / comment; object_id is that row\'s uuid4 pk (no FK), so two databases cannot collide by construction'),
    'soul_assist.HelpChunk:help_chunk_one_per_entry': ('GLOBAL_VALUE', '(locale, entry_id) of the help corpus; global content'),
    'soul_push.PushDevice:token': ('GLOBAL_VALUE', 'push token of a soul device'),
    'soul_accounts.SoulDeviceLogin:credential_hash': ('GLOBAL_VALUE', 'hash of a soul app device-login credential; random 256-bit value, so two databases cannot collide by construction'),
    'authentication.OfficerDeviceLogin:credential_hash': ('GLOBAL_VALUE', 'hash of an officer app device-login credential; random 256-bit value, so two databases cannot collide by construction'),
    'soul_accounts.SoulMfaDevice:token_hash': ('GLOBAL_VALUE', 'hash of a soul app remembered-device token; random 256-bit value, so two databases cannot collide by construction'),
    'souls.Soul:soul_code': ('GLOBAL_VALUE', 'soul login name and the key of cross-hall private chat lookup (/me/chat/lookup/); generated by soul_accounts.services._ensure_soul_code with collision retry'),
    'workflow.ApprovalWorkflow:number': ('GLOBAL_VALUE', 'printed approval number WF-0582; one global sequence from the JudgmentCaseCounter row WF (row lock, same as case_number). Once shards write it, they bump that control row first (STRATEGY REGISTRY, gap 4b)'),
    'tenants.ShardOutbox:message_id': ('GLOBAL_VALUE', 'a saga message id: one message, one id, wherever it is'),
    'tenants.ShardInbox:message_id': ('GLOBAL_VALUE', 'a redelivered saga message inserts nothing and applies nothing (stage 4 part C)'),
    'tenants.GlobalCode:global_code_one_claim_per_value': ('GLOBAL_VALUE', '(kind, value): one claim per code, the registry soul_code / Organization.code are claimed in (stage 4)'),
    'tenants.Tenant:code': ('GLOBAL_VALUE', 'tenant code; the key the JWT, the death-sync API key and every *_for_tenant task resolve a tenant by'),
    'soul_accounts.SoulMfa:account': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'authentication.OfficerMfa:user': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'reincarnation.Reincarnation:reincarnation_one_per_soul_cycle': ('PER_PARENT', 'one live rebirth row per (soul, life); lives with its soul'),
    'judgment.JudgmentAppeal:workflow': ('PER_PARENT', "one appeal per ladder workflow (OneToOne); unique inside one parent row, the rows live with the parent"),
    'chat.ChatIdentity:account': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'chat.Conversation:chat_one_open_direct_room_per_pair': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.SoulDataExport:soul_data_export_one_in_progress': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'chat.ChatBlock:chat_one_block_per_pair': ('PER_PARENT', "one block row per (blocker, blocked) soul account; lives with the blocker's account (blocks may cross civilizations, as private chat does)"),
    'chat.InboxOfficerState:chat_one_inbox_state_per_officer': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'dispatch.CrossTenantJudgment:judgment': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'dispatch.CrossTenantJudgmentParticipant:unique_cross_judgment_node_order': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'death_sync.TudiGod:unique_tudi_god_name_per_hall': ('PER_TENANT', 'unique per tenant only (tenant is in the key); NOT global'),
    'dispatch.CaptureWarrant:one_open_capture_warrant_per_soul': ('PER_PARENT', 'one open (ISSUED / CAPTURED) capture warrant per soul'),
    'dispatch.DispatchRecord:unique_active_dispatch': ('PER_PARENT', 'one live PROPOSED/APPROVED dispatch per soul, spanning source and target tenant'),
    'disposition.Disposition:judgment': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'judgment.NegativeConfession:unique_confession_judgment_statute': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'judgment.EvidenceAdmission:unique_admission_judgment_record': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'judgment.JudgmentCitation:unique_citation_judgment_statute': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'judgment.JudgmentAppeal:unique_appeal_round': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'judgment.JudgmentAppeal:unique_open_appeal_per_judgment': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'menus.MenuButton:unique_menubutton_menu_code': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'notifications.NotificationEmail:notification': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'perm.FieldPermission:unique_together(role,model_name,field_name)': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'perm.RolePermission:unique_rolepermission_role_permission': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'realms.SoulPathEntry:soulpath_one_open_entry_per_soul': ('PER_PARENT', 'one open path station per soul, whichever tenant it is in'),
    'realms.SoulPathEntry:soulpath_unique_sequence': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'scheduler.ScheduledJob:periodic_task': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'sentence_plan.SentenceNode:unique_live_sentence_node_order': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'sentence_plan.SentenceNode:unique_occupying_sentence_node': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'sentence_plan.SentencePlan:unique_in_progress_sentence_plan': ('PER_PARENT', 'one in-progress plan per soul (plan belongs to the home tenant, the soul may reside elsewhere)'),
    'sentence_plan.SentencePlanRequest:unique_pending_sentence_request': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.Follow:unique_follow_relationship': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.Reaction:unique_reaction_per_comment': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.Reaction:unique_reaction_per_post': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.Report:social_report_one_open_per_comment': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.Report:social_report_one_open_per_post': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.Report:social_report_one_open_per_user': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.ReportEntry:social_report_entry_once_per_reporter': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.SensitiveWordDailyHit:social_sensitive_word_hit_one_row_per_day': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'social.SocialInteraction:social_interaction_one_follow_row_per_day': ('PER_PARENT', 'one merged follow row per recipient per day'),
    'social.SocialInteraction:social_interaction_one_row_per_post_day': ('PER_PARENT', 'one merged reaction / lamp row per recipient, post and day'),
    'social.UserProfile:user': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.CooldownShorteningRequest:application': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.CooldownShorteningRequest:cooldown_shortening_one_pending_per_soul': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.RebirthApplication:appeal_workflow': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.RebirthApplication:rebirth_application_one_open_per_soul': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.RebirthApplication:workflow': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.SoulAccount:previous_account': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.SoulAccount:soul_account_one_current': ('PER_PARENT', 'one current account per soul'),
    'soul_accounts.SoulAccount:soul_account_one_per_life': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_accounts.SoulAccount:user': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_push.PushDelivery:push_delivery_once_per_device': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_push.PushDelivery:push_delivery_once_without_device': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'soul_push.PushPreference:account': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'workflow.ApprovalWorkflow:judgment': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'workflow.WorkflowTemplateVersion:uniq_wf_tmpl_one_draft': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'workflow.WorkflowTemplateVersion:uniq_wf_tmpl_one_published': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'workflow.WorkflowTemplateVersion:uniq_wf_tmpl_version_number': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'workflow.WorkflowSegment:uniq_wf_segment_order': ('PER_PARENT', "unique inside one parent row; holds across tenants only because the parent's pk is global and the rows live with the parent"),
    'actors.Actor:unique_actor_tenant_civ_name': ('PER_TENANT', 'unique per tenant only (tenant is in the key); NOT global'),
    'chat.Conversation:chat_one_open_inbox_per_soul_and_hall': ('PER_TENANT', 'unique per tenant only (tenant is in the key); NOT global'),
    'judgment.CityGod:unique_city_god_name_per_hall': ('PER_TENANT', 'unique per tenant only (tenant is in the key); NOT global'),
    'judgment.CityGod:one_default_city_god_per_hall': ('PER_TENANT', 'one default city god per hall (tenant is the key); NOT global'),
    'judgment.CityGodOfficer:unique_together(citygod,user)': ('PER_PARENT', "one row per (city god, officer): CityGod.officers' through table (gap 4c), the rows live with their city god"),
    'death_sync.TudiGodOfficer:unique_together(tudigod,user)': ('PER_PARENT', "one row per (tudi god, officer): TudiGod.officers' through table (gap 4c), the rows live with their tudi god"),
    'perm.RoleDataScopeOrg:unique_together(roledatascope,organization)': ('PER_PARENT', "one row per (scope, unit): RoleDataScope.orgs' through table (gap 4c), the rows live with their global scope row"),
    'judgment.Statute:unique_statute_tenant_code': ('PER_TENANT', 'statute code is unique PER TENANT only, yet some code lookups ignore the tenant (see tenancy_unscoped_sites CODE rows)'),
    'ledger.BalanceSnapshot:uniq_balance_snapshot_tenant_month': ('PER_TENANT', 'unique per tenant only (tenant is in the key); NOT global'),
    'ledger.SoulCensusSnapshot:uniq_census_snapshot_tenant_day': ('PER_TENANT', 'unique per tenant only (tenant is in the key); NOT global'),
    'social.SensitiveWord:social_sensitive_word_unique_per_tenant': ('PER_TENANT', 'unique per tenant only (tenant is in the key); NOT global'),
}

#: Stage 4 (writes split): the unique keys of a SHARD model whose columns include a key that may cross
#: civilizations (`apps.core.shard_reads.crossing_keys`) and not the hall. Each shard's UNIQUE index covers only
#: its own rows, and the rows that share such a key can be in two shards -- a soul's residence rows in the hall it
#: resides in, its home rows at home. Held by D6 (one writable copy of a soul; its rows written by the hall that
#: holds the soul) and, across civilizations, by the stage-4 saga (outbox / inbox, part C), not by an index.
#: Derived and pinned by `test_global_uniqueness_inventory.py::test_the_keys_a_write_split_can_span_are_pinned`.
SPANNING = {
    'chat.Conversation:chat_one_open_direct_room_per_pair': "one open room per soul pair; the two souls may live in two civilizations (private chat across halls): the room is opened by the initiator's hall only",
    'dispatch.CrossTenantJudgmentParticipant:unique_cross_judgment_node_order': 'one seat per bench order; seats live with their halls, the bench with the initiating hall (joint judgment, part C)',
    'dispatch.DispatchRecord:unique_active_dispatch': 'one live dispatch per soul across source and target halls (dispatch state machine, part C)',
    'judgment.EvidenceAdmission:unique_admission_judgment_record': 'one ruling per (case, record): a residence court rules on records the home hall wrote; the admission lives with the case',
    'realms.SoulPathEntry:soulpath_one_open_entry_per_soul': 'one open station per soul, whichever hall holds it: only the hall holding the soul writes one (D6)',
    'realms.SoulPathEntry:soulpath_unique_sequence': 'per-soul path sequence across the halls it passed through: written by the hall holding the soul (D6)',
    'reincarnation.Reincarnation:reincarnation_one_per_soul_cycle': 'one rebirth per soul and life: written by the hall holding the soul (D6)',
    'sentence_plan.SentencePlan:unique_in_progress_sentence_plan': 'one plan in progress per soul; the plan belongs to the home hall, the soul may reside elsewhere (part C)',
    'soul_accounts.RebirthApplication:appeal_workflow': 'one application per appeal workflow; the application follows its soul, the workflow stays in the hall that opened it',
    'soul_accounts.RebirthApplication:workflow': 'one application per rebirth workflow; as appeal_workflow',
    'workflow.WorkflowSegment:uniq_wf_segment_order': "one segment per (workflow, order); a segment run by another civilization's realm lives in that shard (part C)",
}
