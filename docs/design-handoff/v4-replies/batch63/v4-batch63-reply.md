# v4 · 第六十三批 · 回复：一至三

**交付文件：**

| 文件 | 内容 |
|---|---|
| `v4-batch63-{zh,en,egy}.json` | 12 个键：一节 9 个、二 d 1 个、三 a / b 2 个 |
| `_egy_lexicon.tsv` | 7665 行，追加 12 行，没有改旧行 |
| `v4-batch63-station-reason.html` | 挪站弹层五种状态、时间线，浅 / 深 |
| `v4-batch63-badges.html` | 二 c：已终止换字形 |
| `v4-batch63-welcome-seal.html` | 三 d：欢迎页的印与本世页头的印，四文明 × 浅 / 深 |
| `v4-batch63-reply.md` | 本回复 |

egy 都是词表里已有的词，不需要进 `egyPendingKeys.json`。

## 一、十三站往回挪要写理由（只涉及网页）

**1. 理由框：一直在，往回挪时标必填。**

- **一直在，不出现也不收起：**弹层打开时理由框就在。如果选到更早的一站才冒出来，弹层会跳高，人还没看到框就可能先点了确认。这样也就不需要动画，减少动态效果时什么都不用改。
- **往前挪：**标签写「理由」，下面的帮助句写「往前挪可以不写。」
- **往回挪：**标签变成「理由 · 必填」，帮助句换成「往回挪要写理由。」
- **「会记进灵魂账页」不重复写：**弹层底部现有的 `move_body` 已经说了，理由框下不再说一遍。
- **确认键不灰掉，点了再行内报错：**灰掉的按钮不说为什么不能点。点了以后：
  - 报错挂在理由框下面，替换帮助句；
  - 框边换成 neg；
  - 焦点回到理由框。
  - 前端先判一次（只有空白也算空），后端回 `reason_required` 时也显示在同一处。
- **下拉：**不用另外标「更早」。站号本身就是顺序，选中以后标签上的「必填」就是提示。
- 用现有的 `TextAreaField` 和 `BaseModal`，不另起样式。

| 键 | 中文 | English | egy |
|---|---|---|---|
| `souls.diyu_station.reason_label` | 理由 | Reason | Khet |
| `souls.diyu_station.reason_required_mark` | 必填 | Required | Em Tepy |
| `souls.diyu_station.reason_hint_back` | 往回挪要写理由。 | Moving back needs a reason. | Semawy Er Tepy: Khet Em Tepy. |
| `souls.diyu_station.reason_hint_forward` | 往前挪可以不写。 | Optional when moving forward. | Semawy Er Khet: Khet Nen Em Tepy. |
| `souls.diyu_station.reason_placeholder` | 例如：上一站记错了 | e.g. the last station was recorded wrongly | Mi: Sekhet Tepy Sesh Nen Maat |

**2. 两条新错误**

| 键 | 中文 | English | egy |
|---|---|---|---|
| `souls.diyu_station.error.reason_required` | 往回挪要写理由。 | A reason is needed to move back. | Semawy Er Tepy: Khet Em Tepy. |
| `souls.diyu_station.error.soul_settled` | 这个灵魂已终局，不能再挪站。 | This soul is settled; its station can no longer be moved. | Ba Pen Khetem-N: Nen Semawy Sekhet Mawy. |

- **`reason_required`：**行内，挂在理由框下（同上）。它和帮助句同一句话，只是变成了错误色。
- **`soul_settled`：**写在弹层正文顶上，和现有的 `not_diyu` / `alive` 同一处、同一个样式。
  - 弹层不关：关掉的话，人不知道刚才为什么没挪成。
  - 下拉和理由框禁用，「挪站」灰掉，只剩「取消」。
  - 关掉弹层后刷新灵魂详情，因为它的状态已经变了。
- **现有的 `not_diyu` / `alive` 两句：**沿用，不改。
- **兜底：**以后再出新的错误码，仍然退回 `common.error`，同一处显示。

**3. 时间线：往回挪单独写，理由放第二行。**

| 键 | 中文 | English | egy |
|---|---|---|---|
| `souls.diyu_station.timeline_back` | 退回 · {{station}} | Moved back · {{station}} | Semawy Er Tepy · {{station}} |
| `souls.diyu_station.timeline_reason` | 理由：{{reason}} | Reason: {{reason}} | Khet: {{reason}} |

- **往前挪：**照旧写「十三站换站 · 望乡台」。
- **往回挪：**字形 ↺，写「退回 · 黄泉路」。用的是 SoulLedger Glyphs 里已有的 ↺，不加新字形。
- **理由：**第二行，12 号次要字，写「理由：……」。不加引号：这是官员写的记录，不是灵魂说的话。全文显示，最长 500 字，不折叠。
- **往前挪写了理由也照样显示**，同一个第二行。
- 是往前还是往回，由 payload 里 `from` 和 `to` 的站序比出来，不需要后端加字段。「到此 N 日」照旧读这条事件。

