/**
 * The demo's stand-in for `GET /judgment/next/` and `previous/` reports the position of the case it hands out, as the
 * server does (`total - remaining + ahead + 1`, backend/apps/judgment/views.py). Before, it always reported the queue
 * head's position: the desk's QueueBar (`next/?at=<id>`) read「第 1 / 共 3」on the third case while K / J walked 3 / 3.
 */
import { derived } from "@/demo/flows";
import { type DemoRole, type Recording, recording, resetOverlay } from "@/demo/store";

type Cursor = { total: number; position: number | null; judgment: { id: string } | null };
const ask = (rec: Recording, path: string, query: Record<string, string> = {}) =>
  derived(rec, path, new URLSearchParams(query))!.data as Cursor;

beforeEach(() => resetOverlay());

describe.each<DemoRole>(["judge", "judge_eg"])("%s", (role) => {
  let rec: Recording;
  beforeAll(async () => {
    rec = await recording(role, "zh");
  });

  /** The queue in order, walked with `?after=` from the head. */
  const walk = () => {
    const ids = [ask(rec, "/judgment/next/").judgment!.id];
    for (;;) {
      const next = ask(rec, "/judgment/next/", { after: ids[ids.length - 1] }).judgment;
      if (!next) return ids;
      ids.push(next.id);
    }
  };

  it("`?at=<id>` reports that case's own position, for every case in the queue", () => {
    const ids = walk();
    expect(ids.length).toBeGreaterThan(1);
    ids.forEach((id, i) => {
      const c = ask(rec, "/judgment/next/", { at: id });
      expect(c.judgment?.id).toBe(id);
      expect(c.position).toBe(i + 1);
      expect(c.total).toBe(ids.length);
    });
    // Absence: the last case is not reported as the head.
    expect(ask(rec, "/judgment/next/", { at: ids[ids.length - 1] }).position).not.toBe(1);
  });

  it("`previous/` and `?after=` report the neighbour's position, and the head has none before it", () => {
    const ids = walk();
    const last = ids[ids.length - 1];
    const prev = ask(rec, "/judgment/previous/", { at: last });
    expect(prev.judgment?.id).toBe(ids[ids.length - 2]);
    expect(prev.position).toBe(ids.length - 1);
    expect(ask(rec, "/judgment/next/", { after: ids[0] }).position).toBe(2);
    expect(ask(rec, "/judgment/previous/", { at: ids[0] }).judgment).toBeNull();
  });
});
