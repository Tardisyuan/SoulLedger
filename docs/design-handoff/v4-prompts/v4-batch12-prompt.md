# SoulLedger · Design v4 · 第十二批 · 按文明的用词收尾(2026-11-07)

回复写到 `v4-batch12-reply.md`,三种语言写到 `v4-batch12-zh.json` / `v4-batch12-en.json` / `v4-batch12-egy.json`(扁平 `键: 值`),第 4 条的图改好后用原文件名重新发布(`maps/egypt-*.svg`),都放在同一目录。**第九批(界域类型按种子重定叫法)还没回,请这次一起回**,它和下面第 3 条里几项是同一件事。第七、八、十、十一批已定的文字不动,除非下面点名。

我们做了一轮四文明逐页的措辞审查(四个文明加共用页,共 178 条)。用错和不一致的已按 `docs/` 改了;剩下这些是用词的取舍,用户说一并交给你定。

## 1. 「受刑计划」一套词按文明给

这套词四文明共用:页面名、菜单、灵魂端「我的受刑」、通知标题、「刑期」。但欧洲天国、埃及芦苇原、希腊至福岛的灵魂并不「受刑」,炼狱是涤罪,不是刑罚。用户决定:**请按文明给一套,受罚的照旧可以叫受刑,不受罚的另起**(如「去处」「停留」「居所」之类,你定)。需要时可以按去处类型(受罚 / 涤罪 / 福地 / 湮灭)分。

现有键(中文含「受刑」「刑期」的,节选 60 条):

