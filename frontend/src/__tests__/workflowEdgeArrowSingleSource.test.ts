import { readFileSync } from "node:fs";
import path from "node:path";
import { edgeArrow } from "@/src/components/workflow/workflowEditorGraph";

import { FRONTEND_ROOT, THEMES, TOKENS_BY_THEME, type ThemeName } from "./support/globalsCssTokens";

/**
 * 工作流的边只有一个来源,而且它就是区块边界色(设计稿 C · 03「连线 Edge」:
 * 1 px 区块边界色的直角折线)。
 *
 * `workflowEditorGraph.ts` 的 `edgeArrow()` 是四处边颜色收拢成的一处(曾经有一份
 * 拷贝漂了两年,见那边的注释)。这里断言**计数**与**取值**:编辑器里不再有手写的
 * markerEnd / stroke / 十六进制,边画成 `--color-block`,1 px,不带箭头。
 *
 * 此前这里钉的是 `CHART_CHROME.accent` 字面值 + `markerEnd`:箭头进 SVG `<marker>`
 * 的 defs 树,var() 在那里画不出来,只能按主题取字面值、建边时读一次。设计稿去掉了
 * 箭头(方向由上入下出的端口表达),于是颜色可以直接是 token,随主题实时切换。
 */

const GRAPH = path.join(FRONTEND_ROOT, "src", "components", "workflow", "workflowEditorGraph.ts");
const EDITOR = path.join(FRONTEND_ROOT, "src", "components", "workflow", "WorkflowEditor.tsx");

/** 注释里写出的颜色不是用法。`WorkflowEditor.tsx` 的文件头正是用散文解释
 *  「为什么 markerEnd 不能用 oklch(var(--…))」—— 不剥注释,守卫会把那段解释报成缺陷。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

describe("the workflow edge arrow has one source", () => {
  const graphSrc = readFileSync(GRAPH, "utf8");
  const editorSrc = readFileSync(EDITOR, "utf8");
  const editorCode = stripComments(editorSrc);

  // 扫描面先断言,再断言「没有违规」—— 一个扫不到东西的扫描器,输出和「干净」
  // 长得一模一样。
  it("is actually reading the two files it claims to read", () => {
    expect(graphSrc.length).toBeGreaterThan(1000);
    expect(editorSrc.length).toBeGreaterThan(10000);
    expect(graphSrc).toContain("export function edgeArrow");
    expect(editorCode).toContain("edgeArrow()");
  });

  it("writes no literal colour of its own", () => {
    expect(stripComments(graphSrc).match(/#[0-9a-fA-F]{6}/g) ?? []).toEqual([]);
  });

  it("draws every edge as a 1 px line in the block token, through the route edge, with no arrowhead", () => {
    const arrow: Record<string, unknown> & { style: { stroke: string; strokeWidth: number } } = edgeArrow();
    expect(arrow.style.stroke).toBe("oklch(var(--color-block))");
    expect(arrow.style.strokeWidth).toBe(1);
    expect(arrow.type).toBe("route");
    // Absence: an arrowhead would put the colour back into a <marker> defs tree.
    expect(arrow).not.toHaveProperty("markerEnd");
  });

  it.each(THEMES)("the block token the edge reads is declared for the %s theme", (theme: ThemeName) => {
    expect(TOKENS_BY_THEME[theme]["--color-block"]).toMatch(/^[\d.]+ [\d.]+ [\d.]+$/);
  });

  it("has no file but the source carrying a `markerEnd` written by hand", () => {
    const offenders: string[] = [];
    const n = (editorCode.match(/markerEnd\s*:/g) ?? []).length;
    if (n > 0) offenders.push(`WorkflowEditor.tsx (${n})`);
    expect(offenders).toEqual([]);
  });

  it("has no file but the source carrying a `stroke` written by hand", () => {
    const offenders: string[] = [];
    const n = (editorCode.match(/stroke\s*:/g) ?? []).length;
    if (n > 0) offenders.push(`WorkflowEditor.tsx (${n})`);
    expect(offenders).toEqual([]);
  });

  it("has no file but the source carrying a literal colour", () => {
    const offenders: string[] = [];
    const n = (editorCode.match(/#[0-9a-fA-F]{6}/g) ?? []).length;
    if (n > 0) offenders.push(`WorkflowEditor.tsx (${n})`);
    expect(offenders).toEqual([]);
  });

  it("routes every edge the editor builds through edgeArrow()", () => {
    const calls = (editorCode.match(/\.\.\.edgeArrow\(\)/g) ?? []).length;
    // 三处:两条 hydration 路径之外的 onConnect,以及 addNode 的自动连边。
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
