"use client";

import type { Soul } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { Skeleton } from "@/components/ui/skeleton";

/** 一行:标签在上、值在下,行线在上(v3 `.soul-biography dl>div`)。 */
const ROW = "border-t border-[oklch(var(--color-line))] py-3";
const DT = "text-2xs text-[oklch(var(--color-ink-subtle))]";
const DD = "mt-1 min-w-0 text-sm text-[oklch(var(--color-ink))] break-words";

/**
 * 身份(v3 灵魂详情左栏「IDENTITY / 身份」):文明、生、卒、籍贯、本名,然后生平描述。
 *
 * ID 不在这里:IDENTIFIER_POLICY(src/lib/domainDisplay.ts)规定 UUID 全站只在页头
 * 出现一次、可复制 —— 那个 chip 在页头的 eyebrow 里。
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
  const { t, tf } = useI18n();

  return (
    <section aria-labelledby="soul-identity-title" data-testid="soul-identity" className="min-w-0 bg-[oklch(var(--color-surface-1))] p-6">
      <h2 id="soul-identity-title" className="text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
        {t("souls.detail.ledger.identity")}
      </h2>
      {loading ? (
        <div className="mt-4 space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <dl className="mt-4 border-b border-[oklch(var(--color-line))]">
            <div className={ROW}>
              <dt className={DT}>{t("souls.civilization")}</dt>
              <dd className={DD}>
                <DomainEnum namespace="souls.civilizations" value={soul?.civilization} />
              </dd>
            </div>
            <div className={ROW}>
              <dt className={DT}>
                {/* birth_date belongs to the soul's original identity
                    (birth_name), not necessarily the name in the header
                    above — label it explicitly whenever the two differ
                    so the date isn't misread as the current life's. */}
                {soul?.birth_name && soul.birth_name !== soul.name
                  ? tf("souls.detail.birth_of", "Birth ({{name}})", { name: soul.birth_name })
                  : t("souls.detail.birth")}
              </dt>
              <dd className={`${DD} font-mono`}>
                <DomainText value={birthDisplay} />
              </dd>
            </div>
            <div className={ROW}>
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
            </div>
            <div className={ROW}>
              <dt className={DT}>{t("souls.detail.location_label")}</dt>
              <dd className={DD}>
                <DomainText value={soul?.origin_location} />
              </dd>
            </div>
            <div className={ROW}>
              <dt className={DT}>{t("souls.detail.profile.birth_name")}</dt>
              <dd className={DD}>
                <DomainText value={soul?.birth_name} />
              </dd>
            </div>
          </dl>
          {/* 生平描述(`Soul.description`):官员写下的记录,不是本人说的话 —— 界面字体,不用衬线。 */}
          <h3 className="mt-6 text-sm font-medium text-[oklch(var(--color-ink))]">{t("souls.detail.profile.description")}</h3>
          <p data-testid="soul-description" className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[oklch(var(--color-ink-muted))]">
            <DomainText value={soul?.description} />
          </p>
        </>
      )}
    </section>
  );
}
