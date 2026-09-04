"use client";

import type { Soul } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { Skeleton } from "@/components/ui/skeleton";

/** Left column's 灵魂信息 card: civilization, birth, death, origin. */
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
    <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
      <h2 className="text-03 font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{t("souls.detail.soul_info")}</h2>
      {loading ? (
        <div className="space-y-2 text-03">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <dl className="space-y-2 text-03">
          {/* Soul ID now lives in the header as a copyable chip —
              a second, non-interactive, truncated copy here was
              redundant and couldn't be pasted into anything. */}
          <div className="flex justify-between">
            <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.civilization")}</dt>
            <dd className="text-[hsl(var(--color-ink))]"><DomainEnum namespace="souls.civilizations" value={soul?.civilization} /></dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[hsl(var(--color-ink-muted))] shrink-0">
              {/* birth_date belongs to the soul's original identity
                  (birth_name), not necessarily the name in the header
                  above — label it explicitly whenever the two differ
                  so the date isn't misread as the current life's. */}
              {soul?.birth_name && soul.birth_name !== soul.name
                ? tf("souls.detail.birth_of", "Birth ({{name}})", { name: soul.birth_name })
                : t("souls.detail.birth")}
            </dt>
            <dd className="text-[hsl(var(--color-ink))] text-right"><DomainText value={birthDisplay} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.death")}</dt>
            {/* A soul that has not died has no death date, and that is
                "not applicable while alive", not "nobody wrote it down
                yet" — the two are different facts and now read
                differently (BRIEF §4.6). */}
            <dd className="text-[hsl(var(--color-ink))]">
              <DomainText
                value={deathDisplay}
                missingKind={soul?.current_state === "ALIVE" ? "inapplicable" : "unrecorded"}
                missingReason={soul?.current_state === "ALIVE" ? t("souls.states.ALIVE") : undefined}
              />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.location_label")}</dt>
            <dd className="text-[hsl(var(--color-ink))]"><DomainText value={soul?.origin_location} /></dd>
          </div>
        </dl>
      )}
    </div>
  );
}
