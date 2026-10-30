"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  captureWarrantsApi,
  cityGodKeys,
  type CaptureEscort,
  type CaptureWarrant,
  type Soul,
} from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField } from "@/src/components/ui/Field";
import { responseCode } from "@soulledger/core/api/client";

const CAPTURE_CODES = ["not_diyu", "not_alive", "lifespan_not_ended", "warrant_open", "wrong_status", "reason_required"];
const ESCORTS: CaptureEscort[] = ["WUCHANG", "NIUTOU_MAMIAN"];
const LIVE = new Set<CaptureWarrant["status"]>(["ISSUED", "CAPTURED"]);

/** 阳寿(完整的公元日期)已到:≤ 今天(本地日期)。与后端 `capture.lifespan_ended_q` 同一条。 */
function lifespanEnded(soul: Soul): boolean {
  const f = soul.fated_death_date;
  if (!f || !f.month || !f.day || f.year < 1) return false;
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  const fated = [f.year, f.month, f.day];
  for (let i = 0; i < 3; i++) if (fated[i] !== today[i]) return fated[i] < today[i];
  return true;
}

/** 阳寿已知(完整的公元日期)且还没到。不知道阳寿的不算「未到」。「记录身故」据此在地府隐藏(用户 2026-10-29)。 */
export function lifespanNotYet(soul: Soul): boolean {
  const f = soul.fated_death_date;
  return !!f && !!f.month && !!f.day && f.year >= 1 && !lifespanEnded(soul);
}

const pad = (n: number) => String(n).padStart(2, "0");
const fatedText = (soul: Soul) => {
  const f = soul.fated_death_date;
  return f && f.month && f.day ? `${f.year}-${pad(f.month)}-${pad(f.day)}` : "";
};

const DAY = 86_400_000;

/** 阳寿过了几天(按本地日期);没过或日期认不出为 0。 */
export function daysOverdue(fated: string, now = new Date()): number {
  const [y, m, d] = fated.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const due = new Date(0);
  due.setFullYear(y, m - 1, d);
  due.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / DAY));
}

function useCaptureFeedback(soulName: string) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  return {
    onError: (err: unknown) => {
      const code = responseCode(err);
      // 发牒或交接时本殿没有能收案的城隍(409 `no_city_god`,2026-10-29;发牒那一处同日补上):说清要先设兜底城隍。
      if (code === "no_city_god") return showToast(t("judgment.error.no_city_god"), "error");
      showToast(code && CAPTURE_CODES.includes(code) ? t(`souls.capture.error.${code}`) : t("common.error"), "error");
    },
    done: (key: string) => () => {
      void queryClient.invalidateQueries({ queryKey: soulKeys.all });
      void queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
      // 交接城隍开出的案子落在城隍初审的列表里(另一个键族)。
      void queryClient.invalidateQueries({ queryKey: cityGodKeys.all });
      showToast(t(key, { name: soulName }), "success");
    },
  };
}

