"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
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
 * 资料舱:供词 / 功过记录 / 律条引用三个标签,浮起一层(`shadow-raised`)。
 * `fullCase` 时三栏并置、标签条不画(原型的 F「展开全案」)。三块内容一直挂着 —— 不当前的
 * 标签只是 `hidden`,律条检索里打到一半的字、证据的焦点行在切标签和切全案时都留着。
 */
export function MaterialDock({
  active,
  onActive,
  fullCase,
  onToggleFullCase,
  panels,
}: {
  active: DeskMaterial;
  onActive: (m: DeskMaterial) => void;
  fullCase: boolean;
  onToggleFullCase: () => void;
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
        <h2 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
          {fullCase ? t("judgment.desk.full_case") : t("judgment.desk.materials")}
        </h2>
        {!fullCase && (
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
        )}
        {/* F 只在两栏以上有意义(原型:单栏不响应 F),所以按钮在 768 以下不画。 */}
        <button
          type="button"
          onClick={onToggleFullCase}
          aria-pressed={fullCase}
          className="ml-auto hidden h-8 items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] md:inline-flex"
        >
          {fullCase ? t("judgment.desk.back_to_focus") : t("judgment.desk.full_case")}
          <Kbd>F</Kbd>
        </button>
      </header>
      <div className={fullCase ? "grid grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)_minmax(0,0.85fr)]" : undefined}>
        {DESK_MATERIALS.map((m, i) => (
          <div
            key={m}
            id={panelId(m)}
            data-material={m}
            {...(fullCase ? {} : { role: "tabpanel", "aria-labelledby": tabId(m), hidden: m !== active })}
            className={`min-w-0 px-4 py-4 md:px-6 transition-[opacity,translate] duration-fast ease-enter starting:translate-y-1.5 starting:opacity-0 ${
              fullCase ? "border-b border-[oklch(var(--color-line))] lg:border-b-0 lg:border-r lg:last:border-r-0" : ""
            }`}
          >
            {fullCase && (
              <h3 className="mb-3 flex items-baseline gap-3 text-lg text-[oklch(var(--color-ink))]">
                <span aria-hidden="true" className="font-mono text-2xs font-normal text-[oklch(var(--color-ink-subtle))]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {panels[m].label}
              </h3>
            )}
            {panels[m].node}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 盖印确认层(原型 `ConfirmationView`):全屏一层,落判前最后看一眼「你选了什么、谁签、不可撤回」。
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
  pending,
  done,
  stampKey,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  verdict: string;
  court: string | null | undefined;
  withWorkflow: boolean;
  pending: boolean;
  done: boolean;
  stampKey: number;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const code = verdict as Verdict;
  /* 句子里的裁决名走 DomainEnum 同一条解析(键是小写的;认不得时写「未识别」而不是键名)。 */
  const verdictLabel = resolveEnumDisplay(t, "judgment.verdicts", verdict).label ?? "";
  /* 进层时焦点落在「盖印并结案」(不是排在前面的「返回检查」),落定后落在「完成」:Enter 做的是这一层要做的事。 */
  const stampRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  /* 落定时「盖印并结案」被换下,焦点不能掉回 body。 */
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  const choice = (
    <p className="font-title text-display-lg text-[oklch(var(--color-ink))]">
      <span aria-hidden="true" className="mr-3 font-normal">{verdictGlyph(code)}</span>
      <DomainEnum namespace="judgment.verdicts" value={verdict} />
    </p>
  );
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Popup
          data-testid="confirm-layer"
          initialFocus={done ? doneRef : stampRef}
          className="fixed inset-0 z-dialog isolate overflow-y-auto bg-[oklch(var(--color-surface-1))] transition-[opacity,translate] duration-base ease-enter data-ending-style:duration-fast data-ending-style:ease-exit data-ending-style:opacity-0 data-starting-style:translate-y-3 data-starting-style:opacity-0"
        >
          <CivMotif />
          <header className="flex h-13 items-center justify-between border-b border-[oklch(var(--color-line))] px-4 md:px-8">
            <span className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.confirm_title")}</span>
            {!done && (
              <Dialog.Close
                disabled={pending}
                className="inline-flex h-8 items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
              >
                {t("judgment.desk.back_to_check")}
                <Kbd>Esc</Kbd>
              </Dialog.Close>
            )}
          </header>
          <div className="mx-auto w-full max-w-[430px] px-4 py-12 text-center">
            {done ? (
              <>
                <Seal size={72} stampKey={stampKey} court={court ?? undefined} className="mx-auto" />
                <Dialog.Title className="mt-6 text-lg text-[oklch(var(--color-ink))]">{t("judgment.desk.recorded")}</Dialog.Title>
                <div className="mt-6">{choice}</div>
                <Button type="button" variant="secondary" size="lg" className="mt-8 w-full" onClick={onClose} ref={doneRef}>
                  {t("judgment.desk.done")}
                </Button>
              </>
            ) : (
              <>
                <Dialog.Title className="text-lg text-[oklch(var(--color-ink))]">{t("judgment.desk.confirm_title")}</Dialog.Title>
                <Dialog.Description className="mt-3 text-sm text-[oklch(var(--color-ink-muted))]">
                  {t("judgment.desk.confirm_body", { verdict: verdictLabel })}
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
                <Button type="button" variant="primary" size="lg" className="mt-8 w-full gap-2" loading={pending} onClick={onConfirm} ref={stampRef}>
                  {pending
                    ? t("judgment.detail.concluding")
                    : withWorkflow
                      ? t("judgment.detail.conclude_with_workflow")
                      : t("judgment.desk.stamp")}
                  <Kbd>⌘⏎</Kbd>
                </Button>
                <p className="mt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.irreversible")}</p>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
