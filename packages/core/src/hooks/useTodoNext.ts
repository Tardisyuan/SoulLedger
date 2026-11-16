"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { officerAppApi, type Todo, type TodoItem } from "../api/index";
import { todoKeys } from "../query_keys";

/** The kinds a 「下一件」 follows: each walks its own group of `GET /officer-app/todo/`. */
export type TodoNextKind = "approval" | "rebirth" | "cooldown";
const GROUP = { approval: "approvals", rebirth: "rebirths", cooldown: "cooldowns" } as const;

/**
 * Where this item sits in its group: `next` the row after it (null: it was the group's last), `left` the rows
 * after it, the next included (officer App `shell.tsx`, 「{name} · 还剩 {n} 件」).
 */
export interface TodoNext {
  next: TodoItem | null;
  left: number;
}

/**
 * The row after `id` in its group, or null when that cannot be said: the item is not in the group, or it is the
 * last row of the first page while the server holds more (the group sends 10 at a time).
 */
export function todoNextAfter(todo: Todo | undefined, kind: TodoNextKind, id: string): TodoNext | null {
  const group = todo?.[GROUP[kind]];
  const at = group ? group.items.findIndex((i) => i.target.id === id) : -1;
  if (!group || at < 0) return null;
  const left = Math.max(0, group.count - at - 1);
  const next = group.items[at + 1] ?? null;
  if (!next && left > 0) return null;
  return { next, left };
}

/**
 * 「下一件」 after deciding an item, in the to-do's own order (the officer App's, and the judgment page's
 * `useJudgmentNextAfter` shape). Read while the item is still waiting: once decided, a refetched to-do no longer
 * holds it, so the last answer that found it is kept for this item. Shares the dashboard to-do strip's cache.
 */
export function useTodoNextAfter(kind: TodoNextKind, id: string | null | undefined, enabled = true): TodoNext | null {
  const q = useQuery({
    queryKey: todoKeys.item("officer"),
    queryFn: async () => (await officerAppApi.todo()).data,
    enabled: enabled && !!id,
    staleTime: 60_000,
  });
  const now = useMemo(() => (id ? todoNextAfter(q.data, kind, id) : null), [q.data, kind, id]);
  const key = `${kind}:${id ?? ""}`;
  const [kept, setKept] = useState<{ key: string; value: TodoNext } | null>(null);
  if (now && kept?.value !== now) setKept({ key, value: now });
  return now ?? (kept?.key === key ? kept.value : null);
}
