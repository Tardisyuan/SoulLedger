"use client";

import { useQuery } from "@tanstack/react-query";
import { reincarnationApi } from "@soulledger/core/api";
import { quotaIsFull, type RebirthQuotaUsage } from "@soulledger/core/api/reincarnation";
import { useI18n } from "@/src/contexts/I18nContext";
import { Badge } from "@/src/components/ui/Badge";
import { SIX_PATHS } from "@/src/components/souls/RebirthFormSelect";

/**
 * 转世月配额(第五十一批):`GET /reincarnation/quota/` —— 调用者这一殿、这个自然月、每道一行。
 * 登记页的那一行配额(Q-2)和办转世时的选道(Q-3)读的是同一份,一个 query key,办完一次两处一起刷新。
 */
export const REBIRTH_QUOTA_KEY = ["reincarnation", "quota"] as const;

export function useRebirthQuota(enabled = true) {
  return useQuery({
    queryKey: REBIRTH_QUOTA_KEY,
    queryFn: () => reincarnationApi.quota().then((r) => r.data),
    enabled,
  });
}

/** 六道 + 未归类:六道按 `reincarnation.groups` 的顺序,「未归类」排最后(后端也按它计数)。 */
const STRIP_FORMS = [...SIX_PATHS, "OTHER"] as const;

/** 本月的 `YYYY-MM`(本地时间,后端按本地时区的月初算)。 */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 一格里的数:有上限写「已用 / 上限」,不限写「已用 · 不限」。 */
export function quotaUsedText(row: Pick<RebirthQuotaUsage, "limit" | "used">, t: (key: string, params?: Record<string, string>) => string): string {
  return row.limit == null
    ? t("rebirths.quota.used_unlimited", { used: String(row.used) })
    : t("rebirths.quota.used_of", { used: String(row.used), limit: String(row.limit) });
}

/**
 * 登记页表格上方的一行(Q-2):每道一格、等宽。满了的格子换 ink 框、加「已满」——
 * 不用 danger:满额是正常状态,不是错误。没拿到数(加载中 / 出错)就不画这一行。
 */
export function RebirthQuotaStrip() {
  const { t } = useI18n();
  const { data } = useRebirthQuota();
  if (!data) return null;
  const byForm = new Map(data.map((r) => [r.rebirth_form, r]));
  return (
    <section aria-labelledby="rebirth-quota-title" data-testid="rebirth-quota-strip" className="pb-4">
      <h2 id="rebirth-quota-title" className="mb-2 text-xs text-[oklch(var(--color-ink-muted))]">
        {t("rebirths.quota.title", { month: currentMonth() })}
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-7">
        {STRIP_FORMS.map((form) => {
          const row = byForm.get(form) ?? { rebirth_form: form, limit: null, used: 0 };
          const full = quotaIsFull(row);
          return (
            <li
              key={form}
              data-quota-cell={form}
              data-full={full ? "true" : undefined}
              className={`min-w-0 border px-3 py-2 ${full ? "border-[oklch(var(--color-ink))]" : "border-[oklch(var(--color-line))]"}`}
            >
              <span className="flex items-center justify-between gap-2 text-xs text-[oklch(var(--color-ink))]">
                <span className="truncate">{t(`reincarnation.forms.${form}`)}</span>
                {full ? <Badge tone="ink">{t("rebirths.quota.full_badge")}</Badge> : null}
              </span>
              <span className="mt-1 block font-mono text-sm tabular-nums text-[oklch(var(--color-ink))]">{quotaUsedText(row, t)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
