"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSoul } from "@soulledger/core/hooks/useSouls";
import type { SoulListItem } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Drawer } from "@/src/components/ui/Drawer";
import { Badge } from "@/src/components/ui/Badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainEnum, DomainNumber, DomainText, MissingValue } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { soulStateBadgeClass, soulStateGlyph } from "@/src/lib/soulStateBadge";
import { formatHistoricalDate } from "@/lib/utils";

interface SoulPreviewDrawerProps {
  /** The list row being previewed; null = closed. */
  soul: SoulListItem | null;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  /** Where focus goes on close — the preview control of the row now shown. */
  finalFocus: () => HTMLElement | null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="min-w-0 text-[oklch(var(--color-ink))]">{children}</dd>
    </>
  );
}

/**
 * The soul list's preview (spec: 不离开列表看详情). Title and state come from the
 * list row already in hand; the rest from GET /souls/{id}/, which is what the
 * skeleton and the error bar are about.
 */
export function SoulPreviewDrawer({ soul, onClose, onNext, onPrev, finalFocus }: SoulPreviewDrawerProps) {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, refetch } = useSoul(soul?.id ?? "");
  // `karmic_balance` is the CHINESE instrument only — same rule as the list's
  // balance column (app/souls/page.tsx).
  const balanceApplies = soul?.civilization === "CHINESE";
  const score = (v: number | undefined) =>
    !balanceApplies ? (
      <MissingValue kind="inapplicable" reason={t("souls.balance_not_applicable")} />
    ) : v === undefined || v === null ? (
      <MissingValue kind="unrecorded" reason={t("souls.balance_withheld")} />
    ) : (
      <DomainNumber value={v} signed toned />
    );

  return (
    <Drawer
      isOpen={soul !== null}
      onClose={onClose}
      title={soul?.name ?? ""}
      hint={t("souls.preview.hint")}
      onNext={onNext}
      onPrev={onPrev}
      finalFocus={finalFocus}
      error={
        isError ? (
          <span className="flex items-baseline justify-between gap-3">
            <span>! {t("souls.preview.load_error")}</span>
            <button type="button" onClick={() => refetch()} className="underline">
              {t("common.retry")}
            </button>
          </span>
        ) : undefined
      }
    >
      {soul && (
        <>
          <dl aria-busy={isLoading} className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-2 text-sm">
            <Row label={t("souls.state")}>
              <Badge
                title={soul.current_state}
                glyph={soulStateGlyph(soul.current_state)}
                className={soulStateBadgeClass(soul.current_state)}
              >
                {resolveEnumDisplay(t, "souls.states", soul.current_state).label ?? t("common.value.unrecorded")}
              </Badge>
            </Row>
            <Row label={t("souls.civilization")}>
              <DomainEnum namespace="souls.civilizations" value={soul.civilization} />
            </Row>
            {isLoading ? (
              // Same rows, same heights as the loaded state, so nothing jumps.
              [0, 1, 2, 3, 4, 5].map((i) => (
                <Row key={i} label={" "}>
                  <Skeleton className="h-5 w-2/3" />
                </Row>
              ))
            ) : data ? (
              <>
                <Row label={t("souls.detail.birth")}>
                  <DomainText value={formatHistoricalDate(data.birth_date, locale)} className="font-mono" />
                </Row>
                <Row label={t("souls.detail.death")}>
                  <DomainText value={formatHistoricalDate(data.death_date, locale)} className="font-mono" />
                </Row>
                <Row label={t("souls.form.location_label")}>
                  <DomainText value={data.origin_location || null} />
                </Row>
                <Row label={t("souls.detail.merit")}>{score(data.merit_score)}</Row>
                <Row label={t("souls.detail.demerit")}>{score(data.demerit_score)}</Row>
                <Row label={t("souls.detail.balance")}>{score(data.karmic_balance)}</Row>
              </>
            ) : null}
          </dl>
          <Link
            href={`/souls/${soul.id}`}
            className="inline-block mt-4 text-sm underline text-[oklch(var(--color-accent-ink))]"
          >
            {t("souls.preview.open_full")}
          </Link>
        </>
      )}
    </Drawer>
  );
}
