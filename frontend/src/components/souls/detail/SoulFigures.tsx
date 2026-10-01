"use client";

import type { Soul } from "@soulledger/core/api";
import { INHERITANCE_QUANTITIES } from "@soulledger/core/api/ledgerQuantities";
import { useI18n } from "@/src/contexts/I18nContext";
import { Figure } from "@/src/components/ledger/QuantityFigure";

/**
 * v3 灵魂详情页头的三件:首字方块、功 / 过 / 承自前世,以及右栏的「功过」。
 *
 * 数从哪来:三处都读 **Soul 自己的** `merit_score` / `demerit_score`
 * (`LedgerService.recalculate`:承自前世 + 本世衰减后的事项,取整后存回 Soul),
 * 不读 `/karma/` 的汇总 —— 那份只算本世事项,两个同名的数并排会像一处对不上的账。
 * 两者都只在 `/karma/` 那一栏(「全部功过记录」)里各自出现,并写明是衰减后。
 *
 * **不相抵。** 功与过永远是两个数,这里不算余额:相抵是功过格一家的读法,
 * 埃及称心、欧洲补赎都不这么算(`SoulKarmaLedgerCard` 里余额那一行的长注释)。
 * 原型右栏也只有功、过两个数。
 *
 * VIEWER 拿不到分数(`SoulSerializer.get_merit_score` 返回 null):那时两处都不画,
 * 而不是画一个「尚未记录」—— 这数是记了的,只是不给这个角色看。
 */

/** 功 / 过,用账簿自己的两个字(`ledger.book.col_merit` / `col_demerit`)。 */
function scores(soul: Soul): { merit: number; demerit: number } | null {
  const { merit_score: merit, demerit_score: demerit } = soul;
  return typeof merit === "number" && typeof demerit === "number" ? { merit, demerit } : null;
}

/** 首字方块。装饰:可访问名是旁边的 `<h1>`,这里 `aria-hidden`。中性色 —— 文明色不进这里。 */
export function SoulMonogram({ name }: { name: string | undefined }) {
  const glyph = Array.from((name ?? "").trim())[0]?.toUpperCase();
  if (!glyph) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="soul-monogram"
      className="grid h-13 w-13 place-items-center bg-[oklch(var(--color-surface-2))] font-title text-xl font-semibold text-[oklch(var(--color-ink))] md:h-16 md:w-16"
    >
      {glyph}
    </span>
  );
}

const DT = "text-2xs text-[oklch(var(--color-ink-subtle))]";
const DD = "mt-2 font-mono text-md font-medium tabular-nums text-[oklch(var(--color-ink))]";
const CELL = "min-w-0 border-l border-[oklch(var(--color-line))] px-3 md:min-w-28 md:px-6";

/** 页头右侧:功、过,以及(第二世起)承自前世。 */
export function SoulHeadingFigures({ soul }: { soul: Soul }) {
  const { t } = useI18n();
  const s = scores(soul);
  if (!s) return null;
  // 第一世没有前世:这一格不画,不写「不适用」—— 绝大多数灵魂都在第一世,那会是一整列噪音。
  const carried =
    (soul.life_index ?? 0) > 0 &&
    typeof soul.inherited_merit === "number" &&
    typeof soul.inherited_demerit === "number";

  return (
    <dl data-testid="soul-heading-figures" className="grid grid-cols-3 md:flex">
      <div className={CELL}>
        <dt className={DT}>{t("souls.detail.merit")}</dt>
        <dd className={DD}>
          <Figure field="merit_score" quantity="magnitude" t={t} className="">
            {s.merit}
          </Figure>
        </dd>
      </div>
      <div className={CELL}>
        <dt className={DT}>{t("souls.detail.demerit")}</dt>
        <dd className={DD}>
          <Figure field="demerit_score" quantity="magnitude" t={t} className="">
            {s.demerit}
          </Figure>
        </dd>
      </div>
      {carried && (
        <div className={CELL}>
          <dt className={DT}>{t("souls.detail.carried_in")}</dt>
          <dd className={`${DD} flex flex-wrap gap-x-2`}>
            <span>
              {t("ledger.book.col_merit")}{" "}
              <Figure field="inherited_merit" quantity={INHERITANCE_QUANTITIES.inherited_merit} t={t} className="">
                {soul.inherited_merit}
              </Figure>
            </span>
            <span aria-hidden="true">/</span>
            <span>
              {t("ledger.book.col_demerit")}{" "}
              <Figure field="inherited_demerit" quantity={INHERITANCE_QUANTITIES.inherited_demerit} t={t} className="">
                {soul.inherited_demerit}
              </Figure>
            </span>
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * 右栏「功过」(原型 `.soul-balance`)。1440 是第三栏;1024 接在身份栏下面;768 在身份旁边;393 在身份与账页之间。
 * `id="soul-karma"`:功过总账的每一行链到 `/souls/{id}#soul-karma`。
 */
export function SoulBalance({ soul }: { soul: Soul }) {
  const { t } = useI18n();
  const s = scores(soul);
  if (!s) return null;
  const figure = (label: string, field: string, value: number) => (
    <div>
      <span className="block text-2xs text-[oklch(var(--color-ink-subtle))]">{label}</span>
      <span className="mt-1 block font-title text-xl font-semibold tabular-nums text-[oklch(var(--color-ink))]">
        <Figure field={field} quantity="magnitude" t={t} className="">
          {value}
        </Figure>
      </span>
    </div>
  );
  return (
    <section
      id="soul-karma"
      aria-labelledby="soul-balance-title"
      data-testid="soul-balance"
      className="min-w-0 scroll-mt-28 bg-[oklch(var(--color-surface-1))] p-6"
    >
      <h2 id="soul-balance-title" className="text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
        {t("souls.detail.ledger.karma")}
      </h2>
      <div className="my-6 flex flex-col gap-3">
        {figure(t("ledger.book.col_merit"), "merit_score", s.merit)}
        <i aria-hidden="true" className="block h-px bg-[oklch(var(--color-line))]" />
        {figure(t("ledger.book.col_demerit"), "demerit_score", s.demerit)}
      </div>
      <p className="text-sm text-[oklch(var(--color-ink-muted))]">
        {t("souls.detail.life_number", { n: String((soul.life_index ?? 0) + 1) })}
        {" · "}
        {t("ledger.advisory_disclaimer")}
      </p>
    </section>
  );
}
