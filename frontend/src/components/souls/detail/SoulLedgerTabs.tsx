"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";

const TABS = ["judgments", "records"] as const;
export type SoulLedgerTab = (typeof TABS)[number];

/**
 * v3 灵魂详情的中栏(原型 `.soul-ledger`):两种主阅读视图 ——「全部审判」「全部功过记录」。
 *
 * 不当前的那一份只是 `hidden`,不卸载:两份数据页面本来就都取了,卸载只会让切回来时
 * 图表重新挂载一次。选中标的下划线是墨色,不是文明色 —— 文明色只进匾、导航当前项、印、
 * 主按钮与「我的」行标(DESIGN.md)。
 *
 * 功过总账的行链到 `#soul-karma`:带着这个 hash 进来时直接打开「全部功过记录」。
 */
export function SoulLedgerTabs({
  judgmentCount,
  recordCount,
  judgments,
  records,
}: {
  judgmentCount: number;
  recordCount: number | null;
  judgments: ReactNode;
  records: ReactNode;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<SoulLedgerTab>("judgments");
  const tabRefs = useRef<Record<SoulLedgerTab, HTMLButtonElement | null>>({ judgments: null, records: null });

  useEffect(() => {
    // 挂载之后才读 hash:服务端没有 location,首帧按「全部审判」画,免得水合对不上。
    if (window.location.hash === "#soul-karma") setActive("records");
  }, []);

  const label: Record<SoulLedgerTab, string> = {
    judgments: t("souls.detail.profile.tab_judgments"),
    records: t("souls.detail.profile.tab_records"),
  };
  const count: Record<SoulLedgerTab, number | null> = { judgments: judgmentCount, records: recordCount };
  const panel: Record<SoulLedgerTab, ReactNode> = { judgments, records };

  function onKey(event: KeyboardEvent<HTMLButtonElement>, tab: SoulLedgerTab) {
    const i = TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? TABS[(i + 1) % TABS.length]
      : event.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length]
      : event.key === "Home" ? TABS[0]
      : event.key === "End" ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section data-testid="soul-ledger-tabs" className="min-w-0 bg-[oklch(var(--color-surface-1))]">
      <div
        role="tablist"
        aria-label={t("souls.detail.profile.ledger_tabs")}
        className="flex h-12 items-stretch overflow-x-auto border-b border-[oklch(var(--color-line))] px-2"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            ref={(el) => {
              tabRefs.current[tab] = el;
            }}
            id={`soul-ledger-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={tab === active}
            aria-controls={`soul-ledger-panel-${tab}`}
            tabIndex={tab === active ? 0 : -1}
            onClick={() => setActive(tab)}
            onKeyDown={(event) => onKey(event, tab)}
            className={`shrink-0 whitespace-nowrap px-4 text-sm transition-colors duration-fast ${
              tab === active
                ? "font-semibold text-[oklch(var(--color-ink))] shadow-[inset_0_-2px_0_oklch(var(--color-ink))]"
                : "text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
            }`}
          >
            {label[tab]}
            {count[tab] !== null && (
              <span className="ml-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{count[tab]}</span>
            )}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab}
          id={`soul-ledger-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`soul-ledger-tab-${tab}`}
          data-ledger-panel={tab}
          hidden={tab !== active}
          className="min-w-0"
        >
          {panel[tab]}
        </div>
      ))}
    </section>
  );
}
