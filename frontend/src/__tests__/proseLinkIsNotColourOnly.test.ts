/**
 * 段落里的链接不能只靠颜色和周围的文字区分开。
 *
 * ── 为什么这条不是 axe 的活 ────────────────────────────────────────────────
 *
 * axe 有一条现成的规则就叫 `link-in-text-block`,而 `support/axeHarness.tsx` 把它
 * **关掉了** —— 不是有意关的:`DISABLED_RULES` 由 `cat.color` 推导(对比度在
 * jsdom 里量不了,那个推导是对的),而 axe 把这条也归在 `cat.color`,于是它跟着
 * 一起走了。`dd11a1e` 的提交信息点名记下了这件事:本仓**没有任何别的东西覆盖它**。
 *
 * 那么把它单独放回去行不行?**不行,实测过两层,两层都拦死。**
 *
 *   1. 规则**根本不会被求值**。`link-in-text-block-matches` 第一句是
 *      `sanitize(node.innerText)`,而 **jsdom 不实现 `innerText`**(实测
 *      `"innerText" in HTMLElement.prototype === false`,取值得到 `undefined`)。
 *      于是匹配器直接返回 false,规则落进 `inapplicable`。把它从
 *      `DISABLED_RULES` 里拿出来,`axe.run` 的输出**逐字节不变** —— 一条加上去
 *      却永远不会跑的规则,正是本仓一再警告的「永远不会触发的检查」。
 *
 *   2. 就算把 `innerText` 垫上去让它跑起来,它也**分辨不了**。实测四个用例:
 *      `text-decoration: none` 的纯色链接、带 `underline` 的链接、和周围文字
 *      **同色**且无下划线的链接、只带 Tailwind 类的链接 —— 四个的结果一模一样,
 *      都是 `violations=0 / passes=1`,检查项 `link-in-text-block-style` 的
 *      result 是 `undefined`。原因在 `hasPseudoContent`:它读
 *      `getComputedStyle(el, ':before').content`,jsdom 返回空串,空串 `!== "none"`,
 *      于是它认为「有伪元素内容」而放弃判断。再往下也没救 ——
 *      `elementIsDistinct` 要读的 `textDecorationLine` / `borderBottomWidth` /
 *      `outlineWidth` / `fontWeight` / `fontFamily` / `backgroundImage`,jsdom
 *      **全部返回空串**,而 Tailwind 的样式表在 jsdom 里根本没有被加载。
 *
 * 所以 `DISABLED_RULES` 保持不动。挡住这条规则的不是「颜色规则需要布局」这个
 * 归类,是 jsdom 缺 `innerText` 加上它算不出计算样式;两个原因都写在这里,是为了
 * 下一个人不必再量一遍。
 *
 * ── 这份文件覆盖的是哪一半 ─────────────────────────────────────────────────
 *
 * `inkOnSurfaceContract` 那套查的是 token 的**值**,不是「哪个 token 落在了
 * `<p>` 里的 `<a>` 上」。这份文件补的正是后面那半:它从**源码**里读出配对 ——
 * 段落的文字色 token 和它里面链接的文字色 token —— 再用本仓已有的
 * `contrastRatio` 判 WCAG 1.4.1 的那条 3:1。
 *
 * 判据照 WCAG 1.4.1 原样,不加码:段落里的链接**要么**在静息态就有颜色之外的
 * 可辨性(下划线 / 下边框 / decoration),**要么**和周围文字的对比度在两个主题
 * 下都达到 3:1。`hover:underline` 只在悬停时存在,不算静息态 —— 而这正是这条
 * 守卫落地时抓到的那一个:`app/disposition/page.tsx` 的灵魂链接是
 * `--color-accent-ink` 压在 `--color-ink` 上,亮色 3.049:1 合格,**暗色 1.954:1
 * 不合格**,且只有 `hover:underline`。改成静息下划线之后这里才绿。
 *
 * ── 扫描器的局限,写在这里而不是留给人发现 ──────────────────────────────
 *
 * 主体只有 `<p>`。这个应用里大量文字块是 `<div>`,它们不在范围内 —— 一个
 * `<div>` 是不是「文字块」需要布局才知道(axe 自己也是靠计算样式判的),源码
 * 层面判不了。所以这条守卫的说法是窄的:**凡是写成 `<p>` 的段落,里面的链接
 * 必须过**。它拦不住把同样的东西写进 `<div>`。
 *
 * 「段落里还有别的文字」这个条件是靠**把链接子树剪掉之后看还剩什么**判的,
 * 对应 axe 的 `parentText.length > widgetText.length`。整段只有一个链接、
 * 别无他物的 `<p>`(`app/(auth)/login/page.tsx` 就是)不是文字块,axe 也不会
 * 判它,这里同样放过。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  oklchTripleToRgb,
  resolveTriple,
} from "./support/globalsCssTokens";

const FRONTEND_ROOT = path.join(__dirname, "..", "..");

/** WCAG 1.4.1 的那条:靠颜色区分的链接,和周围文字要有 3:1。已发布的档位,不是本仓定的。 */
const LINK_VS_TEXT_CONTRAST = 3;

