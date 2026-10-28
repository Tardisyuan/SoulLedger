/**
 * API barrel file — re-exports all domain modules.
 *
 * Usage:
 *   import { soulsApi, type Soul } from "@/lib/api";
 *   import { api } from "@/lib/api/client";  // direct Axios instance
 */
export { api, getApiBaseUrl, PAGE_SIZE } from "./client";

// Auth
export {
  authApi,
  mfaApi,
  sessionsApi,
  type SignInSession,
  isMfaRequired,
  type LoginOutcome,
  type MfaRequiredResponse,
  type MfaStatus,
  type MfaRefusal,
  type MfaSetupResponse,
  type MfaRecoveryCodes,
  type MfaVerifyRequest,
  type UserRole,
  type BuiltinUserRole,
  type LoginUser,
  type LoginResponse,
  type LoginRequest,
  type AuthProfile,
  type LoginFailedBody,
  type LoginLockedBody,
  type PublicCivilization,
  type DefaultView,
  type UserPreferences,
  type PasswordHelpAccepted,
  type OfficerLoginRequest,
  type HallChoiceBody,
  type OfficerResetRefusal,
} from "./auth";

// Souls
export {
  soulsApi,
  SOUL_BATCH_RECYCLE_ERROR_CODES,
  soulBatchRecycleErrorOf,
  soulImportFileErrorOf,
  soulImportRowsRefusalOf,
  SOUL_IMPORT_COLUMNS,
  SOUL_FILE_MAX_ROWS,
  SOUL_IMPORT_ROW_CODES,
  SOUL_IMPORT_FILE_CODES,
  type SoulRegionUpdatePreview,
  type SoulRegionUpdateRow,
  type SoulRegionUpdateCommitResult,
  type SoulImportPreview,
  type SoulImportRow,
  type SoulImportCommitResult,
  type SoulImportFileError,
  type SoulInput,
  type SoulOriginRegion,
  type SoulDuatPassage,
  type SoulDiyuStation,
  type SoulContinent,
  DIYU_STATIONS,
  CONTINENTS,
  diyuStationOrdinal,
  type SoulBaptism,
  type Soul,
  type SoulListItem,
  type SoulRecord,
  type SoulRecordEntry,
  type SoulPathEntry,
  type SoulBatchRecycleRequest,
  type SoulBatchRecycleResult,
  type SoulBatchRecycleError,
  type SoulBatchRecycleErrorCode,
} from "./souls";

// Users
// 以此人身份查看(只读代看,W6)
export {
  getImpersonation,
  subscribeImpersonation,
  startImpersonation,
  startHallView,
  endImpersonation,
  IMPERSONATION_MAX_MINUTES,
  type ImpersonationState,
} from "./impersonation";

export { usersApi, handoverApi, officerRefusalOf, handoverProblemsOf, openWorkOf, type OfficerInviteInput, type OfficerRefusal, type HandoverPreview, type HandoverResult, type User, type UserMfaRef, type CreateUserInput, type UpdateUserInput, type UserFilters, type UserImportResult, type UserImportPreview, type UserImportRow, type UserImportFileError, userImportFileErrorOf, type AssignRolesInput, type UserBatchUpdateResult, type UserBatchDeactivateResult, type PaginatedResponse } from "./users";

// Judgment
export {
  judgmentApi,
  type Judgment,
  type JudgmentCitation,
  type CitationSnapshot,
  type JudgmentPrecedent,
  type Statute,
  type StatuteCorpus,
  type StatutePolarity,
  type ConcludeJudgmentPayload,
  type JudgmentQueueCursor,
  type JudgmentQueueParams,
  type JudgmentPreviousParams,
  type JudgmentDestinations,
  type JudgmentDestinationOption,
  type JudgmentVerdict,
  type QueueSoul,
  type QueueLedger,
  type QueueLedgerRecord,
  type QueuePriorCycle,
  type QueueRealm,
  type JudgmentQueueGroup,
  type JudgmentQueueCounts,
  type JudgmentCourt,
  type JudgmentQueueCountsParams,
  type JudgmentBatchOperation,
  type JudgmentBatchPayload,
  type JudgmentBatchResult,
  type JudgmentClaimRefusal,
  type AssignableOfficer,
  judgmentAppealsApi,
  judgmentAppealKeys,
  APPEAL_ERROR_CODES,
  type JudgmentAppeal,
  type JudgmentAppealStatus,
  type JudgmentAppealDecidePayload,
  type AppealLadder,
  type AppealLadderStation,
  type AppealLadderState,
  cityGodsApi,
  cityGodCasesApi,
  cityGodKeys,
  AT_CITY_GOD,
  CITY_GOD_CASE_ERROR_CODES,
  type CityGod,
  type CityGodWrite,
  type CityGodCase,
  type CityGodStatus,
} from "./judgment";

// Ledger
export { ledgerApi, isMonthTooLarge, type LedgerStatsOverview, type LedgerTrends, type LedgerTrendPoint, type LedgerTrendRange,type LedgerRecord, type LedgerSummary, type LedgerReading, type LedgerRecalculation, type LedgerInheritance, type LedgerInheritanceNotApplicable, type LedgerJournal, type LedgerJournalRow, type LedgerJournalCategory, type LedgerJournalParams } from "./ledger";

// Realms
export { realmsApi, type Realm, type RealmOccupancy, type RealmCapacityResult } from "./realms";

// Actors
export { actorsApi, type Actor } from "./actors";

