"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  socialModerationApi,
  type ContentAction,
  type ContentKind,
  type HandledContent,
  type HandledFilters,
  type ModerationFilters,
  type MuteFilters,
  type NewSensitiveWord,
  type ReportResolution,
  type SensitiveWordAction,
  type SensitiveWordEdit,
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

export function useSocialMutes(filters: MuteFilters = {}) {
  return useQuery({
    queryKey: socialModerationKeys.mutes({ ...filters }),
    queryFn: async () => (await socialModerationApi.mutes(filters)).data,
    placeholderData: (previous) => previous,
  });
}

/** `enabled` false: the picker is closed, ask nothing. */
export function useMuteSouls(q: string, enabled = true) {
  return useQuery({
    queryKey: socialModerationKeys.muteSouls(q),
    queryFn: async () => (await socialModerationApi.muteSouls(q)).data,
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useMuteExecutors() {
  return useQuery({
    queryKey: socialModerationKeys.muteExecutors(),
    queryFn: async () => (await socialModerationApi.muteExecutors()).data,
  });
}

export function useHandledContent(filters: HandledFilters) {
  return useQuery({
    queryKey: socialModerationKeys.handled({ ...filters }),
    queryFn: async () => (await socialModerationApi.handled(filters)).data,
    placeholderData: (previous) => previous,
  });
}

/** The review detail's full text. `id` null: nothing selected, no request. */
export function useModeratedItem(kind: ContentKind, id: string | null) {
  return useQuery({
    queryKey: socialModerationKeys.item(kind, id ?? ""),
    queryFn: async () => (await socialModerationApi.item(kind, id as string)).data,
    enabled: id !== null,
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
  return useModerationWrite(async (word: NewSensitiveWord) => (await socialModerationApi.addWord(word)).data);
}

export function useRemoveSensitiveWord() {
  return useModerationWrite(async (id: string) => (await socialModerationApi.removeWord(id)).status);
}

export function useUpdateSensitiveWord() {
  return useModerationWrite(
    async ({ id, edit }: { id: string; edit: SensitiveWordEdit }) => (await socialModerationApi.updateWord(id, edit)).data
  );
}

export function useUpdateSensitiveWords() {
  return useModerationWrite(
    async ({ ids, action }: { ids: string[]; action: SensitiveWordAction }) =>
      (await socialModerationApi.updateWords(ids, action)).data
  );
}

export function useCopySensitiveWords() {
  return useModerationWrite(async (sourceTenant: string) => (await socialModerationApi.copyWords(sourceTenant)).data);
}

export function useRemoveSensitiveWords() {
  return useModerationWrite(async (ids: string[]) => (await socialModerationApi.removeWords(ids)).data);
}

/**
 * 恢复可见 for a HIDDEN row of the handled list — the existing `restore` action on
 * its post or comment. DELETED rows have no restore here (recycle-bin rules).
 */
export function useRestoreVisible() {
  return useModerationWrite(
    async ({ row, reason }: { row: Pick<HandledContent, "type" | "id">; reason?: string }) =>
      (await socialModerationApi.act(row.type === "POST" ? "posts" : "comments", row.id, "restore", reason)).status
  );
}

export function useMuteSoul() {
  return useModerationWrite(
    async ({ userId, days, reason }: { userId: number; days: number; reason?: string }) =>
      (await socialModerationApi.mute(userId, days, reason)).data
  );
}

export function useLiftMute() {
  return useModerationWrite(async (id: string) => (await socialModerationApi.liftMute(id)).data);
}

/** `{detail, code}` → the code, else null. The page maps it to `social_moderation.errors.<code>`. */
export function moderationErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === "string" ? code : null;
}
