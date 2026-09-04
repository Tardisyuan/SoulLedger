"use client";

import { useRef } from "react";

/**
 * 六道 picker for the rebirth action on a soul's detail page.
 *
 * Until this existed, app/souls/[id]/page.tsx posted a hardcoded
 * `rebirth_form: "HUMAN"` on every rebirth, so the product advertised 六道轮回
 * while every soul it ever reincarnated was written into 人道. The backend
 * enum had all six; there was simply nowhere to say which one.
 *
 * The two groups and their order are docs/07_六道轮回详解.md §一 — 三善道 best
 * to worst (天道 / 人道 / 阿修罗道), then 三恶道 worst-going-down (畜生道 /
 * 饿鬼道 / 地狱道). Grouping is not decoration: the six are not a flat list of
 * peers, and an operator choosing a destination is choosing 善 or 恶 first.
 *
 * OTHER is deliberately absent. It is a legacy storage value ("recorded
 * before the six paths existed"), not a seventh path — apps/reincarnation
 * has a test pinning `OTHER not in SIX_PATHS`, and the API now rejects it on
 * write, so offering it here would only manufacture 400s.
 */

import { useI18n } from "@/src/contexts/I18nContext";

/** 三善道, best to worst. */
export const THREE_GOOD_PATHS = ["DIVINE", "HUMAN", "ASURA"] as const;
/** 三恶道, worst going down. */
export const THREE_EVIL_PATHS = ["ANIMAL", "HUNGRY_GHOST", "HELL_BEING"] as const;
/** The six paths in doctrinal order. Mirrors apps/reincarnation/models.SIX_PATHS. */
export const SIX_PATHS = [...THREE_GOOD_PATHS, ...THREE_EVIL_PATHS] as const;

export type RebirthFormValue = (typeof SIX_PATHS)[number];

export const DEFAULT_REBIRTH_FORM: RebirthFormValue = "HUMAN";

/**
 * Tints stay at 0.1 — the depth every light-mode `--color-status-*` token was
 * re-measured against for AA (see src/__tests__/dataGridToneContract.test.ts).
 * Raising it here would invalidate those measurements just as surely as
 * raising it in the data grid did.
 */
const GROUP_TONE = {
  good: {
    selected:
      "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))] border-[hsl(var(--color-status-success)/0.5)]",
    label: "text-[hsl(var(--color-status-success))]",
  },
  evil: {
    selected:
      "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))] border-[hsl(var(--color-status-warning)/0.5)]",
    label: "text-[hsl(var(--color-status-warning))]",
  },
} as const;

const UNSELECTED =
  "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-3))] hover:text-[hsl(var(--color-ink))]";

interface RebirthFormSelectProps {
  value: RebirthFormValue;
  onChange: (form: RebirthFormValue) => void;
  disabled?: boolean;
}

export function RebirthFormSelect({ value, onChange, disabled }: RebirthFormSelectProps) {
  // `tf` (translate, or show this literal) came down as a prop from the soul
  // detail page through SoulActionsCard; it is on the i18n context now. This is
  // the one of the four that did not already call `useI18n` — the six form
  // names ship in messages/*.json under `reincarnation.forms.*`, but the two
  // group headings and `reincarnation.form_label` do not, so half of what this
  // component renders comes out of the fallbacks written below.
  const { tf } = useI18n();
  const groups = [
    {
      key: "good" as const,
      label: tf("reincarnation.groups.THREE_GOOD_PATHS", "三善道"),
      forms: THREE_GOOD_PATHS,
    },
    {
      key: "evil" as const,
      label: tf("reincarnation.groups.THREE_EVIL_PATHS", "三恶道"),
      forms: THREE_EVIL_PATHS,
    },
  ];

  /**
   * The keyboard contract `role="radiogroup"` promises, which was not kept.
   *
   * A radio group is ONE tab stop plus arrow selection. This rendered six
   * buttons that were all tab stops and where arrow keys did nothing —
   * selection worked and `aria-checked` was truthful, so nothing was
   * unreachable; what was wrong is that the navigation model announced was not
   * the navigation model implemented. Same class as the two `role="menu"`
   * popups the 2026-09-01 round fixed, and as `SoulHeaderActions` in this same
   * commit.
   *
   * Flattened across the three groups on purpose: the groups are a visual
   * grouping of one choice, not three choices. Arrowing off the end of 天道
   * lands on the first of 人道 rather than stopping, because there is one
   * value here and six candidates for it.
   *
   * Wrapping, and `Home`/`End`, match `useRovingPopupKeys` — this could not
   * reuse that hook (it is written for a popup with an open/closed lifecycle
   * and a close callback, neither of which exists here), so it matches its
   * behaviour instead of inventing a second dialect.
   */
  const flat = groups.flatMap((g) => g.forms);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, flat.indexOf(value));

  const moveTo = (index: number) => {
    const next = flat[(index + flat.length) % flat.length];
    onChange(next);
    // Selection follows focus, which is the standard behaviour for a radio
    // group and the reason this is not a listbox: there is no "browse without
    // choosing" state to preserve here, and one arrow press meaning "look at"
    // rather than "pick" would leave the group's value out of step with what
    // the operator is looking at.
    itemRefs.current[flat.indexOf(next)]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveTo(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveTo(index - 1);
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(flat.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={tf("reincarnation.form_label", "轮回形态")}
      className="space-y-3"
    >
      {/* `aria-hidden`: the group already carries this exact string as its
          `aria-label`, so without this a screen reader reads the heading and
          then the group's name — the same words twice, in a row. */}
      <p aria-hidden="true" className="text-01 uppercase text-[hsl(var(--color-ink-muted))]">
        {tf("reincarnation.form_label", "轮回形态")}
      </p>
      {groups.map((group) => (
        <div key={group.key} className="space-y-1.5">
          <p className={`text-02 font-medium ${GROUP_TONE[group.key].label}`}>{group.label}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {group.forms.map((form) => {
              const selected = form === value;
              const index = flat.indexOf(form);
              return (
                <button
                  key={form}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  // ONE tab stop for the whole group — the other half of the
                  // contract. Six tab stops is what a group of six checkboxes
                  // would be, and it is six presses to get past a single
                  // choice. `selectedIndex` falls back to 0 when `value` is
                  // not one of the six, so the group is never unreachable.
                  tabIndex={index === selectedIndex ? 0 : -1}
                  disabled={disabled}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  onClick={() => onChange(form)}
                  className={`px-2 py-1.5 border text-03 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    selected ? GROUP_TONE[group.key].selected : UNSELECTED
                  }`}
                >
                  {tf(`reincarnation.forms.${form}`, form)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
