/**
 * The wire shapes the EventBus sends, and the shape a handler answers with.
 *
 * Split out of `event_registry.ts` so the registry file is the table and this
 * one is the vocabulary. Every name here is re-exported from `event_registry`
 * unchanged — importing either path gets the same type.
 */
import type { QueryClient } from "@tanstack/react-query";

// ── Event Payload Types ────────────────────────────────────────────────

export interface BaseEventPayload {
  domain: string;
  event: string;
  tenant_code?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface SoulEventPayload extends BaseEventPayload {
  domain: "soul";
  soul_id: string;
  soul_name?: string;
}

export interface WorkflowEventPayload extends BaseEventPayload {
  domain: "workflow";
  workflow_id: string;
  workflow_name?: string;
  soul_name?: string;
  soul_id?: string;
  status?: string;
  verdict?: string;
  node_name?: string;
}

export interface NotificationEventPayload extends BaseEventPayload {
  domain: "notification";
  notification?: {
    id: number;
    title: string;
    message: string;
    notification_type: string;
    is_read: boolean;
    created_at: string;
    user_id: number;
  };
}

export interface DispatchEventPayload extends BaseEventPayload {
  domain: "dispatch";
  dispatch_id?: string;
  soul_name?: string;
  source_tenant?: string;
  target_tenant?: string;
  old_status?: string;
  new_status?: string;
}

export interface DeathSyncEventPayload extends BaseEventPayload {
  domain: "deathsync";
  registration_id?: string;
  source_system?: string;
  status?: string;
}

export interface SocialEventPayload extends BaseEventPayload {
  domain: "social";
  post_id?: string;
  comment_id?: string;
  reaction_type?: string;
  user_id?: string;
  author_name?: string;
  content?: string;
  follower_id?: string;
  following_id?: string;
}

export type EventPayload =
  | SoulEventPayload
  | WorkflowEventPayload
  | NotificationEventPayload
  | DispatchEventPayload
  | DeathSyncEventPayload
  | SocialEventPayload;

// ── Handler Type ───────────────────────────────────────────────────────

export type EventHandler = (
  payload: any,
  context: EventContext,
) => HandlerResult;

export interface EventContext {
  queryClient: QueryClient;
  showToast: (msg: string, type?: "success" | "error" | "info", duration?: number) => void;
}

// ── Handler Result (for replay safety) ─────────────────────────────────

export interface HandlerResult {
  /** Whether the handler executed successfully */
  success: boolean;
  /** Cache keys that were invalidated */
  invalidatedKeys: string[];
  /** Toast message shown (if any) */
  toastMessage?: string;
  /** Error if handler failed */
  error?: string;
}
