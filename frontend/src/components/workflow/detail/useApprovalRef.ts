"use client";

import { useQuery } from "@tanstack/react-query";
import { soulAccountsApi } from "@soulledger/core/api";
import { soulAccountKeys } from "@soulledger/core/query_keys";
import type { ApprovalRef } from "./AddCosignerDialog";

/**
 * The to-do item this workflow is (`/officer-app/` kinds): a plain approval is named by the workflow's id; a
 * rebirth application's flow (its first review or its appeal) by the application's id, which the workflow does not
 * carry -- it is found among the soul's applications. null until known, or when it is not one.
 */
export function useApprovalRef(
  workflow: { id: string; case_type: string; soul?: string | null } | undefined,
  enabled: boolean
): ApprovalRef | null {
  const rebirth = workflow?.case_type === "REBIRTH_APPLICATION";
  const soul = workflow?.soul ?? "";
  const apps = useQuery({
    queryKey: soulAccountKeys.rebirthApplications({ soul }),
    queryFn: async () => (await soulAccountsApi.rebirthApplications({ soul })).data,
    enabled: enabled && rebirth && !!soul,
    staleTime: 60_000,
  });
  if (!workflow) return null;
  if (!rebirth) return { kind: "approval", id: workflow.id };
  const app = apps.data?.results.find((a) => a.workflow === workflow.id || a.appeal_workflow === workflow.id);
  return app ? { kind: "rebirth", id: String(app.id) } : null;
}
