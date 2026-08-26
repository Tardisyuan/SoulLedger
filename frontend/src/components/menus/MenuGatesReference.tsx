"use client";

import { useI18n } from "@/src/contexts/I18nContext";

/**
 * The five visibility gates, as i18n keys. Five near-identical `<tr>` blocks
 * became one loop when the row height and the header spelling were unified —
 * the copy is the only thing that differed between them, and now that is the
 * only thing written down per row.
 */
const GATE_ROWS = [
  { name: "menus.active", effect: "menus.gate_is_active_effect", nonadmin: "menus.gate_is_active_nonadmin" },
  { name: "menus.visible_label", effect: "menus.gate_visible_effect", nonadmin: "menus.gate_visible_nonadmin" },
  { name: "menus.permission_field", effect: "menus.gate_permission_effect", nonadmin: "menus.gate_permission_nonadmin" },
  { name: "menus.roles", effect: "menus.gate_roles_effect", nonadmin: "menus.gate_roles_nonadmin" },
  { name: "menus.type", effect: "menus.gate_menu_type_effect", nonadmin: "menus.gate_menu_type_nonadmin" },
] as const;

export function MenuGatesReference() {
  const { t } = useI18n();

  return (
    /* Five-gate reference: an entry can be invisible for five unrelated
       reasons (is_active, visible, permission, roles, menu_type), none
       of them named anywhere in the UI. This names them. Left open to
       anyone who can reach this page — menu.read is granted to every
       role — since the ADMIN-only write gate (menu.manage) doesn't mean
       only ADMIN benefits from knowing why an entry is missing.

       WHY THIS STAYS A HAND-WRITTEN <table> AND DOES NOT BECOME A DataTable.
       DataTable's contract is `data: T[]` + `keyExtractor` + `renderRow`,
       with loading / error / empty / sort / pagination states attached. None
       of those has a referent here: there is no request, no page, no row
       identity and no possible empty state — the five gates are five facts
       about the schema, spelled out in copy. Passing it a literal array of
       five i18n keys would invent a data source in order to satisfy a
       signature, and would hang a `<caption class="sr-only">`, a bordered
       card and a pagination-capable footer off a paragraph.

       What WAS wrong is the part that is fixed below. The brief counted
       three header spellings across the app's hand-written tables; this one
       was the "no background at all" variant, with `text-ink-subtle` heads
       and a `py-1.5` row height on nobody's ladder. Its `<thead>` is now
       character-for-character DataTable's own — `bg-surface-2
       text-ink-muted`, `px-4 py-3 font-medium`, hairline rule under the row
       — so the two tables on this page read as one table style even though
       only one of them is the component. */
    <details className="mb-4 bg-surface-2 border border-hairline">
      <summary className="cursor-pointer px-4 py-3 text-03 font-medium text-ink">
        {t("menus.gates_title")}
      </summary>
      <div className="px-4 pb-4">
        <p className="text-03 text-ink-muted mb-3">{t("menus.gates_intro")}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-03 border-collapse">
            <thead className="bg-surface-2 text-ink-muted">
              <tr className="text-left border-b border-hairline">
                <th className="px-4 py-3 font-medium">{t("menus.gate_col_name")}</th>
                <th className="px-4 py-3 font-medium">{t("menus.gate_col_effect")}</th>
                <th className="px-4 py-3 font-medium">{t("menus.gate_col_nonadmin")}</th>
              </tr>
            </thead>
            <tbody className="text-ink-muted">
              {GATE_ROWS.map((row) => (
                <tr key={row.name} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{t(row.name)}</td>
                  <td className="px-4 py-3">{t(row.effect)}</td>
                  <td className="px-4 py-3">{t(row.nonadmin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-02 text-ink-subtle mt-2">{t("menus.gates_footnote")}</p>
      </div>
    </details>
  );
}
