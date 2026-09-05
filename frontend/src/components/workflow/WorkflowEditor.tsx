"use client";

import { useCallback, useState, useEffect, useId, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
/**
 * WHAT gsap COSTS HERE, MEASURED, SO THE TRADE CAN BE RE-JUDGED LATER.
 *
 * This editor is code-split (`LazyWorkflowEditor`), so the bill lands on this
 * route and no other. Built with gsap installed but not imported, then with:
 *
 *     raw    223,658 → 318,888    +95,230  (+42.6%)
 *     gzip    70,376 → 105,905    +35,529  (+50.1%)
 *
 * Half again, in gzip, for one transition. It was approved on the grounds that
 * a re-layout without it tells the operator nothing about which node went
 * where — information, not decoration — and that reasoning stands only while
 * this stays the single animated thing in the file. It is the whole of the
 * project's animation budget; the next one has to argue against this number
 * rather than against zero.
 *
 * Core + Flip only. Verified by grepping the built chunk: the one
 * `ScrollTrigger` hit is gsap-core's optional-hookup name lookup, and the
 * `Draggable`/`Observer` hits are react-flow's own `nodesDraggable` and
 * `ResizeObserver`. No MorphSVG, SplitText, ScrollSmoother, MotionPath,
 * Inertia or DrawSVG rides along.
 */
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Connection,
  addEdge,
  NodeChange,
  EdgeChange,
  BackgroundVariant,
  Panel,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi } from "@soulledger/core/api";
import {
  CIVILIZATION_OPTIONS,
  isCivilizationOption,
  type CivilizationOption,
} from "@soulledger/core/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
// Both stay under src/components/workflow/ deliberately: xyflow renders
// `markerEnd` into a standalone <marker> defs tree where `hsl(var(--…))` does
// not resolve, so the literal hex values here are a ruled exception — and
// eslint.config.mjs's HEX_ALLOW grants it by PATH PREFIX. A file of this
// editor's moved anywhere else goes red on its first arrow colour.
import { nodeTypes } from "@/src/components/workflow/EditableNode";
import {
  NodeEditModal,
  type NodeDataUpdates,
  type NodeEditData,
} from "@/src/components/workflow/NodeEditModal";
import { useToast } from "@/src/contexts/ToastContext";
import { QueryError } from "@/src/components/ui/PageError";
import {
  appendPosition,
  edgeArrow,
  layoutNodes,
  presetTemplateToFlow,
  savedTemplateToFlow,
  NODE_WIDTH,
  NODE_HEIGHT,
  type TemplateNode,
} from "@/src/components/workflow/workflowEditorGraph";

// Re-exported, not relocated as far as callers are concerned: `TemplateNode`
// has been part of this module's surface since before the split.
export type { TemplateNode };

// Guarded rather than bare: this module is imported during Next's prerender of
// `/workflow`, and plugin registration has no meaning without a document.
// `registerPlugin` is idempotent, so running it once per module evaluation is
// the whole of the setup.
if (typeof window !== "undefined") {
  gsap.registerPlugin(Flip);
}

/**
 * How long a node takes to travel to its new place.
 *
 * Long enough to be followed by eye across the width of the canvas, short
 * enough that pressing the button twice is not a wait. It is the only tunable
 * in this animation; there is deliberately no stagger, no entrance and no
 * easing on anything that did not move, because the ONE thing this transition
 * exists to say is "that card went there".
 */
const LAYOUT_TRAVEL_SECONDS = 0.45;

/**
 * The operator asked their OS for no motion, so the re-layout is instant.
 *
 * `app/globals.css` already collapses every CSS animation and transition to
 * 1ms under this same query, and that rule DOES NOT REACH THIS ANIMATION:
 * gsap writes `transform` from JavaScript on a `requestAnimationFrame` loop,
 * which no stylesheet can shorten. So the preference has to be read here, in
 * JS, or the one animation in this app that moves a large object across the
 * screen would be the one animation the accessibility rule misses.
 *
 * Read at click time rather than subscribed to: a `matchMedia` listener would
 * need a `useEffect` and would answer the same question one press later.
 * `window.matchMedia` is guarded because this function is also reachable from
 * a test environment that does not implement it.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The rectangle a set of nodes occupies, in the LAYOUT's own coordinates —
 * the same space `layoutNodes` returns and `position` is written in, with no
 * viewport `translate`/`scale` in it.
 *
 * The size fallbacks match `workflowEditorGraph.ts`'s own `sizeOf`: xyflow's
 * `measured` after a render, the assumed card otherwise. This is called with
 * `layoutNodes`'s output, which carries `measured` through unchanged from the
 * nodes it was given, so on the button's path the numbers are the real ones.
 */