/** 三步小进度「发勾魂牒 → 拘到 → 交接城隍」,字形同站梯:已过 ■ · 当前 ▪ · 未到 □。`at` = 当前是第几步(0-2),3 = 走完。 */
function CaptureSteps({ at }: { at: number }) {
  const { t } = useI18n();
  const steps = [t("souls.capture.issue"), t("souls.capture.capture"), t("souls.capture.hand_over_city_god")];
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="capture-steps">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2" data-state={i < at ? "passed" : i === at ? "current" : "ahead"}>
          {i > 0 && <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">→</span>}
          <span className={i === at ? "font-semibold text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-muted))]"}>
            <span aria-hidden="true">{i < at ? "■" : i === at ? "▪" : "□"}</span> {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 发牒那一步(S-4 第一态;待发勾魂牒页的抽屉里也是它,S-7)。鬼差下拉默认选「按功过建议」的那一位
 * (`suggested` 是后端 `capture.suggested_escort` 的结果,`due/` 一行带着它),并写出建议规则。
 */
export function CaptureIssueStep({
  soul,
  suggested,
  onIssued,
}: {
  soul: { id: string; name: string };
  suggested: CaptureEscort | null;
  onIssued?: () => void;
}) {
  const { t } = useI18n();
  const feedback = useCaptureFeedback(soul.name);
  const [escort, setEscort] = useState<CaptureEscort | "">(suggested ?? "");
  const issue = useMutation({
    mutationFn: () => captureWarrantsApi.issue({ soul: soul.id, ...(escort ? { escort } : {}) }),
    onSuccess: () => {
      feedback.done("souls.capture.issued_toast")();
      onIssued?.();
    },
    onError: feedback.onError,
  });
  const label = (e: CaptureEscort) =>
    `${t(`souls.capture.escort.${e}`)}${e === suggested ? ` · ${t("souls.capture.escort.SUGGESTED")}` : ""}`;
  return (
    <div className="mt-3 space-y-2" data-testid="soul-capture-issue">
      <SelectField
        id={`capture-escort-${soul.id}`}
        label={t("souls.capture.escort_label")}
        size="sm"
        value={escort}
        onChange={(e) => setEscort(e.target.value as CaptureEscort | "")}
        disabled={issue.isPending}
        options={[
          // 没有建议(详情页还没取到 `due/`)时多一项「按功过建议」= 不传,由后端定。
          ...(suggested ? [] : [{ value: "", label: t("souls.capture.escort.SUGGESTED") }]),
          ...ESCORTS.map((e) => ({ value: e, label: label(e) })),
        ]}
      />
      <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]" data-testid="capture-escort-hint">
        {t("souls.capture.escort_hint", {
          merit_escort: t("souls.capture.escort.WUCHANG"),
          demerit_escort: t("souls.capture.escort.NIUTOU_MAMIAN"),
        })}
      </p>
      <Button size="sm" variant="primary" disabled={issue.isPending} onClick={() => issue.mutate()}>
        {t("souls.capture.issue")}
      </Button>
    </div>
  );
}

/**
 * 勾魂卡(Design 第五十七批 S-4;只地府):一张卡片,三步小进度。每一状态只有一个主按钮往下一步走;
 * 「撤销…」始终是描边次按钮,点了在卡片里原地展开必填的理由框,不叠弹层。已交接后收成两行,给「去初审 →」。
 * 已撤销:灰字一行「日期 撤销 · 理由」,阳寿已到就可以重新发牒。`canIssue` = 持 `capture.issue`(发牒、撤销),
 * `canExecute` = 持 `capture.execute`(拘到、交接;交接就是登记死亡)—— 2026-10-29 从 `soul.die` 拆出。
 */
export function CapturePanel({ soul, canIssue, canExecute }: { soul: Soul; canIssue: boolean; canExecute: boolean }) {
  const { t, formatDate } = useI18n();
  const warrants = useQuery({
    queryKey: soulKeys.capture(soul.id),
    queryFn: async () => (await captureWarrantsApi.list({ soul: soul.id })).data.results,
  });
  const rows = [...(warrants.data ?? [])].sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  const latest = rows[0];
  const open = latest && LIVE.has(latest.status) ? latest : undefined;
  const mayIssue = canIssue && soul.current_state === "ALIVE" && lifespanEnded(soul) && !open;
  // 建议的鬼差是后端算的(`due/` 的一行);只在要发牒时取,与「待发勾魂牒」页同一份查询。
  const due = useQuery({
    queryKey: soulKeys.captureDue(),
    queryFn: async () => (await captureWarrantsApi.due()).data,
    enabled: mayIssue,
  });
  const suggested = due.data?.results.find((d) => d.id === soul.id)?.suggested_escort ?? null;
  if (!latest && !mayIssue) return null;

  const status = open ? (
    <DomainEnum namespace="souls.capture.status" value={open.status} />
  ) : mayIssue ? (
    t("souls.capture.due_on", { date: fatedText(soul) })
  ) : latest ? (
    <DomainEnum namespace="souls.capture.status" value={latest.status} />
  ) : null;

  return (
    <section data-testid="soul-capture" className="min-w-0 bg-[oklch(var(--color-surface-1))] p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">{t("souls.capture.title")}</h2>
        <span className="text-xs text-[oklch(var(--color-ink-muted))]" data-testid="soul-capture-status">{status}</span>
      </div>
      {open ? (
        <LiveWarrant key={open.id} warrant={open} soulName={soul.name} canIssue={canIssue} canExecute={canExecute} />
      ) : mayIssue ? (
        <>
          <CaptureSteps at={0} />
          {/* key:建议取到后重挂,下拉的默认值跟上。 */}
          <CaptureIssueStep key={suggested ?? "none"} soul={soul} suggested={suggested} />
        </>
      ) : latest?.status === "HANDED_OVER" ? (
        <>
          <CaptureSteps at={3} />
          <p className="mt-2 text-xs text-[oklch(var(--color-ink-muted))]" data-testid="capture-handed">
            {t("souls.capture.handed_line", {
              date: latest.handed_over_at ? formatDate(latest.handed_over_at) : "",
              city_god: latest.city_god_name ?? "",
            })}
            {" · "}
            <Link
              href={latest.city_god ? `/city-god-cases?city_god=${latest.city_god}` : "/city-god-cases"}
              className="underline underline-offset-2 text-[oklch(var(--color-ink))]"
            >
              {t("souls.capture.go_review")}
            </Link>
          </p>
        </>
      ) : null}
      {!open && latest?.status === "CANCELLED" && (
        <p className="mt-2 text-xs text-[oklch(var(--color-ink-subtle))]" data-testid="capture-cancelled">
          {/* 牒上没有撤销时间(只有 issued / captured / handed_over 三个时刻),所以这一行不写日期。 */}
          {t("souls.capture.cancelled_line", { reason: latest.cancel_reason })}
        </p>
      )}
    </section>
  );
}

function LiveWarrant({ warrant, soulName, canIssue, canExecute }: { warrant: CaptureWarrant; soulName: string; canIssue: boolean; canExecute: boolean }) {
  const { t, formatDateTime } = useI18n();
  const feedback = useCaptureFeedback(soulName);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const capture = useMutation({
    mutationFn: () => captureWarrantsApi.capture(warrant.id),
    onSuccess: feedback.done("souls.capture.captured_toast"),
    onError: feedback.onError,
  });
  const handOver = useMutation({
    mutationFn: () => captureWarrantsApi.handOver(warrant.id),
    onSuccess: feedback.done("souls.capture.handed_over_toast"),
    onError: feedback.onError,
  });
  const cancel = useMutation({
    mutationFn: () => captureWarrantsApi.cancel(warrant.id, reason.trim()),
    onSuccess: feedback.done("souls.capture.cancelled_toast"),
    onError: feedback.onError,
  });
  const busy = capture.isPending || handOver.isPending || cancel.isPending;
  const captured = warrant.status === "CAPTURED";
  const meta = [
    t(`souls.capture.escort.${warrant.escort}`),
    warrant.city_god_name ? t("souls.capture.city_god", { name: warrant.city_god_name }) : "",
    captured && warrant.captured_at
      ? `${formatDateTime(warrant.captured_at)} ${t("souls.capture.capture")}`
      : formatDateTime(warrant.issued_at),
  ].filter(Boolean);
  return (
    <div data-testid="capture-warrant" data-status={warrant.status}>
      <CaptureSteps at={captured ? 2 : 1} />
      <p className="mt-2 text-xs text-[oklch(var(--color-ink-muted))]">{meta.join(" · ")}</p>
      {(canIssue || canExecute) && !cancelling && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!canExecute ? null : captured ? (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => handOver.mutate()}>
              {t("souls.capture.hand_over_city_god")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => capture.mutate()}>
              {t("souls.capture.capture")}
            </Button>
          )}
          {canIssue && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setCancelling(true)}>
              {t("souls.capture.cancel_open")}
            </Button>
          )}
        </div>
      )}
      {cancelling && (
        <div className="mt-3 space-y-2" data-testid="capture-cancel-form">
          <TextAreaField
            id={`capture-cancel-${warrant.id}`}
            label={t("souls.capture.cancel_reason")}
            required
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            error={tried && !reason.trim() ? t("souls.capture.revoke_reason_required") : null}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelling(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => {
                setTried(true);
                if (reason.trim()) cancel.mutate();
              }}
            >
              {t("souls.capture.cancel_confirm")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
