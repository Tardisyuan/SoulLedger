"use client";

import type { Soul } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerHeading } from "./SoulLedgerSections";

/** 一对 dt/dd 的行线与字色(规范 v1 灵魂详情「甲 · 身份」)。 */
const DT = "py-1.5 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))]";
const DD = "py-1.5 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink))] min-w-0";

/**
 * 甲 · 身份: civilization, birth, death, origin — ledger rows, no card.
 *
 * 规范稿这一段首行是 ID。这里不放:IDENTIFIER_POLICY(src/lib/domainDisplay.ts)
 * 规定 UUID 全站只在页头出现一次、可复制 —— 那个 chip 仍在副标题里。
 */
export function SoulInfoCard({
  soul,
  loading,
  birthDisplay,
  deathDisplay,
}: {
  soul: Soul | null;
  loading: boolean;
  birthDisplay: string | null;
  deathDisplay: string | null;
}) {
  // `tf` used to arrive as a prop from app/souls/[id]/page.tsx, alongside the
  // `t` this component was already pulling off the context itself.
  const { t, tf } = useI18n();

  return (
    <section>
      <LedgerHeading mark="甲" title={t("souls.detail.ledger.identity")} />
      {loading ? (
        <div className="space-y-2 text-sm pt-2">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <dl className="grid grid-cols-[6rem_1fr] text-sm">
          {/* Soul ID now lives in the header as a copyable chip —
              a second, non-interactive, truncated copy here was
              redundant and couldn't be pasted into anything. */}
          <dt className={DT}>{t("souls.civilization")}</dt>
          <dd className={DD}><DomainEnum namespace="souls.civilizations" value={soul?.civilization} /></dd>
          <dt className={DT}>
            {/* birth_date belongs to the soul's original identity
                (birth_name), not necessarily the name in the header
                above — label it explicitly whenever the two differ
                so the date isn't misread as the current life's. */}
            {soul?.birth_name && soul.birth_name !== soul.name
              ? tf("souls.detail.birth_of", "Birth ({{name}})", { name: soul.birth_name })
              : t("souls.detail.birth")}
          </dt>
          <dd className={`${DD} font-mono`}><DomainText value={birthDisplay} /></dd>
          <dt className={DT}>{t("souls.detail.death")}</dt>
          {/* A soul that has not died has no death date, and that is
              "not applicable while alive", not "nobody wrote it down
              yet" — the two are different facts and now read
              differently (BRIEF §4.6). */}
          <dd className={`${DD} font-mono`}>
            <DomainText
              value={deathDisplay}
              missingKind={soul?.current_state === "ALIVE" ? "inapplicable" : "unrecorded"}
              missingReason={soul?.current_state === "ALIVE" ? t("souls.states.ALIVE") : undefined}
            />
          </dd>
          <dt className={DT}>{t("souls.detail.location_label")}</dt>
          <dd className={DD}><DomainText value={soul?.origin_location} /></dd>
        </dl>
      )}
    </section>
  );
}
