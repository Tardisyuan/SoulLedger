"use client";

import { DomainEnum } from "@/src/components/ui/DomainValue";

/** 操作人:显示名(没有就用户名)· 本地化角色。角色走 users.roles,原始成员留在 title。 */
export function ActorCell({ actor, displayName, role }: { actor: string; displayName?: string; role?: string }) {
  // 旧事件只存 `User.__str__` 的 `username (ROLE)`;接口给了显示名与角色就用接口的。
  const m = /^(.+) \(([A-Z_]+)\)$/.exec(actor);
  const r = role || m?.[2];
  const name = displayName || (m ? m[1] : actor);
  if (!r) return <>{name}</>;
  return (
    <>
      {name} · <DomainEnum namespace="users.roles" value={r} />
    </>
  );
}
