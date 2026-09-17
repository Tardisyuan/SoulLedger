/**
 * The only sanctioned path from a domain enum to text — shared by the web
 * admin (`frontend/src/lib/domainDisplay.ts` re-exports it) and the soul app.
 *
 * Moved here from the frontend on 2026-09-17 when the second client arrived:
 * the function never touched React or the DOM, and a mobile copy would have
 * been two implementations of "never leak a dotted key, never swallow an
 * unknown member" that nothing kept in step.
 */

/** Minimal shape of a translator — keeps this module free of React imports. */
export type Translate = (key: string, params?: Record<string, string>) => string;

export type EnumDisplay =
  /** Field was null/undefined/"" — nothing was recorded, so it is `unrecorded`. */
  | { state: "missing"; raw: null; label: null }
  /** Bundle had an entry. `label` is translated copy; `raw` is for `title`. */
  | { state: "known"; raw: string; label: string }
  /**
   * Backend sent a value the bundles do not cover — a new enum member, or a
   * tenant misconfiguration. Shows translated "unrecognized" copy, never the
   * key, with the raw value kept so it is still diagnosable.
   */
  | { state: "unrecognized"; raw: string; label: string };

/**
 * @param namespace dotted bundle path, e.g. `"souls.states"`.
 * @param raw the value straight off the API.
 */
export function resolveEnumDisplay(
  t: Translate,
  namespace: string,
  raw: string | null | undefined
): EnumDisplay {
  if (raw === null || raw === undefined || raw === "") {
    return { state: "missing", raw: null, label: null };
  }
  // The bundles are not consistent about case — `souls.states` is keyed
  // ALIVE/JUDGING while `workflow.node_type` is keyed trial/evaluation. That
  // inconsistency is why two screens grew private Record<string, string> maps
  // just to bridge an enum member to its key. Trying the member as written,
  // then folded both ways, retires those maps here instead of in each caller.
  for (const candidate of [raw, raw.toLowerCase(), raw.toUpperCase()]) {
    const key = `${namespace}.${candidate}`;
    const translated = t(key);
    // t() echoes the key back on a miss, so an untranslated enum would
    // otherwise leak a dotted path into the UI.
    if (translated !== key && translated !== "") {
      return { state: "known", raw, label: translated };
    }
  }
  return { state: "unrecognized", raw, label: t("common.value.unrecognized") };
}
