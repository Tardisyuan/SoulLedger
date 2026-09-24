/**
 * API barrel file — re-exports all domain modules.
 *
 * Usage:
 *   import { soulsApi, type Soul } from "@/lib/api";
 *   import { api } from "@/lib/api/client";  // direct Axios instance
 */
export { api, getApiBaseUrl, PAGE_SIZE } from "./client";

// Auth
export { authApi, type UserRole, type BuiltinUserRole, type LoginUser, type LoginResponse, type AuthProfile } from "./auth";

// Souls
export { soulsApi, type SoulInput, type Soul, type SoulListItem, type SoulRecord, type SoulRecordEntry } from "./souls";

// Users
export { usersApi, type User, type CreateUserInput, type UpdateUserInput, type UserFilters, type UserImportResult, type PaginatedResponse } from "./users";

// Judgment
export {
  judgmentApi,
  type Judgment,
  type JudgmentCitation,
  type Statute,
  type StatuteCorpus,
  type StatutePolarity,
  type ConcludeJudgmentPayload,
  type JudgmentQueueCursor,
  type JudgmentQueueParams,
  type QueueSoul,
  type QueueLedger,
  type QueueLedgerRecord,
  type QueuePriorCycle,
  type QueueRealm,
  type JudgmentQueueGroup,
  type JudgmentQueueCounts,
  type JudgmentQueueCountsParams,
  type JudgmentBatchOperation,
  type JudgmentBatchPayload,
  type JudgmentBatchResult,
  type JudgmentClaimRefusal,
} from "./judgment";

// Ledger
export { ledgerApi, type LedgerStatsOverview, type LedgerRecord, type LedgerSummary, type LedgerReading, type LedgerRecalculation, type LedgerInheritance, type LedgerInheritanceNotApplicable } from "./ledger";

// Realms
export { realmsApi, type Realm } from "./realms";

// Actors
export { actorsApi, type Actor } from "./actors";

// Workflow
export { workflowApi, requiresReasonForSoul, REBIRTH_APPLICATION_CASE_TYPE, REJECTION_REASON_FOR_SOUL_MAX, type ApprovalWorkflow, type ApprovalWorkflowListItem, type ApprovalNode, type WorkflowTemplate, type WorkflowTemplateListItem, type WorkflowTemplateNode } from "./workflow";

// Disposition
export { dispositionApi, type Disposition } from "./disposition";

// Reincarnation
export { reincarnationApi, type Reincarnation } from "./reincarnation";

// Events
export { eventsApi, type SoulEvent } from "./events";

// Permissions
export { permApi, type Permission, type Role, type RolePermissions, type PermissionAssignResult, type RolePermissionConflict, type PermissionImportResult } from "./perm";

// Menus
export { menusApi, menuButtonsApi, type MenuItem, type MenuButton } from "./menus";

// Audit
export { auditApi, type AuditLogEntry } from "./audit";

// Tenants
export { tenantsApi, type Tenant } from "./tenants";

// Organizations
export { organizationsApi, type Organization } from "./organizations";

// Notifications
export { notificationsApi, type Notification } from "./notifications";

// Dispatch
export { dispatchApi, crossTenantJudgmentsApi, type DispatchRecord, type CrossTenantJudgment, type CrossTenantJudgmentListItem, type CrossTenantJudgmentParticipant } from "./dispatch";

// Social
export { socialApi, type Post, type Comment, type Reaction, type Follow, type UserProfile } from "./social";

// Scheduler
export {
  schedulerApi,
  type ScheduledJob,
  type ScheduledJobScope,
  type ScheduledJobUpdate,
  type TaskRun,
  type TaskRunFilters,
  type TaskRunStatus,
  type TaskRunSummary,
  type TaskRunTrigger,
  type RebuildResult,
} from "./scheduler";

// Soul accounts (officer side)
export {
  soulAccountsApi,
  type CredentialFilters,
  type InitialCredential,
  type InitialCredentialStatus,
  type OfficerRebirthApplication,
  type RebirthApplicationFilters,
  type RebirthApplicationForm,
  type RebirthApplicationStatus,
  type RebirthCurrentStep,
  type RevealedCredential,
  type SoulAccount,
  type SoulAccountErrorBody,
  type SoulAccountOrigin,
  type SoulContactUpdate,
} from "./soul-accounts";

// Recycle bin
export { recycleBinApi, type RecycleBinEntry, type RecycleBinListResponse, type RestoreResponse } from "./recycle-bin";
