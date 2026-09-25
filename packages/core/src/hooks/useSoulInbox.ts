"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inboxTemplatesApi, soulInboxApi, type InboxListParams } from "../api/soul-inbox";
import { soulInboxKeys } from "../query_keys";

/**
 * The hall inbox. A reply, read, archive or draft change moves rows between
 * folders and changes the counts, so each invalidates the list root — but not
 * the message thread, which only a reply changes.
 */

export function useInboxConversations(params: InboxListParams = {}) {
  const query = { page: 1, folder: "all", ...params } as const;
  return useQuery({
    queryKey: soulInboxKeys.list({ ...query }),
    queryFn: async () => (await soulInboxApi.list(query)).data,
    placeholderData: (previous) => previous,
  });
}

export function useInboxFolders() {
  return useQuery({
    queryKey: soulInboxKeys.folders(),
    queryFn: async () => (await soulInboxApi.folders()).data,
  });
}

export function useInboxMessages(id: string | null) {
  return useQuery({
    queryKey: soulInboxKeys.messages(id ?? ""),
    queryFn: async () => (await soulInboxApi.messages(id as string)).data,
    enabled: Boolean(id),
  });
}

export function useInboxReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => (await soulInboxApi.reply(id, body)).data,
    onSettled: () => qc.invalidateQueries({ queryKey: soulInboxKeys.all }),
  });
}

const invalidateLists = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: soulInboxKeys.lists() }),
    qc.invalidateQueries({ queryKey: soulInboxKeys.folders() }),
  ]);

export function useInboxMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await soulInboxApi.markRead(id)).data,
    onSuccess: () => invalidateLists(qc),
  });
}

export function useInboxArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      (await (archived ? soulInboxApi.archive(id) : soulInboxApi.unarchive(id))).data,
    onSuccess: () => invalidateLists(qc),
  });
}

/** The caller's own draft. `staleTime: Infinity`: after load the composer owns the text; the server copy only restores it. */
export function useInboxDraft(id: string | null, enabled = true) {
  return useQuery({
    queryKey: soulInboxKeys.draft(id ?? ""),
    queryFn: async () => (await soulInboxApi.draft(id as string)).data,
    enabled: Boolean(id) && enabled,
    staleTime: Infinity,
  });
}

export function useInboxSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => (await soulInboxApi.saveDraft(id, body)).data,
    onSuccess: (state, { id }) => {
      qc.setQueryData(soulInboxKeys.draft(id), state);
      return invalidateLists(qc);
    },
  });
}

export function useInboxTemplates(enabled = true) {
  return useQuery({
    queryKey: soulInboxKeys.templates(),
    queryFn: async () => (await inboxTemplatesApi.list()).data,
    enabled,
    staleTime: 60_000,
  });
}

export function useInboxTemplateMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: soulInboxKeys.templates() });
  return {
    create: useMutation({
      mutationFn: async (data: { title: string; body: string }) => (await inboxTemplatesApi.create(data)).data,
      onSuccess,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...data }: { id: string; title?: string; body?: string }) =>
        (await inboxTemplatesApi.update(id, data)).data,
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => (await inboxTemplatesApi.remove(id)).data,
      onSuccess,
    }),
  };
}