| 键 | 中文 | 英文 |
|---|---|---|
| `souls.events.SENTENCE_PLAN_CREATED` | 受刑计划生成 | Sentence plan created |
| `souls.events.SENTENCE_NODE_ACTIVATED` | 受刑节点开始 | Sentence stage started |
| `souls.events.SENTENCE_NODE_WAITING` | 受刑节点待前往 | Sentence stage awaiting the soul |
| `souls.events.SENTENCE_NODE_COMPLETED` | 受刑节点服完 | Sentence stage served |
| `souls.events.SENTENCE_NODE_REFUSED` | 受刑节点调拨未成 | Sentence stage transfer did not go through |
| `souls.events.SENTENCE_NODE_REDISPATCHED` | 受刑节点重新调拨 | Sentence stage transfer resent |
| `souls.events.SENTENCE_PLAN_AMENDED` | 受刑计划变更 | Sentence plan amended |
| `souls.events.SENTENCE_REQUEST_CREATED` | 受刑请求提交 | Sentence request submitted |
| `souls.events.SENTENCE_REQUEST_DECIDED` | 受刑请求裁定 | Sentence request decided |
| `souls.events.SENTENCE_PLAN_COMPLETED` | 受刑计划服完 | Sentence plan completed |
| `souls.events.SENTENCE_PLAN_CANCELLED` | 受刑计划取消 | Sentence plan cancelled |
| `souls.detail.reading.sentence_owed_label` | 所欠刑期 | Term owed |
| `souls.detail.reading.sentence_requited_detail` | 桩在案善行 · 不冲抵刑期 | recorded good deeds · never against the term |
| `souls.detail.reading.elapsed_missing_term_start` | 刑期何时开始 | When the term began |
| `souls.diyu_station_desc.EIGHTEEN_HELLS` | 判有罪者在此受刑。 | Where those found guilty are punished. |
| `dashboard.todo.sentence_requests` | 受刑请求待批 | Sentence plan requests |
| `ledger.civ.GREEK` | 偿还刑期 | Sentence to be Served |
| `judgment.placement.term` | 刑期（年） | Term (years) |
| `judgment.placement.errors.term_conflict` | 执行失败：刑期与永恒只能选一个 | Not executed: choose a term or eternal, not both |
| `judgment.placement.errors.term_not_applicable` | 埃及的去处不服刑：芦苇原与第二死都没有刑期。 | Egyptian outcomes take no term: neither the Field of Reeds nor the second death is served. |
| `notifications.open_sentence_plan` | 打开受刑计划 | Open the sentence plan |
| `notifications.open_sentence_requests` | 去受刑请求 | Open sentence requests |
| `dispatch.soul_on_sentence_plan` | 这个灵魂的受刑计划正在进行，调拨按计划走 | This soul has a sentence plan in progress; its dispatches follow the plan |
| `reincarnation.error.plan_in_progress` | {{name}}的受刑计划还没走完，不能转世。 | {{name}}'s sentence plan is not finished; no rebirth yet. |
| `reincarnation.error.eternal_sentence` | {{name}}受的是永久刑期，没有下一世。 | {{name}} serves an eternal sentence; there is no next life. |
| `breadcrumb.menu.sentence_requests` | 受刑请求 | Sentence Requests |
| `breadcrumb.menu.sentence_plans` | 受刑计划 | Sentence Plans |
| `soul_app.life.sentence_years` | 刑期 {{years}} 年 | {{years}} years |
| `soul_app.life.sentence` | 刑期 | Term |
| `soul_app.form_notes.HELL_BEING` | 刑期有定，不可自出。 | A fixed term, with no way out before it ends. |
| `soul_app.sentence.section_title` | 我的受刑 | My sentence |
| `soul_app.sentence.term` | 刑期 | Term |
| `soul_app.sentence.state.active` | 受刑中 | Serving |
| `soul_app.sentence.eternal_title` | 刑期永久 | The term is eternal |
| `soul_app.sentence.eternal_no_rebirth` | 刑期永久者不申请转生。 | Those under an eternal term do not apply for rebirth. |
| `soul_app.sentence.pardoned_title` | 剩余刑期已赦免 | The remaining term is pardoned |
| `soul_app.sentence.all_done_title` | 受刑已全部服完 | Your sentence is fully served |
| `soul_app.sentence.empty` | 尚未定下受刑。审判结束后此处入簿。 | No sentence yet. It is entered here once judgment ends. |
| `soul_app.sentence.blocked_title` | 受刑尚未服完 | Your sentence is not yet served |
| `soul_app.sentence.blocked_link` | 看我的受刑 | See my sentence |
| `soul_app.help.q_sentence` | 受刑计划 | Sentence plan |
| `soul_push.sentence_completed.title` | 受刑已全部服完 | Sentence fully served |
| `soul_push.sentence_completed.body` | 你的受刑已全部服完，打开灵魂簿查看。 | Your sentence is fully served. Open Soul Ledger to see it. |
| `soul_push.sentence_waiting.body` | 你有一站刑期已满，打开灵魂簿查看。 | One of your terms is served. Open Soul Ledger to see it. |
| `soul_push.sentence_amended.title` | 受刑计划有变动 | Your sentence changed |
| `soul_push.sentence_amended.body` | 你的受刑计划有变动，打开灵魂簿查看。 | Your sentence plan has changed. Open Soul Ledger to see it. |
| `soul_push.sentence_pardoned.title` | 剩余刑期已赦免 | Remaining term pardoned |
| `soul_push.sentence_pardoned.body` | 你有刑期获赦，打开灵魂簿查看。 | Part of your term was pardoned. Open Soul Ledger to see it. |
| `official_notify.sentence_node_active.title` | 受刑节点开始 | Sentence stop begun |
| `official_notify.sentence_node_done.title` | 受刑节点结束 | Sentence stop ended |
| `official_notify.sentence_node_refused.title` | 受刑节点被拒 | Sentence stop refused |
| `official_notify.sentence_node_not_dispatched.title` | 受刑节点未能发起调拨 | Sentence stop not dispatched |
| `official_notify.sentence_plan_completed.title` | 受刑计划完成 | Sentence plan completed |
| `official_notify.sentence_plan_completed.body` | 灵魂「{{soul}}」的受刑计划已全部完成。 | Soul {{soul}} has served every stop of its sentence plan. |
| `official_notify.sentence_plan_amended.title` | 受刑计划变更 | Sentence plan changed |
| `official_notify.sentence_request_pending.title` | 受刑计划请求待决 | Sentence plan request pending |
| `official_notify.sentence_request_decided.title` | 受刑计划请求已决定 | Sentence plan request decided |
| `official_notify.sentence_plan_cancelled.title` | 受刑计划已撤销 | Sentence plan cancelled |
| `sentence_plan.panel_title` | 受刑计划 | Sentence plan |
| `sentence_plan.none` | 尚无受刑计划 | No sentence plan yet |
请给出:哪些键要按文明分、每个文明每种去处的写法(三语),以及新键怎么命名(照 `realms.types_by_civ.<文明>.<类型>` 的做法即可)。

## 2. 「殿主」改名

角色 `MODERATOR` 现在叫「殿主」/ Realm Lead(`users.roles.MODERATOR`、`demo.role_moderator`)。它的实际权限是**朋友圈审核**(`social.moderate`),不改派案子,「殿主」读起来像一殿之长。用户决定改名贴合权限,请给三语名字(例如「殿司主事」「巡察」之类,你定)。

## 3. 其余用词取舍

下面是审查报告里的「需用户拍板」原文(编号是报告的)。**已经定了的不用再答**:
- CN U-7:改「醧忘台」。
- EU 1:用「层」。
- EU 2:用「林勃」。
- EU 3:演示角色按 docs 换。
- EU 6:七宗罪只列在炼狱判决下。
- EU 9:按 docs。
- EG 3:按 docs。
- EG 7:演示角色按 docs 换。
- GR 1:「岔路口的草地」。
- GR 3:译名按 docs。
- GR 5:按实际终裁人。
- GR 7:按 docs。
- GR 8:无渡资者改为岸边徘徊百年。
- SH 3:见上面第 2 条。
- SH 4:用「玛特」。
- SH 5:中国地府 / 欧洲天堂与地狱 / 埃及冥界 / 希腊冥界。
- SH 8:动作用「转生」,「轮回」只给地府。

