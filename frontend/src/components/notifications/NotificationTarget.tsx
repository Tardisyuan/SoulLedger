"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type Notification } from "@soulledger/core/api";
import { sentencePlansApi } from "@soulledger/core/api/sentence-plans";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * 一条通知点进哪一页 —— 全站只在这里决定(审计 1017 #5)。此前通知页只给改派请求和调度两类配了按钮,
 * 被派了审批、被邀请入席联审的官员只能自己去列表里找。
 *
 * 键是后端写进 `Notification.related_resource` 的值。后端每发出一个新值,
 * `notificationTarget.test.ts` 会去 `backend/apps` 里 grep `related_resource=`,要求它要么在
 * `NAVIGABLE` 里、要么在 `NOT_NAVIGABLE` 里写明为什么不跳 —— 不会再悄悄多出一类点不动的通知。
 */
export type NotificationTarget =
  | { kind: "href"; href: string; label: string }
  /** 通知只带计划 id;灵魂详情要灵魂 id,点的时候再取计划(`GET /sentence-plans/{id}/`)。 */
  | { kind: "sentence_plan"; planId: string; label: string };

type NotificationRef = Pick<Notification, "related_resource" | "related_id" | "notification_type">;

/** related_resource → 目标。拿到 `null` 表示这条通知没有可去的页(缺 id、或类型不对)。 */
export const NAVIGABLE: Record<string, (n: NotificationRef, id: string) => NotificationTarget | null> = {
  workflow: (_n, id) => (id ? { kind: "href", href: `/workflow/${id}`, label: "notifications.open_workflow" } : null),
  // 城隍收案 / 退回补正(第五十三批):落到初审队列并打开那件案子的抽屉(`?case=`)。
  judgment: (n, id) =>
    id
      ? n.notification_type?.startsWith("CITY_GOD_CASE_")
        ? { kind: "href", href: `/city-god-cases?case=${encodeURIComponent(id)}`, label: "notifications.open_case" }
        : { kind: "href", href: `/judgment/${id}`, label: "notifications.open_case" }
      : null,
  // 只认调度类通知:同一个资源名将来若挂到别的通知上,不该被当成「打开移交」。
  DispatchRecord: (n, id) =>
    id && n.notification_type?.startsWith("DISPATCH_")
      ? { kind: "href", href: `/dispatch/${id}`, label: "notifications.open_dispatch" }
      : null,
  CrossTenantJudgment: (_n, id) =>
    id ? { kind: "href", href: `/cross-judgments/${id}`, label: "notifications.open_cross_judgment" } : null,
  // 待决的变更请求要去「受刑请求」那一页决定;其余(节点开始 / 完成 / 被拒、计划修订…)去灵魂详情的受刑计划卡。
  SentencePlan: (n, id) =>
    n.notification_type === "SENTENCE_REQUEST_PENDING"
      ? { kind: "href", href: "/sentence-requests", label: "notifications.open_sentence_requests" }
      : id
        ? { kind: "sentence_plan", planId: id, label: "notifications.open_sentence_plan" }
        : null,
  soul: (_n, id) => (id ? { kind: "href", href: `/souls/${id}`, label: "notifications.open_soul" } : null),
  // 收件箱没有逐封的路由:`?c=` 让 /soul-inbox 一进来就打开这一封。
  soul_inbox: (_n, id) =>
    id ? { kind: "href", href: `/soul-inbox?c=${encodeURIComponent(id)}`, label: "notifications.open_letter" } : null,
  death_sync: () => ({ kind: "href", href: "/death-sync", label: "notifications.open_death_sync" }),
  scheduler: () => ({ kind: "href", href: "/scheduler", label: "notifications.open_scheduler" }),
  assistant_config: () => ({ kind: "href", href: "/admin/assistant", label: "notifications.open_assistant" }),
  // 转生申请的审批流程(`WorkflowService.notice_target`)把通知挂在申请上,收件人是审批官员;灵魂那一份(`rebirth.py`)不上 Web。
  // 2026-10-23 前它在 NOT_NAVIGABLE 里,理由「只发给灵魂」—— 官员在 Web 上收到审批通知却没有按钮。
  rebirth_application: () => ({ kind: "href", href: "/rebirth-applications", label: "notifications.open_workflow" }),
};

/** 后端会发、但 Web 上故意不给按钮的,各写一句为什么。 */
export const NOT_NAVIGABLE: Record<string, string> = {
  // 重设密码求助有自己的「去用户页」(看 `request_context`,只给能管用户的人);代登录通知的 id 是代登录的人,不是可去的页。
  user: "password help has its own request_context row; impersonation points at the actor",
  // 只发给灵魂本人的账号(`apps/soul_accounts/`),灵魂不用 Web。`notificationTarget.test` 核对它真的只从那里发。
  cooldown_shortening: "sent to the soul's own account only; souls do not use the Web",
};

export function notificationTarget(n: NotificationRef): NotificationTarget | null {
  const resolve = n.related_resource ? NAVIGABLE[n.related_resource] : undefined;
  return resolve ? resolve(n, n.related_id ?? "") : null;
}

const LINK_CLASS = cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-2 mr-2");

/** 通知行上的「打开 …」。没有目标就什么都不画。 */
export function NotificationTargetLink({ notification }: { notification: NotificationRef }) {
  const { t } = useI18n();
  const target = notificationTarget(notification);
  if (!target) return null;
  if (target.kind === "sentence_plan") return <SentencePlanLink planId={target.planId} label={t(target.label)} />;
  return (
    <Link href={target.href} className={LINK_CLASS}>
      {t(target.label)}
    </Link>
  );
}

function SentencePlanLink({ planId, label }: { planId: string; label: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const { data } = await sentencePlansApi.get(planId);
      router.push(`/souls/${data.soul}`);
    } catch {
      // 计划已不可读(404:别的租户、或已删):说打不开,不跳到一个空页。
      showToast(t("notifications.open_failed"), "error");
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="secondary" size="sm" className="mt-2 mr-2" loading={busy} onClick={() => void open()}>
      {label}
    </Button>
  );
}
