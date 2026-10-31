"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import { judgmentApi, type Judgment } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useReducedMotionDurations } from "@/src/hooks/useReducedMotionDurations";
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
 *
 * 认领超过一页(20 件)时,底下一个「再载入 N 件」接着取下一页(审计 1017 #16):此前只取第一页,
 * 第 21 件起不显示,而标题旁的计数是全部 —— 数对不上,也没有提示。第一页的请求不带 `page`。
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
  const query = useInfiniteQuery({
    // 与别处 `judgmentKeys.list({...PARAMS})` 的单页缓存分开(形状不同);仍在 `judgmentKeys.all` 之下,推送照样刷新。
    queryKey: [...judgmentKeys.list({ ...PARAMS }), "pages"],
    queryFn: async ({ pageParam }) =>
      (await judgmentApi.list(pageParam > 1 ? { ...PARAMS, page: String(pageParam) } : { ...PARAMS })).data,
    initialPageParam: 1,
    getNextPageParam: (last, _pages, lastParam) => (last.next ? lastParam + 1 : undefined),
  });
  const loaded = query.data?.pages.flatMap((p) => p.results) ?? [];
  const total = query.data?.pages[0]?.count;

  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? recent.length : i;
  };
  const rows = loaded
    .filter((j) => !gone.includes(j.id))
    .map((j, order) => ({ j, order }))
    .sort((a, b) => rank(a.j.id) - rank(b.j.id) || a.order - b.order)
    .map(({ j }) => j);
  const goneHere = loaded.filter((j) => gone.includes(j.id)).length;

  return (
    <section aria-labelledby="queue-mine-heading" data-testid="queue-mine" className="space-y-2">
      {/* 区块标签一档(与审判队列控制台里的 <h2> 同一写法);v2 节首的匾纹片段撤掉。 */}
      <div className="flex items-center gap-3">
        <h2 id="queue-mine-heading" className="text-2xs uppercase text-[oklch(var(--color-ink-muted))]">
          {t("judgment.claim.groups.mine")}
        </h2>
        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
          {total !== undefined ? String(total - goneHere) : "…"}
        </span>
      </div>
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
                      {j.soul_name ? j.soul_name : <MissingValue kind="unrecorded" reason={t("judgment.soul_name_not_returned")} />}
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
          {query.hasNextPage && total !== undefined && (
            <button
              type="button"
              data-testid="queue-mine-more"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              /* 同行内动作:1px ink3 框、11 字。 */
              className="mt-2 inline-flex h-(--control-h-sm) items-center px-3 border border-[oklch(var(--color-line-strong))] text-2xs text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))] disabled:text-[oklch(var(--color-disabled-ink))]"
            >
              {t("judgment.claim.load_more", { n: String(total - loaded.length) })}
            </button>
          )}
        </LayoutGroup>
      )}
    </section>
  );
}
