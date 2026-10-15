"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PAGE_SIZE, type CredentialSlip, type InitialCredential } from "@soulledger/core/api";
import { soulAccountKeys } from "@soulledger/core/query_keys";
import {
  classifySoulAccountError,
  useMarkCredentialDelivered,
  usePrintCredentialSlip,
  useRetryCredential,
  useSoulCredentials,
} from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { RevealCredentialDialog } from "@/src/components/soul-accounts/RevealCredentialDialog";
import { DeliverySlip } from "@/src/components/soul-accounts/DeliverySlip";
import { loadSlipBundles, type SlipBundles } from "@/src/components/soul-accounts/slipTexts";
import { SoulCode } from "@/src/components/soul-accounts/SoulCode";
import { EmailNotSyncedNote } from "@/src/components/soul-accounts/EmailNotSyncedNote";
import {
  CREDENTIAL_FILTERS,
  credentialTone,
  credentialReason,
  failureKey,
  isExpired,
  lifeNumber,
} from "@/src/components/soul-accounts/soulAccountsView";

// 操作列定宽,不是 `auto`:表头那一格是空的,`auto` 在表头里解成 0、在数据行里解成
// 按钮宽,两边的 fr 列于是按不同的余量分配,表头与数据错开(2026-09-25 截图里实测)。
/** 打印机图标(第二十批画稿 CredentialDesk 的那一条 path)。 */
const PrinterIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="mr-1 inline">
    <path d="M5.75 7.25v-4.5h8.5v4.5M5.75 13.75h-3v-6.5h14.5v6.5h-3M5.75 11.25h8.5v6h-8.5z" />
  </svg>
);

// 存的是「彩色」的旧键,语义不变:"0" = 黑白。开关现在叫「黑白打印」,勾上 = 黑白。
const SLIP_COLOR_STORAGE = "soulledger.slip.color";

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.6fr)_minmax(0,2fr)_minmax(0,1.3fr)_10rem] md:items-center md:gap-4";


