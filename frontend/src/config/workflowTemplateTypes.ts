// The shape of a workflow preset — and the header that used to sit on top of
// `workflow-templates.ts` itself, moved here when that file was split so it
// could stay under the 500-line ceiling. The data file is now almost entirely
// data, and the warnings live with the types that describe it.
//
//
// The mythological facts encoded here (who acts, where, and in what order) are
// sourced. Before "correcting" a node name, court or order by intuition, read
// docs/lore-verification/verify-egyptian.md and verify-greek.md — both cite
// public-domain primary editions, and the errors they catalogue were all
// intuitive-looking. Node-level comments below name the plate or line each
// value rests on. src/__tests__/workflowTemplateLore.test.ts locks the ones
// that were actually found wrong.
//
// 还有一条跨端约束：节点名里的人必须是名册里真实存在的人。规则与理由表见文件
// 末尾的 NODES_THAT_NAME_NO_ACTOR，断言在
// backend/tests/test_workflow_template_cast.py（它把本文件当文本读，因为
// Jest 连不上数据库、pytest 跑不了 TypeScript）。
//
// ── AND ONE CONSTRAINT ON THE FILE ITSELF ────────────────────────────────
//
// `workflow-templates.ts` is READ AS TEXT by three pytest files, because Jest
// cannot reach the database and pytest cannot run TypeScript:
//
//   backend/tests/test_workflow_template_cast.py
//   backend/tests/test_workflow_preset_node_types.py
//   backend/tests/test_workflow_template_priority.py
//
// They regex it, and the regexes encode its LAYOUT:
//   `^  KEY: {$`                      — one preset per line, two-space indent
//   `^    (civilization|caseType|name): "…",$`  — four-space indent
//   `^    priority: (\d+),$`
//   `{ id: "…", name: "…", court: "…", type: "…", order: N }` — one line each
//   `export const NODES_THAT_NAME_NO_ACTOR … {` … `\n};`
//
// So: the presets and the reason table cannot be moved out of that file, and it
// cannot be reflowed or reindented. `test_workflow_preset_node_types.py` pins
// the count at `assert len(presets) == 16` and cross-checks the node literals
// against every `order:` in the source, so a partial move fails loudly rather
// than quietly checking fewer presets — but only a move that leaves the header
// regex matchable at all. THAT is why only the type declarations came out here.

export interface WorkflowNodeTemplate {
  id: string;
  name: string;
  court: string;
  /**
   * 中文步骤名，**不是** `NodeType` 成员。「分流」「初审」「申诉受理」…
   *
   * 它比 NodeType 具体，并且被 `src/__tests__/workflowTemplateLore.test.ts`
   * 当作考据锁定（Ammit 的每个节点必须是「失败分支」，希腊三位必须是
   * 「分区审判」而不是「初审/复核」，Michael 的任何节点的 type 不得含
   * 「审」），所以它留在这里。
   *
   * 但它不能原样发到后端：`node_type` 是 ChoiceField，只收五个 NodeType 成员，
   * 于是「编辑」保存任何预设都会 400。判读成 NodeType 的表在
   * `src/config/workflow-node-types.ts`（`PRESET_NODE_TYPE` / `nodeTypeFor`），
   * 新增预设漏映射会让 `src/__tests__/presetNodeTypes.test.ts` 变红。
   */
  type: string;
  order: number;
}

export interface WorkflowTemplate {
  civilization: string;
  caseType: string;
  name: string;
  description: string;
  /**
   * 本套程序默认的急缓：0=普通, 1=紧急, 2=危急。与
   * `ApprovalWorkflow.priority` 同一把尺子，因为它就是那一列的默认值——
   * 存成 `WorkflowTemplate.priority` 之后，`WorkflowService.create_from_judgment`
   * 建流程时若调用方没有显式指定，就落到这个值。
   *
   * **这个字段是必填的，没有默认值，这一点是故意的。** 三套「紧急审判流程」
   * 之所以需要它，是因为 `caseType` 回答的是「这是哪一类案子」而不是「多急」
   *（见下面 CHINESE_EMERGENCY 顶部那段：`"EMERGENCY"` 曾经被写进 caseType，
   * 一保存就 400）。把它设成可选、缺省当 0，会让下一套新增的紧急预设在没人
   * 表态的情况下静默地变成普通件；必填意味着新增预设时 tsc 会逼着作者回答
   * 这个问题。**不许因为「大多数是 0」就把它改成可选。**
   *
   * 跨端断言：backend/tests/test_workflow_template_priority.py 核对这里写着
   * `priority: 1` 的那几套，与后端
   * `0014_backfill_emergency_template_priority.EMERGENCY_TEMPLATES` 的签名表
   * 一致。
   */
  priority: number;
  nodes: WorkflowNodeTemplate[];
}
