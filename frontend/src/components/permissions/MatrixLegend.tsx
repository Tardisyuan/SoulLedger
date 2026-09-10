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
    <div className="bg-[oklch(var(--color-surface-2))] border border-[oklch(var(--color-hairline))] p-4 mb-4 text-03 space-y-2">
      {/* 面板标题这一档是 `text-06`,见 `src/components/ui/PageShell.tsx` 文件头。
          此前这里一个 `text-0N` 都没写,于是标题的字号来自**外层那个 `text-03`**
          —— 它和自己下面的说明段落同为 13px,只靠 weight 分开。字号从刻度来,
          不从祖先的一个工具类来,这是刻度存在的全部理由。
          `font-semibold` 一并删掉:`--text-06--font-weight` 已经是 600。 */}
      <h3 className="text-06 text-[oklch(var(--color-ink))]">{t("permissions.matrix.legend_title")}</h3>
      <p className="text-[oklch(var(--color-ink-muted))]">{t("permissions.matrix.legend_intro")}</p>
      {nonSubsetPair && (
        <p className="text-[oklch(var(--color-ink-muted))]">
          {t("permissions.matrix.legend_nonsubset", {
            roleA: roleMeta[nonSubsetPair.a]?.display_name || nonSubsetPair.a,
            roleB: roleMeta[nonSubsetPair.b]?.display_name || nonSubsetPair.b,
            codenamesA: nonSubsetPair.aOnly.map((id) => codenameOf(permsById, id)).slice(0, 4).join(", "),
            codenamesB: nonSubsetPair.bOnly.map((id) => codenameOf(permsById, id)).slice(0, 4).join(", "),
          })}
        </p>
      )}
      {countParadox && (
        <p className="text-[oklch(var(--color-ink-muted))]">
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