其余每条请给一个定法和三语写法;要改种子或逻辑的,写明你的建议,我们再请用户定。

### 需用户拍板

- **U-1 「忘川」归谁**:任务说明说「忘川 / 奈何桥是地府自己的」。docs/09:34、:320-321 则说「忘川」查不到中国古籍里作冥河的用例,很可能是 Lethe 的汉译倒流(存疑,未定谳);种子把「忘川」挂在**欧洲**的 Lethe 上,`zh` home.civ_desc.EUROPEAN「……忘川河」、:883「饮忘川、忆善河」也是欧洲的。地府界面目前一处「忘川」都没有,地图用的是「奈河」,这与 docs 一致。请确认:地府保持不用「忘川」(推荐),还是把它当地府的词。如果当地府的词,欧洲那两处就要改成「勒忒河」。
- **U-2 地府界域类型的四个词**(CN-18、CN-19):Design 说过「以种子为准，告诉我我改词」。是否回报 Design,让它去掉 `cn.NEUTRAL`「殿司」、把 `cn.PURGATORY`「待审」改成「待审所」或「候审」?
- **U-3 过多于功而判通过时,判词写什么**(CN-2):(a)只写「送交第十殿发放，投生{{path}}。」;(b)请 Design 补一句,例如「过虽多于功，念其可恕，送交第十殿发放……」;(c)界面禁止这种组合。
- **U-4 十殿流程的节点命名**(CN-3、CN-4):是否把「初审……终审」改成按殿、按罪类命名?这会改后端模板,以及 `workflowPresetEnglish.ts` 和若干守卫测试;已存进数据库的 WorkflowTemplate 行不会跟着改。
- **U-5 egy 的地府名**(CN-28):保留「Duat Sherer」,还是改音译专名?
- **U-6 「不过」的分量**(CN-23):v4 定稿词,保留,还是中英对齐?
- **U-7 孟婆亭还是醧忘台**(CN-10):文档要「醧忘台」,第二批地图定稿是「孟婆亭」。按用户规矩「代码与文档不符按文档」应改「醧忘台」,但这也意味着要改 Design 的定稿,请确认。

---
### 需用户拍板

1. **炼狱用「台」还是「层」**(EU-16):docs/03 写「层」,v4 设计和 en 的 Terrace 写「台」。按「代码与文档不符按文档」该用「层」,可设计定稿是「台」。
2. **Limbo 的中文名**(EU-18):docs/03 的「林勃」、天主教常用的「灵薄狱」,还是现在的「地狱边境 / 幽冥边境」。
3. **欧洲官署和演示判官**(EU-3、EU-23):`plaque.office.court.eu`「米诺斯之庭」改「基督台前 / 私审判庭」吗?演示判官「Saint Peter」「Minos」换不换?
4. **`plaque.realm.eu`「彼岸」**(EU-13):10-02 定的,但「彼岸」是佛教的词。
5. **欧洲灵魂端的「功 / 过」**(EU-28):换成本文明的词,还是沿用。
6. **地狱判决下面列七宗罪**(D9,docs/01:247):文书在「下地狱第 n 圈」下面列出所引的七宗罪(`verdictDocument.ts:214`;条文 EU-DS-T1..T7 本身是「炼狱第 n 层」)。而 docs/03:3-28 说七宗罪不对应九圈,傲慢、嫉妒在地狱里没有圈。是保留、改成只在炼狱判决下列出,还是在地狱判决下改成「所犯之罪」?
7. **egy 用 Duat / Pet 指欧洲的地狱和天国**(EU-38):要不要请 Design 改成拉丁借词。
8. **欧洲的「受刑计划」叫什么**(EU-4、EU-34):网页的页面名、灵魂端的「我的受刑」、通知标题。天国的灵魂也有一份「受刑计划」,要不要按文明改叫「去处」之类?(第十批只换了站点状态。)
9. **撒旦还是路济弗尔**(EU-24):条文用路济弗尔,名册和节点用撒旦。

---
### 需用户拍板

