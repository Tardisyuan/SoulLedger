/**
 * Which column a reference name is read from: the English one for an English reader when it has a value, otherwise the
 * source. Reference tables keep the source in `name` / `display_name` / `node_name` … and English beside it in
 * `<field>_en` (`Menu.name_en`, `WorkflowTemplate.description_en`, `ApprovalNode.node_name_en`).
 *
 * For display only. Anything that matches on a name (`courtLabel`, `menuI18n`, `hideTheWheel`, `nodeTypeFor`,
 * `presetRouting`) keeps reading the source field, and a form edits the two fields separately, so English cannot reach
 * a lookup or be written over the source. Kemet reads the source too: it has its own columns where it has any.
 */
export function localName(row: object | null | undefined, locale: string | undefined, field = "name"): string {
  if (!row) return "";
  const columns = row as Record<string, unknown>;
  const english = locale === "en" ? columns[`${field}_en`] : undefined;
  if (typeof english === "string" && english) return english;
  const source = columns[field];
  return typeof source === "string" ? source : "";
}

/** A workflow node's name. A built node has `node_name_en`; a node inside a template's JSON has `name_en`. */
export function localNodeName(
  node: { node_name?: string; node_name_en?: string; name_en?: string } | null | undefined,
  locale: string | undefined,
): string {
  if (!node) return "";
  return (locale === "en" && (node.node_name_en || node.name_en)) || node.node_name || "";
}
