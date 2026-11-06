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

/**
 * 十殿流程的十个节点按殿名显示(用户 2026-11-07):`realms.names.DY_COURT_01…10`(第一殿秦广王 …)。
 * 「初审…终审」只作流程代号,库里与后端模板(`WorkflowTemplate`)不改;按存着的节点名整名认,别的流程里
 * 同殿的节点(跨域流程的「案件分类」也在第一殿)不受影响。
 */
const TEN_COURT_NODES: Readonly<Record<string, string>> = {
  "秦广王 · 分流": "DY_COURT_01_QINGUANG",
  "楚江王 · 初审": "DY_COURT_02_CHUJIANG",
  "宋帝王 · 二审": "DY_COURT_03_SONGDI",
  "五官王 · 三审": "DY_COURT_04_WUGUAN",
  "阎罗王 · 四审": "DY_COURT_05_YANLUO",
  "卞城王 · 五审": "DY_COURT_06_BIANCHENG",
  "泰山王 · 六审": "DY_COURT_07_TAISHAN",
  "都市王 · 七审": "DY_COURT_08_DUSHI",
  "平等王 · 八审": "DY_COURT_09_PINGDENG",
  "转轮王 · 终审": "DY_COURT_10_ZHUANLUN",
};

/** The court name a ten-court node reads as, or undefined (no `t`, not one of the ten, or the bundle lacks the key). */
export function tenCourtName(name: string | undefined, t?: (key: string) => string): string | undefined {
  const court = t && name ? TEN_COURT_NODES[name] : undefined;
  if (!court) return undefined;
  const key = `realms.names.${court}`;
  const label = t!(key);
  return label && label !== key ? label : undefined;
}

/**
 * A workflow node's name. A built node has `node_name_en`; a node inside a template's JSON has `name_en`.
 * With `t`, the ten courts read as their court names (above). The source's 「欧西里斯」 (the weighing template's
 * spelling) is shown as 「奥西里斯」, the one spelling the UI uses (用户 2026-11-07); the stored name is unchanged.
 */
export function localNodeName(
  node: { node_name?: string; node_name_en?: string; name_en?: string } | null | undefined,
  locale: string | undefined,
  t?: (key: string) => string,
): string {
  if (!node) return "";
  const court = tenCourtName(node.node_name, t);
  if (court) return court;
  const english = locale === "en" && (node.node_name_en || node.name_en);
  return english || (node.node_name ?? "").replace(/欧西里斯/g, "奥西里斯");
}
