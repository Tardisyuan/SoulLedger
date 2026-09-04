"use client";

import { type ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Badge } from "@/src/components/ui/Badge";
import { nodeTypeFor } from "@soulledger/core/config/workflow-node-types";
import { type WorkflowTemplate as PresetTemplate } from "@soulledger/core/config/workflow-templates";
import { type WorkflowTemplateListItem } from "@soulledger/core/api";
import { type FlowNode } from "@/src/components/workflow/page/types";

/**
 * /workflow 「现有模板」页签右侧的模板预览：标题 + 文明/案件类型两枚徽章 +
 * 说明 + 节点条数 + 节点清单。
 *
 * WHY THIS EXISTS — 度量，不是行数。`app/workflow/page.tsx` 曾把这段标记写了
 * 两遍，一遍读后端模板（`node_name` / `court_code`），一遍读预设模板
 * （`name` / `court`）。按**保序 LCS**（difflib，不是排序后取交集）量，两段
 * 去掉注释后各 82 / 81 行，对齐的公共行 44 行，其中 19 行是纯闭合记号，
 * **实质重复 25 行**：标题、两枚徽章、节点条数那一格，以及整份节点清单
 * （同一个序号圆点、同两个 `·` 分隔）。
 *
 * 真正的理由是这 25 行**一条都没有被守住**。合并前实测（每条都是把那一行改
 * 坏、跑 `WorkflowPage.test.tsx` + `WorkflowPage.instances.test.tsx`、读退出
 * 码，再还原）：
 *
 *     后端预览 node_name 置空          → 1 failed   ← 全部两段里唯一红的一条
 *     后端预览 court_code / 类型 / 序号 → 32 passed
 *     预设预览 名称 / court / 类型 / 序号 → 32 passed
 *     两段的标题、文明徽章、案件类型徽章  → 32 passed
 *     预设预览的 nodeTypeFor(...) 改回 n.type（那条已发货缺陷本身）→ 32 passed
 *
 * 也就是说两份副本加起来只有一个字段有测试，而它在后端那一份上。分岔不会红。
 * 收成一份之后，`src/__tests__/TemplatePreview.test.tsx` 把两种形状喂进同一个
 * 组件并断言它们在共有部分上逐格相同——而且同时钉住那些格子的**内容**，因为
 * 「两张表一致」在两张都错时也是绿的。
 *
 * 差异全部收在**适配器**里（下面两个 `*PreviewModel`），不是靠组件内部的
 * `||` 链：两套字段名在那里各自收敛一次，`node_type` 的两种含义（后端是已经
 * 校验过的成员，预设是中文步骤名，要过 `nodeTypeFor`）也在那里说清楚。
 * 组件本身只认一个形状。
 *
 * 按钮**不**收进来。后端那份有「查看/编辑/删除」三颗且查看要发一次请求，预设
 * 那份只有「查看/编辑」且查看是纯本地构造——把它们塞进组件要用一串布尔开关，
 * 那正是「用坏抽象换重复」。它们作为 `actions` 插槽由页面原样传进来。
 */

/** 预览用的节点：两种来源在适配器里都收敛到这三格。 */
export interface PreviewNode {
  /** 节点名。后端叫 `node_name`，预设叫 `name`。 */
  name: string;
  /** 所属司/殿。后端叫 `court_code`，预设叫 `court`。 */
  court?: string;
  /**
   * `NodeType` 成员。后端行里已经是成员（经过 ChoiceField），预设行里是中文
   * 步骤名，必须先过 `nodeTypeFor`——见 `presetPreviewModel`。
   */
  nodeType?: string;
}

/** 预览用的模板。两种来源的唯一交汇点。 */
export interface TemplatePreviewModel {
  name: string;
  civilization: string;
  caseType?: string;
  description?: string;
  nodeCount: number;
  /**
   * `null` 表示这一行**没有带节点图**，不是「带了但是空的」。列表接口
   * （WorkflowTemplateListSerializer）故意不发节点图，所以已存模板在这里
   * 一律是 `null`，预览改为指路到详情弹窗。空数组则是另一回事：带了图而图是
   * 空的。两者在页面上长得不一样，所以类型上也不能混。
   */
  nodes: PreviewNode[] | null;
}

