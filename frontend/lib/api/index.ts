/**
 * API barrel file — re-exports all domain modules.
 *
 * Usage:
 *   import { soulsApi, type Soul } from "@/lib/api";
 *   import { api } from "@/lib/api/client";  // direct Axios instance
 */
export { api, API_BASE, PAGE_SIZE } from "./client";

// Auth
export { authApi, type UserRole, type LoginUser, type LoginResponse, type AuthProfile } from "./auth";

// Souls
export { soulsApi, type SoulInput, type Soul, type SoulListItem, type SoulRecord, type SoulRecordEntry } from "./souls";

// Users
export { usersApi, type User, type CreateUserInput, type UpdateUserInput, type UserFilters, type UserImportResult, type PaginatedResponse } from "./users";

// Judgment
export { judgmentApi, type Judgment, type ConcludeJudgmentPayload } from "./judgment";

// Ledger
export { ledgerApi, type LedgerStatsOverview, type LedgerRecord, type LedgerSummary, type LedgerReading, type LedgerRecalculation, type LedgerInheritance, type LedgerInheritanceNotApplicable } from "./ledger";

// Realms
export { realmsApi, type Realm } from "./realms";

// Actors
export { actorsApi, type Actor } from "./actors";

// Workflow
export { workflowApi, type ApprovalWorkflow, type ApprovalWorkflowListItem, type ApprovalNode, type WorkflowTemplate, type WorkflowTemplateListItem, type WorkflowTemplateNode } from "./workflow";

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

// Recycle bin
export { recycleBinApi, type RecycleBinEntry, type RecycleBinListResponse, type RestoreResponse } from "./recycle-bin";
