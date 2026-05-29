/**
 * API barrel file — re-exports all domain modules.
 *
 * Usage:
 *   import { soulsApi, type Soul } from "@/lib/api";
 *   import { api } from "@/lib/api/client";  // direct Axios instance
 */
export { api, API_BASE } from "./client";

// Auth
export { authApi } from "./auth";

// Souls
export { soulsApi, type SoulInput, type Soul, type SoulRecord } from "./souls";

// Users
export { usersApi, type User, type CreateUserInput, type UpdateUserInput, type UserFilters, type PaginatedResponse } from "./users";

// Judgment
export { judgmentApi, type Judgment } from "./judgment";

// Karma
export { karmaApi, type KarmaStatsOverview, type KarmaRecord, type KarmaSummary } from "./karma";

// Realms
export { realmsApi, type Realm } from "./realms";

// Actors
export { actorsApi, type Actor } from "./actors";

// Workflow
export { workflowApi, type ApprovalWorkflow, type ApprovalNode } from "./workflow";

// Disposition
export { dispositionApi, type Disposition } from "./disposition";

// Reincarnation
export { reincarnationApi, type Reincarnation } from "./reincarnation";

// Events
export { eventsApi, type SoulEvent } from "./events";

// Permissions
export { permApi, type Permission, type Role } from "./perm";

// Menus
export { menusApi, menuButtonsApi, type MenuItem, type MenuButton } from "./menus";

// Audit
export { auditApi } from "./audit";

// Tenants
export { tenantsApi, type Tenant } from "./tenants";

// Organizations
export { organizationsApi, type Organization } from "./organizations";

// Notifications
export { notificationsApi, type Notification } from "./notifications";

// Dispatch
export { dispatchApi, crossTenantJudgmentsApi, type DispatchRecord, type CrossTenantJudgment, type CrossTenantJudgmentParticipant } from "./dispatch";
