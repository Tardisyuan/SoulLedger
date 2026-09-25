"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { realmsApi, type Realm, type RealmCapacityResult } from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Castle, Cloud, Flame, CircleDot } from "lucide-react";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Badge } from "@/src/components/ui/Badge";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { RouteTopology, realmStationLabel } from "@/src/components/realms/RouteTopology";
import { buildTopology } from "@/src/lib/routeTopology";
import { CIVILIZATION_MARK } from "@/src/lib/civilizationIdentity";

/**
 * 界域(第三类 B · /realms):左边是这个文明的行程拓扑,右边是同一批数据的树表
 * (在押 / 容量 / 永恒)。界域就是行程拓扑的「底图」—— 详情页的行程条 = 这张图 +
 * 一个灵魂的 path,所以两处用的是同一个 `<RouteTopology>`、同一套图例,切换文明只换
 * 形状、不换颜色(文明靠 ■●▲◆ 与名字区分,规范 v1 §1.8)。
 *
 * **只有容量可改。** `PATCH /realms/{id}/` 只收 `capacity`(别的字段 400),持
 * `realms.manage`(默认只 ADMIN)的人在树表里行内改;其余各列来自神话语料,不经接口改。
 * 不持有的人看到的仍是只读表,表下写明原因。容量降到在押人数以下是允许的:谁都不挪,
 * 之后发落到这里会被拒(409 `realm_full`)—— 编辑时与保存后都用「已满」说出来。
 *
 * 在押来自 `GET /realms/occupancy/`(未离开的行程站计数,按租户划界)。容量 null
 * 是「未记录」,不是无限;在押 ≥ 容量用警示色,并另写「已满」,不单靠颜色。
 */

/** The switch's four entries. Keyed by civilization so a fifth one missing here is caught
 *  (src/__tests__/civilizationMapCoverage.test.ts); the mark comes from civilizationIdentity. */
const CIVILIZATION_CONFIG: Record<string, { nameKey: string }> = {
  CHINESE: { nameKey: "realms.civilizations.CHINESE" },
  EUROPEAN: { nameKey: "realms.civilizations.EUROPEAN" },
  EGYPTIAN: { nameKey: "realms.civilizations.EGYPTIAN" },
  GREEK: { nameKey: "realms.civilizations.GREEK" },
};

/**
 * The realm-type badge, drawn from the VERDICT palette — the domain layer —
 * rather than the system-feedback one it used to borrow. Shown in the tree
 * table's 类型 column for a realm that has no 殿 / 门 / 层 / 道 `kind`.
 *
 * NEUTRAL is the authored dim neutral: `RealmType.NEUTRAL` is a waypoint nobody
 * is sentenced to, so no verdict token can mirror it. Its LABEL is ink-muted
 * rather than ink-tertiary because ink-tertiary on a 10% tint of itself is
 * under the 4.5:1 floor (2.56:1 light).
 *
 * src/__tests__/statusTokenLayering.test.ts holds this map to the rule. It reads
 * these four entries AS TEXT, one line per key, and parses the
 * `x-[oklch(var(--t)/a)]` utilities out of each — so the four lines below stay
 * one-line literals and the alphas stay 0.1 / 0.3 / 1.
 */
const REALM_TYPE_CONFIG: Record<string, { icon: React.ReactNode; className: string }> = {
  HELL: { icon: <Flame className="w-4 h-4" />, className: 'bg-[oklch(var(--color-verdict-failed)/0.1)] border-[oklch(var(--color-verdict-failed)/0.3)] text-[oklch(var(--color-verdict-failed))]' },
  PURGATORY: { icon: <Cloud className="w-4 h-4" />, className: 'bg-[oklch(var(--color-verdict-purgatory)/0.1)] border-[oklch(var(--color-verdict-purgatory)/0.3)] text-[oklch(var(--color-verdict-purgatory))]' },
  BLISS: { icon: <CircleDot className="w-4 h-4" />, className: 'bg-[oklch(var(--color-verdict-passed)/0.1)] border-[oklch(var(--color-verdict-passed)/0.3)] text-[oklch(var(--color-verdict-passed))]' },
  NEUTRAL: { icon: <Castle className="w-4 h-4" />, className: 'bg-[oklch(var(--color-ink-tertiary)/0.1)] border-[oklch(var(--color-ink-tertiary)/0.3)] text-[oklch(var(--color-ink-muted))]' },
};

