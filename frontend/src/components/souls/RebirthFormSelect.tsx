"use client";

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
  /** Translator with a code-level fallback — see the `tf` helper on the soul
   *  detail page. The six form names ship in messages/*.json under
   *  `reincarnation.forms.*`; the two group headings do not yet. */
  tf: (key: string, fallback: string, params?: Record<string, string>) => string;
}

export function RebirthFormSelect({ value, onChange, disabled, tf }: RebirthFormSelectProps) {
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

  return (
    <div
      role="radiogroup"
      aria-label={tf("reincarnation.form_label", "轮回形态")}
      className="space-y-3"
    >
      <p className="text-01 uppercase text-[hsl(var(--color-ink-muted))]">
        {tf("reincarnation.form_label", "轮回形态")}
      </p>
      {groups.map((group) => (
        <div key={group.key} className="space-y-1.5">
          <p className={`text-02 font-medium ${GROUP_TONE[group.key].label}`}>{group.label}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {group.forms.map((form) => {
              const selected = form === value;
              return (
                <button
                  key={form}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
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
