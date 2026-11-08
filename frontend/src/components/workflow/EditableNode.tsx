"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  type EdgeProps,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import { useI18n } from "@/src/contexts/I18nContext";
import { courtLabel } from "@soulledger/core/domain/courts";
import { AUTO_ROUTE_GLYPH, EXIT_HANDLE_PREFIX, KIND_GLYPH, ROLE_GLYPH, type Branch, type NodeRole } from "@/src/components/workflow/workflowValidation";

/**
 * A workflow node on the canvas — design C · 03 「画布节点 FlowNode」.
 *
 * MEMOISED, and it is the first thing xyflow's own performance guidance asks
 * for. Nodes are real DOM elements and React Flow re-renders every custom node
 * on any viewport change unless the component is wrapped — so without this,
 * dragging one node re-rendered all of them, once per frame. `nodeTypes` is
 * already module-scope (a fresh object each render would defeat this
 * entirely), so the memo was the only piece missing.
 *
 * v4 第十四批 §2: 176 wide, 62 high (84 with the issue line), padding 9/12/10, radius 6. Line 1 (12/16, sub):
 * the ROLE glyph in the civilization accent (▷ entry, □ step, ◇ branch, ■ end — derived, see
 * `workflowValidation.ts`) · the KIND glyph and name · the stage code (`NodeType`, mono); the annotation at the
 * right (timeout「24h」or the 会签 threshold「2/3」). Line 2 (14/20, 600): the display name, ellipsised.
 *
 * Ground: dark `surface-2` with a 1 px `line` inner edge and no shadow; light `surface-1` with the card shadow
 * (`--shadow-card`). `.light` is matched as an ancestor class (`[.light_&]`) because xyflow's root carries `.dark`
 * (`colorMode="dark"`, see WorkflowEditor), so the `dark:` variant is true everywhere inside the canvas.
 *
 * States — told apart by SHAPE, not colour (地府's accent is itself red, next to the error colour):
 *   - hover     → the inner edge turns `sub`.
 *   - selected  → a 2 px accent ring 2 px out, and a 10 px dot showing on each side.
 *   - issues    → a 1.5 px danger inner edge, an 18 px「!」badge on the top-right corner (ringed in the canvas
 *                 colour so it reads on the edge), and a third line: rule + 16 px「!」+ the short reason
 *                 (`issue_short.<code>`). Never colour alone.
 *   - dragging  → `shadow-raised` (v4 `--shadowPop`) and −1°.
 */
type CardData = {
  label: string;
  /** English beside `label`; blank = show `label`. */
  labelEn?: string;
  nodeType: string;
  courtCode: string;
  approverRole: string;
  role?: NodeRole;
  ordinal?: number;
  issueCount?: number;
  /** The codes of this node's issues, in `validateFlow` order; the first one is the card's short line. */
  issueCodes?: string[];
  /** 自动分流(`isAutoRoute`,第四十五批):「▷◇ 自动 · 无审批人」+ ⇉。 */
  autoRoute?: boolean;
  /** 自动分流没连的出口(第四十七批 W-1):地域码与显示名。 */
  unconnected?: { region: string; label: string }[];
  [key: string]: unknown;
};

const PORT =
  "w-[7px]! h-[7px]! min-w-0! min-h-0! rounded-none! border! border-[oklch(var(--color-block))]! bg-[oklch(var(--color-canvas))]!";

