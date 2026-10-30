"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { permApi, usersApi, type Role, type RoleMembersChange, type RoleMembersRefused, type User } from "@soulledger/core/api";
import { permKeys, userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { Pagination } from "@/src/components/ui/Pagination";
import { Segmented } from "@/src/components/ui/Segmented";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { responseCode, responseData, responseStatus } from "@soulledger/core/api/client";

const PAGE_SIZE = 20;

function refusedOf(error: unknown): RoleMembersRefused | null {
  const status = responseStatus(error);
  const data = responseData<RoleMembersRefused>(error);
  return (status === 400 || status === 403) && responseCode(error) === "refused" && Array.isArray(data?.refusals)
    ? (data as RoleMembersRefused)
    : null;
}

const holds = (u: User, role: string) => u.role === role || (u.extra_roles ?? []).includes(role);
// 没绑殿的账号(全局管理员)归在「未归殿」下,与机构选择器同一个词。
const tenantName = (u: { tenant?: { code?: string; display_name?: string } | null }, none: string) =>
  u.tenant?.display_name || u.tenant?.code || none;

/**
 * 角色抽屉的「成员」页签(rbac-snowy 2026-10-29,决定第 6 条):谁持有这个角色(主角色在前,兼任另标),
 * 以及从角色这一侧一次授一批人(选人按殿分组)、移除兼任。服务端与「设置角色」是同一套规则;
 * 绑殿的管理员只看得到、改得了本殿的人。主角色不能在这里移除 —— 先给那个人授别的主角色。
 */
export function RoleMembersSection({ role }: { role: Role }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [granting, setGranting] = useState(false);
  const [refused, setRefused] = useState<RoleMembersRefused | null>(null);

  const members = useQuery({
    queryKey: [...permKeys.roles, "members", role.id, search, page],
    queryFn: async () => (await permApi.roles.members(role.id, { search: search || undefined, page })).data,
  });

  const change = useMutation({
    mutationFn: (body: RoleMembersChange) => permApi.roles.changeMembers(role.id, body),
    onSuccess: (res, body) => {
      setRefused(null);
      queryClient.invalidateQueries({ queryKey: permKeys.roles });
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(
        t(body.action === "add" ? "permissions.members.granted" : "permissions.members.removed", { n: String(res.data.changed) }),
        "success"
      );
      if (body.action === "add") setGranting(false);
    },
    onError: (error) => {
      const r = refusedOf(error);
      if (r) setRefused(r);
      else showToast(t("permissions.members.change_error"), "error");
    },
  });

  const rows = members.data?.results ?? [];
  const count = members.data?.count ?? 0;

  return (
    <div className="space-y-3" data-role-members={role.name}>
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label={t("permissions.members.search")}
          placeholder={t("permissions.members.search")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={cn(fieldControl({ size: "md" }), "min-w-0 flex-1")}
        />
        <Button type="button" variant="secondary" size="sm" onClick={() => setGranting((v) => !v)} aria-expanded={granting}>
          {t("permissions.members.grant")}
        </Button>
      </div>

      {refused && (
        <div role="alert" className="border-l-2 border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] px-3 py-2 text-sm">
          <p className="text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">! </span>
            {t("permissions.members.refused_title")}
          </p>
          <ul className="mt-1 space-y-0.5">
            {refused.refusals.map((r) => (
              <li key={r.user_id}>
                {r.username || `#${r.user_id}`} · {t(`permissions.members.refused.${r.code}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {granting && (
        <GrantPicker
          role={role}
          pending={change.isPending}
          onSubmit={(ids, kind) => change.mutate({ action: "add", kind, user_ids: ids })}
          onCancel={() => setGranting(false)}
        />
      )}

      {members.isError ? (
        <p className="text-sm text-[oklch(var(--color-danger))]">{t("permissions.members.load_error")}</p>
      ) : !members.isLoading && rows.length === 0 ? (
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("permissions.members.empty")}</p>
      ) : (
        <ul aria-label={t("permissions.members.list")} className="divide-y divide-[oklch(var(--color-rule))] border-y border-[oklch(var(--color-rule))]">
          {rows.map((u) => {
            const primary = u.role === role.name;
            return (
              <li key={u.id} data-member={u.username} className="flex min-h-11 items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-[oklch(var(--color-ink))]">{u.username}</span>
                  <span className="block font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                    {[tenantName(u, t("org_select.no_tenant")), u.organization?.name].filter(Boolean).join(" · ")}
                    {!u.is_active && ` · ${t("users.inactive")}`}
                  </span>
                </span>
                <Badge tone="neutral">{t(primary ? "permissions.members.primary" : "permissions.members.extra")}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={primary || change.isPending}
                  title={primary ? t("permissions.members.primary_locked") : undefined}
                  aria-label={t("permissions.members.remove_label", { name: u.username })}
                  onClick={() => change.mutate({ action: "remove", kind: "extra", user_ids: [u.id] })}
                >
                  {t("permissions.members.remove")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {count > PAGE_SIZE && (
        <Pagination page={page} totalPages={Math.ceil(count / PAGE_SIZE)} count={count} onPageChange={setPage} />
      )}
    </div>
  );
}

/** 选人:按用户名搜(服务端用户列表,已按殿收窄),结果按殿分组勾选;已持有的人不可勾。 */
function GrantPicker({
  role,
  pending,
  onSubmit,
  onCancel,
}: {
  role: Role;
  pending: boolean;
  onSubmit: (ids: number[], kind: "primary" | "extra") => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"primary" | "extra">("extra");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const candidates = useQuery({
    queryKey: [...userKeys.all, "role-grant-picker", q],
    queryFn: async () => (await usersApi.list({ search: q || undefined, ordering: "username" })).data.results,
  });
  const groups = new Map<string, User[]>();
  for (const u of candidates.data ?? []) {
    const key = tenantName(u, t("org_select.no_tenant"));
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const toggle = (id: number, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <form
      aria-label={t("permissions.members.grant")}
      className="space-y-2 border border-[oklch(var(--color-line))] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked.size) onSubmit([...picked], kind);
      }}
    >
      <input
        type="search"
        aria-label={t("permissions.members.pick_search")}
        placeholder={t("permissions.members.pick_search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={cn(fieldControl({ size: "md" }), "w-full")}
      />
      <div className="max-h-56 overflow-y-auto border border-[oklch(var(--color-line))]">
        {candidates.data?.length === 0 && (
          <p className="px-3 py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("permissions.members.pick_empty")}</p>
        )}
        {[...groups].map(([tenant, users]) => (
          <div key={tenant} role="group" aria-label={tenant}>
            <div aria-hidden="true" className="bg-[oklch(var(--color-surface-2))] px-3 py-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
              {tenant}
            </div>
            {users.map((u) => {
              const already = holds(u, role.name);
              return (
                <label key={u.id} className="flex min-h-11 items-center gap-2 px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={already || picked.has(u.id)}
                    disabled={already}
                    onChange={(e) => toggle(u.id, e.target.checked)}
                  />
                  {u.username}
                  {already && <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("permissions.members.already")}</span>}
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <Segmented
        label={t("permissions.members.kind")}
        value={kind}
        options={[
          { value: "extra", label: t("permissions.members.extra") },
          { value: "primary", label: t("permissions.members.primary") },
        ]}
        onChange={(v) => setKind(v as "primary" | "extra")}
      />
      {kind === "primary" && <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("permissions.members.primary_hint")}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={picked.size === 0}>
          {t("permissions.members.grant_n", { n: String(picked.size) })}
        </Button>
      </div>
    </form>
  );
}
