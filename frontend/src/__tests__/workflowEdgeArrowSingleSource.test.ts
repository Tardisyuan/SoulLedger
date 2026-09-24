import { readFileSync } from "node:fs";
import path from "node:path";
import { CHART_COLORS } from "@/lib/chart-colors";
import { edgeArrow } from "@/src/components/workflow/workflowEditorGraph";

import { FRONTEND_ROOT, THEMES, type ThemeName } from "./support/globalsCssTokens";

/**
 * 工作流的边箭头只有一个来源,而且它就是当前主题的强调色。
 *
 * `workflowEditorGraph.ts` 的 `edgeArrow()` 是四处边颜色收拢成的一处(曾经有一份
 * 拷贝漂了两年,见那边的注释)。这里断言**计数**与**取值**:编辑器里不再有手写的
 * markerEnd / stroke / 十六进制,箭头颜色等于 `CHART_CHROME.accent`(按主题,
 * 由 chartColourContract 钉到 globals.css)。
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

  it.each(THEMES)("draws the arrow in the %s accent", (theme: ThemeName) => {
    document.documentElement.classList.toggle("light", theme === "light");
    const arrow = edgeArrow();
    document.documentElement.classList.remove("light");
    const accent = CHART_COLORS[theme].CHART_CHROME.accent;
    expect(arrow.markerEnd.color).toBe(accent);
    expect(arrow.style.stroke).toBe(accent);
  });

  it("the two themes' arrows differ, so the theme is actually read", () => {
    expect(CHART_COLORS.dark.CHART_CHROME.accent).not.toBe(CHART_COLORS.light.CHART_CHROME.accent);
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