1. **埃及的「受刑计划」整套叫什么**（EG-1、EG-2、EG-3）：面板标题、菜单「受刑计划 / 受刑请求」、灵魂端「我的受刑」、通知标题、推送。第十批只换了站状态，这些外层的词没有给。要不要再出一批给 Design？
2. **「羽侧 / 心侧」是否保留**（EG-6），以及 web 审判台和灵魂页头要不要也换成埃及词（EG-5）。
3. **两真之殿的规范名**（EG-11）：「两真之殿」还是「真理大厅」？种子里殿名与 realm name「真理殿堂」要不要一起改（要改迁移与演示种子）？
4. **「欧西里斯」是否还要在节点显示名里保留**（EG-14）：v4 之前用户定过两个译名并存。
5. **两真之殿在 /realms 和概览上算什么类型**（EG-19）：跟种子写「杜阿特」，还是跟站状态写「两真之殿」？
6. **灵魂端路线是否画出杜阿特入口、七道通路**（`packages/core/src/domain/soulRoute.ts:109-115`）：系统里埃及的案子登记死亡后当即挂到两真之殿，「杜阿特的门不入行程」（`docs/02_奥西里斯审判详解.md:64-69`），但路线把这两站显示为已经走过。Design 第二批按「称心二岔」画（`v4-batch02-prompt.md:18`，用户确认过 realms/0022）。路线保持现在这样，还是在 docs 里补一句「路线是示意，不是行程」？
7. **演示角色**（EG-8）：阿努比斯当 JUDGE、玛特当 MODERATOR，要不要换？
8. **称量和告白的先后**（EG-26）。

---
### 需用户拍板

1. **审判草地的正式名**(GR-12):docs 用「岔路口的草地」,代码里有「岔路草原 / 审判岔路 / 岔路口草地」。定一个界域全名、一个短码名,en 同理。
2. **希腊 NEUTRAL 类型的词**(GR-2):换成同时盖住渡口和草地的词(如「途经之地」),还是把草地单列一类(要改种子)?Design 只给了「渡口」,要回给 Design。
3. **两套译名统一到哪一套**(GR-11):建议按 docs(米诺斯 / 拉达曼迪斯 / 艾亚哥斯 / 至福岛),这样就要改语料里的自译引文。
4. **至福岛的年数叫什么**(GR-6、GR-26、GR-33):共用的「刑期 / 受刑」键要不要按文明或按去处类型分出「停留」类的词?这会动四文明共用的键。
5. **《高尔吉亚》文书的落款**(GR-5):只在米诺斯实际终裁时才写「米诺斯 终裁」,要从审批实例里取实际审到的那一步。改的是逻辑,不只是措辞。
6. **勒忒与阿墨勒斯**(GR-24):厄尔语境下要不要按《理想国》写阿墨勒斯河?
7. **「冥府」与「冥界」**(GR-15):界面统一用哪一个?
8. **渡资规则**(GR-19):「无渡资者永不得渡」没有文献依据。这是有意的建模吗?导览和说明以哪一条为准?
9. **《理想国》义人显示为「居于至福岛」**(GR-23):接受这个路由折中,还是按所选文书换词?

---
### 需用户拍板

1. **混合视图怎么叫界域类型**(SH-31):全局概览里,是沿用「地狱 / 炼狱 / 天堂」,还是换中性词(受罚之所 / 中途 / 福地)?要换,得请 Design 给词。
2. **希腊的 OTHER 叫什么,全局 `/rebirths` 怎么显示**(SH-2、SH-3):「六道之外」换成「另择一生」或别的说法?全局视图保留形态列(地府行写道,希腊行写新名字),还是去掉?
3. **「殿主」**(SH-27):这个角色管朋友圈审核还是改派案子?是否改名(例如「殿司主事」)?en 用「Hall lead」吗?
4. **「玛阿特」还是「玛特」**(SH-14):v4 定稿用前者,docs 用后者。按「代码与文档不符按文档」就是「玛特」,但这样等于推翻 v4 定稿。
5. **文明正名**(SH-11):「埃及杜阿特」还是「埃及冥界」?「欧洲天堂与地狱」带不带「与」?en 的四个正名各是什么?
6. **天国、芦苇原的「永久」怎么写**(SH-1):只写「永久」,还是按文明写(「永在天国」「永居芦苇原」)?
7. **没归属的分组叫什么**(SH-28):「未归属文明」「未归殿」二选一,或者另起一个,例如「跨文明 · 系统」。
8. **转生、转世、轮回分工**(SH-20):建议动作和申请用「转生」,「轮回」只留给地府。

---

## 4. 埃及地图的七门、二十一门

地图上七门、二十一门画成了一格一格,看起来像能逐门显示走到第几道门。但系统里没有逐门的记录,仓库也有意不按序号排门(`docs/` 没有支撑排序的出处)。用户决定:**门格跟所在的大站一起亮暗,请把它们改画成一组装饰,不再暗示逐门进度**(不带序号、不要「第 n 门」之类的字)。深浅两套,沿用原来的 `id` 规矩。

## 规矩

一律按 v4;与 `docs/` 冲突时按 `docs/`;冲突写在回复里;每条回复带编号。
