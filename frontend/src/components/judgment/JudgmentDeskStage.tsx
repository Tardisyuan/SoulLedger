"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { Judgment } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { civSkinOf } from "@/src/lib/civSkin";
import { verdictGlyph } from "@/src/lib/verdictGlyph";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { Seal } from "@/src/components/plaque/Seal";
import { Kbd } from "@/src/components/judgment/JudgmentDesk";

/**
 * 审判台 v3(第 7 轮原型 `JudgmentDesk`)的三件页面级零件:中轴的文明母题、资料舱、盖印确认层。
 * 状态全在页面里(`app/judgment/[id]/page.tsx`),这里只画。
 */

type Verdict = NonNullable<Judgment["verdict"]>;
export type DeskMaterial = "confession" | "evidence" | "law";
export const DESK_MATERIALS: readonly DeskMaterial[] = ["confession", "evidence", "law"];

/**
 * 文明母题 —— 原型 `CivilizationMotif` 的四组线,画在「当前这一判」背后。
 *
 * 原型用文明主色 8%;这里用 ink 6%。文明色只走五处(匾、导航当前项、印、主按钮、行首「我的」),
 * 母题不在其中,所以它是中性的线,不是第六处主色。不承载任何信息,读屏看不见。
 */
const MOTIF: Record<string, ReactNode> = {
  cn: (
    <>
      <path d="M300 0v520M255 38h90v90h-90zM270 161h60v60h-60zM242 259h116v116H242zM278 412h44v44h-44z" />
      <path d="M210 83h180M225 191h150M195 317h210M240 434h120" />
    </>
  ),
  eu: (
    <path d="M110 20a190 120 0 0 0 380 0M135 92a165 105 0 0 0 330 0M163 160a137 88 0 0 0 274 0M194 224a106 68 0 0 0 212 0M225 281a75 48 0 0 0 150 0M254 332a46 30 0 0 0 92 0M300 356v164" />
  ),
  eg: (
    <>
      <path d="M300 28v464M95 260h410M130 260l-55 125h110L130 260Zm340 0-55 125h110L470 260Z" />
      <path d="M112 222v76m18-76v76m340-76v76m18-76v76M245 492h110" />
      <circle cx="300" cy="260" r="22" />
    </>
  ),
  gr: (
    <>
      <path d="M276-10c85 74-68 143 18 218 56 49-10 82 6 116" />
      <path d="M300 324c-11 57-88 71-117 139M300 324c19 61 101 70 135 139M183 463c-7 17-9 38-7 57M435 463c9 18 12 37 11 57" />
      <path d="M260 45c57 48-42 93 15 142" />
    </>
  ),
};

export function CivMotif() {
  const { user } = useTenant();
  const lines = MOTIF[civSkinOf(user?.tenant?.code ?? null)];
  if (!lines) return null;
  return (
    <svg
      aria-hidden="true"
      data-testid="civ-motif"
      data-print-hide=""
      viewBox="0 0 600 520"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full text-[oklch(var(--color-ink))] opacity-6"
    >
      {lines}
    </svg>
  );
}

/**
 * 资料舱:供词 / 功过记录 / 律条引用三个标签,浮起一层(`shadow-raised`)。三块内容一直挂着 —— 不当前的
 * 标签只是 `hidden`,律条检索里打到一半的字、证据的焦点行在切标签时都留着。
 * 第三十批第 3 步起它在卷宗页左栏「卷」的下面;v3 的 F「展开全案」(三栏并置 + gsap 转场)随审判台一起退场 ——
 * 卷宗页本来就是两栏摊开的,判在右栏,不再有第二种版式。
 */
export function MaterialDock({
  active,
  onActive,
  panels,
}: {
  active: DeskMaterial;
  onActive: (m: DeskMaterial) => void;
  panels: Record<DeskMaterial, { label: string; node: ReactNode }>;
}) {
  const { t } = useI18n();
  const base = useId();
  const tabId = (m: DeskMaterial) => `${base}-tab-${m}`;
  const panelId = (m: DeskMaterial) => `${base}-panel-${m}`;
  /* ←/→ 在三个标签之间走(WAI-ARIA tabs);焦点跟着走,内容随之切换。 */
  const onTabKey = (event: React.KeyboardEvent, m: DeskMaterial) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = DESK_MATERIALS[(DESK_MATERIALS.indexOf(m) + step + DESK_MATERIALS.length) % DESK_MATERIALS.length];
    onActive(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <section
      aria-label={t("judgment.desk.materials")}
      data-testid="material-dock"
      className="min-w-0 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] shadow-raised"
    >
      <header className="flex min-h-12 flex-wrap items-center gap-x-6 gap-y-1 border-b border-[oklch(var(--color-line))] px-4 md:px-6">
        <h2 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.materials")}</h2>
        <div role="tablist" aria-label={t("judgment.desk.materials")} className="flex items-stretch gap-1 self-stretch">
          {DESK_MATERIALS.map((m) => (
            <button
              key={m}
              id={tabId(m)}
              type="button"
              role="tab"
              aria-selected={m === active}
              aria-controls={panelId(m)}
              tabIndex={m === active ? 0 : -1}
              onClick={() => onActive(m)}
              onKeyDown={(event) => onTabKey(event, m)}
              className={`relative px-3 text-sm transition-colors duration-fast ${
                m === active
                  ? "font-semibold text-[oklch(var(--color-ink))] shadow-[inset_0_-2px_0_oklch(var(--color-ink))]"
                  : "text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
              }`}
            >
              {panels[m].label}
            </button>
          ))}
        </div>
      </header>
      {DESK_MATERIALS.map((m) => (
        <div
          key={m}
          id={panelId(m)}
          data-material={m}
          role="tabpanel"
          aria-labelledby={tabId(m)}
          hidden={m !== active}
          className="min-w-0 px-4 py-4 md:px-6 transition-[opacity,translate] duration-fast ease-enter starting:translate-y-1.5 starting:opacity-0"
        >
          {panels[m].node}
        </div>
      ))}
    </section>
  );
}

