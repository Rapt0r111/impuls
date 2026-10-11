import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.uuid(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  currentVersion: z.number().int().optional(),
});

export const telegramLoginRequestSchema = z.object({
  initData: z.string().min(1).max(8192),
});

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string().min(1),
  }),
  csrfToken: z.string().min(1),
});

export const permissionsResponseSchema = z.object({
  permissions: z.array(
    z.object({
      action: z.enum([
        "task.view",
        "task.create",
        "task.assign",
        "task.edit",
        "task.cancel",
        "task.review",
        "reward.decide",
        "reward.fulfill",
        "admin.access",
        "admin.access.manage",
        "admin.members.manage",
        "admin.rules",
        "admin.catalog",
        "admin.catalog.publish",
        "admin.catalog.schedule",
        "admin.catalog.schedule.cancel",
        "admin.catalog.create",
        "admin.catalog.quota.publish",
        "admin.audit",
        "admin.notifications",
        "ledger.correct",
      ]),
      scope: z.object({
        id: z.uuid(),
        kind: z.enum(["rota", "group", "project"]),
        name: z.string().min(1),
      }),
      validUntil: z.iso.datetime().nullable(),
    }),
  ),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type TelegramLoginRequest = z.infer<typeof telegramLoginRequestSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type PermissionsResponse = z.infer<typeof permissionsResponseSchema>;
export {
  assignedTaskDetailSchema,
  assignedTaskStatusSchema,
  assignedTaskSummarySchema,
  taskSubmissionHeadersSchema,
  taskSubmissionRequestSchema,
  taskSubmissionResponseSchema,
  taskStartRequestSchema,
  taskStartResponseSchema,
  taskDetailResponseSchema,
  taskIdSchema,
  taskListQuerySchema,
  taskListResponseSchema,
} from "./tasks";
export type {
  TaskDetailResponse,
  TaskListResponse,
  TaskSubmissionHeaders,
  TaskSubmissionRequest,
  TaskSubmissionResponse,
  TaskStartRequest,
  TaskStartResponse,
} from "./tasks";
export {
  reviewListQuerySchema,
  reviewListResponseSchema,
  taskReturnRequestSchema,
  taskReturnResponseSchema,
  taskReviewRequestSchema,
  taskAcceptanceRequestSchema,
  taskAcceptanceResponseSchema,
} from "./reviews";
export { accountLedgerResponseSchema, ledgerListQuerySchema } from "./ledger";
export type { AccountLedgerResponse } from "./ledger";
export {
  ledgerCorrectionRequestSchema,
  ledgerCorrectionQuerySchema,
  ledgerCorrectionResponseSchema,
  ledgerCorrectionsResponseSchema,
} from "./ledger-corrections";
export type {
  LedgerCorrectionItem,
  LedgerCorrectionRequest,
} from "./ledger-corrections";
export type {
  ReviewListResponse,
  ReviewQueueItem,
  TaskReturnRequest,
  TaskReturnResponse,
} from "./reviews";
export {
  managementTaskSchema,
  taskAssignRequestSchema,
  taskEditRequestSchema,
  taskCancelRequestSchema,
  taskCreateRequestSchema,
  taskManagementListQuerySchema,
  taskManagementListResponseSchema,
  taskManagementOptionsResponseSchema,
  taskManagementResponseSchema,
} from "./task-management";
export type {
  ManagementTask,
  TaskAssignRequest,
  TaskEditRequest,
  TaskCancelRequest,
  TaskCreateRequest,
  TaskManagementListResponse,
  TaskManagementOptionsResponse,
} from "./task-management";
export {
  taskHistoryQuerySchema,
  taskHistoryResponseSchema,
} from "./task-history";
export type { TaskHistoryResponse } from "./task-history";
export {
  taskTimelineQuerySchema,
  taskTimelineResponseSchema,
} from "./task-timeline";
export type { TaskTimelineResponse } from "./task-timeline";
export {
  leaderboardQuerySchema,
  leaderboardResponseSchema,
} from "./leaderboard";
export type { LeaderboardResponse } from "./leaderboard";
export {
  participantProfileResponseSchema,
  profileNameRequestSchema,
  profileNameSchema,
  profileNameResponseSchema,
} from "./profile";
export type {
  ParticipantProfileResponse,
  ProfileNameRequest,
  ProfileNameResponse,
} from "./profile";
export {
  auditActionSchema,
  auditCursorSchema,
  auditFieldSchema,
  auditQuerySchema,
  auditResponseSchema,
} from "./audit";
export type { AuditQuery, AuditResponse } from "./audit";
export {
  notificationStatusQuerySchema,
  notificationStatusResponseSchema,
  notificationEventsCursorSchema,
  notificationEventsQuerySchema,
  notificationEventsResponseSchema,
} from "./notification-status";
export type {
  NotificationStatusResponse,
  NotificationEventsResponse,
} from "./notification-status";
export {
  rewardListQuerySchema,
  rewardCursorSchema,
  redemptionCursorSchema,
  redemptionListQuerySchema,
  reserveRewardRequestSchema,
  cancelRedemptionRequestSchema,
  decideRedemptionRequestSchema,
  redemptionReviewQuerySchema,
  fulfillRedemptionRequestSchema,
  redemptionDecisionResponseSchema,
  redemptionReviewResponseSchema,
  redemptionSchema,
  rewardCatalogResponseSchema,
  redemptionListResponseSchema,
  redemptionMutationResponseSchema,
} from "./rewards";
export type {
  RewardCatalogResponse,
  RedemptionListResponse,
  RedemptionMutationResponse,
  Redemption,
  RedemptionReviewResponse,
} from "./rewards";
export {
  adminCatalogCursorSchema,
  adminCatalogQuerySchema,
  adminCatalogResponseSchema,
  adminCatalogHistoryCursorSchema,
  adminCatalogHistoryParamsSchema,
  adminCatalogHistoryQuerySchema,
  adminCatalogHistoryResponseSchema,
  adminCatalogQuotasCursorSchema,
  adminCatalogQuotasQuerySchema,
  adminCatalogQuotasResponseSchema,
} from "./admin-catalog";
export {
  catalogPublicationRequestSchema,
  catalogSchedulingRequestSchema,
  catalogPublicationEvidenceSchema,
  catalogPublicationResponseSchema,
} from "./catalog-publication";
export type {
  CatalogPublicationRequest,
  CatalogSchedulingRequest,
  CatalogPublicationResponse,
} from "./catalog-publication";
export type {
  AdminCatalogResponse,
  AdminCatalogHistoryResponse,
  AdminCatalogQuotasResponse,
} from "./admin-catalog";
export {
  notificationAttemptSchema,
  notificationAttemptsCursorSchema,
  notificationAttemptsQuerySchema,
  notificationAttemptsResponseSchema,
} from "./notification-attempts";
export type { NotificationAttemptsResponse } from "./notification-attempts";
export {
  quotaPublicationRequestSchema,
  quotaPublicationEvidenceSchema,
  quotaPublicationResponseSchema,
} from "./quota-publication";
export type {
  QuotaPublicationRequest,
  QuotaPublicationResponse,
} from "./quota-publication";

export {
  catalogCreationRequestSchema,
  catalogCreationEvidenceSchema,
  catalogCreationResponseSchema,
} from "./catalog-creation";
export type {
  CatalogCreationRequest,
  CatalogCreationResponse,
} from "./catalog-creation";

export {
  catalogCancellationRequestSchema,
  catalogCancellationResponseSchema,
} from "./catalog-cancellation";
export type { CatalogCancellationRequest } from "./catalog-cancellation";

export {
  accessChangeResponseSchema,
  accessListResponseSchema,
  accessQuerySchema,
  accessGrantRequestSchema,
  accessRevocationRequestSchema,
  grantableActions,
  memberAdmissionRequestSchema,
  memberChangeResponseSchema,
  memberRemovalRequestSchema,
} from "./access-management";
export type {
  AccessGrantRequest,
  AccessListResponse,
  AccessRevocationRequest,
  MemberAdmissionRequest,
  MemberChangeResponse,
  MemberRemovalRequest,
} from "./access-management";

export {
  currentRulesSchema,
  rulesPublishRequestSchema,
  rulesPublishResponseSchema,
  rulesResponseSchema,
} from "./rules";
export type {
  RulesPublishRequest,
  RulesPublishResponse,
  RulesResponse,
} from "./rules";