// Workflow
export { workflowApi, requiresReasonForSoul, REBIRTH_APPLICATION_CASE_TYPE, REJECTION_REASON_FOR_SOUL_MAX, type ApprovalWorkflow, type ApprovalWorkflowListItem, type StartWorkflowBody, type WorkflowCaseTypeOption, type ApprovalNode, type WorkflowTemplate, type WorkflowTemplateListItem, type WorkflowTemplateNode, type WorkflowTemplateVersion, type ApproverPreview, type ApproverAssignment, type TemplateValidationIssue, type TemplateBranch, type TemplateSigner, type ConditionClause, type ConditionFact, type ConditionOp, type WorkflowNodeKind, type WorkflowTimeoutAction, type FlowPreview, type FlowPreviewStation, type JumpSource, type WorkflowSegment, type WorkflowHistoryEntry, type WorkflowSkipKind, type CrossJudgmentWorkflowSummary } from "./workflow";

// Disposition
export {
  dispositionApi,
  type Disposition,
  type DispositionListParams,
  type DispositionPage,
  type DispositionSection,
  type DispositionSectionCounts,
} from "./disposition";

// Reincarnation
export { reincarnationApi, rebirthQuotaFullOf, rebirthBlockedOf, quotaIsFull, soupNotTakenOf, soupRefusalOf, type Reincarnation, type RebirthQuotaUsage, type RebirthQuotaFull } from "./reincarnation";

// Events
export { eventsApi, type SoulEvent } from "./events";

// Permissions
export {
  permApi,
  type Permission,
  type Role,
  type RolePermissions,
  type PermissionAssignResult,
  type RolePermissionConflict,
  type PermissionImportResult,
  type PermissionImportSkipped,
  type PermissionImportDocument,
  type MatrixChange,
  type MatrixChangeResult,
  type MatrixChangesResult,
  type MatrixImpactResult,
  type MatrixConflict,
  type MatrixWorkflowConflict,
  type RoleDeleteRefusal,
  type RoleCopyPayload,
} from "./perm";

// Menus
export { menusApi, menuButtonsApi, type MenuItem, type MenuButton, type MenuButtonConfig } from "./menus";

// Audit
export { auditApi, loginLogsApi, type AuditActionOption, type AuditLogDetail, type AuditLogEntry, type AuditStats, type AuditTimelineParams, type LoginLogEntry, type LoginLogStatus } from "./audit";

// Tenants
export { tenantsApi, REBIRTH_COOLDOWN_SETTING, REBIRTH_QUOTA_SETTING, MFA_REQUIRED_ROLES_SETTING, SOUL_EMAIL_SELF_SERVICE_SETTING, VISIT_SETTING_LIMITS, type Tenant, type TenantSettingsPatch, type TenantMfaRoleRow, type TenantCreateBody, type HallOverviewRow, type HallQuotaRow } from "./tenants";

// Organizations
export { organizationsApi, organizationNotEmptyOf, type Organization, type OrganizationInput, type OrganizationNotEmpty } from "./organizations";

// Notifications
export { notificationsApi, type Notification, type NotificationEmailStatus } from "./notifications";

// Dispatch
export { captureWarrantsApi, type CaptureWarrant, type CaptureStatus, type CaptureEscort, type CaptureDueSoul, type CaptureRefusal } from "./dispatch";
export { dispatchApi, crossTenantJudgmentsApi, DISPATCH_REASON_MIN_CHARS, dispatchReasonLength, type DispatchRecord, type DispatchDraftInput, type DispatchRealmOption, type CrossTenantJudgment, type CrossTenantJudgmentListItem, type CrossTenantJudgmentParticipant } from "./dispatch";

// Social
export {
  socialApi,
  type Post,
  type ScreeningOutcome,
  type Comment,
  type Reaction,
  type Follow,
  type UserProfile,
  type PostMediaLimits,
  type PostMediaUpload,
} from "./social";

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
  type CooldownShorteningCounts,
  type CooldownShorteningFilters,
  type CooldownShorteningStatus,
  type CredentialFilters,
  type InitialCredential,
  type InitialCredentialStatus,
  type OfficerCooldownShortening,
  type OfficerRebirthApplication,
  type RebirthApplicationFilters,
  type RebirthApplicationForm,
  type RebirthApplicationStatus,
  type RebirthCurrentStep,
  type RevealedCredential,
  type CredentialSlip,
  type SoulAccount,
  type SoulAccountErrorBody,
  type SoulAccountOrigin,
  type SoulContactUpdate,
} from "./soul-accounts";

// Death sync (browser read side)
export {
  deathSyncApi,
  type DeathRegistration,
  type DeathRegistrationStatus,
  type DeathRegistrationSummary,
  type ExternalApiKey,
  type ExternalApiKeyCreate,
  type ExternalApiKeySystemType,
  type AdminWebhook,
  type AdminWebhookEvent,
  type AdminWebhookCreate,
  type AdminWebhookUpdate,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  tudiGodsApi,
  type TudiGod,
  type TudiGodInput,
  type TudiRegistrationInput,
} from "./death-sync";

// Recycle bin
export { recycleBinApi, type RecycleBinEntry, type RecycleBinLocation, type RecycleBinListResponse, type RestoreResponse } from "./recycle-bin";

// Officer mobile app
export {
  officerAppApi,
  decisionFailureOf,
  DECISION_FAILURE_CODES,
  type Todo,
  type TodoGroup,
  type TodoItem,
  type TodoItemDetail,
  type TodoKind,
  type SignerCandidate,
  type OfficerPushToken,
  type DecisionFailureCode,
} from "./officer-app";

export { isArchivableConflict, type ArchiveFields } from "./archive";
