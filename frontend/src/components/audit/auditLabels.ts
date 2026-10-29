import { resolveEnumDisplay } from "@/src/lib/domainDisplay";

type T = (key: string, params?: Record<string, string>) => string;

/** 审计列表、权限变更、统计三处共用的资源名:有词条的翻译，没有的原样显示。 */
export function auditResourceLabel(t: T, resource: string): string {
  // 殿设置: the audit rows of editing a hall's settings themselves (resource=tenant). Distinct
  // from the 「按殿」 dropdown on the list, which narrows ANY resource to one hall's rows.
  if (resource === "tenant") return t("audit.resource_tenant");
  const shown = resolveEnumDisplay(t, "audit.resources", resource);
  return shown.state === "known" && shown.label ? shown.label : resource;
}

/**
 * 权限变更时间线默认看的六类资源，与 `AuditLogViewSet.timeline` 的 `permission_resources` 同一份
 * (小写，同 `_meta.label_lower`)。
 */
export const PERMISSION_RESOURCES = [
  "role",
  "rolepermission",
  "menu",
  "menubutton",
  "fieldpermission",
  "permission",
] as const;

export type DatePreset = "" | "7d" | "30d";

/**
 * 列表的日期三档(全部 · 7 天 · 30 天)都是「N 天前到现在」,所以只算起点(`start_date`);全部为 ""。
 */
export function datePresetStart(preset: DatePreset, now = new Date()): string {
  if (!preset) return "";
  const from = new Date(now);
  from.setDate(from.getDate() - (preset === "7d" ? 7 : 30));
  return from.toISOString().slice(0, 10);
}
