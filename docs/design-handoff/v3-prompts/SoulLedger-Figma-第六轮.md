# SoulLedger 灵魂簿 · 第六轮：修第五轮引入的断点缺陷

第五轮的修复方向都对：1440 现在是真实画板宽度，中央判决列在 1440 展开态实测 692px、1024 实测 722px，都达标；四档画板、组件库也都在。

但引入了一个严重缺陷：**768 和 393 两档的页面会被压成一条 68px 宽的竖条。**

---

## A. 缺陷：切到 1024 之后再切 768 或 393，页面塌掉

### 复现（Chromium 1512×950，`vite build` 产物）

1. 打开审判台
2. 点 `1024`
3. 点 `768`（或 `393`）

页面内容被挤进左侧约 68px 宽的一条，文字一行一个字，元素互相重叠，画板其余部分空白。直接从 `1440` 点到 `768` 不会出现。

### 实测

```
768        → .web-shell "shell-expanded shell-compact shell-mobile"
             grid-template-columns: 768px      .shell-content 宽 768   ✅
1024 → 768 → .web-shell "shell-collapsed shell-compact shell-mobile"
             grid-template-columns: 68px 700px .shell-content 宽 68    ❌
1024 → 393 → grid-template-columns: 68px 325px .shell-content 宽 68
             而子元素宽 393，横向溢出                                   ❌
393        → grid-template-columns: 393px      .shell-content 宽 393   ✅
```

### 根因（两处，要一起修）

**1. `navMode` 切档时没有重置。** `App.tsx` 的四个画板按钮：

```jsx
onClick={() => { setViewport("wide");   setNavMode("expanded");  }}   // 1440
onClick={() => { setViewport("tablet"); setNavMode("collapsed"); }}   // 1024
onClick={() => { setViewport("compact"); … }}                         // 768 ← 没有 setNavMode
onClick={() => { setViewport("phone");   … }}                         // 393 ← 没有 setNavMode
```

1024 把 `navMode` 设成 `collapsed`，切到 768 / 393 时它留在那儿。768 和 393 是底栏形态，根本没有竖向导航，`collapsed` 对它们没有意义。

**2. CSS 优先级反了。**

```css
.web-shell.shell-collapsed { grid-template-columns: 68px minmax(0,1fr) }   /* (0,2,0) */
.shell-mobile              { grid-template-columns: 1fr }                   /* (0,1,0) */
```

两个类在同一个元素上，`.shell-collapsed` 优先级更高，于是底栏形态的壳仍然按桌面两列排。第一列 68px 是那条**并不存在**的导航栏留下的，`.shell-content` 落进了第一列。

### 要求

两处都改，不要只改一处：

- 切到 `compact` / `phone` 时把 `navMode` 重置为 `expanded`（或者干脆让 `navMode` 在这两档下不参与渲染）；
- 把底栏形态的规则提到同等或更高优先级，例如 `.web-shell.shell-mobile { grid-template-columns: 1fr }`。

**改完请逐条验证这 12 条路径**（4 个起点 × 3 个终点），每一条都要确认 `.shell-content` 的宽度等于画板宽度：

```
1440→1024  1440→768  1440→393
1024→1440  1024→768  1024→393
768→1440   768→1024  768→393
393→1440   393→1024  393→768
```

审判台、审判队列、灵魂详情、导航壳四个样板页共用同一个壳，请四个都确认。

---

## B. 顺带两条

**1. 1440 画板实际是被缩小显示的。** 在 1512 宽的窗口里实测：画板列宽 1221px，`scale = 1221 / 1440 = 0.848`。内部布局按 1440 算没错，但评审时看到的是 84.8%——11px 的字实际显示 9.3px，44px 的点击区显示 37px。

请在画板角上标出当前缩放比例（例如 `1440 · 85%`），让人知道自己看到的不是 1:1。另外提供一个「1:1」按钮，横向滚动查看真实尺寸。

**2. 1024 下 `.focus-stage` 有 18px 横向溢出。** 实测 `clientWidth 956 / scrollWidth 974`。列是 `170px 722px`，加 20px 间距和 44px 内边距正好 956，所以溢出来自某个子元素，请找出来。

---

## C. 一条流程上的建议

第五轮的验证是 `tsc --noEmit`、`vite build`、小于 11px 字号扫描——这三样全过了，但这个缺陷让两档画板完全不可用。**类型检查和构建不检查布局。**

请补一个渲染检查：用 Playwright 之类的工具，对每个画板档位和每个样板页，断言

- `.shell-content` 的宽度等于画板宽度；
- 没有非预期的横向溢出（`scrollWidth <= clientWidth + 1`）。

这个检查能直接挡住上面 A 和 B2 两条。

---

## D. 交付

1. A 的修复，附 12 条切换路径的验证结果
2. B 的两条
3. C 的渲染检查脚本
