"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { permApi } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";

const ROLES = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"];

export default function PermissionsPage() {
  const { t } = useI18n();
  const [selectedRole, setSelectedRole] = useState("ADMIN");

  const { data: rolePerms, isLoading: loadingRole } = useQuery({
    queryKey: ["role-permissions", selectedRole],
    queryFn: async () => {
      const res = await permApi.rolePermissions(selectedRole);
      return res.data as { role: string; permissions: string[] };
    },
  });

  const { data: allPerms, isLoading: loadingAll } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const res = await permApi.list();
      return res.data as Array<{ id: number; codename: string; name: string; category: string }>;
    },
  });

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-hairline/50">
        <Link href="/" className="text-ink-muted hover:text-ink text-sm">← {t("nav.home")}</Link>
        <h1 className="text-lg font-bold text-amber-400 flex-1">{t("permissions.title")}</h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Role selector */}
        <div className="mb-6">
          <label className="block text-sm text-ink-muted mb-2">{t("permissions.select_role")}</label>
          <div className="flex gap-2">
            {ROLES.map((role) => (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  selectedRole === role
                    ? "bg-amber-500 text-black"
                    : "bg-surface-2 text-ink-muted border border-hairline hover:border-amber-500"
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        </div>

        {/* Role permissions */}
        <div className="mb-8">
          <h2 className="text-md font-semibold text-ink mb-3">
            {t("permissions.role_perms", { role: selectedRole })}
          </h2>
          {loadingRole ? (
            <div className="text-center text-ink-muted py-8">{t("souls.loading")}</div>
          ) : rolePerms ? (
            <div className="bg-surface-1 rounded-lg border border-hairline p-4">
              {rolePerms.permissions.length === 0 ? (
                <p className="text-ink-muted">{t("permissions.no_perms")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {rolePerms.permissions.map((perm) => (
                    <span key={perm} className="px-2 py-1 bg-amber-500/20 text-amber-400 rounded text-sm font-mono">
                      {perm}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* All permissions */}
        <div>
          <h2 className="text-md font-semibold text-ink mb-3">{t("permissions.all_permissions")}</h2>
          {loadingAll ? (
            <div className="text-center text-ink-muted py-8">{t("souls.loading")}</div>
          ) : allPerms ? (
            <div className="bg-surface-1 rounded-lg border border-hairline overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-ink-muted">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">{t("permissions.codename")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("permissions.name")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("permissions.category")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {allPerms.map((perm) => (
                    <tr key={perm.id} className="hover:bg-surface-2/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-amber-400 text-xs">{perm.codename}</td>
                      <td className="px-4 py-3 text-ink">{perm.name}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-surface-2 text-ink-muted rounded text-xs">
                          {perm.category}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