function CredentialsPageContent() {
  const { t, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("soul_account.manage");

  // 状态签**不**记在浏览器里(2026-10-15):这一页是待交付的工作清单,每次都从「待交付」开始,
  // 记住别的状态会让官员下次进来看不到待交付的那几份而漏交。与审判页的「待审」同理。
  const [status, setStatus] = useState<string>("PENDING");
  const [page, setPage] = useState(1);
  const [revealing, setRevealing] = useState<InitialCredential | null>(null);
  // 只在调起打印的那一刻挂着;交付单不是页面的一部分,屏幕上也看不到它。
  const [slip, setSlip] = useState<{ data: CredentialSlip; texts: SlipBundles; reprint: boolean } | null>(null);
  // 从点打印到交付单卸载:期间所有打印按钮不可点,每一次有审计的打印才都真的印出来(mutate 的回调只认最后一次)。
  const [printing, setPrinting] = useState(false);
  // 黑白打印:默认不勾(= 彩色,用户 2026-10-11),记在这台电脑上;读不到存储(隐私窗口、被禁用)按默认。
  const [mono, setMono] = useState(false);
  useEffect(() => {
    try {
      setMono(localStorage.getItem(SLIP_COLOR_STORAGE) === "0");
    } catch {
      /* 按默认:彩色 */
    }
  }, []);
  const changeMono = (on: boolean) => {
    setMono(on);
    try {
      localStorage.setItem(SLIP_COLOR_STORAGE, on ? "0" : "1");
    } catch {
      /* 本次有效,下次回到默认 */
    }
  };

  const list = useSoulCredentials({ status: status || undefined, page });
  const retry = useRetryCredential();
  const deliver = useMarkCredentialDelivered();
  const printSlip = usePrintCredentialSlip();

  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const doRetry = (c: InitialCredential) =>
    retry.mutate(c.id, {
      onSuccess: (row) => {
        if (row.status === "SENT") showToast(t("soul_accounts.credentials.retry_sent"), "success");
        else showToast(t(credentialReason(row).key, credentialReason(row).params), "info");
      },
      onError: (error) =>
        showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.credentials.retry_failed")), "error"),
    });

  const doDeliver = (c: InitialCredential) =>
    deliver.mutate(c.id, {
      onSuccess: () => showToast(t("soul_accounts.credentials.delivered_ok"), "success"),
      onError: (error) =>
        showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.credentials.deliver_failed")), "error"),
    });

  // 先让服务端写审计并给出内容;失败就不打印。成功后先把三种语言的词条加载好(交付单上联按文明印文字,不跟界面语言),
  // 再同步挂载交付单并调起浏览器打印(window.print 在多数浏览器里阻塞到对话框关闭),随后卸载。打印不改行的状态,不刷新列表。
  const doPrint = (c: InitialCredential) => {
    if (printing) return;
    setPrinting(true);
    printSlip.mutate(c.id, {
      onSuccess: async (data) => {
        try {
          const texts = await loadSlipBundles();
          flushSync(() => setSlip({ data, texts, reprint: c.status === "DELIVERED" }));
        } catch {
          showToast(t("soul_accounts.credentials.print_failed"), "error");
          setPrinting(false);
          return;
        }
        // 不阻塞的浏览器里 print() 立刻返回,马上卸载会印出空页:等 afterprint 再卸;
        // 个别浏览器不发这个事件,60 秒后兜底卸载,免得下一次 Ctrl+P 印出交付单。
        const done = () => {
          window.removeEventListener("afterprint", done);
          clearTimeout(fallback);
          setSlip(null);
          setPrinting(false);
        };
        const fallback = setTimeout(done, 60_000);
        window.addEventListener("afterprint", done);
        window.print();
      },
      onError: (error) => {
        setPrinting(false);
        const key = failureKey(classifySoulAccountError(error), "");
        const detail = (error as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
        showToast(
          key ? t(key) : detail?.status === 409 && typeof detail.data?.detail === "string" ? detail.data.detail : t("soul_accounts.credentials.print_failed"),
          "error",
        );
      },
    });
  };

  const printButton = (c: InitialCredential, label: string, muted = false) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={muted ? "text-[oklch(var(--color-ink-muted))]" : undefined}
      loading={printSlip.isPending && printSlip.variables === c.id}
      disabled={printing}
      onClick={() => doPrint(c)}
    >
      <PrinterIcon />
      {label}
    </Button>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      {canManage && (
        <label className="inline-flex items-center gap-2 text-sm" title={t("soul_accounts.credentials.print_mono_hint")}>
          <input type="checkbox" checked={mono} onChange={(e) => changeMono(e.target.checked)} />
          {t("soul_accounts.credentials.print_mono")}
        </label>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => void queryClient.invalidateQueries({ queryKey: soulAccountKeys.all })}
        aria-busy={list.isFetching}
      >
        <RefreshCw aria-hidden="true" className={`w-4 h-4 mr-1 inline ${list.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
        {t("soul_accounts.refresh")}
      </Button>
    </div>
  );

  const filters = (
    <div role="group" aria-label={t("soul_accounts.credentials.filters.label")} className="flex flex-wrap gap-2">
      {CREDENTIAL_FILTERS.map((value) => (
        /* 筛选签(规范 v1 §2),仍是 aria-pressed 的单选:再按一下已按下的签不改变筛选 ——
           「全部」本身就是其中一枚签,不是「什么都不按」。 */
        <FilterChipToggle
          key={value || "all"}
          pressed={status === value}
          onPressedChange={() => {
            setStatus(value);
            setPage(1);
          }}
        >
          {t(`soul_accounts.credentials.filters.${value || "all"}`)}
        </FilterChipToggle>
      ))}
    </div>
  );

  // Failed / nothing pending at all / nothing under this filter: three states, three looks.
  const failed = list.isError && !list.data;
  const empty = failed ? (
    <QueryError onRetry={() => list.refetch()} />
  ) : status === "PENDING" ? (
    <EmptyState title={t("soul_accounts.credentials.empty.pending")} reason={t("soul_accounts.credentials.empty.pending_reason")} />
  ) : (
    <EmptyState title={t("soul_accounts.credentials.empty.filtered")} />
  );

  const label = "md:hidden font-mono text-2xs text-[oklch(var(--color-ink-subtle))]";

  return (
    <PageShell
      variant="full"
      title={t("soul_accounts.credentials.title")}
      subtitle={
        canManage
          ? t("soul_accounts.credentials.subtitle")
          : `${t("soul_accounts.credentials.subtitle")} · ${t("soul_accounts.credentials.manage_hint")}`
      }
      actions={actions}
      filters={filters}
      isLoading={list.isLoading}
      skeleton={<ListSkeleton count={4} />}
      isEmpty={failed || rows.length === 0}
      empty={empty}
      pagination={
        count > PAGE_SIZE
          ? { controls: <Pagination page={page} totalPages={totalPages} count={count} onPageChange={setPage} /> }
          : undefined
      }
    >
      {/* 账页(规范 v1 §2):不装框;表头 11 px 等宽,下接区块边界线,行与行之间是行线。 */}
      <div>
        <div
          aria-hidden="true"
          className={`hidden min-h-(--control-h-sm) items-center px-3 py-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] border-b-2 border-[oklch(var(--color-ink))] ${ROW_GRID}`}
        >
          <span>{t("soul_accounts.fields.soul")}</span>
          <span>{t("soul_accounts.fields.cycle")}</span>
          <span>{t("soul_accounts.fields.reason")}</span>
          <span>{t("soul_accounts.fields.expires_at")}</span>
          <span />
        </div>
        <ul>
          {rows.map((c) => {
            const expired = isExpired(c);
            const reason = credentialReason(c);
            return (
              <li
                key={c.id}
                data-credential-id={c.id}
                className={`px-3 py-3 md:py-2 md:min-h-(--table-row-h) space-y-3 md:space-y-0 border-b border-[oklch(var(--color-rule))] ${ROW_GRID}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-[oklch(var(--color-ink))] break-words">
                    <Link href={`/souls/${c.soul}`} className="hover:underline">
                      {c.soul_name}
                    </Link>
                  </p>
                  <p className="text-xs text-[oklch(var(--color-ink-tertiary))] break-all">
                    <SoulCode code={c.soul_code} />
                  </p>
                  <StatusBadge namespace="soul_accounts.credential_status" value={c.status} tone={credentialTone(c.status)} />
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.cycle")}</p>
                  <p className="text-sm">{t("soul_accounts.life", { n: lifeNumber(c.cycle) })}</p>
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.reason")}</p>
                  <p className="text-sm text-[oklch(var(--color-ink-muted))] break-words">{t(reason.key, reason.params)}</p>
                  {c.email_not_synced === "taken" && <EmailNotSyncedNote />}
                  {c.revealed_at && (
                    <p className="text-xs text-[oklch(var(--color-ink-subtle))] break-words">
                      {t("soul_accounts.credentials.revealed_by", { by: c.revealed_by ?? "", time: formatDateTime(c.revealed_at) })}
                    </p>
                  )}
                  {c.delivered_at && (
                    <p className="text-xs text-[oklch(var(--color-ink-subtle))] break-words">
                      {t("soul_accounts.credentials.delivered_by", { by: c.delivered_by ?? "", time: formatDateTime(c.delivered_at) })}
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.expires_at")}</p>
                  <p className="font-mono text-xs">{formatDateTime(c.expires_at)}</p>
                  {expired && c.status !== "DELIVERED" && <Badge tone="error" glyph="✕">{t("soul_accounts.credentials.expired")}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-1 md:justify-end">
                  {canManage && c.status === "PENDING" && !expired && (
                    <>
                      <Button type="button" size="sm" variant="ghost" className="text-[oklch(var(--color-warning))]" onClick={() => setRevealing(c)}>
                        {t("soul_accounts.credentials.actions.reveal")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        loading={retry.isPending && retry.variables === c.id}
                        onClick={() => doRetry(c)}
                      >
                        {t("soul_accounts.credentials.actions.retry")}
                      </Button>
                    </>
                  )}
                  {canManage && (c.status === "PENDING" || c.status === "REVEALED") && !expired &&
                    printButton(c, t("soul_accounts.credentials.print_slip"))}
                  {canManage && c.status === "DELIVERED" && !expired && printButton(c, t("soul_accounts.credentials.reprint_slip"), true)}
                  {canManage && c.status === "REVEALED" && !expired && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-[oklch(var(--color-accent-ink))]"
                      loading={deliver.isPending && deliver.variables === c.id}
                      onClick={() => doDeliver(c)}
                    >
                      {t("soul_accounts.credentials.actions.mark_delivered")}
                    </Button>
                  )}
                  {canManage && expired && c.status !== "DELIVERED" && (
                    <Link
                      href={`/souls/${c.soul}#soul-account`}
                      className="inline-flex min-h-(--control-h-sm) items-center px-2 text-xs underline text-[oklch(var(--color-accent-ink))]"
                    >
                      {t("soul_accounts.credentials.actions.go_reset")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {slip && <DeliverySlip slip={slip.data} texts={slip.texts} color={!mono} reprint={slip.reprint} />}
      {revealing && <RevealCredentialDialog key={revealing.id} credential={revealing} onClose={() => setRevealing(null)} />}
    </PageShell>
  );
}

export default function SoulCredentialsPage() {
  return (
    <RequirePermission permissions="soul_account.read" fallback={<PermissionDenied />}>
      <CredentialsPageContent />
    </RequirePermission>
  );
}
