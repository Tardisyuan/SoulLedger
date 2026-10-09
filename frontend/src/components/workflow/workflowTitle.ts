/**
 * 转生申请流程的显示标题。库里的 `workflow_name` 是「转生申请: 灵魂码」(检索、审计在用,不动),
 * 屏幕上按语言包写「转生申请 · 灵魂名」(申诉:「转生申请申诉 · 灵魂名」);灵魂名没带(旧缓存)就退回原名。
 * 已有的行不需要迁移:名字取自灵魂,不取自存下来的中文。
 */
export function workflowTitle(
  wf: { workflow_name: string; case_type: string; is_appeal?: boolean; soul_name?: string },
  t: (key: string, vars?: Record<string, string>) => string
): string {
  if (wf.case_type !== "REBIRTH_APPLICATION" || !wf.soul_name) return wf.workflow_name;
  return t(wf.is_appeal ? "soul_accounts.rebirth.appeal_title" : "soul_accounts.rebirth.detail_title", { name: wf.soul_name });
}
