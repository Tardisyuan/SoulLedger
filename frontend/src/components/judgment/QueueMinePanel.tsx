"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import { judgmentApi, type Judgment } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useReducedMotionDurations } from "@/src/hooks/useReducedMotionDurations";
import { SectionTitle } from "@/src/components/plaque/SectionTitle";
import { RowMark, ROW_MARK_ROW, isMinePending } from "@/src/components/judgment/RowMark";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { MOTION_EASINGS } from "@/lib/motion";

/**
 * 审判队列上的「我认领的」分组(2026-09-30 用户拍板的三项新功能之一):服务端 `?group=mine`
 * —— 我认领、未结案的案子。每行带行首色标(B12「待我处理」),点名字把队列切到那一件,
 * 有改派权限时每行可改派。行高与审判队列同为 v3 的 64(`--table-row-h`),行内动作 44。
 *
 * 动效(交互与动效第 2 轮 §三 2 / 2c):刚认领的那件排在最上面,其余行 layout 补位
 * (base 200 · ease.standard,级差 30,只对前 8 行);改派走的那一行向左 8px 淡出
 * (fast 120 · ease.exit),不留占位 —— `popLayout`。减少动态效果时一律直接到位。
 */

const PARAMS = { group: "mine", ordering: "created_at" } as const;
/** 级差只对前 8 行,第 9 行起和第 8 行同时(总级差 ≤ 240ms)。 */
const STAGGER_ROWS = 8;
const STAGGER = 0.03;

export function QueueMinePanel({
  currentId,
  recent,
  gone,
  canAssign,
  onOpen,
  onReassign,
}: {
  /** 队列正在看的那一件。 */
  currentId: string | null;
  /** 本次认领的 id,新的在前 —— 排到最上面。 */
  recent: readonly string[];
  /** 已改派走、服务端还没刷新到的 id:先让它退场,不等往返。 */
  gone: readonly string[];
  canAssign: boolean;
  onOpen: (id: string) => void;
  onReassign: (judgment: Judgment) => void;
}) {
  const { t } = useI18n();
  const { user } = useTenant();
  const d = useReducedMotionDurations();
  const query = useQuery({
    queryKey: judgmentKeys.list({ ...PARAMS }),
    queryFn: async () => (await judgmentApi.list({ ...PARAMS })).data,
  });

  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? recent.length : i;
  };
  const rows = (query.data?.results ?? [])
    .filter((j) => !gone.includes(j.id))
    .map((j, order) => ({ j, order }))
    .sort((a, b) => rank(a.j.id) - rank(b.j.id) || a.order - b.order)
    .map(({ j }) => j);
  const goneHere = (query.data?.results ?? []).filter((j) => gone.includes(j.id)).length;

  return (
    <section aria-labelledby="queue-mine-heading" data-testid="queue-mine" className="space-y-2">
      <SectionTitle id="queue-mine-heading" aside={query.data ? String(query.data.count - goneHere) : "…"}>
        {t("judgment.claim.groups.mine")}
      </SectionTitle>
      {query.isError ? (
        <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.claim.refused.generic")}</p>
      ) : rows.length === 0 && query.isSuccess ? (
        <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.claim.group_empty")}</p>
      ) : (
        <LayoutGroup id="queue-mine">
          <ul className="border-t border-[oklch(var(--color-block))]">
            <AnimatePresence mode="popLayout" initial={false}>
              {rows.map((j, i) => {
                const marked = isMinePending(j, user?.id);
                return (
                  <m.li
                    key={j.id}
                    layout
                    data-testid="queue-mine-row"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, x: 0, transition: { duration: d.fast, ease: MOTION_EASINGS.enter } }}
                    exit={{ opacity: 0, x: -8, transition: { duration: d.fast, ease: MOTION_EASINGS.exit } }}
                    transition={{
                      layout: { duration: d.base, ease: MOTION_EASINGS.standard, delay: d.base ? Math.min(i, STAGGER_ROWS - 1) * STAGGER : 0 },
                    }}
                    className={`relative flex min-h-(--table-row-h) items-center gap-3 border-b border-[oklch(var(--color-line))] px-2 text-sm ${marked ? ROW_MARK_ROW : ""}`}
                  >
                    {marked && <RowMark />}
                    <button
                      type="button"
                      onClick={() => onOpen(j.id)}
                      aria-current={j.id === currentId ? "true" : undefined}
                      title={j.soul_name || undefined}
                      className={`min-w-0 flex-1 truncate text-left text-[oklch(var(--color-ink))] hover:underline ${j.id === currentId ? "font-semibold" : ""}`}
                    >
                      {j.soul_name ? j.soul_name : <MissingValue kind="unrecorded" reason="soul_name 未随判决返回" />}
                    </button>
                    {j.court ? (
                      <span className="truncate text-xs text-[oklch(var(--color-ink-subtle))] max-sm:hidden" title={j.court}>
                        {j.court}
                      </span>
                    ) : null}
                    {canAssign && (
                      <button
                        type="button"
                        onClick={() => onReassign(j)}
                        /* B9 行内动作:1px ink3 框、11 字。 */
                        className="inline-flex h-(--control-h-sm) shrink-0 items-center px-3 border border-[oklch(var(--color-line-strong))] text-2xs text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("judgment.claim.reassign")}
                      </button>
                    )}
                  </m.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </LayoutGroup>
      )}
    </section>
  );
}
