/**
 * packages/core/src/hooks/useTodoNext.ts `todoNextAfter`: the row after an item in its own group of
 * `GET /officer-app/todo/`, and how many are left after it (the next included).
 */
import { todoNextAfter } from "@soulledger/core/hooks/useTodoNext";
import type { Todo } from "@soulledger/core/api";

const row = (kind: string, id: string) => ({ kind, id, title: id, created_at: "", target: { kind, id } });
const todo = (over: Partial<Record<keyof Todo, unknown>>) => over as unknown as Todo;

it("is the next row of the same group, with the rows left after this one", () => {
  const t = todo({ approvals: { count: 3, items: [row("approval", "a"), row("approval", "b"), row("approval", "c")] } });
  expect(todoNextAfter(t, "approval", "a")).toEqual({ next: row("approval", "b"), left: 2 });
  expect(todoNextAfter(t, "approval", "c")).toEqual({ next: null, left: 0 });
});

it("walks only the item's own group", () => {
  const t = todo({ approvals: { count: 1, items: [row("approval", "x")] }, cooldowns: { count: 2, items: [row("cooldown", "x"), row("cooldown", "y")] } });
  expect(todoNextAfter(t, "cooldown", "x")?.next?.id).toBe("y");
  expect(todoNextAfter(t, "approval", "x")).toEqual({ next: null, left: 0 });
});

it("says nothing when the item is not there, or sits last on a page the server has more of", () => {
  const t = todo({ rebirths: { count: 12, items: [row("rebirth", "a"), row("rebirth", "b")] } });
  expect(todoNextAfter(t, "rebirth", "zz")).toBeNull();
  expect(todoNextAfter(t, "rebirth", "b")).toBeNull();
  expect(todoNextAfter(undefined, "rebirth", "a")).toBeNull();
  expect(todoNextAfter(t, "rebirth", "a")).toEqual({ next: row("rebirth", "b"), left: 11 });
});