/** One row of the tree table: a realm and how deep it sits under `parent_realm`. */
interface TreeRow {
  realm: Realm;
  depth: number;
}

/**
 * Depth-first over `parent_realm`, in the API's order at each level. A parent
 * outside this list (another civilization, or deleted) makes the realm a root —
 * and a cycle cannot hang the page: a realm is emitted at most once.
 */
function treeRows(realms: Realm[]): TreeRow[] {
  const ids = new Set(realms.map((r) => r.id));
  const children = new Map<string, Realm[]>();
  const roots: Realm[] = [];
  for (const r of realms) {
    if (r.parent_realm && ids.has(r.parent_realm) && r.parent_realm !== r.id) {
      children.set(r.parent_realm, [...(children.get(r.parent_realm) ?? []), r]);
    } else roots.push(r);
  }
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (r: Realm, depth: number) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({ realm: r, depth });
    for (const c of children.get(r.id) ?? []) walk(c, depth + 1);
  };
  roots.forEach((r) => walk(r, 0));
  // Anything only reachable through a cycle is still listed, flat.
  realms.forEach((r) => walk(r, 0));
  return out;
}

function RealmsPageContent() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("realms.manage");
  const [picked, setPicked] = useState<string | null>(null);

  const realmsQuery = useQuery({
    queryKey: ["realms", user?.tenant?.code, user?.role],
    queryFn: () => realmsApi.list().then((r) => r.data.results || []),
    enabled: !!user,
  });
  const occupancyQuery = useQuery({
    queryKey: ["realms", "occupancy", user?.tenant?.code],
    queryFn: () => realmsApi.occupancy().then((r) => r.data),
    enabled: !!user,
  });

  const realms = realmsQuery.data ?? [];
  const civilization =
    picked ?? CIVILIZATION_OPTIONS.find((c) => realms.some((r) => r.civilization === c)) ?? CIVILIZATION_OPTIONS[0];
  const own = realms.filter((r) => r.civilization === civilization);
  const occupancy = new Map((occupancyQuery.data ?? []).map((o) => [o.realm_id, o.count]));

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("realms.title")}
          <MenuGloss path="/realms" />
        </>
      }
      subtitle={t("realms.subtitle")}
      filters={
        <div role="group" aria-label={t("souls.filter_civilization")} className="flex flex-wrap border border-[oklch(var(--color-block))] text-xs">
          {Object.entries(CIVILIZATION_CONFIG).map(([civ, config]) => (
            <button
              key={civ}
              type="button"
              aria-pressed={civ === civilization}
              onClick={() => setPicked(civ)}
              className={`px-3 h-8 ${
                civ === civilization
                  ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                  : "text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
              }`}
            >
              <span aria-hidden="true">{CIVILIZATION_MARK[civ]} </span>
              {t(config.nameKey)}
            </button>
          ))}
        </div>
      }
    >
      {realmsQuery.isError ? (
        <QueryError onRetry={() => realmsQuery.refetch()} />
      ) : realmsQuery.isLoading ? (
        <RealmsSkeleton />
      ) : realms.length === 0 ? (
        <EmptyState title={t("realms.title")} reason={t("realms.no_realms")} />
      ) : own.length === 0 ? (
        <EmptyState title={t(`realms.civilizations.${civilization}`)} reason={t("realms.table.empty_civ")} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-x-10 gap-y-6 pt-2">
          <section data-testid="realm-topology">
            <RouteTopology
              mode="map"
              title={t("realms.topology.map_title")}
              topology={buildTopology(civilization, realms)}
              occupancy={occupancyQuery.isError ? undefined : occupancy}
            />
          </section>
          <section className="min-w-0">
            <RealmTreeTable
              rows={treeRows(own)}
              occupancy={occupancy}
              occupancyFailed={occupancyQuery.isError}
              canManage={canManage}
            />
            <p className="text-2xs text-[oklch(var(--color-ink-subtle))] mt-3">
              {canManage ? t("realms.table.edit_scope") : t("realms.table.read_only")}
            </p>
          </section>
        </div>
      )}
    </PageShell>
  );
}