/**
 * 盖印确认层(原型 `ConfirmationView`):全屏一层,落判前最后看一眼「你选了什么、谁签、落印后进入审批 / 不可撤回」。
 *
 * 原型这一层整幅铺文明主色;这里是中性面 + 印 + 主按钮 —— 文明色只走五处,印与主按钮正是其中两处。
 * 落判成功后同一层翻成「已写入记录」,印按 `stampKey` 落下(320ms、ease-drop;减少动态时直接是
 * 落定的样子,见 `Seal`)。Esc / 「返回检查」关层,裁决与判词都还在页面上。
 */
export function JudgmentConfirmLayer({
  open,
  onClose,
  verdict,
  court,
  withWorkflow,
  toApproval,
  pending,
  done,
  stampKey,
  onConfirm,
  refusal,
  stations,
  step = 1,
  onStep,
  reasons,
  reasonsReady = true,
  verdictNamespace = "judgment.verdicts",
  chooseFirst = false,
}: {
  open: boolean;
  onClose: () => void;
  verdict: string;
  court: string | null | undefined;
  withWorkflow: boolean;
  /** 落印后进入审批(`sealGoesToApproval`):是就写「落印后进入审批」,不是(再审裁决、非原审不要流程)才写「不可撤回」。 */
  toApproval: boolean;
  pending: boolean;
  done: boolean;
  stampKey: number;
  onConfirm: () => void;
  /** 提交被挡下时的那句话(如还有跨域审判没结束);给了就放在盖印键上面,盖印键置灰。 */
  refusal?: ReactNode;
  /**
   * 第四十三批 W-1a:勾了「生成审批流」时的选站列表。给了就分两步 —— 第 1 步的主键变成「下一步」,
   * 第 2 步是这份列表与「上一步 / 落判并发起」。步数由页面持有(⌘⏎ 也要按步走)。
   */
  stations?: ReactNode;
  step?: 1 | 2;
  onStep?: (step: 1 | 2) => void;
  /**
   * 规范 v4 S10:「不过」的理由面板(希腊「通过」只选文书),画在第 1 步里。没选够(`reasonsReady` 为假)时
   * 主键置灰;不过而又不用选站时主键写「不过 · 落印」,旁边「放回」关层。
   */
  reasons?: ReactNode;
  reasonsReady?: boolean;
  /** 按文明的裁决叫法(`verdictNamespace`,第十一批 1a)。 */
  verdictNamespace?: string;
  /**
   * Design 第十一批第 3 条:希腊判「通过」先单独问「这一判写在哪一篇」(`reasons` 就是那一问),选好「下一步」
   * 才到原来的落印一页。两项初始都不选,「下一步」是灰的。
   */
  chooseFirst?: boolean;
}) {
  const { t } = useI18n();
  const code = verdict as Verdict;
  /* 句子里的裁决名走 DomainEnum 同一条解析(键是小写的;认不得时写「未识别」而不是键名)。 */
  const verdictLabel = resolveEnumDisplay(t, verdictNamespace, verdict).label ?? "";
  /** 希腊通过的第 1 步(选文书)走过了没有;每次进层从头来。 */
  const [chosen, setChosen] = useState(false);
  useEffect(() => {
    if (!open) setChosen(false);
  }, [open]);
  const choosing = chooseFirst && !chosen && !done;
  /* 进层时焦点落在「盖印并结案」(不是排在前面的「返回检查」),落定后落在「完成」:Enter 做的是这一层要做的事。 */
  const stampRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  /* 落定时「盖印并结案」被换下,焦点不能掉回 body。 */
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  const picking = !done && withWorkflow && !!stations && step === 2;
  const choice = (
    <p className="font-title text-display-lg text-[oklch(var(--color-ink))]">
      <span aria-hidden="true" className="mr-3 font-normal">{verdictGlyph(code)}</span>
      <DomainEnum namespace={verdictNamespace} value={verdict} />
    </p>
  );
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Popup
          data-testid="confirm-layer"
          initialFocus={done ? doneRef : stampRef}
          className="fixed inset-0 z-confirm isolate overflow-y-auto bg-[oklch(var(--color-surface-1))] transition-[opacity,translate] duration-base ease-enter data-ending-style:duration-fast data-ending-style:ease-exit data-ending-style:opacity-0 data-starting-style:translate-y-3 data-starting-style:opacity-0"
        >
          <CivMotif />
          <header className="flex h-13 items-center justify-between border-b border-[oklch(var(--color-line))] px-4 md:px-8">
            <span className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.confirm_title")}</span>
            {!done && (
              <Dialog.Close
                disabled={pending}
                className="inline-flex h-(--control-h-sm) items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
              >
                {t("judgment.desk.back_to_check")}
                <Kbd>Esc</Kbd>
              </Dialog.Close>
            )}
          </header>
          <div className={`mx-auto w-full px-4 py-12 text-center ${picking ? "max-w-[720px]" : "max-w-[430px]"}`}>
            {done ? (
              <>
                <Seal size={72} stampKey={stampKey} court={court ?? undefined} className="mx-auto" />
                <Dialog.Title className="mt-6 text-lg text-[oklch(var(--color-ink))]">{t("judgment.desk.recorded")}</Dialog.Title>
                <div className="mt-6">{choice}</div>
                <Button type="button" variant="secondary" size="lg" className="mt-8 w-full" onClick={onClose} ref={doneRef}>
                  {t("judgment.desk.done")}
                </Button>
              </>
            ) : picking ? (
              <>
                <Dialog.Title className="sr-only">{t("workflow.pick.title")}</Dialog.Title>
                {stations}
                {refusal && <div className="mt-8">{refusal}</div>}
                <div className="mt-8 flex gap-3">
                  <Button type="button" variant="secondary" size="lg" className="flex-1" disabled={pending} onClick={() => onStep?.(1)}>
                    {t("workflow.pick.back")}
                  </Button>
                  <Button type="button" variant="primary" size="lg" className="flex-1 gap-2" loading={pending} onClick={onConfirm} ref={stampRef} disabled={!!refusal || !reasonsReady}>
                    {pending ? t("judgment.detail.concluding") : t("judgment.detail.conclude_with_workflow")}
                    <Kbd>⌘⏎</Kbd>
                  </Button>
                </div>
                <p className="mt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">{t(toApproval ? "judgment.desk.to_approval" : "judgment.desk.irreversible")}</p>
              </>
            ) : choosing ? (
              <>
                <p className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("judgment.greek_account.step_choose")}</p>
                <Dialog.Title className="sr-only">{t("judgment.greek_account_label")}</Dialog.Title>
                <div className="mt-4">{reasons}</div>
                <div className="mt-8 flex gap-3">
                  <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={onClose}>
                    {t("reject.sheet.cancel")}
                  </Button>
                  <Button type="button" variant="primary" size="lg" className="flex-1" ref={stampRef} disabled={!reasonsReady} onClick={() => setChosen(true)}>
                    {t("workflow.pick.next")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {chooseFirst && (
                  <p className="mb-2 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("judgment.greek_account.step_seal")}</p>
                )}
                <Dialog.Title className="text-lg text-[oklch(var(--color-ink))]">{t("judgment.desk.confirm_title")}</Dialog.Title>
                <Dialog.Description className="mt-3 text-sm text-[oklch(var(--color-ink-muted))]">
                  {t(toApproval ? "judgment.desk.confirm_body_flow" : "judgment.desk.confirm_body", { verdict: verdictLabel })}
                </Dialog.Description>
                <div className="my-8">{choice}</div>
                <div className="flex items-center gap-4 border-t border-[oklch(var(--color-line))] pt-4 text-left">
                  <Seal size={52} court={court ?? undefined} className="shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.signing_court")}</span>
                    <span className="mt-1 block truncate text-sm text-[oklch(var(--color-ink))]" title={court ?? undefined}>
                      <DomainText value={court} />
                    </span>
                  </span>
                </div>
                {reasons && !chooseFirst && <div className="mt-8">{reasons}</div>}
                {refusal && <div className="mt-8">{refusal}</div>}
                <div className="mt-8 flex gap-3">
                  {reasons && !chooseFirst && (
                    <Button type="button" variant="secondary" size="lg" className="flex-1" disabled={pending} onClick={onClose}>
                      {t("reject.sheet.cancel")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="flex-1 gap-2"
                    loading={pending}
                    onClick={withWorkflow && stations ? () => onStep?.(2) : onConfirm}
                    ref={stampRef}
                    disabled={!!refusal || !reasonsReady}
                  >
                    {pending
                      ? t("judgment.detail.concluding")
                      : withWorkflow && stations
                        ? t("workflow.pick.next")
                        : code === "FAILED" && reasons
                          ? t("reject.sheet.confirm")
                          : chooseFirst
                            ? t("judgment.greek_account.confirm_pass")
                          : withWorkflow
                            ? t("judgment.detail.conclude_with_workflow")
                            : t("judgment.desk.stamp")}
                    <Kbd>⌘⏎</Kbd>
                  </Button>
                </div>
                <p className="mt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">{t(toApproval ? "judgment.desk.to_approval" : "judgment.desk.irreversible")}</p>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
