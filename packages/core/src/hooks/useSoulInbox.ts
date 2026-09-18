"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { soulInboxApi } from "../api/soul-inbox";
import { soulInboxKeys } from "../query_keys";

/** The hall inbox. A reply invalidates the whole root: it moves the thread and the list order. */

export function useInboxConversations(page = 1) {
  return useQuery({
    queryKey: soulInboxKeys.list({ page }),
    queryFn: async () => (await soulInboxApi.list({ page })).data,
    placeholderData: (previous) => previous,
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
