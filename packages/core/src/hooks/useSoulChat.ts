"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { soulChatApi } from "../api/soul-chat";
import { soulChatKeys } from "../query_keys";

/**
 * Finding a soul is a mutation, not a query: it is rate-limited per account on
 * the server, so it must run once per explicit submit — never on mount, refocus
 * or retry. `retry: false` is explicit so a host's app-wide `mutations.retry` default
 * cannot turn one submit into three (a 404 is an answer, not a fault).
 */
export function useSoulChatLookup() {
  return useMutation({ mutationFn: (soulCode: string) => soulChatApi.lookup(soulCode), retry: false });
}

export function useOpenSoulChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetUser: number) => soulChatApi.openDirect(targetUser),
    onSettled: () => qc.invalidateQueries({ queryKey: soulChatKeys.all }),
  });
}

export function useSoulConversations() {
  return useQuery({ queryKey: soulChatKeys.conversations(), queryFn: soulChatApi.conversations });
}
