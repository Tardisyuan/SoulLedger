"use client";

import { useId, useMemo, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { Field, TextField, fieldControl } from "@/src/components/ui/Field";
import { COMMON_TIMEZONES, allTimezones, utcOffsetLabel } from "./schedulerView";

interface Props {
  value: string;
  onChange: (timeZone: string) => void;
  error?: string | null;
}

/**
 * Pinned zones first, then every IANA zone the engine knows, narrowed by a
 * search box. A native `<select>` with two `<optgroup>`s rather than a custom
 * combobox: it is keyboard- and screen-reader-complete for free and opens the
 * OS picker on a phone, which a 400-row custom listbox would not.
 *
 * The current value is always an option even when the search hides it or the
 * engine does not list it (e.g. a zone renamed in tzdata) — a select whose
 * value is not among its options silently shows the first option instead.
 */
export function TimezoneSelect({ value, onChange, error }: Props) {
  const { t } = useI18n();
  const selectId = useId();
  const [query, setQuery] = useState("");

  // Offsets are "now" for every zone; computed once per mount (~420 zones).
  const labelled = useMemo(() => {
    const names = [...new Set([...COMMON_TIMEZONES, ...allTimezones()])];
    return new Map(names.map((name) => [name, `${name} (${utcOffsetLabel(name) ?? "?"})`]));
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = (name: string) => needle === "" || name.toLowerCase().includes(needle);
  const common = COMMON_TIMEZONES.filter(matches);
  const rest = [...labelled.keys()].filter((name) => !COMMON_TIMEZONES.includes(name) && matches(name));
  const valueHidden = !common.includes(value) && !rest.includes(value);

  return (
    <div className="space-y-2">
      <TextField
        label={t("scheduler.editor.timezone_search")}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="off"
        spellCheck={false}
      />
      <Field id={selectId} label={t("scheduler.editor.timezone")} error={error}>
        {(control) => (
          <select
            {...control}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={fieldControl({ invalid: Boolean(error) })}
          >
            {valueHidden && <option value={value}>{labelled.get(value) ?? value}</option>}
            {common.length > 0 && (
              <optgroup label={t("scheduler.editor.timezone_common")}>
                {common.map((name) => (
                  <option key={name} value={name}>
                    {labelled.get(name)}
                  </option>
                ))}
              </optgroup>
            )}
            {rest.length > 0 && (
              <optgroup label={t("scheduler.editor.timezone_all")}>
                {rest.map((name) => (
                  <option key={name} value={name}>
                    {labelled.get(name)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
      </Field>
      {common.length === 0 && rest.length === 0 && (
        <p className="text-02 text-[oklch(var(--color-ink-muted))]">{t("scheduler.editor.timezone_none")}</p>
      )}
    </div>
  );
}
