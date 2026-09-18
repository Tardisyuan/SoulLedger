"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  socialModerationApi,
  type ContentAction,
  type ContentKind,
  type ModerationFilters,
  type ReportResolution,
} from "../api/social-moderation";
import { socialModerationKeys } from "../query_keys";

/**
 * Officer moderation backend. Every write invalidates the whole
 * `socialModerationKeys.all` root — see that key's comment for why.
 */

export function useModerationReports(filters: ModerationFilters) {
  return useQuery({
    queryKey: socialModerationKeys.reports({ ...filters }),
    queryFn: async () => (await socialModerationApi.reports(filters)).data,
    placeholderData: (previous) => previous,
  });
}

export function useModeratedContent(kind: ContentKind, filters: ModerationFilters) {
  return useQuery({
    queryKey: socialModerationKeys.content(kind, { ...filters }),
    queryFn: async () => (await socialModerationApi.content(kind, filters)).data,
    placeholderData: (previous) => previous,
  });
}

export function useSensitiveWords(page = 1) {
  return useQuery({
    queryKey: socialModerationKeys.words({ page }),
    queryFn: async () => (await socialModerationApi.words({ page })).data,
    placeholderData: (previous) => previous,
  });
}

export function useSocialMutes(page = 1) {
  return useQuery({
    queryKey: socialModerationKeys.mutes({ page }),
    queryFn: async () => (await socialModerationApi.mutes({ page })).data,
    placeholderData: (previous) => previous,
  });
}

function useModerationWrite<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: socialModerationKeys.all }),
  });
}

export function useResolveReport() {
  return useModerationWrite(
    async ({ id, resolution, note, muteDays }: { id: string; resolution: ReportResolution; note?: string; muteDays?: number }) =>
      (await socialModerationApi.resolveReport(id, resolution, note, muteDays)).data
  );
}

export function useModerateContent() {
  return useModerationWrite(
    async ({ kind, id, action, reason }: { kind: ContentKind; id: string; action: ContentAction; reason?: string }) =>
      (await socialModerationApi.act(kind, id, action, reason)).status
  );
}

export function useAddSensitiveWord() {
  return useModerationWrite(async (word: string) => (await socialModerationApi.addWord(word)).data);
}

export function useRemoveSensitiveWord() {
  return useModerationWrite(async (id: string) => (await socialModerationApi.removeWord(id)).status);
}

export function useLiftMute() {
  return useModerationWrite(async (id: string) => (await socialModerationApi.liftMute(id)).data);
}

/** `{detail, code}` → the code, else null. The page maps it to `social_moderation.errors.<code>`. */
export function moderationErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === "string" ? code : null;
}