/** Blank = null (未记录); otherwise a non-negative whole number, or `undefined` = not valid. */
function parseCapacity(draft: string): number | null | undefined {
  const s = draft.trim();
  if (s === "") return null;
  return /^\d+$/.test(s) ? Number(s) : undefined;
}

function RealmTreeTable({
  rows,
  occupancy,
  occupancyFailed,
  canManage = false,
}: {
  rows: TreeRow[];
  occupancy: ReadonlyMap<string, number>;
  occupancyFailed: boolean;
  canManage?: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<RealmCapacityResult | null>(null);
  const save = useMutation({
    mutationFn: ({ id, capacity }: { id: string; capacity: number | null }) =>
      realmsApi.setCapacity(id, capacity).then((r) => r.data),
    onSuccess: (result) => {
      setSaved(result);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["realms"] });
    },
  });
  const th = "font-mono text-2xs font-normal text-[oklch(var(--color-ink-subtle))] pb-1 text-left";
  return (
    <>
    <table className="w-full border-collapse" data-testid="realm-tree">
      <caption className="sr-only">{t("realms.title")}</caption>
      <thead>
        <tr className="border-b border-[oklch(var(--color-block))]">
          <th scope="col" className={th}>{t("realms.table.col_name")}</th>
          <th scope="col" className={`${th} max-md:hidden`}>{t("realms.table.col_code")}</th>
          <th scope="col" className={th}>{t("realms.table.col_kind")}</th>
          <th scope="col" className={`${th} !text-right`}>{t("realms.table.col_held")}</th>
          <th scope="col" className={`${th} !text-right`}>{t("realms.table.col_eternal")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ realm, depth }) => {
          const held = occupancy.get(realm.id) ?? 0;
          const cap = realm.capacity ?? null;
          const full = cap !== null && held >= cap;
          const type = REALM_TYPE_CONFIG[realm.realm_type] || REALM_TYPE_CONFIG.NEUTRAL;
          const name = realmStationLabel(t, { id: realm.id, code: realm.realm_code, realm, state: "pending" });
          return (
            <tr key={realm.id} data-realm-row={realm.realm_code} data-depth={depth} data-full={full ? "true" : undefined} className="border-b border-[oklch(var(--color-rule))] h-8">
              <td
                className={`text-sm pr-3 ${depth ? "text-[oklch(var(--color-ink-muted))]" : "font-medium text-[oklch(var(--color-ink))]"}`}
                style={{ paddingLeft: depth * 14 }}
              >
                {depth > 0 && <span aria-hidden="true">└ </span>}
                {name ?? realm.realm_code}
              </td>
              <td className="font-mono text-xs pr-3 max-md:hidden">{realm.realm_code}</td>
              <td className="text-sm pr-3 text-[oklch(var(--color-ink-muted))]">
                {realm.kind ? (
                  t(`realms.kind.${realm.kind}`)
                ) : (
                  <Badge glyph={type.icon} className={type.className}>
                    <DomainEnum namespace="realms.types" value={realm.realm_type} />
                  </Badge>
                )}
              </td>
              <td
                data-testid="realm-held"
                className={`font-mono text-xs text-right whitespace-nowrap ${
                  full
                    ? "text-[oklch(var(--color-warning))] font-semibold"
                    : held
                      ? "text-[oklch(var(--color-ink))]"
                      : "text-[oklch(var(--color-ink-subtle))]"
                }`}
              >
                {editing === realm.id ? (
                  <CapacityEditor
                    held={held}
                    draft={draft}
                    onDraft={setDraft}
                    pending={save.isPending}
                    failed={save.isError}
                    onCancel={() => setEditing(null)}
                    onSave={(capacity) => save.mutate({ id: realm.id, capacity })}
                  />
                ) : occupancyFailed ? (
                  <MissingValue kind="unrecorded" reason={t("realms.table.occupancy_failed")} />
                ) : (
                  <>
                    {held}
                    {cap !== null ? ` / ${cap}` : <span className="sr-only"> · {t("realms.table.capacity_unrecorded")}</span>}
                    {full && <span className="ml-1 font-sans">{t("realms.table.full")}</span>}
                  </>
                )}
                {canManage && editing !== realm.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(realm.id);
                      setDraft(cap === null ? "" : String(cap));
                      setSaved(null);
                      save.reset();
                    }}
                    aria-label={t("realms.table.edit_capacity_of", { name: name ?? realm.realm_code })}
                    className="ml-2 font-sans underline text-[oklch(var(--color-accent-ink))]"
                  >
                    {t("realms.table.edit_capacity")}
                  </button>
                )}
              </td>
              <td className="text-right text-xs text-[oklch(var(--color-ink-subtle))]">
                {realm.is_eternal ? t("realms.table.eternal_yes") : t("realms.table.eternal_no")}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {saved && (
      <p data-testid="capacity-saved" role="status" className="text-xs pt-2 text-[oklch(var(--color-ink-muted))]">
        {saved.is_full
          ? t("realms.table.saved_full", {
              code: saved.realm_code,
              held: String(saved.held),
              cap: String(saved.capacity ?? ""),
            })
          : t("realms.table.saved", { code: saved.realm_code })}
      </p>
    )}
    </>
  );
}

