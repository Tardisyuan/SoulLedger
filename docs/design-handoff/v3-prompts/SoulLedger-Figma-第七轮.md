# SoulLedger 灵魂簿 · 第七轮：五个缺陷 + 把渲染检查补到能抓住它们

第六轮的 768 / 393 塌缩确实修好了，我实跑验证过：四档下 `.shell-content` 宽度分别是 1188 / 956 / 768 / 393，12 条切档路径都正确，`1024 → 768` 不再残留 `shell-collapsed`。缩放比例标记和 `1:1` 按钮也在。

但还有五个缺陷，`pnpm check:layout` 一个都没抓到。

**验证环境**：`npm install` → `vite build` → `vite preview`，Chromium（playwright-core），浏览器视口 1512 × 950。下面每个数字都是实测。

---

## A. 1024 下导航栏展不开，而按钮看起来是可点的

点「展开」之后类名确实变成了 `shell-expanded`，但导航仍然是 67px，网格仍然是 `68px 956px`。

原因：

```css
.shell-tablet{ grid-template-columns: 68px minmax(0,1fr) !important }
```

`!important` 压过了一切，`navMode` 在 1024 下完全失效。

**要决定的是产品规则，不是只删一个 `!important`：**

- 如果 1024 就是强制图标条 → 把「展开」按钮在 1024 下 **禁用**，并标注原因。现在它可点、点了没反应，读起来像坏了。
- 如果 1024 允许展开 → 去掉 `!important`，让 `navMode` 生效，并给出展开态下 1024 的布局（252 + 772，中央判决列会掉到多少，要重新核对 A 轮定的 600px 下限）。

请说明你选了哪一种。

---

## B. 埃及文明下 header 溢出（三处，第三处你没报）

```
审判台  1024  埃及   .identity-band     956 / 1090    +134px
审判队列 768  埃及   .identity-band     768 /  858    +90px
审判台  1440  埃及   .current-decision  692 /  732    +40px   ← 这条也在
```

根因：

```css
.identity-band { display:grid; grid-template-columns: 190px 1fr 190px; overflow:hidden }
.identity-title h1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
```

Grid 的 `1fr` 轨道默认 `min-width:auto`，所以 `nowrap` 的长标题会把轨道**撑到超过容器**。`text-overflow: ellipsis` 永远不会触发——元素从来没有被约束过。

修法：给 `.identity-title`（以及 `.current-decision` 对应的 grid item）加 `min-width: 0`。

这和你第六轮在 1024 给聚焦视图子元素加 `min-width: 0` 是同一类问题，当时只改了一处。**请把四个样板页 × 四档 × 四个文明全部扫一遍，同类的都改掉。**

另外：`Djadjat En Maat (42 Netjeru)` 是 28 字符，是我们约束里写明的最长页题。它必须在所有档位放得下——要么缩进去，要么降档到 28px / 20px 两行（这条降档规则第四轮就定过），不能靠容器溢出。

---

## C. 导航壳这一页在 393 档整页溢出

```
.identity-band        393 /  646   (地府)
.identity-band        393 / 1090   (埃及)
.navigation-content   393 /  499
.nav-state-spec       323 /  464
```

截图上：身份带整条跑出画板右边，标题被切掉；「四档过渡」那张表挤成一列一个词。

这一页的正文（规范说明、四个规则卡片、四档过渡表）没有做任何窄屏适配。请把它按 393 单列化，表格改成纵向条目。

---

## D. 拉丁字母的下缘被切掉约 3.4px

```css
.identity-title h1 { font: 600 40px/48px "Noto Serif SC"; overflow: hidden }
```

实测：`clientHeight 48` / `scrollHeight 52`，字形墨迹底边比元素底边低 **3.4px**，被 `overflow:hidden` 切掉。

所以 `Djadjat` 的 `j`、`Judgment` 的 `g` 下缘会缺一截。中文标题看不出来，因为汉字没有下伸部。

修法二选一，请说明选了哪个：

- `line-height` 从 `1.2` 提到至少 `1.35`（48px → 54px），高度够了再谈裁切；
- 或者去掉 h1 上的 `overflow:hidden`，把裁切交给外层带 `min-width:0` 的容器。

**这条要全站查**，不只是这一个 h1：凡是 `line-height` 小于 1.3 又带 `overflow:hidden` 的文字元素都有同样的风险。

---

## E. 产品界面里没有收起 / 展开导航的按钮

`setNavMode` 目前只存在于 `ReviewControls`（评审控件，在画板外面）。**产品界面本身没有任何入口**——真实使用时判官没有办法收起或展开导航。

请在导航壳里加一个入口，并给出：

- 放在哪里（建议在导航顶部品牌区，或顶部工具栏最左）
- 图标与读屏文字（收起 / 展开两种状态）
- 键盘快捷键（如果给）
- 焦点态和悬停态
- 动效（用第四轮的 240ms 布局令牌）
- 状态是否需要记住（刷新后保持上次的选择）

1024 下这个按钮的行为，取决于 A 的选择。

---

## F. 渲染检查要扩面——现在它 48/48 全绿，而上面五条都在

`scripts/check-layout.mjs` 现在只查三个元素：`.web-shell`、`.shell-content`、`.focus-stage`，而且只在默认文明（地府）下跑。所以 B、C、D 全部在它的视野之外。

请扩成：

1. **扫全部后代**，不是三个写死的选择器：
   ```js
   el.scrollWidth > el.clientWidth + 1   // 横向溢出
   el.scrollHeight > el.clientHeight + 1 // 纵向裁切（能抓到 D）
   ```
   已知合法的滚动容器（资料舱、表格、底部抽屉）列一张白名单排除掉，**白名单要写成显式清单**，不要用「包含 scroll 就跳过」这种模糊规则。
2. **四个文明都跑一遍**（地府 / 欧洲 / 埃及 / 希腊）。埃及是最长文案，必须覆盖。
3. **覆盖全部评审页面**，不只是四个样板页——导航壳、组件库、令牌、文明规范这些页同样会溢出（C 就是）。
4. **加一条字形裁切断言**：用 `Range.getBoundingClientRect()` 量墨迹盒，和元素盒比，超出即失败。这条能直接抓住 D。

检查跑出来应该是红的，把上面五条都报出来；修完再变绿。**先让它红，再让它绿**——一个从来没红过的检查，证明不了任何事。

---

## G. 交付

1. A–E 五条的修复，A 和 D 说明你选了哪种方案
2. F 的扩面检查，并附「修复前它报了什么」和「修复后全绿」两份输出
3. 四个样板页 + 导航壳 × 四档 × 四文明的溢出扫描结果
