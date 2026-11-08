# SoulLedger · Design v4 · 第十五批 · 两个 egy 词与一处推送用词(2026-11-08)

回复写到 `v4-batch15-reply.md`;需要文案时三语写到 `v4-batch15-zh.json` / `v4-batch15-en.json` / `v4-batch15-egy.json`(扁平 `键: 值`)。第七至十四批已定的不动。

第十三、十四批都已落进代码并上线。落地时多出两件要你定的事，很小。

## 1. 流程编辑器两个新键的 egy

照第十四批第 5 节，窄屏版补了两处，我们先写了 zh / en,egy 暂缺(界面退回中文):

| 键 | zh | en | 用在哪 |
|---|---|---|---|
| `workflow.editor.read_only` | 只读 | Read only | 窄屏页头，模板名旁的标签(代替三个操作) |
| `workflow.editor.other_exit` | {{node}} 的另一条出口 · {{label}} | Another exit of {{node}} · {{label}} | 窄屏线性预览里，分支第一张卡上面那行(「◇」由代码加在前面) |

`{{label}}` 是出口标签，例如「否决」「是 · 条件」或区域名。请给 egy,照常不要新词根就最好。

## 2. 中国籍灵魂最后一站在埃及时的「走完」推送

推送用词跟**最后一站**所在的文明走(第十三批第 2 节的规则)。第十三批的回复假设埃及站不会触发 `sentence_completed`,但会触发:中国籍灵魂的去处计划最后一站排在埃及，走完就发。

现在它读 `soul_push.sentence_completed.title_by_civ.eg` = 「去处计划已全部走完」,正文「你的去处计划已全部走完，打开灵魂簿查看。」。

请定:
- 就用这句(中性的「去处计划」),还是
- 按灵魂原籍(中国 → 「受刑计划」那套),或者给埃及一句自己的说法。

`soul_app.sentence.push.completed.*` 是同一句在 App 里的副本，跟着改。

## 3. 只是告诉你(不用回)

- 欧洲的 `sentence_completed` 你给了 `_by_civ.eu`(通用)和 `_by_civ.eu.PURGATORY` 两层。语言包是嵌套 JSON,同一个键不能既是字符串又是对象，所以通用那句落成了 `eu.BLISS` 和 `eu.NEUTRAL` 两份;欧洲地狱照你说的读底键。显示效果和你写的一致。
- 管理员的「全部待处理的去处请求有几件？」不在语言包里:推荐问题写在代码 `officerAssistSuggestions.ts`,临时键没加。
- 第十四批没做的:`version.pending_changes`(前端拿不到已发布版本的图，要多一个请求，先不做);侧栏悬停展开(只做了点击与 `[`);三个操作留在模板条右端(页头组件只收文字);侧栏宽度沿用全站 68 / 252。
