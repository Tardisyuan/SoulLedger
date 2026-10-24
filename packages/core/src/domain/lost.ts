/**
 * 第五十批:失踪横条的数据 —— 最近一条「→ 失踪」的状态变更(STATE_CHANGED,new_state = LOST)。网页与官员 App 共用。
 * 在 domain/ 而不是 api/:很多测试整包 mock `@soulledger/core/api`。
 */
type EventLike = { event_type: string; payload: unknown; create_time: string; actor?: string | null };

export function latestLostEvent<E extends EventLike>(events: readonly E[]): E | null {
  return (
    [...events]
      .filter((e) => e.event_type === "STATE_CHANGED" && (e.payload as { new_state?: unknown } | null)?.new_state === "LOST")
      .sort((a, b) => new Date(b.create_time).getTime() - new Date(a.create_time).getTime())[0] ?? null
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 「10-24 14:20」,本地时间。 */
export function lostSinceLabel(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
