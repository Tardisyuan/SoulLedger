# SoulLedger · Design v3 · 第六十二批 · 灵魂端四张进度卡(2026-10-29)

灵魂 App「我的这一世」页(`mobile/src/screens/life.tsx`)现在有几段时间是**沉默**的:灵魂在系统里已经有事发生,自己却什么都看不到。后端 `/me/` 已经给出下面这些字段(不适用时为 null),请为它们各设计一张卡(或一行状态),放在现有五阶段与审判卡之间。

| 卡 | 字段 | 取值 | 何时出现 |
|---|---|---|---|
| 勾魂牒 | `capture_warrant` | `{status: "ISSUED" \| "CAPTURED", issued_at}` | 地府:阳寿已到、勾魂牒已签发,尚未交接城隍(灵魂状态仍是「在世」)。ISSUED = 鬼差已出发;CAPTURED = 已拘到、待交城隍 |
| 冥河渡口(希腊) | `greek_ferry` | `{ferry_passage: "UNBURIED" \| "NO_FARE", crossed: bool, crosses_on: date \| null}` | 卡戎不渡时。UNBURIED = 未得安葬,`crosses_on` 是满百年得渡的第一天;NO_FARE = 无渡资,没有日期 |
| 地狱前庭(欧洲) | `european_vestibule` | `{entered_at}` | 灵魂在地狱前庭(中立者的永久去处,没有「进度」,只有进入时间) |
| 四十二条告白(埃及) | `negative_confession` | `{truthful, untruthful, unheard, total}` | 本世最近一件称心审判的告白计数(属实 / 不实 / 未听 / 总 42) |
| 已超度(地府) | `wangsi_delivered_at` | datetime | 枉死城申诉得超度之后 |

请给:
1. 每张卡的版式(标题、一句话状态、日期写法;中文日期按「2026年 · 10月28日」/「前44年」;egy 按第六十批的 Abed 写法)。
2. 每张卡的中文 / English / egy 文案(egy 用闭合词表,新词根请先告诉我)。
3. 四十二条那张:计数怎么画(进度条 / 三段数字 / 别的),窄屏 393pt 不换行。
4. 冥河那张:有 `crosses_on` 时是否写「还要等 N 年」,以及 N 很大(近百年)时的写法。
5. 与现有五阶段条、审判卡的先后顺序;同时出现两张时怎么排。
6. 动效是否沿用现有卡片入场(尊重减弱动效)。

另:推送新增四种枉死结论(属实·提前释放 / 属实 / 超度 / 不属实),落点是这张页面的审判卡。文案已有中英,egy 会在下一批词表里一起给你。
