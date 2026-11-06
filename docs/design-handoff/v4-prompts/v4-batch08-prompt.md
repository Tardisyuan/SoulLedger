# SoulLedger · Design v4 · 第八批 · 进代码后的补遗(2026-11-06)

回复写到 `v4-batch08-reply.md`,egy 写到 `v4-batch08-egy.json`,稿子用 `V4Batch08.dc.html`,都发布到同一目录(`project/templates/soulledger-v4-pages/`)。

v4 已经开始进代码:第七批的 255 键已进三份语言包,网页和两个 App 的令牌、深浅主题、7 套字体已换。这一批是进代码时冒出来、只有你能定的事。第七批定稿的文字**一个字都不要动**。

## 1. egy 待补词条(43 个)

这些键是最近的功能加的,中文和英文已经有,egy 还空着(代码里先回退中文)。请按 `soulledger-v3-pages/_egy_lexicon.tsv` 的词表规矩补齐,写进 `v4-batch08-egy.json`(扁平的 `键: 值`)。新词根请在回复里单列,我登记进词表守卫。

| 键 | 中文 | 英文 |
|---|---|---|
| `about.author` | 作者 | Author |
| `audit.resources.actor` | 人物 | Actor |
| `audit.resources.auth` | 登录 | Sign-in |
| `audit.resources.disposition` | 处置 | Disposition |
| `audit.resources.loginlog` | 登录日志 | Login log |
| `audit.resources.organization` | 机构 | Organization |
| `audit.resources.post` | 帖子 | Post |
| `audit.resources.realm` | 界域 | Realm |
| `audit.resources.statute` | 律条 | Statute |
| `audit.resources.workflowtemplate` | 工作流模板 | Workflow template |
| `demo.admin_hint` | 管理员看得到四个冥界。这里是全局数字；审计、用户与权限、语料在左边的菜单里。 | An administrator sees all four underworlds. These are the overall numbers; audit, users and permissions, and the corpus are in the menu on the left. |
| `demo.author.line` | 作者 {{name}} 决定领域建模、考据和验证标准。 | {{name}} decided the domain model, the source research and the standard of verification. |
| `demo.build.lede` | 一个 Django 后端，三个前端（网页、灵魂端、官员端）。四种冥界的规则写在后端；packages/core 放三端共用的接口、hooks、领域配置和语言包。 | One Django backend, three front ends (web, soul app, officer app). The rules of the four underworlds live in the backend; packages/core holds the API client, hooks, domain configuration and language packs the three share. |
| `demo.build.node.core` | 三端共用的层 | Shared by all three |
| `demo.build.node.core_detail` | 接口客户端、hooks、领域配置、语言包。规则不在这里。 | API client, hooks, domain configuration, language packs. The rules are not here. |
| `demo.build.node.tenancy` | 多租户：每个冥界一个租户，数据按租户隔开；跨冥界只走调拨与会审。 | Multi-tenant: each underworld is one tenant with its data kept apart; underworlds meet only through transfers and joint judgments. |
| `demo.tour.cn.3.body` | 城隍先看功过；枉死的，送进枉死城等候。这一步看的是全殿的案子。 | The City God reviews merit and demerit first; the wrongfully dead wait in their own city. This step shows the whole hall's cases. |
| `demo.tour.done_body` | 这是{{civ}}的走法。换一个冥界，走的是另一套规矩。 | That is how {{civ}} does it. Change underworld and the rules change with it. |
| `demo.tour.eu.5.body` | 地狱没有出口。Francesca 留在第二圈，这一生停在这里。欧洲没有转世。 | Hell has no way out. Francesca stays in the second circle, and this life stops here. Europe has no rebirth. |
| `demo.tour.eu.5.name` | 这一生停在这里 | This life stops here |
| `demo.tour.gr.4.body` | 处置记下灵魂去哪里、待多久。这一步看的是全殿的处置。 | A disposition records where a soul goes and for how long. This step shows the whole hall's dispositions. |
| `demo.tour.skipped_body` | 可以留在这里自己看，也可以换一个冥界。 | Look around on your own, or try another underworld. |
| `demo.tour.skipped_title` | 导览已跳过 | Tour skipped |
| `disposition.overdue_since` | 期满于 {{date}} | Ended {{date}} |
| `disposition.term_overdue` | 期满未释放 | Term ended, not released |
| `souls.detail.memory_mechanisms.LETHE` | 勒忒之水 | The water of Lethe |
| `souls.detail.memory_mechanisms.MENGPO` | 孟婆汤 | Meng Po's soup |
| `souls.detail.memory_mechanisms.NONE` | 不重置 | No reset |
| `souls.detail.memory_mechanisms.SPELL` | 诵咒 | Spell recitation |
| `souls.events.WORKFLOW_TERMINATED` | 工作流被管理员结束 | Workflow ended by an administrator |
| `souls.import.row_codes.birth_in_future` | 出生日期在未来 | Birth date is in the future |
| `workflow.detail.end_stop` | 流程已到结束节点，这里没有裁决。 | The workflow has reached its end node; there is nothing to decide here. |
| `workflow.detail.not_your_stop` | 这一站不由你裁决，这里只能查看。 | This stop is not yours to decide; you can only view it. |
| `workflow.detail.refusals.final_review_required` | 推进不能越过终审：终审要由审批人判。 | Advancing cannot pass the final review: it has to be decided by its approver. |
| `workflow.detail.refusals.no_successor` | 这一站后面没有可去的站，流程不能再推进。 | There is no stop after this one, so the workflow cannot advance. |
| `workflow.detail.terminate` | 结束流程 | End workflow |
| `workflow.detail.terminate_confirm_message` | 结束后不能再推进或裁决。理由会记入审计日志。 | It cannot be advanced or decided afterwards. The reason goes into the audit log. |
| `workflow.detail.terminate_confirm_title` | 结束这个流程？ | End this workflow? |
| `workflow.detail.terminate_error` | 结束流程失败 | Failed to end the workflow |
| `workflow.detail.terminate_needs_reason` | 结束流程必须说明理由 | Ending a workflow needs a reason |
| `workflow.detail.terminate_reason_label` | 结束理由 | Reason for ending |
| `workflow.detail.terminate_reason_placeholder` | 写明为什么结束这个流程 | Say why this workflow is ending |
| `workflow.detail.terminate_success` | 流程已结束 | Workflow ended |
## 2. 一处 egy 我们改了,请复核