/** 静息态的非颜色可辨性。`hover:` / `focus:` / `group-hover:` 这类变体前缀不算。 */
const RESTING_AFFORDANCE = /(?:^|\s)(?:underline|border-b(?:-|\s|$)|decoration-)/;

function tsxFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|__tests__|\.next/.test(entry.name)) tsxFilesUnder(full, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 注释先剥掉,再扫。
 *
 * 第一版没剥,于是 `app/judgment/[id]/page.tsx` 里一段引用了 `<p className="italic">`
 * 的**说明文字**被当成了一个真段落 —— 一个把自己的文档读成主体的扫描器,读的
 * 就不是代码。同一个坑 `suiteShape.test.ts` 里也踩过一次,那里的解法是逐行判断。
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

interface ProseLink {
  file: string;
  paragraphClass: string;
  linkClass: string;
}

/** `text-[oklch(var(--color-foo))]` 里的那个 token 名,没有就返回 null。 */
function inkTokenOf(className: string): string | null {
  return /text-\[oklch\(var\((--color-[a-z0-9-]+)\)\)\]/.exec(className)?.[1] ?? null;
}

function scan(): { paragraphs: number; proseLinks: ProseLink[] } {
  const files = [
    ...tsxFilesUnder(path.join(FRONTEND_ROOT, "app")),
    ...tsxFilesUnder(path.join(FRONTEND_ROOT, "src")),
  ];
  let paragraphs = 0;
  const proseLinks: ProseLink[] = [];

  for (const file of files) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const block of source.matchAll(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
      paragraphs += 1;
      const paragraphClass = /className="([^"]*)"/.exec(block[1] ?? "")?.[1] ?? "";
      const inner = block[2];

      const links = [...inner.matchAll(/<(?:a|Link)(\s[^>]*?)>([\s\S]*?)<\/(?:a|Link)>/g)];
      if (links.length === 0) continue;

      // 剪掉链接子树,看段落里还剩不剩别的文字。剩的必须是真内容 —— `{" "}` 和
      // 标点之外什么都没有的,和 axe 的 `parentText > widgetText` 一样不算文字块。
      let remainder = inner;
      for (const link of links) remainder = remainder.replace(link[0], "");
      if (!/[^\s{}"';:,.]/.test(remainder.replace(/\{"\s*"\}/g, ""))) continue;

      for (const link of links) {
        proseLinks.push({
          file: path.relative(FRONTEND_ROOT, file),
          paragraphClass,
          linkClass: /className="([^"]*)"/.exec(link[1])?.[1] ?? "",
        });
      }
    }
  }
  return { paragraphs, proseLinks };
}

const SCAN = scan();

describe("段落里的链接不是只靠颜色", () => {
  it("扫描器确实扫到了段落", () => {
    // 扫不到东西的扫描器,输出和「干净」长得一模一样。这条和下一条是这份文件
    // 唯一能自证「主体非空」的地方 —— 正则改坏、目录挪走、注释剥过了头,都在
    // 这里现形,而不是变成一句安静的绿。
    expect(SCAN.paragraphs).toBeGreaterThan(50);
  });

  it("扫到的段落里确实有带链接的那种", () => {
    // 上一条只证明「有 <p>」。这条证明剪链接子树那段逻辑没有把所有东西都剪没。
    expect(SCAN.proseLinks.length).toBeGreaterThan(0);
    expect(SCAN.proseLinks.map((l) => l.file)).toContain(path.join("app", "disposition", "page.tsx"));
  });

  it("每个段落内链接要么静息态可辨,要么和周围文字有 3:1", () => {
    const offenders: string[] = [];

    for (const link of SCAN.proseLinks) {
      if (RESTING_AFFORDANCE.test(link.linkClass)) continue;

      const linkToken = inkTokenOf(link.linkClass);
      const textToken = inkTokenOf(link.paragraphClass);
      if (linkToken === null || textToken === null) {
        // 两端的颜色不是从 token 直接写在类名里的,这条守卫就判不了它。
        // **不静默放过** —— 判不了和判过了是两件事。
        offenders.push(
          `${link.file}: 链接没有静息态可辨性,而它(${link.linkClass})或它所在段落` +
            `(${link.paragraphClass})的文字色不是 text-[oklch(var(--color-*))] 的形式,` +
            `这条守卫量不了它们的对比度`
        );
        continue;
      }
      if (linkToken === textToken) continue; // 同一个 token:根本不是靠颜色区分的

      for (const theme of THEMES) {
        const tokens = TOKENS_BY_THEME[theme];
        const ratio = contrastRatio(
          oklchTripleToRgb(resolveTriple(tokens, linkToken)),
          oklchTripleToRgb(resolveTriple(tokens, textToken))
        );
        if (ratio < LINK_VS_TEXT_CONTRAST) {
          offenders.push(
            `${link.file}: ${theme} 主题下 ${linkToken} 压在 ${textToken} 上只有 ` +
              `${ratio.toFixed(3)}:1(要 ${LINK_VS_TEXT_CONTRAST}:1),而这个链接静息态没有` +
              `下划线/下边框 —— 只有颜色在区分它,颜色又不够。给它一个静息态的 ` +
              `underline,或者换一个够对比的 token`
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
