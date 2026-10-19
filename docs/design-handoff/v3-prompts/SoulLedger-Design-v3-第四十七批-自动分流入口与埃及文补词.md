# 第四十七批 · 自动分流的新建入口、补录文件列名、埃及文补词(2026-10-19)

第四十五、四十六批(灵魂「出身地域」、希腊常规流程按出身地域自动分流、灵魂列表「补录出身地域」)已全部落地上线。编辑器「预定义模板」里的希腊冥界流程现在也是分流的形状(自动分流 → Aeacus / Rhadamanthus,存疑交 Minos,结束)。这一批三件事。

## 一、编辑器:新建「自动分流」节点的入口(要稿)

现状:
- 编辑器左栏「节点 · 拖入画布」有四种:审批、会签、通知、结束。点一下追加到末尾，拖进画布落在松手处。
- 「自动分流」节点(卡片首行「▷◇ 自动 · 无审批人」,第二行「⇉ 名称」,三条实线出口「欧洲 / 亚洲 / 不详」)只能**显示和编辑已有的**:检查器里只改三条出口的去处(第四十五批 W-4 的稿)。没有办法从零新建一个。
- 引擎里它是「通知」节点(无人审批、即刻按分支走)加两条条件分支(出身地域属于 EUROPE / ASIA),「不详」走默认出口。

要问的:
1. 入口放哪:左栏第五项「自动分流」?还是「通知」节点检查器里的一个开关(「按出身地域分流」)?或者别的。
2. 新建出来时三条出口怎么连:全部「未连」(`workflow.editor.auto_route.no_target`,已有)等人去连?还是像「添加节点」那样，把「不详」默认连到下一个节点?
3. 新建时的默认名称：沿用 `workflow.editor.auto_route.default_name`「按出身地域分流」?
4. 左栏若加第五项，它的图标 / 字形与说明文字(zh / en / egy)。

请给网页编辑器的稿(1440 宽;窄屏是只读，不用画新建)。官员 App 不编辑模板，不用画。

## 二、补录出身地域:「跳过的行」下载文件的第三列列名

预览里「下载跳过的行」生成一个 CSV,三列:`soul_id`(或 `soul_code`)、`origin_region`、`reason`。前两列是上传格式的列名，必须保持英文(改好后可以直接再传);第三列 `reason` 是跳过的原因(已按界面语言翻译)，上传时会被忽略，所以可以翻译。

请给一个键 `souls.region_backfill.skipped_reason_column` 的 zh / en / egy(例如 zh「跳过原因」)。如果你认为它应保持英文 `reason`,也请直接说。

## 三、埃及文补词(48 条)

实现时多出的词条,zh / en 已定，只缺 egy。规则照旧：只用 `packages/core/messages/egy.json` 里已出现的词，没有新词根;`{{…}}` 占位符原样保留。

背景:
- `workflow.court.*`:流程里各站的「殿 / 地点」名(编辑器卡片、流程详情、选站列表都显示)。中国十殿、城隍、枉死城等是中国冥界的地名，希腊的「岔路口草地」、但丁的「第二层入口」「第九层」同理。egy 若没有对应的词，可以写成「冥界名 + 序号」之类已有词能拼出的说法，或说明缺哪个意思。
- `workflow.refusal.*`:选站、加减站被拒时的提示，一条一句。
- `crossJudgments.join_locked`:流程在走时，跨域审判页上「入席 / 排序」被锁住的说明。
- `souls.import.row_codes.invalid_origin_region`:导入 / 补录文件某一行的出身地域写错了。
- `souls.origin_region.ASIA`:**词表里没有「亚洲」**,现在 egy 界面显示英文 Asia。欧洲(EUROPE)已有词。请给一个写法，或说明它只能借词。
- `workflow.editor.auto_route.no_target`:自动分流的某条出口还没连到任何节点。