`map.replay.start` 你给的是 `Wehem Ankh Pen`。`Wehem Ankh` 在第十节统一时已经废止(全库改成 `Wehem Mesut`),守卫会拦。我们先改成了 `Wehem Mesut Pen`。如果这里的意思不是「再生 / 转生」而是「重放」,请给一个合规的写法。

## 3. 四张冥界地图出图

用户决定:地图等你出图再做,代码这一阶段先空着。请按第七批的结构和交互(全景、拖动缩放、支线收起 `map.branches_hidden` / `branch_only`、当前站、我在哪)出四张成品图:地府、欧洲、埃及、希腊。

- 地名、站数、站序以仓库 `docs/` 各文明文档和 App 的「赴冥 · 十三站」为准(`packages/core/src/domain/diyuStations.ts` 只读,不改)。对比稿里的路线还是旧线稿,不要照它。
- 交付成 SVG(每张一份,站点用 `id` 标出,方便代码接点击与高亮),深浅两套。
- 落地页四文明主视觉同理(第七批说「后面可以有但得找别的画」),这次一并出,或在回复里说明还要什么。

## 4. 连接条放在哪

断线时顶部出现一条 28px 的连接状态条。现在它浮在最上面,会盖住顶栏一角。我们试过让它占位,结果整页内容下移 28px,违反「内容区一屏高、不被挤动」的规矩,已撤回。请定它在 v4 外壳里的位置(例如顶栏内的一格、顶栏下沿浮层、侧栏底部),给深浅两套样子和 393 宽的样子。

## 5. 登录前与未知文明的中性配色

v4 只画了四个文明,没有画「中性」(登录前、文明不认识)。我们先用了 v4 自己的灰:

| 用途 | 深色 | 浅色 |
|---|---|---|
| 字色(civT) | #B4B6BA | #54575C |
| 白字底(solid) | #38393E | #16171A |

浅色白字底和正文同色,中性主按钮会和正文一样黑。请确认或给一组。

## 6. 稿子里两处达不到对比度,我们没照搬

- `--faint` 当正文(角标计数、分组标题):浅色 2.94:1、深色 3.91:1,低于 4.5:1。我们只把它用在装饰和禁用态,正文用 `--sub`。
- 深色 `neg` 实底配深字(onNeg)。

如果你希望这些位置仍然更淡,请给达标的值;不回复就按现在的做。

## 7. 各文明的界域类型叫法、「不转生」页

- 界域类型现在四文明共用一套基督教词:地狱 / 炼狱 / 天堂 / 中立 / 湮灭(`realms.types.*`)。请给每个文明一套显示词(数据不改,只换显示),三种语言。例如地府不该叫「天堂」。
- 埃及、欧洲不转生,但 `/rebirths` 页对所有文明都显示六道。请定这两个文明进到这页时看到什么:隐藏入口,还是一页说明(给文案)。

## 规矩

- 一律按 v4;有冲突时在回复里写明你怎么定的。
- 每条回复带编号,和上面对应。