function EditableNodeComponent({
  data,
  selected,
  dragging,
}: {
  data: CardData;
  selected: boolean;
  dragging?: boolean;
}) {
  const { t, locale } = useI18n();
  const shownLabel = (locale === "en" && data.labelEn) || data.label;
  const role = data.role ?? "step";
  const issues = data.issueCount ?? 0;
  const kind = data.kind === "COUNTERSIGN" || data.kind === "NOTIFY" || data.kind === "END" ? data.kind : "APPROVAL";
  const signers = Array.isArray(data.signers) ? data.signers.length : 0;
  const threshold = typeof data.threshold === "number" ? data.threshold : signers;
  const hours = typeof data.timeoutHours === "number" && data.timeoutHours > 0 ? `${data.timeoutHours} h` : "";
  // 右端附注:会签的门槛 k/n,否则超时时长(v4 第十四批)。殿名不上卡片 —— 在检查器与可访问名称里。
  const meta = kind === "COUNTERSIGN" && signers > 0 ? `${threshold}/${signers}` : hours;
  const firstCode = data.issueCodes?.[0];
  // 卡片放不下带「{{node}}」的整句,用短句(第十四批取舍 6)。自动分流缺出口没有短句:卡片下的短桩已经画出缺哪条。
  const short =
    firstCode && firstCode !== "auto_route_exit_missing"
      ? t(`workflow.editor.issue_short.${firstCode}`)
      : t("workflow.editor.node_issue_count", { n: String(issues) });
  const bad = issues > 0;
  const stage = typeof data.nodeType === "string" ? data.nodeType : "";

  return (
    <div
      data-role={role}
      data-issues={bad ? issues : undefined}
      title={courtLabel(t, data.courtCode, locale) || undefined}
      className={`group/card relative w-[176px] min-h-[62px] pt-[9px] px-3 pb-[10px] rounded-panel bg-[oklch(var(--color-surface-2))] [.light_&]:bg-[oklch(var(--color-surface-1))] [.light_&]:shadow-(--shadow-card) text-[oklch(var(--color-ink))] cursor-pointer transition-[outline-color,border-color,rotate] duration-state ${
        bad
          ? "border-[1.5px] border-[oklch(var(--color-danger))]"
          : "border border-[oklch(var(--color-line))] hover:border-[oklch(var(--color-ink-muted))]"
      } ${selected ? "outline-2 outline-offset-2 outline-[oklch(var(--color-accent))]" : ""} ${
        dragging ? "shadow-raised! -rotate-1" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} className={PORT} />
      {/* 选中:左右各露出一个 10px 的圆点,压在外环上 —— 与出错的红内边按形状分开,不只靠颜色。 */}
      {selected && (
        <>
          <span aria-hidden="true" data-selected-dot="" className="absolute top-1/2 -left-[8px] -translate-y-1/2 size-2.5 rounded-circle bg-[oklch(var(--color-accent))]" />
          <span aria-hidden="true" data-selected-dot="" className="absolute top-1/2 -right-[8px] -translate-y-1/2 size-2.5 rounded-circle bg-[oklch(var(--color-accent))]" />
        </>
      )}
      {bad && (
        <span
          data-issue-badge=""
          title={t("workflow.editor.node_issue_count", { n: String(issues) })}
          className="absolute -top-[9px] -right-[9px] flex size-[18px] items-center justify-center rounded-circle bg-[oklch(var(--color-danger))] text-2xs font-semibold text-[oklch(var(--color-on-danger))] ring-2 ring-[oklch(var(--color-canvas))]"
        >
          !
        </span>
      )}
      {/* 第一行(12/16,sub):角色字形(强调色)· 类型字形与名称 · 流程代号;右端附注 */}
      <div className="flex items-center justify-between gap-2 text-xs leading-4 text-[oklch(var(--color-ink-muted))]">
        <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          {data.autoRoute ? (
            // Design W-3:它总有分支,所以带 ◇;在入口时前面还有 ▷。没有审批人,写明「自动」。
            <span data-auto-route="">
              <span aria-hidden="true" className="text-[oklch(var(--color-accent))]">
                {role === "branch" ? ROLE_GLYPH.branch : `${ROLE_GLYPH[role]}${ROLE_GLYPH.branch}`}
              </span>{" "}
              {t("workflow.editor.auto_route.badge")}
            </span>
          ) : (
            <span title={t(`workflow.editor.role.${role}`)}>
              <span aria-hidden="true" className="text-[oklch(var(--color-accent))]">{ROLE_GLYPH[role]}</span>{" "}
              <span aria-hidden="true">{KIND_GLYPH[kind]}</span> {t(`workflow.editor.kind.${kind}`)}
            </span>
          )}
          {stage && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono truncate">{stage}</span>
            </>
          )}
        </span>
        {meta && <span className="shrink-0 font-mono">{meta}</span>}
      </div>
      {/* 第二行(14/20,600):显示名,放不下省略 */}
      <div className="mt-0.5 truncate text-sm leading-5 font-semibold" title={shownLabel}>
        {data.autoRoute && (
          <span aria-hidden="true" title={t("workflow.editor.auto_route.kind")}>
            {AUTO_ROUTE_GLYPH}{" "}
          </span>
        )}
        {shownLabel}
      </div>
      {/* 出错时多一行:分隔线 + 16 圆「!」+ 短说明(12/16,neg)。 */}
      {bad && (
        <div data-issue-line="" className="mt-2 flex items-center gap-[6px] border-t border-[oklch(var(--color-line))] pt-[6px] text-xs leading-4 text-[oklch(var(--color-danger))]">
          <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-circle border border-current text-2xs font-semibold">
            !
          </span>
          <span className="truncate" title={short}>{short}</span>
        </div>
      )}
      {/* 第四十七批 W-1:没连的出口画成短桩 + 空心方端点,标签虚线框写「欧洲 · 未连」,「未连」用 danger 色。
          从下方的通过端口拖到节点即连上(连上的那条按地域归位,见 setAutoRouteTarget);也可在检查器里选。 */}
      {data.autoRoute && (data.unconnected ?? []).length > 0 && (
        <ul data-unconnected-exits="" className="absolute left-0 right-0 top-full mt-3 flex justify-center gap-1">
          {(data.unconnected ?? []).map(({ region, label }) => (
            <li key={region} className="flex flex-col items-center">
              <span aria-hidden="true" className="w-px h-2 bg-[oklch(var(--color-ink-muted))]" />
              {/* 空心端点就是这条出口的连接点:从它拖到节点,接上的就是这一条。 */}
              <Handle
                id={`${EXIT_HANDLE_PREFIX}${region}`}
                type="source"
                position={Position.Bottom}
                title={label}
                className="relative! inset-auto! transform-none! w-3! h-3! min-w-0! min-h-0! rounded-none! border! border-[oklch(var(--color-ink-muted))]! bg-[oklch(var(--color-canvas))]!"
              />
              <span className="mt-1 px-1 whitespace-nowrap border border-dashed border-[oklch(var(--color-line-strong))] text-2xs normal-case tracking-normal text-[oklch(var(--color-ink-muted))]">
                {label} · <span className="text-[oklch(var(--color-danger))]">{t("workflow.editor.auto_route.no_target")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* TWO source handles, not one, and the ids are the routing.
          A single handle could only ever say "next"; the engine distinguishes
          where a flow goes when this node PASSES from where it goes when it is
          REFUSED (`ApprovalNode.on_pass` / `on_fail`), and an edge has to be
          able to say which it is. `sourceHandle` is what `getTemplateNodes`
          reads back.

          Square ports, as drawn; the FAIL port is dashed because every edge
          leaving it is drawn dashed — the pair is told apart by line, not by
          colour, and by the title on hover. */}
      {/* 结束 has no way out, and 通知 cannot fail — nobody decides it — so
          neither offers a port the engine would never follow. */}
      {kind !== "END" && (
        <Handle
          id="pass"
          type="source"
          position={Position.Bottom}
          style={{ left: kind === "NOTIFY" ? "50%" : "30%" }}
          className={PORT}
          title={t("workflow.editor.branch.pass")}
        />
      )}
      {kind !== "END" && kind !== "NOTIFY" && (
        <Handle
          id="fail"
          type="source"
          position={Position.Bottom}
          style={{ left: "70%" }}
          className={`${PORT} border-dashed!`}
          title={t("workflow.editor.branch.fail")}
        />
      )}
    </div>
  );
}

const EditableNode = memo(EditableNodeComponent);
EditableNode.displayName = "EditableNode";

export const nodeTypes: NodeTypes = {
  editableNode: EditableNode,
};

/**
 * 「连线 Edge」: a 1 px right-angle polyline. PASS solid, FAIL dashed — the
 * FAIL route is the conditional one (an unrouted FAIL ends the flow, so a FAIL
 * edge exists only where someone chose a branch). The colour and width come
 * from `edgeArrow()` in `workflowEditorGraph.ts`, the one source for both.
 *
 * Labelled beside the LAST vertical segment, the one that drops into the
 * target, so a label never sits on the horizontal run two branches share.
 * Only branches are labelled: every FAIL edge, and a PASS edge whose source
 * also has a FAIL edge (`data.labelled`, computed in the editor). A plain
 * chain carries no words.
 */
type RouteData = {
  branch?: Branch;
  labelled?: boolean;
  conditionText?: string;
  isDefault?: boolean;
  active?: boolean;
  /** Into or out of the selected node (v4 第十四批): 2 px in the civilization accent. */
  highlight?: boolean;
  /** 自动分流的出口:地域名(欧洲 / 亚洲 / 不详),实线,不写「是 / 否 · 默认」(第四十五批)。 */
  regionText?: string;
};

/**
 * 方向箭头:一个**内联**的 `<polygon>`,尖端落在目标端口上,填充取边自己的 stroke。
 * 不用 `markerEnd`:xyflow 把 marker 放进独立的 `<defs>` 树,`oklch(var(--…))` 在那里
 * 画不出来(p3b 遗留)。内联多边形与边同在文档 `:root` 下,var 解析、随主题实时切换。
 * 下面的角度把「底边朝上、尖朝下」的基形转到从哪一侧进入目标。
 */
const ARROW_ROTATION: Record<string, number> = {
  [Position.Top]: 0,
  [Position.Right]: 90,
  [Position.Bottom]: 180,
  [Position.Left]: 270,
};

function RouteEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps) {
  const { t } = useI18n();
  const route = (data ?? {}) as RouteData;
  const [path, , labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 0,
  });
  const fail = route.branch === "fail";
  const y = (labelY + targetY) / 2;
  // The exit the inspector's 出口 section is on, and every edge into or out of the selected node: 2 px in the
  // civilization accent, fully opaque (v4 第十四批). The rest keep `edgeArrow()`'s 1.4 px sub at .7.
  const lit = route.active || route.highlight;
  const stroke = lit ? "oklch(var(--color-accent))" : style?.stroke;
  const opacity = lit ? 1 : style?.opacity;
  const conditional = !fail && route.regionText === undefined && (route.conditionText !== undefined || route.isDefault);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, stroke, opacity, strokeWidth: lit ? 2 : style?.strokeWidth, strokeDasharray: fail ? "4 4" : undefined }}
      />
      <polygon
        data-edge-arrow=""
        points={`${targetX - 4},${targetY - 6} ${targetX + 4},${targetY - 6} ${targetX},${targetY}`}
        transform={`rotate(${ARROW_ROTATION[targetPosition] ?? 0} ${targetX} ${targetY})`}
        style={{ fill: stroke, opacity }}
      />
      {route.labelled && (
        <EdgeLabelRenderer>
          {/* 20 高的小胶囊,11 号字,卡片底加细边;被高亮的那条字与边换成强调色。 */}
          <span
            data-edge-label=""
            className={`absolute pointer-events-none flex h-5 items-center rounded-full border px-2 text-2xs normal-case tracking-normal bg-[oklch(var(--color-surface-1))] ${
              conditional ? "font-mono" : ""
            } ${
              lit
                ? "text-[oklch(var(--color-accent))] border-[oklch(var(--color-accent))]"
                : "text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-line))]"
            }`}
            style={{ transform: `translate(0, -50%) translate(${targetX + 6}px, ${y}px)` }}
          >
            {fail
              ? t("workflow.editor.branch.fail")
              : route.regionText !== undefined
                ? route.regionText
                : route.conditionText
                  ? `${t("workflow.editor.condition.yes")} · ${route.conditionText}`
                  : route.isDefault
                    ? `${t("workflow.editor.condition.no")} · ${t("workflow.editor.condition.default")}`
                    : t("workflow.editor.branch.pass")}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes: EdgeTypes = {
  route: memo(RouteEdgeComponent),
};
