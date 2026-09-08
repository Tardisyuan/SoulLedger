import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FRONTEND_ROOT,
  THEMES,
  TOKENS_BY_THEME,
  hslTripleToRgb,
  resolveTriple,
  type ThemeName,
} from "./support/globalsCssTokens";

/**
 * 工作流的边箭头只有一个来源,而且它就是强调色。
 *
 * WHY。`workflowEditorGraph.ts` 的 `EDGE_ARROW` 是为了「一个颜色不要散在多处」
 * 才抽出来的,它的注释当时写的是「three times」—— 而实际是**四处**。
 * `387c29c` 一次引入四份逐字节相同的 `#d97706`;`051bf9a`(一个提交信息里
 * 只字未提边颜色的批量提交)把其中三份改成 `#f59e0b`,漏掉第四份。改掉的三份
 * 缩进 12 空格,漏掉的那份缩进 14、嵌在三元数组里。**那份漏网的拷贝随后带着
 * 深一档的琥珀色存活了两年**,而后来的去重按同样的三份计数,于是把同一个遗漏
 * 又漏了第二遍。
 *
 * 所以这份守卫断言的是**计数**,不是那句注释。注释会腐烂,而这里会红。
 *
 * 为什么颜色是十六进制字面量而不是 `hsl(var(--…))`:xyflow 把 `markerEnd`
 * 渲染进一棵独立的 SVG `<marker>` defs 树,那里没有自定义属性可解析,箭头会
 * 变成没上色的。`eslint.config.mjs` 的 HEX_ALLOW 按**路径前缀**授予豁免。
 *
 * 为什么两边各自精确钉死、而不是用容差交叉校验:
 * `#f59e0b` 是 rgb(245,158,11),而 `hsl(38 92% 50%)` 是 rgb(245,159,10) ——
 * **Tailwind 公布的十六进制不是它自己文档里那个三元组的精确往返**(实测,非假设)。
 * 一个宽到能吞下这 1/255 的容差,也就宽到能吞下一个打字错的十六进制,
 * 而那正是本守卫要抓的缺陷。于是:十六进制精确钉、样式表三元组精确钉、
 * 两者之间 1/255 的差本身也按实测钉住。
 */

const GRAPH = path.join(FRONTEND_ROOT, "src", "components", "workflow", "workflowEditorGraph.ts");
const EDITOR = path.join(FRONTEND_ROOT, "src", "components", "workflow", "WorkflowEditor.tsx");
const ARROW_HEX = "#f59e0b";

/** 注释里写出的颜色不是用法。`WorkflowEditor.tsx` 的文件头正是用散文解释
 *  「为什么 markerEnd 不能用 hsl(var(--…))」—— 不剥注释,守卫会把那段解释报成缺陷。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
    expect(graphSrc).toContain("EDGE_ARROW");
    expect(editorCode).toContain("edgeArrow()");
  });

  it("draws the arrow in amber-500", () => {
    // 剥注释:本文件的文件头把 `#d97706` 这段考据写了出来,而注释里写出的颜色
    // 不是用法 —— 不剥的话,守卫会把解释它自己的那段散文报成缺陷。
    const hits = stripComments(graphSrc).match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.toLowerCase()).toBe(ARROW_HEX);
  });

  it("declares that colour exactly once, in one constant", () => {
    const decl = stripComments(graphSrc).match(/#[0-9a-fA-F]{6}/g) ?? [];
    // markerEnd 的 color 与 style 的 stroke,同一个常量里的两处
    expect(decl).toHaveLength(2);
    expect(new Set(decl.map((d) => d.toLowerCase())).size).toBe(1);
  });

  // 这两条的主体是【本文件的常量】对【样式表】,不是【源码里的值】对【样式表】。
  // 实测:把 EDGE_ARROW 改一个字符,红的是上面那条 "draws the arrow in amber-500",
  // 这两条纹丝不动。它们守的是反方向 —— 样式表的 --color-accent 漂离琥珀 500。
  // 两个方向都有人守,但别把这两条当成源码的守卫。
  it.each(THEMES)("stays within 1/255 of --color-accent (%s theme)", (theme: ThemeName) => {
    const fromHex = hexToRgb(ARROW_HEX);
    const fromToken = hslTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], "--color-accent"));
    const gap = Math.max(...fromHex.map((v, i) => Math.abs(v - fromToken[i])));
    // 实测值,不是猜的容差:两者相差恰好 1/255,见文件头。
    expect(gap).toBeLessThanOrEqual(1);
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
