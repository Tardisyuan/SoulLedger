"use client";

import { useId, useState } from "react";
import type { Organization } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { flattenTree } from "@/src/components/ui/TreeRow";
import { cn } from "@/lib/utils";

/** 机构树的拼法(/organizations 与本组件共用):兄弟按 `sort`,深度优先展开。 */
export function orgTreeRows(orgs: readonly Organization[]) {
  return flattenTree(
    [...orgs].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    (o) => o.id,
    (o) => o.parent,
  );
}

interface Common {
  organizations: readonly Organization[];
  label: string;
  /** 殿 id → 殿名;有不止一个殿时按殿分组,组头用它。 */
  tenantNames?: ReadonlyMap<number, string>;
  disabled?: boolean;
  /** 这些行不可选(机构表单的上级:自己和自己的下级,挂过去会成环)。 */
  disabledIds?: ReadonlySet<number>;
  error?: string;
}
type Props =
  | (Common & { mode: "single"; value: number | null; onChange: (id: number | null) => void; noneLabel?: string })
  | (Common & { mode: "multi"; value: readonly number[]; onChange: (ids: number[]) => void });

/**
 * 机构树选择。单选 = 一组原生 radio(方向键在组内移动);多选 = 原生 checkbox。
 * 多选时勾了上级,它的下级显示为「含于上级」(勾着、不可单独点);提交的仍只是显式勾选的 id,
 * 勾上级时顺手去掉已显式勾选的下级(已被包含,留着只是重复)。
 */
export function OrgTreeSelect(props: Props) {
  const { organizations, label, tenantNames, disabled, disabledIds, error } = props;
  const { t } = useI18n();
  const name = useId();
  const errorId = `${name}-error`;
  const [query, setQuery] = useState("");
  const byId = new Map(organizations.map((o) => [o.id, o]));

  const ancestors = (id: number) => {
    const out: number[] = [];
    const seen = new Set<number>([id]);
    for (let p = byId.get(id)?.parent; p != null && !seen.has(p); p = byId.get(p)?.parent) {
      seen.add(p);
      out.push(p);
    }
    return out;
  };
  const selected = new Set(props.mode === "multi" ? props.value : props.value != null ? [props.value] : []);
  const implied = (id: number) => props.mode === "multi" && ancestors(id).some((a) => selected.has(a));

  const q = query.trim().toLowerCase();
  let shown: readonly Organization[] = organizations;
  if (q) {
    const keep = new Set<number>();
    for (const o of organizations) {
      if (o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)) {
        keep.add(o.id);
        ancestors(o.id).forEach((a) => keep.add(a));
      }
    }
    shown = organizations.filter((o) => keep.has(o.id));
  }

  const groups = new Map<number | null, Organization[]>();
  for (const o of shown) {
    const key = o.tenant ?? null;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const grouped = new Set(organizations.map((o) => o.tenant ?? null)).size > 1;

  const toggle = (id: number, on: boolean) => {
    if (props.mode === "single") return props.onChange(id);
    props.onChange(on ? [...props.value.filter((v) => !ancestors(v).includes(id)), id] : props.value.filter((v) => v !== id));
  };

  const groupName = (tenant: number | null) =>
    tenant == null ? t("org_select.no_tenant") : tenantNames?.get(tenant) ?? `#${tenant}`;

  const rowClass = "flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm";
  const inputType = props.mode === "multi" ? "checkbox" : "radio";

  return (
    <fieldset
      className="flex flex-col gap-1"
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="text-xs text-[oklch(var(--color-ink-muted))]">{label}</legend>
      <input
        type="search"
        aria-label={t("souls.search")}
        placeholder={t("souls.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-(--control-h-md) border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-3 text-sm"
      />
      <div className="max-h-56 overflow-y-auto border border-[oklch(var(--color-line))]">
        {props.mode === "single" && props.noneLabel && !q && (
          <label className={rowClass}>
            <input type="radio" name={name} checked={props.value === null} onChange={() => props.onChange(null)} />
            {props.noneLabel}
          </label>
        )}
        {shown.length === 0 && <p className="px-3 py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("org_select.no_match")}</p>}
        {[...groups].map(([tenant, orgs]) => (
          <div key={tenant ?? "none"} role={grouped ? "group" : undefined} aria-label={grouped ? groupName(tenant) : undefined}>
            {grouped && (
              <div className="bg-[oklch(var(--color-surface-2))] px-3 py-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]" aria-hidden="true">
                {groupName(tenant)}
              </div>
            )}
            {orgTreeRows(orgs).map(({ item: o, depth }) => {
              const viaParent = implied(o.id);
              const checked = selected.has(o.id) || viaParent;
              const off = disabledIds?.has(o.id) ?? false;
              return (
                <label
                  key={o.id}
                  style={{ paddingLeft: 12 + depth * 16 }}
                  className={cn(
                    rowClass,
                    checked && "bg-[oklch(var(--color-surface-2))]",
                    viaParent && "text-[oklch(var(--color-ink-muted))]",
                    off && "cursor-not-allowed text-[oklch(var(--color-disabled-ink))]",
                  )}
                >
                  <input
                    type={inputType}
                    name={props.mode === "single" ? name : undefined}
                    checked={checked}
                    disabled={viaParent || off}
                    onChange={(e) => toggle(o.id, e.target.checked)}
                  />
                  {o.name}
                  <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{o.code}</span>
                  {viaParent && <span className="text-xs">{t("org_select.implied")}</span>}
                </label>
              );
            })}
          </div>
        ))}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[oklch(var(--color-danger))]">
          {error}
        </p>
      )}
    </fieldset>
  );
}