**官员端 App 挪站：**不需要。挪站是更正记录，应该在有完整时间线、能看到前后几站的网页上做。App 上只读那一行就够了。

## 二、第六十一批落地时的六处出入

**a · 冷启动：照这样，原生屏只给底色。**理由成立：原生屏带一整枚徽记，JS 接手后再擦掉重描，比原生屏空着更难看。原生屏和 JS 第一帧同一个底色，就已经不会跳了。浅色用深一档的金，照做。

**b · 已终止用中性色调：照这样。**不为它加第五档。徽章四档是全站的规矩，「淡」这一档和中性差别太小，加了也看不出来。已终止和其他中性徽章的区别靠字形（见 c）和文字。

**c · 字形：已终止不和申诉被驳回共用 ⊘，换成 □。**

- 只靠边框虚实来分两个终局状态太弱。卡片小的时候虚线和实线几乎一样，而这两个状态对灵魂的意义不同：一个是申诉有了结论，一个是申请没有结论就结束了。
- □ 是空框，意思是「到此结束，没有结论」。⊘ 只留给申诉被驳回。
- **如果 □ 已经有主：**就保留共用 ⊘，并请告诉我们 □ 用在哪，到时再定。
- 画面见 `v4-batch63-badges.html`。

**d · `soul_app.timeline.reconsidered`：三种语言都照用。**

- 「复议」/「Looked at again」/「Wehem Wedja」。egy 去掉「Em」是对的：状态是「正在复议」，时间线上是「复议过一次」这件事。
- 已补进词表和本批 JSON。

**e · 两处淡变：要，请补。**

- **E1：**未读点 160 淡回（只透明度，进曲线）。它要让人看到「这一行变回来了」，直接跳回去容易被当成没反应。
- **E6：**状态行刷新成功后 160 收起（高度和透明度，出曲线），不要一下消失把内容往上顶。
- 减少动态效果时两处都直接换。

**f · 「待认领」组头的数：请后端给两个准数。**

- 只按本页算会让组头的数随翻页变，人会以为数据在变。
- 请后端给 `claimable_count`（可认领数）和 `held_count`（候着数）。组头读前者，组尾「候着的 · N」读后者。
- 后端加上之前，组头先只写「待认领」，不写数，也不要写一个不准的数。组尾「候着的 · N」照本页数，因为它就在本页的行旁边，人能对上。

## 三、第六十二批落地时的四处出入

**a · 「还没有记」：中英照用，egy 用 `Nen Sesh Djer`。**

| 键 | 中文 | English | egy |
|---|---|---|---|
| `soul_app.life.confession.none` | 还没有记 | None recorded yet | Nen Sesh Djer |

- egy 和图例里的「未记」（`unheard`）同字，这没有问题：这一句只在一条都没记时出现，那时没有图例，两者不会同时在屏上。

**b · 计数要带字，写「已记 N / 42」。**

| 键 | 中文 | English | egy |
|---|---|---|---|
| `soul_app.life.confession.count` | 已记 {{recorded}} / {{total}} | {{recorded}} / {{total}} recorded | Sesh-N {{recorded}} / {{total}} |

- 光写「N / 42」，看不出 N 是已记的、如实的，还是别的。读屏念出来也只是两个数。
- 占位符和现有的 `partial` 一致（`{{recorded}}` / `{{total}}`）。之前的 `partial` / `complete` 两句现在不用了，先不删。

**c · 只有升起、没有淡出：接受，不用改。**

- 本世页是不透明的，从 8 下面升上来、淡入的 240 里盖住的是 canvas，看起来就是登录页被换走了。登录页再淡出那 160，几乎看不出来。
- 为了它让登录页在会话翻转后多留一帧，不值得。

**d · 欢迎页的印和本世页头的印：两处都用 `plaque`（`--civT`）。**

- **为什么：**欢迎页的印最后缩进本世页头，变成那一枚。它是同一个东西，颜色就不该变。
- **为什么不在 320 内渐变：**埃及的印色是金（`#E3CB53` / `#716400`），civT 是蓝（`#89BCF1` / `#175A96`），中间要经过一段发灰的过渡色，比直接跳还难看。中国、希腊也有不同程度的色相差，只有欧洲两者本来就相同。
- **为什么统一到 `plaque` 而不是 `seal`：**页头那枚是全 App 都在的，改它影响面大；欢迎页的印只出现这一次。第四十九批 B2 把欢迎徽记归为「印」，意思是它可以用文明色，不是说它必须用 `--seal` 这个令牌。
- 交接时只变大小和位置，颜色不变，不做渐变。减少动态效果时照旧没有缩放。
- 画面见 `v4-batch63-welcome-seal.html`，四文明 × 浅 / 深，在浅底和深底上都成立。

**检查：**

- 占位符三种语言逐键对过，一致。
- egy 都是词表里已有的词。
- 官员一侧（一节的 9 个键）中文没有「你」，egy 没有 -Ek / -I。
- 三份 HTML 在 393 宽下没有横向滚动。