| 键 | zh-Hans | en |
|---|---|---|
| `workflow.court.heaven` | 天堂 | Heaven |
| `workflow.court.heaven_gate` | 天堂之门 | Gate of Heaven |
| `workflow.court.diocese` | 主教座堂 | Diocese |
| `workflow.court.archdiocese` | 教省 | Archdiocese |
| `workflow.court.vatican` | 罗马教廷 | Vatican |
| `workflow.court.confessional` | 告解室 | Confessional |
| `workflow.court.purgatory` | 炼狱 | Purgatory |
| `workflow.court.two_truths` | 两真之殿 | Hall of Two Truths |
| `workflow.court.duat` | 杜阿特 | Duat |
| `workflow.court.egypt` | 埃及 | Egypt |
| `workflow.court.crossroads` | 岔路口草地 | Meadow at the Crossroads |
| `workflow.court.second_circle_gate` | 第二层入口 | Entrance to the Second Circle |
| `workflow.court.ninth_circle` | 第九层 | Ninth Circle |
| `workflow.court.court_1` | 第一殿 | First Court |
| `workflow.court.court_2` | 第二殿 | Second Court |
| `workflow.court.court_3` | 第三殿 | Third Court |
| `workflow.court.court_4` | 第四殿 | Fourth Court |
| `workflow.court.court_5` | 第五殿 | Fifth Court |
| `workflow.court.court_6` | 第六殿 | Sixth Court |
| `workflow.court.court_7` | 第七殿 | Seventh Court |
| `workflow.court.court_8` | 第八殿 | Eighth Court |
| `workflow.court.court_9` | 第九殿 | Ninth Court |
| `workflow.court.court_10` | 第十殿 | Tenth Court |
| `workflow.court.ten_courts` | 十殿 | Ten Courts |
| `workflow.court.inspection` | 察查司 | Inspection Bureau |
| `workflow.court.original_court` | 原审判殿 | Original Court |
| `workflow.court.court_above` | 上一殿 | Court Above |
| `workflow.court.fengdu` | 酆都 | Fengdu |
| `workflow.court.city_god` | 城隍 | City God |
| `workflow.court.city_god_system` | 城隍体系 | City God system |
| `workflow.court.wrongful_death_city` | 枉死城 | City of Wrongful Death |
| `workflow.court.jiuhua` | 九华山 | Mount Jiuhua |
| `workflow.court.avici` | 阿鼻地狱 | Avici Hell |
| `workflow.court.rebirth_application` | 转生申请 | Rebirth application |
| `workflow.court.reopened_judgment` | 重开审判 | Reopened judgment |
| `workflow.refusal.jump_target_required` | {{station}}是{{source}}驳回时转去的站，不能跳过；要跳过它，先把{{source}}一并跳过 | {{station}} receives rejected cases from {{source}}, so it can't be skipped unless {{source}} is skipped too |
| `workflow.refusal.final_required` | 终审必须走，不能跳过 | The final review can't be skipped |
| `workflow.refusal.segment_changed` | 这一段刚被别人改过，请重新打开再选 | Someone just changed this segment; reopen it and pick again |
| `workflow.refusal.workflow_required` | 这个案子有跨域审判在进行，落判时必须生成审批流程 | A cross-realm judgment is open on this case, so the ruling must generate an approval flow |
| `workflow.refusal.not_allowed` | 你没有权限做这一步 | You can't do this step |
| `workflow.refusal.too_early` | 在门口满 {{days}} 天，或那个域没有能选站的判官时，才能按默认流程走 | Allowed after {{days}} days at the gate, or when the realm has no judge to pick |
| `workflow.refusal.unknown_node` | 流程里已经没有这一站，请刷新后再试 | That station is no longer in this flow; refresh and try again |
| `workflow.refusal.reason_required` | 请填写理由 | Please give a reason |
| `workflow.refusal.moved_on` | 流程已经往前走了，请刷新后再试 | The flow has moved on; refresh and try again |
| `crossJudgments.join_locked` | 审批流程不在走，不能入席；流程在走时，新的域只能排在最后 | The approval flow isn't running, so no new seat; while it runs, a new realm can only go last |
| `souls.import.row_codes.invalid_origin_region` | 只能是 EUROPE、ASIA 或留空 | Must be EUROPE, ASIA or blank |
| `souls.origin_region.ASIA` | 亚洲 | Asia |
| `workflow.editor.auto_route.no_target` | 未连 | Not connected |
## 要的回复
1. 第一节的稿和文案(含新增键的 zh / en / egy)。
2. 第二节一个键的三语。
3. 第三节按表每个键给一行 egy;写不出来的说明缺哪个意思，我们先空着。
