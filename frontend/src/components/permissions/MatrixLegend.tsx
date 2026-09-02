"use client";

import { Permission, Role } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { codenameOf, findCountParadox, findNonSubsetPair } from "./matrixDiff";

type NonSubsetPair = ReturnType<typeof findNonSubsetPair>;
type CountParadox = ReturnType<typeof findCountParadox>;

/** Peer-not-ladder legend, computed from the live baseline by the caller. */
export function MatrixLegend({
  nonSubsetPair,
  countParadox,
  roleMeta,
  permsById,
}: {
  nonSubsetPair: NonSubsetPair;
  countParadox: CountParadox;
  roleMeta: Record<string, Role>;
  permsById: Record<number, Permission>;
}) {
  const { t } = useI18n();
  if (!nonSubsetPair && !countParadox) return null;

  return (
    <div className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] p-4 mb-4 text-03 space-y-2">
      <h3 className="font-semibold text-[hsl(var(--color-ink))]">{t("permissions.matrix.legend_title")}</h3>
      <p className="text-[hsl(var(--color-ink-muted))]">{t("permissions.matrix.legend_intro")}</p>
      {nonSubsetPair && (
        <p className="text-[hsl(var(--color-ink-muted))]">
          {t("permissions.matrix.legend_nonsubset", {
            roleA: roleMeta[nonSubsetPair.a]?.display_name || nonSubsetPair.a,
            roleB: roleMeta[nonSubsetPair.b]?.display_name || nonSubsetPair.b,
            codenamesA: nonSubsetPair.aOnly.map((id) => codenameOf(permsById, id)).slice(0, 4).join(", "),
            codenamesB: nonSubsetPair.bOnly.map((id) => codenameOf(permsById, id)).slice(0, 4).join(", "),
          })}
        </p>
      )}
      {countParadox && (
        <p className="text-[hsl(var(--color-ink-muted))]">
          {t("permissions.matrix.legend_countparadox", {
            higher: roleMeta[countParadox.higher]?.display_name || countParadox.higher,
            higherCount: String(countParadox.higherCount),
            lower: roleMeta[countParadox.lower]?.display_name || countParadox.lower,
            lowerCount: String(countParadox.lowerCount),
            codenames: countParadox.exclusiveToLower.map((id) => codenameOf(permsById, id)).join(", "),
          })}
        </p>
      )}
    </div>
  );
}