/**
 * 后端模板列表行 → 预览模型。
 *
 * `nodes_json` 只在「预设模板本地构造出来、还没落库」的对象上出现；真正从
 * `GET /workflow/templates/` 回来的行没有它（见 `WorkflowTemplateListItem`
 * 上的注释）。所以这里 `undefined` → `null`，页面显示「去详情看节点」。
 *
 * `node_count` 是列表行唯一真有的那个数；`??` 后面那半是给不带它的对象兜底，
 * 与合并前逐字一致。
 */
export function backendPreviewModel(tmpl: WorkflowTemplateListItem): TemplatePreviewModel {
  return {
    name: tmpl.name,
    civilization: tmpl.civilization,
    caseType: tmpl.case_type,
    description: tmpl.description,
    nodeCount: tmpl.node_count ?? (tmpl.nodes_json || []).length,
    nodes: tmpl.nodes_json
      ? tmpl.nodes_json.map((node: FlowNode) => ({
          name: node.node_name,
          court: node.court_code,
          nodeType: node.node_type,
        }))
      : null,
  };
}

/**
 * 预设模板 → 预览模型。
 *
 * `nodeTypeFor` 就在这一行上：`workflow.node_type` 这个 bundle 只有 trial /
 * evaluation / appeal / final / execution 五个键，直接把 `n.type`
 * （「分流」「初审」…）交给 `<DomainEnum>` 会让 56 个预设节点整列显示
 *「未识别取值」；而同一个未映射的值经「编辑」存下去就是
 * `POST /workflow/templates/ -> 400`。预览与保存走同一张表，看到的类型才和
 * 存下去的是同一个。`src/__tests__/TemplatePreview.test.tsx` 断言这一格显示的
 * 是成员、并且断言中文步骤名**不出现**在任何 `title` 上。
 */
export function presetPreviewModel(tmpl: PresetTemplate): TemplatePreviewModel {
  return {
    name: tmpl.name,
    civilization: tmpl.civilization,
    caseType: tmpl.caseType,
    description: tmpl.description,
    nodeCount: tmpl.nodes.length,
    nodes: tmpl.nodes.map((n) => ({
      name: n.name,
      court: n.court,
      nodeType: nodeTypeFor(n.type),
    })),
  };
}

export function TemplatePreview({
  model,
  actions,
}: {
  model: TemplatePreviewModel;
  /** 这份模板能做的事。见文件头：按结果分流的按钮不进组件。 */
  actions?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div>
          {/* 06 是区块标题那一档。 */}
          <h3 className="text-06 text-[hsl(var(--color-ink))]">{model.name}</h3>
          <div className="flex gap-2 mt-1">
            {/* A civilization is an identity, which is the documented
                meaning of `pill` here; the case type is a classification
                and stays square. */}
            <Badge tone="accent" shape="pill">
              <DomainEnum namespace="workflow.civilizations" value={model.civilization} />
            </Badge>
            <Badge>
              <DomainEnum namespace="workflow.case_types" value={model.caseType} />
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">{actions}</div>
      </div>
      <p className="text-03 text-[hsl(var(--color-ink-muted))] mb-4">
        {model.description || t("workflow.no_description")}
      </p>
      <div className="text-02 text-[hsl(var(--color-ink-subtle))] mb-3">
        {t("workflow.nodes_count", { count: String(model.nodeCount) })}
      </div>
      {model.nodes ? (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {model.nodes.map((node, idx) => (
            <div key={idx} className="flex items-center gap-3 p-2 bg-[hsl(var(--color-surface-2))]">
              {/* `rounded-full` survives the corner purge: a round mark is an
                  identity token, which an ordinal step number is. */}
              <span className="w-6 h-6 rounded-full bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))] flex items-center justify-center text-02 font-medium shrink-0">
                {idx + 1}
              </span>
              <span className="text-03 text-[hsl(var(--color-ink))]">{node.name}</span>
              <span className="text-[hsl(var(--color-ink-subtle))]">·</span>
              <span className="text-02 text-[hsl(var(--color-ink-muted))]">{node.court}</span>
              <span className="text-[hsl(var(--color-ink-subtle))]">·</span>
              <span className="text-02 text-[hsl(var(--color-ink-muted))]">
                <DomainEnum namespace="workflow.node_type" value={node.nodeType} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        // Saved backend templates arrive from WorkflowTemplateListSerializer,
        // which carries node_count but not the node graph itself — a per-list-row
        // node breakdown would mean shipping every template's full graph on one
        // list request. Predefined (not-yet-saved) templates still come with
        // nodes_json inline and keep the detail list above.
        <p className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("workflow.view_to_see_nodes")}</p>
      )}
    </>
  );
}