/** 行内容量编辑:数字框 + 保存 / 取消。填的数 ≤ 在押时就提示「已满」及其后果。 */
function CapacityEditor({
  held,
  draft,
  onDraft,
  pending,
  failed,
  onCancel,
  onSave,
}: {
  held: number;
  draft: string;
  onDraft: (v: string) => void;
  pending: boolean;
  failed: boolean;
  onCancel: () => void;
  onSave: (capacity: number | null) => void;
}) {
  const { t } = useI18n();
  const value = parseCapacity(draft);
  const fullAfter = typeof value === "number" && held >= value;
  return (
    <span className="inline-flex flex-col items-end gap-1 font-sans" data-testid="capacity-editor">
      <span className="inline-flex items-center gap-1">
        <span className="font-mono">{held} /</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          aria-label={t("realms.table.capacity_label")}
          placeholder={t("realms.table.capacity_unrecorded")}
          className="w-20 h-7 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-1 text-right font-mono"
        />
        <Button type="button" size="sm" variant="primary" disabled={value === undefined || pending} onClick={() => value !== undefined && onSave(value)}>
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </span>
      {fullAfter && (
        <span data-testid="capacity-full-warning" className="text-[oklch(var(--color-warning))] font-semibold whitespace-normal">
          {t("realms.table.full_warning", { held: String(held) })}
        </span>
      )}
      {failed && <span role="alert" className="text-[oklch(var(--color-danger))]">{t("realms.table.save_failed")}</span>}
    </span>
  );
}

/** 拓扑与树表同时出骨架;文明切换先渲染(它在 filters 槽里,不等数据)。 */
function RealmsSkeleton() {
  return (
    <div aria-busy="true" data-testid="realms-skeleton" className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-10 pt-2">
      <div className="space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-3/4" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}

/* 页级门。**后端才是正解,这里是纵深** —— `apps/realms/views.py` 已经挂了
   `CodenamePermission`,这道门挡不住任何直接打接口的人;它挡的是侧边栏的菜单过滤
   **只藏链接、不挡路由**。`fallback={<PermissionDenied />}` 而不是空白:没有权限的人
   应当看到「你没有这个权限」,而不是一个看起来加载失败的页面。 */
export default function RealmsPage() {
  return (
    <RequirePermission permissions="realms.read" fallback={<PermissionDenied />}>
      <RealmsPageContent />
    </RequirePermission>
  );
}
