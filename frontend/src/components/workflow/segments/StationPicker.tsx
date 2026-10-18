"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";

/** 一站:勾上 = 要走。`key` 是送回后端的那个值(生成之前是站序,生成之后是节点 id)。 */
export interface PickRow {
  key: string;
  /** 「1 · 分流」:段内站号 + 站名。 */
  label: string;
  hall: ReactNode;
  /** 审批人(人名或角色名)。 */
  who: ReactNode;
  /** 终审:勾灰、点不动,理由写在站名下(Design W-1a)。 */
  required: boolean;
}

/** 外域一行(W-1a 下半):只读,只写「由该域判官选站 · 默认流程 N 站」。 */
export interface ForeignRow {
  order: number;
  realm_name: string;
  default_node_count: number;
}

/** 段序号 → ①②③(Design 的分段头与外域行都用它)。 */
export const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `${n}.`);

/**
 * 选站列表(第四十三批 W-1a / W-1b,W-2 同一个列表)。
 *
 * 默认全选,表头不放「全选」;有取消时计数旁出现「全部恢复」。终审行勾灰,理由直接写在站名下。
 * 取消到只剩终审时列表上方出提示条(W-1b),不拦也不二次确认 —— 那是判官的权限;勾回任一站就消失。
 * 只画,不发请求:`skipped` 由调用方持有(结案弹层 / 发起弹层 / 选站底页各自送回后端)。
 */
export function StationPicker({
  flowName,
  rows,
  skipped,
  onChange,
  foreign = [],
  footnote,
}: {
  flowName: string;
  rows: PickRow[];
  skipped: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  foreign?: ForeignRow[];
  /** 外域判官那份(W-2):「本域排第 2 · 前面：中国 8 站」,代替外域行。 */
  footnote?: ReactNode;
}) {
  const { t } = useI18n();
  const final = rows.find((r) => r.required);
  const skippable = rows.filter((r) => !r.required);
  const skipCount = skippable.filter((r) => skipped.has(r.key)).length;
  const onlyFinal = !!final && skippable.length > 0 && skipCount === skippable.length;

  const toggle = (key: string) => {
    const next = new Set(skipped);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  return (
    <div data-testid="station-picker" className="flex flex-col gap-3 text-left">
      <div>
        <h3 className="text-lg text-[oklch(var(--color-ink))]">{t("workflow.pick.title")}</h3>
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("workflow.pick.subtitle", { flow: flowName, n: String(rows.length) })}
        </p>
      </div>

      {onlyFinal && final && (
        <div role="status" data-testid="only-final" className="border border-[oklch(var(--color-ink))] px-3 py-2 text-sm">
          <p className="font-medium text-[oklch(var(--color-ink))]">{t("workflow.pick.only_final_title")}</p>
          <p className="mt-1 text-[oklch(var(--color-ink-muted))]">
            {t("workflow.pick.only_final_body", {
              n: String(skippable.length),
              hall: typeof final.hall === "string" ? final.hall : "",
              approver: typeof final.who === "string" ? final.who : "",
            })}
          </p>
        </div>
      )}

      <div role="group" aria-label={t("workflow.pick.title")} className="border border-[oklch(var(--color-line))]">
        <div
          aria-hidden="true"
          className="grid grid-cols-[24px_minmax(0,1fr)_minmax(0,6rem)_minmax(0,7rem)] gap-x-2 px-3 py-1 text-2xs uppercase text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-line))]"
        >
          <span />
          <span>{t("workflow.pick.col_node")}</span>
          <span>{t("workflow.pick.col_hall")}</span>
          <span>{t("workflow.pick.col_approver")}</span>
        </div>
        <ul>
          {rows.map((row) => {
            const on = row.required || !skipped.has(row.key);
            return (
              <li
                key={row.key}
                data-station={row.key}
                data-required={row.required ? "" : undefined}
                className="border-b last:border-b-0 border-[oklch(var(--color-line))]"
              >
                <label
                  className={`grid grid-cols-[24px_minmax(0,1fr)_minmax(0,6rem)_minmax(0,7rem)] items-start gap-x-2 px-3 py-2 text-sm ${
                    row.required ? "cursor-default" : "cursor-pointer hover:bg-[oklch(var(--color-surface-2))]"
                  } ${on ? "text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-subtle))]"}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={row.required}
                    onChange={() => { if (!row.required) toggle(row.key); }}
                    className="mt-1 h-4 w-4 accent-[oklch(var(--color-accent))]"
                  />
                  <span className="min-w-0">
                    <span className={`break-words ${on ? "" : "line-through"}`}>{row.label}</span>
                    {row.required && (
                      <>
                        {" "}
                        <Badge tone="neutral">{t("workflow.pick.final_badge")}</Badge>
                        <span className="block text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.pick.final_reason")}</span>
                      </>
                    )}
                  </span>
                  <span className="min-w-0 truncate text-xs" title={typeof row.hall === "string" ? row.hall : undefined}>{row.hall}</span>
                  <span className="min-w-0 truncate text-xs" title={typeof row.who === "string" ? row.who : undefined}>{row.who}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {foreign.length > 0 && (
        <section data-testid="picker-foreign" className="flex flex-col gap-1">
          <h4 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("workflow.pick.foreign_title")}</h4>
          <ul className="border border-[oklch(var(--color-line))]">
            {foreign.map((f) => (
              <li
                key={f.order}
                className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm border-b last:border-b-0 border-[oklch(var(--color-line))] text-[oklch(var(--color-ink-muted))]"
              >
                <span className="text-[oklch(var(--color-ink))]">
                  <span aria-hidden="true">{circled(f.order)} </span>
                  {f.realm_name}
                </span>
                <span className="text-xs">{t("workflow.pick.foreign_by_realm")}</span>
                <span className="ml-auto text-xs">{t("workflow.pick.foreign_default", { n: String(f.default_node_count) })}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.pick.foreign_note")}</p>
        </section>
      )}

      {footnote ? <p className="text-xs text-[oklch(var(--color-ink-muted))]">{footnote}</p> : null}

      <div className="flex flex-wrap items-center gap-3 text-sm text-[oklch(var(--color-ink))]">
        <span data-testid="pick-summary">
          {t("workflow.pick.summary", { go: String(rows.length - skipCount), skip: String(skipCount) })}
        </span>
        {skipCount > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(new Set())}>
            {t("workflow.pick.restore_all")}
          </Button>
        )}
      </div>
    </div>
  );
}