function layoutBounds(nodes: Node[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const w = n.measured?.width ?? NODE_WIDTH;
    const h = n.measured?.height ?? NODE_HEIGHT;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Would `bounds` be wholly on screen, under the viewport the operator is
 * currently looking through?
 *
 * xyflow's viewport is `translate(x, y) scale(zoom)`, so a layout coordinate
 * lands at `coord * zoom + offset` in the pane's own pixels. The pane spans
 * `[0, width] × [0, height]`.
 *
 * INCLUSIVE AT THE BOUNDARY, deliberately: a graph whose left edge is exactly
 * at 0 or whose right edge is exactly at the pane width is fully visible, and
 * fitting it would move the viewport to show something the operator can
 * already see. The comparison is `>= 0` / `<= size` and not a tolerance,
 * because there is no measurement noise here — both sides are numbers this
 * module computed, not rects read back off the DOM.
 */
function fitsInside(
  bounds: { x: number; y: number; width: number; height: number },
  viewport: { x: number; y: number; zoom: number },
  pane: { width: number; height: number }
): boolean {
  const left = bounds.x * viewport.zoom + viewport.x;
  const top = bounds.y * viewport.zoom + viewport.y;
  const right = (bounds.x + bounds.width) * viewport.zoom + viewport.x;
  const bottom = (bounds.y + bounds.height) * viewport.zoom + viewport.y;
  return left >= 0 && top >= 0 && right <= pane.width && bottom <= pane.height;
}

/**
 * THE NODE EDIT MODAL HAD NO KEYBOARD PATH AT ALL.
 *
 * `onNodeDoubleClick` was the only way in, so an operator without a mouse could
 * not edit a single node of a template. What follows is the way in; `E` is the
 * key, and every part of that choice is load-bearing:
 *
 *   - NOT Enter and NOT Space. `@xyflow/system` exports
 *     `elementSelectionKeys = ['Enter', ' ', 'Escape']` and the node wrapper's
 *     own `onKeyDown` (index.mjs ~2173) hands those three to `handleNodeClick`.
 *     Claiming Enter or Space would mean either fighting that handler or
 *     replacing it, and replacing it also costs the arrow-key node nudging it
 *     implements in the same function.
 *   - A single letter, because that is the scheme this app already has:
 *     `JudgmentQueueConsole.tsx` rules a verdict on 1/2/3/4 and takes U, W, R,
 *     N, S and H. `E` collides with none of them, and the two surfaces are
 *     never on screen together anyway.
 *
 * The guards below are `JudgmentQueueConsole.tsx`'s, deliberately the same
 * shape rather than a second convention: modifiers out first, then text entry.
 */
const EDIT_NODE_KEY = "e";

/**
 * `aria-keyshortcuts` announces `E` on every node, which is the half of
 * discoverability that reaches a screen reader. The visible half is the `<kbd>`
 * in the hint Panel below.
 *
 * Passed through `domAttributes` — xyflow spreads it onto the wrapper AFTER its
 * own attributes (index.mjs 2240). That ordering is why this object carries
 * nothing else: anything xyflow already sets there would be silently replaced
 * rather than merged. It cannot carry `onKeyDown` in any case — the react
 * `Node` type omits `keyof DOMAttributes` from `domAttributes`, so every DOM
 * event handler is excluded by the type, not merely by convention.
 *
 * Module scope so the identity never changes; `<ReactFlow nodes>` is diffed.
 */
const NODE_DOM_ATTRIBUTES = { "aria-keyshortcuts": "E" } as const;

/**
 * The accessible name of one card, built out of what the card already shows.
 *
 * The three fields are the ones `EditableNode.tsx` renders as text, IN THAT
 * ORDER, and the node type is the RAW member (`TRIAL`) because that is what the
 * card displays — a translated name here would leave the accessible name
 * saying something the visible label does not (WCAG 2.5.3). Nothing here is new
 * copy, so no bundle key was added.
 *
 * `, ` and not the ` · ` this file uses elsewhere: the node names in the shipped
 * presets ARE middot-separated ("秦广王 · 分流"), so a middot join produces
 * "秦广王 · 分流 · TRIAL · 第一殿", in which the field boundaries are
 * unrecoverable. A comma is also where screen readers pause.
 *
 * FALLS BACK TO THE ID AND NEVER TO "". An empty `aria-label` is worse than no
 * `aria-label`: it silences the element's other naming paths instead of
 * deferring to them, so a node whose fields are all blank would announce as
 * nothing at all. `presetTemplateToFlow` defaults `label` to `""`, so that node
 * is reachable, not hypothetical.
 */
function nodeAriaLabel(node: Node): string {
  const parts = [node.data.label, node.data.nodeType, node.data.courtCode]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return parts.length > 0 ? parts.join(", ") : node.id;
}

export interface WorkflowTemplateInput {
  name: string;
  description: string;
  civilization: CivilizationOption;
  case_type: string;
  /**
   * 本模板默认的急缓：0=普通, 1=紧急, 2=危急。对应后端
   * `WorkflowTemplate.priority`，是 `ApprovalWorkflow.priority` 的默认值——
   * 建流程时调用方没有显式指定，就落到这个值。
   *
   * 它必须在 POST 的 body 里，否则 DRF 会把这个键**静默丢掉**并照样答 201：
   * 预设里写着 `priority: 1` 的三套「紧急审判流程」会存成 0，而没有任何地方
   * 会报错。
   */
  priority: number;
  nodes: TemplateNode[];
}

export default function WorkflowEditor({
  templateId,
  initialTemplateData,
  onClose,
  onSave,
}: {
  templateId?: string;
  initialTemplateData?: any;
  onClose?: () => void;
  onSave?: (template: WorkflowTemplateInput) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Unique prefix so field ids never collide across multiple
  // WorkflowEditor instances mounted at once.
  const formId = useId();
  const templatePriorityId = `${formId}-template-priority`;

  // State
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesStateChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editData, setEditData] = useState<NodeEditData | null>(null);

  // Form state - initialized from query data
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  // GREEK is in the union because `GREEK_ROUTINE` is one of the presets this
  // editor can be opened with. The two guards below only call `setTemplateCiv`
  // for a value they recognise and otherwise leave the state at its "CHINESE"
  // default — so omitting a civilization here does not fail, it silently
  // relabels somebody else's flow, and saving would file Aeacus, Rhadamanthus
  // and Plato's Minos under the Chinese ten courts.
  const [templateCiv, setTemplateCiv] = useState<CivilizationOption>("CHINESE");
  const [templateCaseType, setTemplateCaseType] = useState("ROUTINE");
  // 0=普通 by default, the same floor the model column has.
  const [templatePriority, setTemplatePriority] = useState(0);

  // Load existing template if editing
  //
  // `isError` and `isLoading` are destructured because the SAVE PATH DEPENDS ON
  // THEM. This query used to hand back `data` alone, and the failure then read
  // like this: the GET 404s or 500s, the populate effect below never fires
  // because `existingTemplate` stays undefined, and the editor renders a blank
  // canvas with a blank name — indistinguishable from "new template". But
  // `templateId` is still set, so `saveMutation` takes its `update` branch
  // (:296) and 保存模板 is enabled. One click PUTs a nameless, node-less
  // template over the real one. A failed READ turning into a destructive WRITE
  // is the whole defect; the blank canvas is only how it looks.
  //
  // The pattern is already in this component's own parent —
  // `app/workflow/page.tsx:394` guards the instances list with
  // `isWorkflowsError ? <QueryError onRetry={…}/>`. The editor is the branch
  // next to it that never got the same treatment.
  //
  // `isLoading` rather than `isPending`: with `enabled: !!templateId` a
  // disabled query sits at `isPending: true` forever, so `isPending` would
  // disable saving on the NEW-template path too — the one path where there is
  // nothing to overwrite and nothing to wait for.
  const {
    data: existingTemplate,
    isError: isTemplateError,
    isLoading: isTemplateLoading,
    refetch: refetchTemplate,
  } = useQuery({
    queryKey: ["workflow-template", templateId],
    queryFn: async () => {
      const res = await workflowApi.templates.get(templateId!);
      return res.data;
    },
    enabled: !!templateId,
  });

  // Populate form when template loads - use ref to track initialization
  const initRef = useRef(false);

  // The canvas, so the auto-layout transition can find the node wrappers
  // without reaching across the whole document — two editors can be mounted at
  // once (the same reason `formId` exists), and a `document.querySelectorAll`
  // here would animate the other one's cards too.
  const canvasRef = useRef<HTMLDivElement>(null);
  /**
   * xyflow's own instance, the only way to read or write the viewport.
   *
   * Captured from `onInit` rather than `useReactFlow()`: that hook has to be
   * called UNDER a provider, and this component is the one rendering
   * `<ReactFlow>` — the provider `<ReactFlow>` mounts internally is its child,
   * not its ancestor. Reaching the hook would mean splitting this component in
   * two around a `<ReactFlowProvider>`; `onInit` hands over the same object
   * with no re-shaping of the tree.
   *
   * Stays null wherever `<ReactFlow>` is stubbed (the three jest suites), and
   * every read of it is guarded — the viewport is not a thing jsdom has.
   */
  const flowRef = useRef<ReactFlowInstance | null>(null);
  // The running travel, kept so a second press can interrupt it and so an
  // editor that unmounts mid-flight does not leave gsap writing to detached
  // nodes.
  const layoutFlipRef = useRef<gsap.core.Timeline | null>(null);

  /**
   * Whether a layout travel is in flight. Drives two things and nothing else:
   * the "re-arranging" status beside the button, and the dimming of the edges
   * (see the ReactFlow wrapper). NOT a loading flag — `layoutNodes` is
   * synchronous and has already finished by the time this turns true; the
   * 450ms is travel, not waiting, and calling it "loading" would tell the
   * operator something untrue.
   */
  const [relayouting, setRelayouting] = useState(false);

  /**
   * Stop a travel in flight, WITHOUT winding it to its end.
   *
   * THIS EXISTS BECAUSE `.kill()` USED TO LIVE IN ONLY TWO PLACES — unmount
   * and `autoLayout` itself — while four other handlers mutate the same nodes
   * gsap is mid-way through animating: `addNode`, `deleteSelectedNode`,
   * `updateNodeData` and `onConnect` all `setNodes`/`setEdges` and none of
   * them stopped the tween. Delete a node 200ms into a travel and gsap keeps
   * writing transforms toward the old target — on a wrapper xyflow has since
   * re-keyed or removed. Every mutation entry point calls this first now.
   *
   * `kill()` and not `progress(1)`: winding to the end would plant the cards
   * at coordinates the mutation is about to invalidate anyway.
   */
  const stopLayoutTravel = useCallback(() => {
    layoutFlipRef.current?.kill();
    layoutFlipRef.current = null;
    setRelayouting(false);
  }, []);

  useEffect(() => {
    return () => {
      layoutFlipRef.current?.kill();
    };
  }, []);

  // Reset init flag when templateId changes
  useEffect(() => {
    initRef.current = false;
  }, [templateId]);

  // Populate form when template loads or templateId changes
  useEffect(() => {
    if (!initRef.current && existingTemplate) {
      initRef.current = true;
      const civ = existingTemplate.civilization;
      setTemplateName(existingTemplate.name || "");
      setTemplateDescription(existingTemplate.description || "");
      // Validate civilization value against the one list, not a hand-written
      // or-chain: an unrecognised value leaves the state at its "CHINESE"
      // default, so a member missing from the check is a silent relabelling.
      if (isCivilizationOption(civ)) {
        setTemplateCiv(civ);
      }
      setTemplateCaseType(existingTemplate.case_type || "ROUTINE");
      // `?? 0`, not `|| 0`: they agree today, but `||` would also swallow a
      // genuine 0 if the scale ever grew a falsy member, and reading a stored
      // priority is exactly the place a silent 0 costs the most.
      setTemplatePriority(existingTemplate.priority ?? 0);

      const flow = savedTemplateToFlow(existingTemplate.nodes || []);
      setNodes(flow.nodes);
      setEdges(flow.edges);
    }
  }, [existingTemplate, templateId, setNodes, setEdges]);

  // Handle initial template data (for predefined templates)
  useEffect(() => {
    if (!initRef.current && initialTemplateData && !templateId) {
      initRef.current = true;
      const civ = initialTemplateData.civilization;
      setTemplateName(initialTemplateData.name || initialTemplateData.templateName || "");
      setTemplateDescription(initialTemplateData.description || initialTemplateData.templateDescription || "");
      if (isCivilizationOption(civ)) {
        setTemplateCiv(civ);
      }
      setTemplateCaseType(initialTemplateData.case_type || initialTemplateData.caseType || "ROUTINE");
      // The preset's own default urgency — `priority: 1` on the three
      // 紧急审判流程 presets. Without this line the editor would open them at 0
      // and save them back at 0, which is the value the whole column exists to
      // stop being the only expressible one.
      setTemplatePriority(initialTemplateData.priority ?? 0);

      const nodesData = initialTemplateData.nodes_json || initialTemplateData.nodes || [];
      const flow = presetTemplateToFlow(nodesData);
      setNodes(flow.nodes);
      setEdges(flow.edges);
    }
  }, [initialTemplateData, templateId, setNodes, setEdges]);

  // Convert React Flow nodes to template nodes
  const getTemplateNodes = useCallback((): TemplateNode[] => {
    /**
     * The canvas edges, read back as routing.
     *
     * `sourceHandle` is what makes this possible: each node has a `pass` and a
     * `fail` source handle, so an edge already carries which outcome it
     * belongs to. Before routing existed, `onConnect` produced edges with no
     * such distinction and this function sent only `node_order` — every drawn
     * branch was discarded on save and the reload rebuilt a straight chain.
     *
     * Last edge wins per (source, handle). The canvas allows more than one
     * edge from a handle and the model holds exactly one target, so something
     * has to choose; taking the most recent matches what the operator just
     * did rather than what they did first.
     */
    const routing = new Map<string, { on_pass?: string; on_fail?: string }>();
    for (const edge of edges) {
      if (!edge.source || !edge.target) continue;
      const field = edge.sourceHandle === "fail" ? "on_fail" : "on_pass";
      const current = routing.get(edge.source) ?? {};
      routing.set(edge.source, { ...current, [field]: edge.target });
    }

    return nodes.map((n, idx) => ({
      id: n.id,
      node_name: n.data.label as string,
      node_type: n.data.nodeType as TemplateNode["node_type"],
      court_code: (n.data.courtCode as string) || "",
      approver_role: (n.data.approverRole as string) || "",
      approver_type: (n.data.approverType as TemplateNode["approver_type"]) || "ROLE",
      node_order: idx + 1,
      // `?? null`, not `|| undefined`: the serializer declares these with
      // `allow_null`, and sending null is how a node says "no route here" —
      // omitting the key would leave whatever was stored before.
      on_pass: routing.get(n.id)?.on_pass ?? null,
      on_fail: routing.get(n.id)?.on_fail ?? null,
      // Rounded because these are pixels on a canvas, not measurements: the
      // drag handler produces long floats and storing them makes every save a
      // diff even when nothing moved.
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    }));
    // `edges` belongs here, and its absence was a shipped defect rather than
    // untidiness. Memoised on `[nodes]` alone, this closure kept whatever
    // `edges` were in scope the last time `nodes` changed identity — so an
    // operator who drew a branch and hit save without also moving or editing
    // a node saved `on_pass`/`on_fail: null` and got a 201 back. Every
    // other edge-producing path (`addNode`) sets nodes in the same commit,
    // which is why it never surfaced. Pinned by
    // `src/__tests__/workflowEditorEdgeRouting.test.tsx`.
    //
    // No loop risk: this is called from `handleSave` and the mutation's
    // `onSuccess`, never from an effect, so a new identity costs nothing.
  }, [nodes, edges]);

  // Save template mutation
  const saveMutation = useMutation({
    mutationFn: async (data: WorkflowTemplateInput) => {
      if (templateId) {
        const res = await workflowApi.templates.update(templateId, data);
        return res.data;
      } else {
        const res = await workflowApi.templates.create(data);
        return res.data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
      showToast(t("workflow.editor.saved"), "success");
      onSave?.({
        name: templateName,
        description: templateDescription,
        civilization: templateCiv,
        case_type: templateCaseType,
        priority: templatePriority,
        nodes: getTemplateNodes(),
      });
    },
    onError: () => {
      showToast(t("workflow.editor.save_failed"), "error");
    },
  });

  // Add a new node
  const addNode = useCallback(() => {
    stopLayoutTravel();
    const newId = `node-${Date.now()}`;
    const newNode: Node = {
      id: newId,
      type: "editableNode",
      position: appendPosition(nodes),
      data: {
        id: newId,
        label: `${t("workflow.editor.new_node")} ${nodes.length + 1}`,
        nodeType: "TRIAL",
        courtCode: "",
        approverRole: "",
        approverType: "ROLE",
      },
    };

    // If there are existing nodes, create an edge from the last one
    const newEdges: Edge[] =
      nodes.length > 0
        ? [
            {
              id: `e${nodes[nodes.length - 1].id}-${newId}`,
              source: nodes[nodes.length - 1].id,
              target: newId,
              markerEnd: { type: MarkerType.ArrowClosed, color: "#d97706" },
              style: { stroke: "#d97706", strokeWidth: 2 },
            },
          ]
        : [];

    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) => [...eds, ...newEdges]);
    // `t` names the new node ("新节点 3"). Its identity changes only when the
    // locale changes or a lazy message bundle lands (see I18nContext's `t`,
    // memoised on `[locale, loadedBundles]`), and this is a click handler, not
    // an effect — a fresh identity re-renders one button and nothing else.
  }, [nodes, setNodes, setEdges, t, stopLayoutTravel]);

  /**
   * Bring the new layout back on screen — BUT ONLY IF IT WOULD NOT BE.
   *
   * THE DEFECT THIS CLOSES. `<ReactFlow fitView>` as a bare prop fits ONCE, on
   * init. Before dagre landed, every node sat at x: 250 in a single column, so
   * a re-layout could not push anything sideways and the init fit was enough
   * for the editor's whole life. `rankdir: "TB"` spreads branches left and
   * right, so pressing the button can now put cards outside the pane with
   * nothing to bring them back.
   *
   * WHY NOT FIT EVERY TIME, which is one line shorter. The 450ms travel exists
   * to say WHICH card went WHERE, and a zoom-and-pan on every press drowns
   * that out — the whole picture moves, so nothing in it reads as having
   * moved. A press that merely re-arranges within the visible area must leave
   * the viewport alone, and `fitsInside` is the whole of that decision.
   *
   * `fitBounds` AND NOT `fitView`. At 12.10.2 `fitView()` is ASYNC AND
   * DEFERRED — read out of the shipped bundle rather than assumed:
   * `useReactFlow`'s entry is `fitView: async (options) => { … setState({
   * fitViewQueued: true, … }); batchContext.nodeQueue.push(…) }`, and the
   * queue handler can push the actual fit into a `requestAnimationFrame`. So
   * it moves the viewport a commit or more after this handler returns, which
   * lands it squarely between the capture and the tween — see the block in
   * `autoLayout` for what that looks like on screen.
   *
   * `fitBounds` instead goes straight to `panZoom.setViewport` →
   * `setTransform`, whose `getD3Transition` returns the PLAIN selection when
   * no `duration` is given, so d3 writes the transform and xyflow's store
   * update has run before this function returns. It also takes the rectangle
   * we hand it, which lets the fit be computed from the layout we are ABOUT to
   * apply rather than the one still on screen — the thing `fitView` cannot do
   * from here at all.
   *
   * The promise is dropped on purpose. With no duration `getD3Transition`
   * calls the `onEnd` resolver immediately, so there is nothing left to wait
   * for, and awaiting would push the rest of the handler into a microtask.
   *
   * Returns nothing and mutates nothing else: callers decide whether the
   * viewport write gets its own commit (`flushSync`) or shares one.
   */
  const fitIfOverflowing = useCallback((next: Node[]) => {
    const flow = flowRef.current;
    const pane = canvasRef.current;
    // Both null under the jest stubs, which render no viewport at all.
    if (!flow || !pane || next.length === 0) return;
    const bounds = layoutBounds(next);
    const { width, height } = pane.getBoundingClientRect();
    if (fitsInside(bounds, flow.getViewport(), { width, height })) return;
    void flow.fitBounds(bounds);
  }, []);

  /**
   * Re-run the layout over everything. The ONLY thing that moves a node the
   * operator placed.
   *
   * The hydration paths lay out nodes that have no stored position and leave
   * the rest alone, on purpose — a template reloads looking exactly as it was
   * left. That makes this button the single moment in the editor's life at
   * which an already-placed node changes coordinates, which is what the
   * transition below narrates. `layoutNodes` is called with no pinned set, so
   * nothing is exempt.
   *
   * WHY THE NODES TRAVEL INSTEAD OF TELEPORTING. A re-layout of a ten-node
   * template moves nine of them at once. Teleported, the operator is shown a
   * new picture and has to re-find every card in it; the 450ms of travel is
   * the only thing that says WHICH card became which. That is the whole of the
   * justification, and it is why nothing else in this editor is animated.
   *
   * WHY `flushSync` AND NOT `useLayoutEffect`. Flip needs the old rects
   * measured before the DOM moves and the tween started after it has. The
   * obvious hook does not work here: `<ReactFlow nodes={…}>` does not position
   * anything itself — `StoreUpdater` copies the prop into xyflow's zustand
   * store from its OWN `useLayoutEffect`, and the wrappers that carry the
   * `transform` re-render from that store in a LATER pass. A `useLayoutEffect`
   * in this component runs in the same commit as that copy, i.e. one pass too
   * early, and would measure the nodes still at their old coordinates and
   * animate nothing. `flushSync` drives the whole cascade — our render,
   * StoreUpdater's effect, the store-driven re-render — to a committed DOM
   * before it returns, which is the only point at which "after" is true.
   * Verified in chromium, not reasoned about: see
   * `e2e/workflow-auto-layout-motion.spec.ts`.
   *
   * WHAT ZOOM DOES, AND WHY IT DOES NOT MATTER. `Flip.getState` records
   * `getBoundingClientRect`, which inside xyflow's `scale()`d viewport is
   * multiplied by the zoom (a 180×110 card reports 90×46 at zoom 0.5 — the
   * same trap `workflowEditorGraph.ts` records for measurement). It cancels
   * out here because capture and animation happen in ONE synchronous handler:
   * the zoom cannot change in between, so both rects are contaminated by the
   * same factor and the delta Flip derives is in the same space it applies it
   * in. gsap converts that screen-space delta into the element's own
   * coordinate space through the parent's matrix, so what lands on the wrapper
   * is xyflow's own untransformed `translate()` — asserted at zoom ≈ 0.3 by
   * the e2e above, which reads the final `transform` back and compares it to
   * the coordinates the save payload carries.
   *
   * WHAT THIS DOES NOT ANIMATE, SEEN AND ACCEPTED RATHER THAN MISSED. Only the
   * node wrappers travel. xyflow draws edges as SVG paths recomputed from its
   * store, which holds the new coordinates from the first frame, so for the
   * 450ms of travel the connectors sit at their FINAL geometry while the cards
   * are still on their way — looked at in chromium mid-flight on the ten-court
   * preset, they read as arrows a little too short to reach the card below.
   * There is no Flip-shaped fix: a path is not positioned by a transform, and
   * the alternative — re-running `setNodes` every frame so xyflow redraws the
   * edges itself — is a re-render per frame per node and stops being a Flip
   * animation at all. The cards are the subject of the sentence this
   * transition exists to say, so the cards are what moves.
   */
  const autoLayout = useCallback(() => {
    const next = layoutNodes(nodes, edges);
    // Nothing to narrate if nothing moved — pressing the button on an
    // already-laid-out canvas must not produce 450ms of theatre. `layoutNodes`
    // maps over `nodes`, so index i is the same node on both sides.
    const moved = next.some(
      (n, i) =>
        n.position.x !== nodes[i].position.x || n.position.y !== nodes[i].position.y
    );

    if (!moved || prefersReducedMotion()) {
      /*
       * ONE COMMIT, so the instant path stays instant. No `flushSync` here:
       * the viewport write and the node write are both made inside this
       * handler, React batches them, and the operator is shown the new layout
       * already framed — never the old layout at the new zoom for a frame,
       * which is the "motion" this branch exists to avoid.
       *
       * The `!moved` case fits too, and that is not an oversight. "Nothing
       * moved" only says the layout is unchanged; it says nothing about
       * whether the operator has since panned it off screen, and the button is
       * the gesture that has to bring it back. The guard above is about not
       * animating, not about not looking.
       */
      fitIfOverflowing(next);
      setNodes(next);
      return;
    }

    // The wrappers xyflow puts the position `transform` on. Scoped to this
    // editor's own canvas, not the document: two editors can be mounted at
    // once. There is deliberately NO `cards.length === 0` branch beside the
    // guard above — it was written, and then removed for failing to earn its
    // place: with it mutated out, `WorkflowEditor.test.tsx` and
    // `workflowEditorEdgeRouting.test.tsx` (whose stubs render no wrappers at
    // all, so the list really is empty there) came back 17 passed. gsap
    // handles an empty target list on its own, and a branch nothing can
    // distinguish is a branch that reads as load-bearing without being it.
    const cards = Array.from(
      canvasRef.current?.querySelectorAll<HTMLElement>(".react-flow__node") ?? []
    );

    // A second press mid-flight: kill the running tween WITHOUT winding it to
    // its end, so `getState` below records the cards where they visually are
    // and the new travel continues from there rather than from a jump.
    stopLayoutTravel();

    /*
     * THE FIT GETS ITS OWN `flushSync`, AND THAT IS THE WHOLE OF THE ORDERING.
     *
     * `Flip.getState` records SCREEN-space rects and the viewport carries its
     * own `translate()/scale()`, so the obvious worry is where the fit sits
     * relative to the capture. Five placements were run in chromium on the
     * ten-court preset zoomed to 1.49 (a temporary `window.__fitOrder` switch,
     * sampling `.react-flow__viewport`'s matrix and two cards' client rects
     * once per animation frame). The answer is not the one the question
     * expects.
     *
     * THREE OF THEM ARE INDISTINGUISHABLE, TO THE TENTH OF A PIXEL: this one;
     * the fit between `flushSync(setNodes)` and `Flip.from`; and the fit after
     * `Flip.from`. All three start card n10 travelling at y=886.7 and walk it
     * the same way, and no card's WIDTH changes at any frame. The reason is
     * the one the zoom paragraph above already gives: gsap stores the delta in
     * the element's own coordinate space, which the ancestor `scale()` divides
     * out, so it does not matter WHICH viewport capture and `Flip.from` were
     * measured under — only that it was the SAME one for both.
     *
     * WHAT BREAKS IS THE VIEWPORT COMMITTING BETWEEN THEM, and that is what
     * the `flushSync` here prevents. `fitBounds` writes xyflow's store
     * synchronously, but the `transform` on `.react-flow__viewport` is a
     * React-rendered style — so a bare `fitIfOverflowing(next)` on this line
     * leaves the commit pending, and the `flushSync(setNodes)` two lines down
     * flushes it: capture in the old viewport, `Flip.from` in the new one, and
     * the delta gsap derives is part re-layout and part camera. Measured, that
     * is not a subtle artifact — n10 sets off from y=1515 in a pane that spans
     * 289–730, i.e. the cards are flung off screen and crawl back over the
     * whole 450ms, with the edges (already at final geometry) left hanging in
     * the middle. `flow.fitView()` in place of `fitBounds` produces the same
     * wreck for the same reason, one commit later.
     *
     * So: commit the viewport, THEN capture. Of the three orderings that work,
     * this is the one whose correctness does not depend on no one ever adding
     * another `flushSync` between the capture and the tween.
     */
    flushSync(() => fitIfOverflowing(next));

    const before = Flip.getState(cards);
    setRelayouting(true);
    flushSync(() => setNodes(next));
    layoutFlipRef.current = Flip.from(before, {
      duration: LAYOUT_TRAVEL_SECONDS,
      ease: "power2.inOut",
      // `onComplete` only. `onInterrupt` would fire on the kill inside
      // `stopLayoutTravel`, which already clears the flag itself — routing it
      // through both would make the ordering of two writes matter.
      onComplete: () => setRelayouting(false),
    });
  }, [nodes, edges, setNodes, stopLayoutTravel, fitIfOverflowing]);

  // Delete selected node
  const deleteSelectedNode = useCallback(() => {
    stopLayoutTravel();
    if (!selectedNodeId) return;

    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, setNodes, setEdges, stopLayoutTravel]);

  // Handle node double-click to edit
  const handleNodeEdit = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      setEditData({
        id: nodeId,
        node_name: node.data.label as string,
        node_type: node.data.nodeType as NodeEditData["node_type"],
        court_code: (node.data.courtCode as string) || "",
        approver_role: (node.data.approverRole as string) || "",
        approver_type: (node.data.approverType as NodeEditData["approver_type"]) || "ROLE",
      });
      setEditModalOpen(true);
    }
  }, [nodes]);

  /**
   * `E` on the focused node opens that node's edit modal.
   *
   * ON THE CANVAS CONTAINER, not on the nodes and not on `window`.
   *
   *   - Not per node: xyflow's only route for that is `domAttributes`, whose
   *     type omits every DOM event handler (see `NODE_DOM_ATTRIBUTES`), and
   *     whose runtime spread happens AFTER the wrapper's own `onKeyDown` — so
   *     an `onKeyDown` smuggled past the type would REPLACE xyflow's, taking
   *     Enter/Space/Escape selection and arrow-key nudging with it. There is no
   *     `onNodeKeyDown` prop at 12.10.2; the `onNode*` surface is
   *     Click, DoubleClick, ContextMenu, the Drag trio and the Mouse trio.
   *   - Not `window`: two editors can be mounted at once (the reason `formId`
   *     and `canvasRef` exist), and a window listener in each would need an
   *     `activeElement` check to work out whose node was focused. Bubbling
   *     gives that scoping for free — the event only arrives here if focus is
   *     inside THIS canvas.
   *
   * Container-scoping is also why typing `E` in the toolbar's template-name
   * input cannot reach this: those inputs are not inside `canvasRef`. That,
   * plus the `.react-flow__node` lookup below, is the whole of the defence —
   * see the note at that lookup for the guard that was written for this and
   * then removed for being unfalsifiable.
   */
  const onCanvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Modifiers first, exactly as JudgmentQueueConsole does it: Cmd/Ctrl+E
      // belongs to the browser and Alt+E to the OS menu bar. Shift is NOT
      // listed — `event.key` is then "E", which lowercases to the same key.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== EDIT_NODE_KEY) return;
      // Already editing. Re-entering would re-seed `editData` from `nodes` and
      // throw away whatever the operator has typed into the open form.
      if (editModalOpen) return;
      // NO `isTextEntry` GUARD HERE, AND THAT IS THE MEASURED DECISION.
      // One was written, and removed for failing to earn its place: deleting
      // it left `WorkflowEditor.test.tsx` at 26 passed and `e2e/workflow.spec`
      // at 14 passed, with md5 confirming the deletion reached disk. The case
      // it would defend is already carried by the `.react-flow__node` lookup
      // below — every text control in this editor (four toolbar fields, five
      // modal fields) sits OUTSIDE a card, so `closest` returns null first,
      // and no card contains an input. `does NOT open when E is typed into the
      // template-name input` goes red when that lookup is removed, which is
      // where the toolbar case actually lives.
      //
      // The day a card grows an inline rename, put the guard back — `E` would
      // otherwise be a letter the operator cannot type. It is two lines, and
      // it will then be provable, which is the only state this repo trusts a
      // check in. Same reasoning as the `cards.length === 0` branch removed
      // from `autoLayout` in this file.

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // `data-id` is xyflow's own attribute on the wrapper (index.mjs 2240),
      // the same one `e2e/workflow-auto-layout-motion.spec.ts` reads cards by.
      // `closest` rather than the element itself so a focusable descendant of a
      // card still counts, and so that `E` pressed on the zoom Controls or an
      // edge — both inside this container — finds no node and does nothing.
      const nodeId = target.closest(".react-flow__node")?.getAttribute("data-id");
      if (!nodeId) return;

      event.preventDefault();
      handleNodeEdit(nodeId);
    },
    [editModalOpen, handleNodeEdit]
  );

  /**
   * Bound with `addEventListener` on the canvas element rather than as an
   * `onKeyDown` prop on the same <div>, and the difference is not stylistic.
   *
   * `jsx-a11y/no-static-element-interactions` rejects the prop form — correctly:
   * a <div> carrying a key handler is normally a control someone forgot to make
   * focusable, and the rule's remedy is a role and a `tabIndex`. Both would be
   * WRONG here. This element is not the control; the focusable things are the
   * node wrappers inside it, which xyflow already gives `tabIndex: 0` and
   * `role="group"`. Giving their container a role of its own would put a second
   * stop in the tab order that does nothing, and silencing the rule with a
   * disable comment would leave that argument nowhere but in a comment.
   *
   * Same event, same bubbling, same scope — this is a delegated listener, which
   * is what the code always was.
   */
  useEffect(() => {
    const pane = canvasRef.current;
    if (!pane) return;
    pane.addEventListener("keydown", onCanvasKeyDown);
    return () => pane.removeEventListener("keydown", onCanvasKeyDown);
  }, [onCanvasKeyDown]);

  /**
   * The nodes as xyflow renders them: ours, plus the two a11y fields the
   * wrapper reads. Derived here rather than written into `data` by
   * `workflowEditorGraph.ts`'s two builders, because `updateNodeData` renames a
   * node WITHOUT going through either of them — a name baked in at build time
   * would keep announcing the node's old name after every edit, and nothing
   * would go red.
   *
   * Memoised on `[nodes]` so the array identity is as stable as the state it
   * derives from; `<ReactFlow nodes>` is copied into xyflow's store on every
   * identity change.
   */
  // Annotated `Node[]` rather than inferred: `<ReactFlow>` takes its node
  // generic FROM THIS PROP, so the literal shape of this array (`ariaLabel:
  // string`, not `string | undefined`) would otherwise re-type the whole
  // instance and `flowRef`'s `ReactFlowInstance` would no longer accept it.
  const a11yNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => ({
        ...n,
        ariaLabel: nodeAriaLabel(n),
        domAttributes: NODE_DOM_ATTRIBUTES,
      })),
    [nodes]
  );

  // Update node data
  const updateNodeData = useCallback(
    (nodeId: string, updates: NodeDataUpdates) => {
      stopLayoutTravel();
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...updates } }
            : n
        )
      );
    },
    [setNodes, stopLayoutTravel]
  );

  // Handle connection changes
  const onConnect = useCallback(
    (connection: Connection) => {
      stopLayoutTravel();
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            ...edgeArrow(),
          },
          eds
        )
      );
    },
    [setEdges, stopLayoutTravel]
  );

  // Handle node changes
  const onNodesChangeHandler = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);
      // Track selection
      const selectionChange = changes.find(
        (c) => c.type === "select"
      );
      if (selectionChange && "selected" in selectionChange) {
        const node = nodes.find((n) => n.id === (selectionChange as { id: string }).id);
        if (node) {
          setSelectedNodeId((selectionChange as { selected: boolean }).selected ? node.id : null);
        }
      }
    },
    [onNodesChange, nodes]
  );

  // Save template
  const handleSave = useCallback(() => {
    const templateData: WorkflowTemplateInput = {
      name: templateName,
      description: templateDescription,
      civilization: templateCiv,
      case_type: templateCaseType,
      priority: templatePriority,
      nodes: getTemplateNodes(),
    };
    saveMutation.mutate(templateData);
  }, [templateName, templateDescription, templateCiv, templateCaseType, templatePriority, getTemplateNodes, saveMutation]);

  // 三档急缓的文案复用 `workflow.detail.*`——`app/workflow/[id]/page.tsx` 用同一
  // 组键把 `ApprovalWorkflow.priority` 的 0/1/2 显示成普通/紧急/危急，三份 bundle
  // (en / zh-Hans / egy) 都已有这四个键。这里说的是同一根尺子的同一个刻度，新造一
  // 组平行文案会让同一个 1 在模板页和流程页读起来不一样。

  const priorityOptions = [
    { value: 0, label: t("workflow.detail.normal") },
    { value: 1, label: t("workflow.detail.urgent") },
    { value: 2, label: t("workflow.detail.critical") },
  ];

  // A template we were asked to edit but could not read. Returning the error
  // instead of the editor is the point: an editor whose canvas is empty
  // BECAUSE THE READ FAILED looks exactly like an editor whose canvas is empty
  // because the template is new, and only one of those two may be saved. This
  // removes the save button from the screen entirely rather than disabling it,
  // so there is no enabled-looking control that would overwrite the real
  // template with the blank state on screen.
  //
  // Guarded on `templateId` so the new-template and preset paths — which have
  // no query to fail — are untouched.
  if (templateId && isTemplateError) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-[hsl(var(--color-surface-2))]">
        <QueryError onRetry={() => void refetchTemplate()} />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] hover:bg-[hsl(var(--color-surface-2))] transition-colors duration-state"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--color-surface-2))]">
      {/* Toolbar
       *
       * ─────────────────────────────────────────────────────────────────
       * 这一行的收缩策略修过一次,方向反了,于是缺陷换了个受害者。
       * ─────────────────────────────────────────────────────────────────
       *
       * 原注释写着:「`min-w-0` 是必需的 —— flex 子项默认 `min-width:auto`,
       * 不加它 `flex-1` 不会收缩,`overflow-x-auto` 也就永远没有可滚动的余量。」
       *
       * **那个因果是倒的。** `overflow-x-auto` 生效的条件是内容**超出**容器,
       * 也就是子项**不收缩**。加上 `min-w-0` 之后这一行永远塞得下,滚动条永远
       * 不出现,而代价是输入区被压到不可用 —— 窄屏上四个按钮直接压在名称输入框
       * 和三个下拉框上面。2026-09-05 在 mobile-chrome(393px)的失败截图里,
       * 「中国地府」是从「删除选中」底下透出来的。
       *
       * 当初要修的是「`保存模板` 被案件类型下拉挡住」—— 同一个病,只是那次
       * 被压的是按钮。把子项改成会收缩,只是换了谁被压。
       *
       * 现在:输入区保留 `flex-1`(桌面上照旧撑开、把按钮推到右边),但**不再**
       * 带 `min-w-0` —— 它的 `min-width:auto` 就是内容宽度,于是窄屏上这一行
       * 真的超出,`overflow-x-auto` 真的滚,每个控件都保持可用的尺寸。
       *
       * 一个 token 的改动,和一段反过来的推理。 */}
      <div className="flex items-center gap-3 p-3 border-b border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] overflow-x-auto">
        {/* Template info inputs */}
        <div className="flex-1 flex items-center gap-3">
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t("workflow.editor.template_name_placeholder")}
            aria-label={t("workflow.editor.template_name_placeholder")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] placeholder:text-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
          <select
            value={templateCiv}
            onChange={(e) => setTemplateCiv(e.target.value as typeof templateCiv)}
            aria-label={t("workflow.editor.civilization_select_label") === "workflow.editor.civilization_select_label" ? "Civilization" : t("workflow.editor.civilization_select_label")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          >
            {/* Rendered from CIVILIZATION_OPTIONS so the dropdown cannot fall
                behind the union the state is typed with — three hand-written
                <option>s beside a four-member type is a value the editor can
                hold and the user can never pick back. */}
            {CIVILIZATION_OPTIONS.map((civ) => (
              <option key={civ} value={civ}>
                {t(`workflow.civilizations.${civ}`)}
              </option>
            ))}
          </select>
          <select
            value={templateCaseType}
            onChange={(e) => setTemplateCaseType(e.target.value)}
            aria-label={t("workflow.editor.case_type_select_label") === "workflow.editor.case_type_select_label" ? "Case Type" : t("workflow.editor.case_type_select_label")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          >
            <option value="ROUTINE">{t("workflow.case_types.ROUTINE")}</option>
            <option value="APPEAL">{t("workflow.case_types.APPEAL")}</option>
            <option value="CROSS_REALM">{t("workflow.case_types.CROSS_REALM")}</option>
            <option value="SPECIAL">{t("workflow.case_types.SPECIAL")}</option>
            <option value="CANONIZATION">{t("workflow.case_types.CANONIZATION")}</option>
            <option value="PURGATORY_REVIEW">{t("workflow.case_types.PURGATORY_REVIEW")}</option>
            <option value="HERESY_TRIAL">{t("workflow.case_types.HERESY_TRIAL")}</option>
            <option value="HEART_WEIGHING">{t("workflow.case_types.HEART_WEIGHING")}</option>
            <option value="DIVINE_TRIAL">{t("workflow.case_types.DIVINE_TRIAL")}</option>
          </select>
          <select
            id={templatePriorityId}
            value={templatePriority}
            onChange={(e) => setTemplatePriority(Number(e.target.value))}
            aria-label={t("workflow.detail.priority")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={addNode}
            className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black text-03 font-medium transition-colors"
          >
            + {t("workflow.editor.add_node")}
          </button>
          <button
            type="button"
            onClick={autoLayout}
            disabled={nodes.length === 0}
            /* `h-8` rather than the `py-1.5` its neighbours use: 1.5 is off the
               spacing rhythm (1/2/3/4/6/10/16) and this file's legacy quota for
               that is already spent, so a ninth would have to be bought by
               raising the baseline. 32px is the same height `px-3 py-1.5` on
               text-03 produces, border included — border-box — so the row still
               lines up. */
            className="px-3 h-8 inline-flex items-center bg-[hsl(var(--color-surface-3))] hover:bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] text-03 font-medium border border-[hsl(var(--color-hairline))] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("workflow.editor.auto_layout")}
          </button>
          {/* Status, not a spinner. `layoutNodes` is synchronous and finished
              before this appears; the 450ms is travel. `role="status"` so the
              change is announced once rather than polled, and it renders
              nothing at all when still — an empty live region is not a layout
              shift because the row's height comes from the buttons. */}
          <span
            role="status"
            aria-live="polite"
            className="text-02 text-[hsl(var(--color-ink-muted))]"
          >
            {relayouting ? t("workflow.editor.relayouting") : ""}
          </span>
          <button
            onClick={deleteSelectedNode}
            disabled={!selectedNodeId}
            className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-03 font-medium border border-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("workflow.editor.delete_selected")}
          </button>
          {/* `isTemplateLoading` in the disabled condition: between mount and
              the GET resolving, the form holds its own empty defaults, and
              saving there would PUT those over the template still in flight.
              The error case never reaches this button — it returns above. */}
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || (!!templateId && isTemplateLoading)}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-03 font-medium transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? t("workflow.editor.saving") : t("workflow.editor.save_template")}
          </button>
        </div>
      </div>

      {/* Flow canvas */}
      {/**
       * Edges dim while the cards travel, and this is the artifact recorded
       * over `autoLayout` being paid for rather than lived with. xyflow draws
       * edges as SVG paths recomputed from its store, which holds the FINAL
       * coordinates from the first frame — so during the 450ms the connectors
       * sit at their destination geometry while the cards are still on their
       * way, reading as arrows too short to reach the card below. A path is
       * not positioned by a transform, so Flip cannot carry them; dimming is
       * the honest alternative to showing a wrong relationship confidently.
       *
       * `opacity`, not `visibility`/`display`: the edges stay in the
       * accessibility tree and in the layout, and the transition is symmetric
       * with the travel it accompanies. `opacity-25` rather than 0 so the
       * topology stays faintly legible — that is the thing an operator
       * re-arranging a branching graph is looking at. 25 and not 15 because
       * the repo's opacity scale is 0/25/40/50/70/75/90 and 15 had exactly one
       * user: this line, before it was corrected.
       *
       * A descendant variant rather than a rule in `globals.css`: the selector
       * is xyflow's internal class and this is the only file that may know it.
       */}
      <div
        ref={canvasRef}
        className={`flex-1 min-h-0 [&_.react-flow__edge]:transition-opacity [&_.react-flow__edge]:duration-state ${
          relayouting ? "[&_.react-flow__edge]:opacity-25" : ""
        }`}
      >
        <ReactFlow
          nodes={a11yNodes}
          edges={edges}
          onNodesChange={onNodesChangeHandler}
          onEdgesChange={onEdgesStateChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeDoubleClick={(_, node) => handleNodeEdit(node.id)}
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          /* ── 边不是 tab 站 ────────────────────────────────────────────
           *
           * xyflow 的 `edgesFocusable` 默认 true,于是每一条边都是一个 tab 停靠点。
           * 十节点预设因此要按 **19 次** Tab 才能穿过(10 个节点 + 9 条边),而边上
           * 没有任何可访问名称 —— `savedTemplateToFlow` / `presetTemplateToFlow`
           * 都不设 `ariaLabel`,读屏在那 9 站上念的是空的 "group"。
           *
           * 关掉而不是给边补名字,理由是**它们没有自己的动作**:节点有 `E`(编辑)
           * 和删除,边只能被拖出来和被连带删掉。一个停下来却什么都不能做的 tab 站,
           * 是把「可达」和「有用」当成同一件事。图的拓扑本来就由节点的
           * `aria-label` 承载(见 `nodeAriaLabel`)。
           *
           * 节点保持可聚焦 —— 那是 `E` 这条键盘路径立足的地方。 */
          edgesFocusable={false}
          /* ── Backspace 不再直接删节点 ─────────────────────────────────
           *
           * `deleteKeyCode` 的 xyflow 默认值是 `'Backspace'`:选中一个节点按退格
           * 就删掉它,**没有确认、没有撤销**,而且这个键在界面上任何地方都没有写。
           * hint 面板写的是「双击节点编辑 · 拖拽连线 · E 编辑」,工具栏里的
           * 「删除选中节点」才是可发现的那条路。
           *
           * `null` 让它成为**唯一**的路。这不减少任何能力:那个按钮本来就挂在
           * `selectedNodeId` 上,也就是退格键要求的同一个前提。
           *
           * 这也和这个仓库对破坏性操作的既有立场一致 —— `recycle-bin` 的永久
           * 硬删除刚从一个手搓弹层换成 `ConfirmDialog`,理由是「删除既少见又后果
           * 重大,不该和日常操作分享同一份权重」。一个没写在任何地方的单键删除,
           * 比那个还轻。 */
          deleteKeyCode={null}
          /* Fits ONCE, on init — that is all this prop has ever done, and
             before branches existed it was all that was needed. `autoLayout`
             owns every fit after this one. */
          fitView
          className="bg-[hsl(var(--color-surface-2))]"
          defaultEdgeOptions={{
            ...edgeArrow(),
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls className="bg-[hsl(var(--color-surface-1))]! border-[hsl(var(--color-hairline))]! !" />
          <Panel position="top-left" className="bg-[hsl(var(--color-surface-1))]/90 backdrop-blur-sm px-3 py-2 border border-[hsl(var(--color-hairline))] text-02 text-[hsl(var(--color-ink-muted))]">
            {/* The keyboard half of the hint, and the only place `E` is
                visible. It reuses `workflow.editor.edit_node` — the modal's own
                title — rather than introducing a fourth string in three
                bundles, one of which (egy) is transliterated and would have to
                be authored, not translated. The `<kbd>` classes are the ones
                `JudgmentQueueConsole.tsx` already uses for its key hints. */}
            <span>{t("workflow.editor.hint")}</span>
            {" · "}
            <kbd className="font-mono text-02 px-1 bg-[hsl(var(--color-surface-3))]">E</kbd>{" "}
            {t("workflow.editor.edit_node")}
          </Panel>
        </ReactFlow>
      </div>

      {/* Node edit modal */}
      <NodeEditModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        formId={formId}
        editData={editData}
        setEditData={setEditData}
        onSave={updateNodeData}
        t={t}
      />
    </div>
  );
}
