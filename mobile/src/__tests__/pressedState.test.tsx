/**
 * App 手感(2026-11-15,设计参考决定记录(不在仓库里) 主会话确认第 2 条):两个 App 里每个可点的东西手指按下时
 * 都有变化。做法在共用件:`ui.tsx` 的 `Press` —— 按下时实底向黑压暗 24%(`shade`),无底的铺 `hair`,其余(半透明底)降到 0.8;
 * 盖着图片的(`dim`)整块降到 0.8。不缩放、不涟漪。
 *
 * 扫 "mobile" 与 "mobile-officer" 的 src:每个 `<Pressable` 的开标签要么写了 `pressed`(自己画按下态),要么记在下面的名单里
 * (文件 → 每一处是什么)。结果必须**等于**名单:多一处裸 `Pressable` 红;名单上的一处改掉了也红,直到从名单删掉。
 *
 * 变异(本轮验过):把 kit.tsx `Chip` 的 `<Press` 改回 `<Pressable`(连同闭标签)→「恰好是名单上的这些」红(kit.tsx 多 1);
 * 把 `pressedFace` 里 `shade(ground)` 换成 `ground` →「实底向黑压暗」红。
 */
import { render, screen } from "@testing-library/react-native";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import type { ReactElement } from "react";
import { StyleSheet, Text } from "react-native";

import { themeFor } from "@soulledger/mobile-ui/src/theme";
import { Press, ThemeContext, pressedFace, shade, styles as uiStyles } from "@soulledger/mobile-ui/src/ui";

const REPO = path.join(__dirname, "..", "..", "..");
const DIRS = [path.join("mobile", "src"), path.join("mobile-officer", "src"), path.join("packages", "mobile-ui", "src")];

type Why = "SCRIM" | "FULL_SCREEN_SKIP" | "VIEWER_PAGE" | "HIDDEN_FIELD_TAP" | "HOLD_FILLS_ITSELF";

/** 文件 → 每一处不画按下态的 `Pressable` 是什么(数组长度 = 次数)。 */
const PLAIN: Record<string, Why[]> = {
  // 抽屉 / 弹层背后的遮罩:点一下关掉,本身不是控件。
  "mobile/src/logout.tsx": ["SCRIM"],
  "mobile/src/assistPanel.tsx": ["SCRIM"],
  "mobile/src/screens/mfaParts.tsx": ["SCRIM"],
  "mobile/src/screens/circle.tsx": ["SCRIM"],
  "mobile/src/screens/circlePeople.tsx": ["SCRIM"],
  "mobile/src/screens/conversation.tsx": ["SCRIM", "SCRIM"],
  // 底页在减少动态效果时自己的遮罩(第六十批 P4:与底页同一个 80 淡入淡出)。
  "packages/mobile-ui/src/feedback.tsx": ["SCRIM"],
  // 欢迎层 / 冷启动:整屏点一下跳过。
  "mobile/src/welcome.tsx": ["FULL_SCREEN_SKIP"],
  "packages/mobile-ui/src/coldStartView.tsx": ["FULL_SCREEN_SKIP"],
  // 看大图时的一整页(点一下关)。
  "mobile/src/screens/chatImages.tsx": ["VIEWER_PAGE"],
  "mobile-officer/src/screens/letterImages.tsx": ["VIEWER_PAGE"],
  // 验证码格子:点它只是把焦点给下面那个看不见的输入框(accessible={false})。
  "mobile/src/screens/forgotPassword.tsx": ["HIDDEN_FIELD_TAP"],
  // 按住才成立的两处:按下时自己的进度环 / 印色在走,就是按下态。
  "mobile-officer/src/screens/swipe.tsx": ["HOLD_FILLS_ITSELF"],
  "mobile-officer/src/screens/sealSheet.tsx": ["HOLD_FILLS_ITSELF"],
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sources(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

/** The opening tag that starts at `from` (braces skipped, so `=>` and `>` inside expressions do not end it). */
function openingTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(from, i + 1);
  }
  return src.slice(from);
}

function plainPressables(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const dir of DIRS) {
    for (const file of sources(path.join(REPO, dir))) {
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of src.matchAll(/<Pressable\b/g)) {
        if (openingTag(src, m.index!).includes("pressed")) continue;
        const key = path.relative(REPO, file).split(path.sep).join("/");
        found[key] = (found[key] ?? 0) + 1;
      }
    }
  }
  return found;
}

describe("every pressable answers the finger", () => {
  it("a plain Pressable (no pressed face of its own) is exactly the ones on the list", () => {
    const expected = Object.fromEntries(Object.entries(PLAIN).map(([file, whys]) => [file, whys.length]));
    expect(plainPressables()).toEqual(expected);
  });

  it("the list names files that exist", () => {
    for (const file of Object.keys(PLAIN)) expect(statSync(path.join(REPO, file)).isFile()).toBe(true);
  });
});

describe("pressedFace", () => {
  const t = themeFor("CHINESE", "light");

  it("a solid fill darkens 24% toward black", () => {
    expect(pressedFace(t, t.ink)).toEqual({ backgroundColor: shade(t.ink) });
    expect(shade("#ffffff")).toBe("#c2c2c2");
    expect(pressedFace(t, "#ffffff")).not.toEqual({ backgroundColor: "#ffffff" });
  });

  it("no fill takes the hairline ground", () => {
    expect(pressedFace(t, undefined)).toEqual({ backgroundColor: t.hair });
    expect(pressedFace(t, "transparent")).toEqual({ backgroundColor: t.hair });
  });

  it("a translucent fill dims instead (shade cannot darken an rgba)", () => {
    expect(pressedFace(t, "rgba(0,0,0,0.05)")).toBe(uiStyles.pressed);
  });
});

describe("Press", () => {
  const t = themeFor("CHINESE", "dark");
  // The Pressable under `Press`: the nearest ancestor of the host view whose style is still the function (as visual.test does).
  const styleOf = () => {
    let node = screen.getByTestId("p").parent;
    while (node && (typeof node.props.style !== "function" || node.type === Press)) node = node.parent;
    return node!.props.style as (s: { pressed: boolean; hovered?: boolean }) => unknown;
  };
  const draw = (ui: ReactElement) => render(<ThemeContext.Provider value={t}>{ui}</ThemeContext.Provider>);

  it("leaves its own face alone until pressed, then lays the pressed face over it", () => {
    const own = { minHeight: 44 };
    draw(
      <Press testID="p" onPress={() => {}} style={own}>
        <Text>x</Text>
      </Press>
    );
    expect(styleOf()({ pressed: false })).toBe(own);
    expect(StyleSheet.flatten(styleOf()({ pressed: true }) as never)).toEqual({ minHeight: 44, backgroundColor: t.hair });
  });

  it("reads a style function's fill for the pressed state too", () => {
    draw(
      <Press testID="p" onPress={() => {}} style={() => ({ backgroundColor: t.ink })}>
        <Text>x</Text>
      </Press>
    );
    expect(StyleSheet.flatten(styleOf()({ pressed: true }) as never)).toMatchObject({ backgroundColor: shade(t.ink) });
  });

  it("dims a target an image covers", () => {
    draw(
      <Press testID="p" dim onPress={() => {}} style={{ backgroundColor: t.s2 }}>
        <Text>x</Text>
      </Press>
    );
    expect(StyleSheet.flatten(styleOf()({ pressed: true }) as never)).toMatchObject({ opacity: 0.8, backgroundColor: t.s2 });
  });
});
