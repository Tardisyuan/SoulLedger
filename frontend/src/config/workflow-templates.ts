// Workflow templates configuration by civilization and case type
//
// The mythological facts encoded here (who acts, where, and in what order) are
// sourced. Before "correcting" a node name, court or order by intuition, read
// docs/lore-verification/verify-egyptian.md and verify-greek.md — both cite
// public-domain primary editions, and the errors they catalogue were all
// intuitive-looking. Node-level comments below name the plate or line each
// value rests on. src/__tests__/workflowTemplateLore.test.ts locks the ones
// that were actually found wrong.
//
// 还有一条跨端约束：节点名里的人必须是名册里真实存在的人。规则与理由表见文件
// 末尾的 NODES_THAT_NAME_NO_ACTOR，断言在
// backend/tests/test_workflow_template_cast.py（它把本文件当文本读，因为
// Jest 连不上数据库、pytest 跑不了 TypeScript）。

export interface WorkflowNodeTemplate {
  id: string;
  name: string;
  court: string;
  /**
   * 中文步骤名，**不是** `NodeType` 成员。「分流」「初审」「申诉受理」…
   *
   * 它比 NodeType 具体，并且被 `src/__tests__/workflowTemplateLore.test.ts`
   * 当作考据锁定（Ammit 的每个节点必须是「失败分支」，希腊三位必须是
   * 「分区审判」而不是「初审/复核」，Michael 的任何节点的 type 不得含
   * 「审」），所以它留在这里。
   *
   * 但它不能原样发到后端：`node_type` 是 ChoiceField，只收五个 NodeType 成员，
   * 于是「编辑」保存任何预设都会 400。判读成 NodeType 的表在
   * `src/config/workflow-node-types.ts`（`PRESET_NODE_TYPE` / `nodeTypeFor`），
   * 新增预设漏映射会让 `src/__tests__/presetNodeTypes.test.ts` 变红。
   */
  type: string;
  order: number;
}

export interface WorkflowTemplate {
  civilization: string;
  caseType: string;
  name: string;
  description: string;
  nodes: WorkflowNodeTemplate[];
}

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  // ========== 中国地府 ==========
  CHINESE_ROUTINE: {
    civilization: "CHINESE",
    caseType: "ROUTINE",
    name: "十殿审判流程",
    description: "完整十殿审判，根据罪行裁定轮回",
    nodes: [
      { id: "n1", name: "秦广王 · 分流", court: "第一殿", type: "分流", order: 1 },
      { id: "n2", name: "楚江王 · 初审", court: "第二殿", type: "初审", order: 2 },
      { id: "n3", name: "宋帝王 · 二审", court: "第三殿", type: "二审", order: 3 },
      { id: "n4", name: "五官王 · 三审", court: "第四殿", type: "三审", order: 4 },
      { id: "n5", name: "阎罗王 · 四审", court: "第五殿", type: "四审", order: 5 },
      { id: "n6", name: "卞城王 · 五审", court: "第六殿", type: "五审", order: 6 },
      { id: "n7", name: "泰山王 · 六审", court: "第七殿", type: "六审", order: 7 },
      { id: "n8", name: "都市王 · 七审", court: "第八殿", type: "七审", order: 8 },
      { id: "n9", name: "平等王 · 八审", court: "第九殿", type: "八审", order: 9 },
      { id: "n10", name: "转轮王 · 终审", court: "第十殿", type: "终审", order: 10 },
    ],
  },
  CHINESE_APPEAL: {
    civilization: "CHINESE",
    caseType: "APPEAL",
    name: "申诉审判流程",
    description: "察查司审核 → 原殿复核 → 上级殿 → 酆都大帝终审",
    nodes: [
      { id: "n1", name: "魏征 · 察查司", court: "察查司", type: "申诉受理", order: 1 },
      { id: "n2", name: "原殿阎王 · 复核", court: "原审判殿", type: "原殿复核", order: 2 },
      { id: "n3", name: "上级殿阎王", court: "上一殿", type: "上级复核", order: 3 },
      { id: "n4", name: "酆都大帝 · 终审", court: "酆都", type: "终审", order: 4 },
    ],
  },
  CHINESE_CROSS_REALM: {
    civilization: "CHINESE",
    caseType: "CROSS_REALM",
    name: "跨域审判流程",
    description: "涉及多地区协调的复杂案件",
    nodes: [
      // type 是「案件分类」而不是「分流」，而且这不是笔误的修正。后端
      // WORKFLOW_TEMPLATES 里这个同名节点记作 NodeType.EVALUATION，而
      // 「秦广王 · 分流」记作 NodeType.TRIAL——同一个旧标签「分流」在两个节点
      // 上要两个不同的答案，一张按步骤名索引的表给不出两个。分开写之后
      // backend/tests/test_workflow_preset_node_types.py 能逐条核对两侧对每个
      // 同名节点的判读一致。
      { id: "n1", name: "案件分类", court: "第一殿", type: "案件分类", order: 1 },
      { id: "n2", name: "城隍初审", court: "城隍体系", type: "地方初审", order: 2 },
      { id: "n3", name: "十殿联审", court: "十殿", type: "联审", order: 3 },
      { id: "n4", name: "酆都大帝 · 终审", court: "酆都", type: "终审", order: 4 },
    ],
  },
  CHINESE_WANG_SI: {
    civilization: "CHINESE",
    caseType: "SPECIAL",
    name: "枉死城流程",
    description: "冤死灵魂申诉 → 城隍/地藏王处理",
    nodes: [
      { id: "n1", name: "枉死城登记", court: "枉死城", type: "登记", order: 1 },
      { id: "n2", name: "城隍申诉审理", court: "城隍", type: "申诉", order: 2 },
      // 名册里的行叫「地藏王菩萨」，「地藏王超度」解析不到任何人。改成
      // 「<名册里的名字> · <步骤>」的写法，这一步才指得到具体的谁。
      { id: "n3", name: "地藏王菩萨 · 超度", court: "九华山", type: "超度", order: 3 },
      { id: "n4", name: "寿数折抵", court: "枉死城", type: "等待", order: 4 },
    ],
  },
  CHINESE_ABYSS: {
    civilization: "CHINESE",
    caseType: "SPECIAL",
    name: "阿鼻地狱流程",
    description: "五逆十恶直接入阿鼻地狱，永不轮回",
    nodes: [
      { id: "n1", name: "罪行核定", court: "第一殿", type: "罪行评定", order: 1 },
      { id: "n2", name: "阿鼻地狱入狱", court: "阿鼻地狱", type: "入狱执行", order: 2 },
    ],
  },
  CHINESE_REINCARNATION: {
    civilization: "CHINESE",
    caseType: "ROUTINE",
    name: "直送轮回流程",
    description: "大善人(功德≥500)直接轮回",
    nodes: [
      { id: "n1", name: "功德核定", court: "第一殿", type: "功德评定", order: 1 },
      { id: "n2", name: "轮回分流", court: "第十殿", type: "轮回分流", order: 2 },
    ],
  },
  CHINESE_EMERGENCY: {
    civilization: "CHINESE",
    caseType: "EMERGENCY",
    name: "紧急审判流程",
    description: "特殊紧急案件直达酆都",
    nodes: [
      { id: "n1", name: "紧急受理", court: "酆都", type: "紧急受理", order: 1 },
      { id: "n2", name: "酆都大帝直审", court: "酆都", type: "直审", order: 2 },
    ],
  },
  // ========== 欧洲天堂地狱 ==========
  //
  // 依据：docs/lore-verification/verify-christian-cast.md。这三个模板此前让
  // Michael 同时坐初审与终审，并在中间插进 Gabriel 与「天使议会」。四处都没有
  // 依据，且错的方向一致：把中国十殿的多级复审形状套在一个只有一位审判者的
  // 神学上。
  //
  //   · 审判者是基督，且只有他一位。约 5:22「父不审判什么人，乃将审判的事全交
  //     与子」；徒 10:42「神所立…作审判活人死人的主」；林后 5:10 βῆμα τοῦ
  //     Χριστοῦ「我们众人必要在基督台前显露出来」；太 25:31-46 人子分别万民；
  //     尼西亚信经「他将在荣耀中再来，审判活人死人」；CCC 1021-1041。
  //   · Michael 不称量灵魂。称量（psychostasia）是中世纪图像学母题，经希腊
  //     psychostasia 源自本文件埃及一侧的称心，圣经与次经都没有把天平交给他。
  //     他有礼仪依据的职分是引路：罗马安魂弥撒奉献经「sed signifer sanctus
  //     Michael repraesentet eas in lucem sanctam」——愿掌旗者圣米迦勒引他们进入
  //     圣光。掌旗引入的人不作裁断。
  //   · Gabriel 是向活人传信的（但 8:16、9:21；路 1:11-20、1:26-38）。「引导亡魂
  //     受审」本是 Michael 的职分被写到了他身上，末日号角的形象则是伊斯兰与后世
  //     民间传统。所以他不在亡魂审判流程里。
  //   · 「天使议会」不存在。看起来像陪审席的两处经文都不是：太 19:28 / 路 22:30
  //     给十二使徒设座却不分案不点名，林前 6:2-3 的主语是「圣徒」——所有人，不是
  //     一份名单。seeder 在 actors_european.py 顶部记录了同一结论，并指出「补一个
  //     基督教陪审席」和「把 Michael 提成审判者」是同一个动作。
  //
  // 名册与此一致：actors_european.py 里 Michael 是 CONDUIT，Christ 是唯一的
  // JUDGE。节点名的「·」前半段必须是名册里解析得到的名字——
  // backend/tests/test_workflow_template_cast.py 跨端核对这一点，解析不到的
  // 节点必须在下方 NODES_THAT_NAME_NO_ACTOR 里写明理由。
  EUROPEAN_ROUTINE: {
    civilization: "EUROPEAN",
    caseType: "ROUTINE",
    name: "末日审判流程",
    description: "基督的私审判与公审判；米迦勒引领，不作裁断",
    nodes: [
      // 私审判：CCC 1021-1022 ——「人在死亡的一刻…在一个把他的一生交付基督的
      // 私审判中，即时领受永远的报应」。这是死时发生的第一次、也是唯一一次
      // 个别裁断。
      { id: "n1", name: "Christ · 私审判", court: "天堂", type: "私审判", order: 1 },
      // 安魂弥撒奉献经求的是「libera eas de ore leonis… sed signifer sanctus
      // Michael repraesentet eas in lucem sanctam」：先求脱离，再求掌旗者引入
      // 圣光。所以引领跟在裁断之后，而不是之前——这也是为什么 Michael 既不是
      // 初审也不是终审：他不在审级里。
      { id: "n2", name: "Michael · 引领入光", court: "天堂", type: "引领", order: 2 },
      // 公审判：太 25:31-46 人子在荣耀里坐宝座分别万民；尼西亚信经；
      // CCC 1038-1041。与 n1 同一位审判者，是《要理问答》分开的两次审判
      //（死时的私审判、末日的公审判），不是一审二审——不要把它读成
      // 「同一个人既初审又终审」重新爬回来。
      { id: "n3", name: "Christ · 公审判", court: "天堂", type: "终审", order: 3 },
    ],
  },
  EUROPEAN_APPEAL: {
    civilization: "EUROPEAN",
    caseType: "APPEAL",
    name: "天堂申诉流程",
    description: "申诉呈至基督台前；天使不构成审级",
    nodes: [
      // 受理是一个动作，不是一位天使。原来的「Gabriel · 受理」把传信天使
      // 当成了亡魂案件的受理者（见本节顶部）。
      { id: "n1", name: "申诉受理", court: "天堂", type: "申诉受理", order: 1 },
      // repraesentet 的字面意思就是「呈上、引到面前」（安魂弥撒奉献经），
      // 所以 Michael 在这里把灵魂呈到审判台前，同样不作裁断。
      { id: "n2", name: "Michael · 引领呈上", court: "天堂", type: "引领", order: 2 },
      // 林后 5:10：「我们众人必要在基督台前显露出来」——申诉的尽头是同一个
      // 审判台，不是一个更高的审级。原来的「天使议会 · 复核 → Michael · 终审」
      // 凭空造了一层复核，又让 Michael 复核他自己的初审。
      { id: "n3", name: "Christ · 终审", court: "天堂", type: "终审", order: 3 },
    ],
  },
  EUROPEAN_GREEK: {
    civilization: "EUROPEAN",
    caseType: "SPECIAL",
    name: "希腊冥界流程",
    // 依据：柏拉图《高尔吉亚篇》524a（Perseus/Loeb W.R.M. Lamb 公版英译）。
    description: "柏拉图《高尔吉亚篇》524a：岔路口草地上的分流审判",
    nodes: [
      // 依据：柏拉图《高尔吉亚篇》524a —— 审判在「the meadow at the dividing of
      // the road, whence are the two ways leading, one to the Isles of the
      // Blest, and the other to Tartarus」，即一个**分流岔路口，在惩罚之前**，
      // 不是层层上诉的多级复审。此前的「Minos 初审 → Aeacus 复核 →
      // Rhadamanthus 终审」把中国十殿的串行复审形状套了上来，并且把柏拉图的
      // 终裁者降成了初审官。
      //
      // 524a 原文的分工：「those who come from Asia shall Rhadamanthus try,
      // and those from Europe, Aeacus; and to Minos I will give the privilege
      // of the final decision」（仅在另二人存疑时）。所以 Aeacus 与
      // Rhadamanthus 是**按亡魂来处并列分区**，不是一审二审；Minos 在最后。
      // order 1/2 只是本 schema 无法表达并列，不表示 Aeacus 先于 Rhadamanthus。
      //
      // 注意：这三位在《神曲》里不是一套 —— 但丁只借了 Minos，且把他放在
      // 第二圈入口（Inf. V.4-15）。不要把本模板的节点再挪进但丁九圈。
      { id: "n1", name: "Aeacus · 分区审判（欧洲亡魂）", court: "岔路口草地", type: "分区审判", order: 1 },
      { id: "n2", name: "Rhadamanthus · 分区审判（亚洲亡魂）", court: "岔路口草地", type: "分区审判", order: 2 },
      { id: "n3", name: "Minos · 终裁（另二人存疑时）", court: "岔路口草地", type: "终裁", order: 3 },
    ],
  },
  // 北欧分流流程 (Odin/Freya/Hel) used to sit here. Norse is out of this
  // system: destination there follows the manner of death, not a verdict, so
  // there is no judgment for a judgment workflow to model. The actors were
  // removed by apps/actors' consolidate_eu_pantheon and no Asgard/Folkvangr/
  // Niflheim realm has ever existed, so applying this preset produced a
  // workflow whose every node named someone the system cannot supply.
  EUROPEAN_HELL_CIRCLE: {
    civilization: "EUROPEAN",
    caseType: "SPECIAL",
    name: "地狱圈层流程",
    description: "九层地狱罪行分类",
    nodes: [
      // 依据：但丁《地狱篇》V.4-15（Longfellow 公版英译）——「There standeth
      // Minos horribly, and snarls; / Examines the transgressions at the
      // entrance; / Judges, and sends according as he girds him」。给灵魂分配
      // 圈层的是 Minos，位置在**第二圈入口**，不是第一圈（Limbo，善良异教徒，
      // 无审无罚）。此前的「罪行核定 @ 地狱第一层」把分级判定放在了 Limbo。
      { id: "n1", name: "Minos · 判定圈层", court: "第二层入口", type: "罪行分类", order: 1 },
      // 他在第九圈 Judecca 冰中，三口啃噬叛徒，**不宣判**（《地狱篇》
      // XXXIV）。原文「入狱宣判」把 Minos 的职能安在了他身上。
      //
      // 名字用名册里的 `Satan` 而不是「Lucifer」：同一位（但丁称 Lucifero、
      // Dite），但模板节点名要能在 seeder 里解析到，否则这一步在流程里指向的是
      // 一个系统拿不出的人（EUROPEAN_ACTORS 有 Satan，没有 Lucifer）。
      { id: "n2", name: "Satan · 第九层收监", court: "第九层", type: "入狱执行", order: 2 },
    ],
  },
  EUROPEAN_EMERGENCY: {
    civilization: "EUROPEAN",
    caseType: "EMERGENCY",
    name: "紧急审判流程",
    description: "紧急队列仍由基督审判——没有可以升级到的第二位审判者",
    nodes: [
      { id: "n1", name: "紧急受理", court: "天堂", type: "紧急受理", order: 1 },
      // 队列的紧急程度是本系统的调度概念，改变不了谁审判：约 5:22 把审判全给了
      // 子，没有第二位审判者可以在赶时间的时候顶上。原来的「Michael · 紧急审判」
      // 是这三处 Michael 兼审的第三处。
      { id: "n2", name: "Christ · 紧急审判", court: "天堂", type: "紧急审判", order: 2 },
    ],
  },
  // ========== 埃及冥界 ==========
  EGYPTIAN_ROUTINE: {
    civilization: "EGYPTIAN",
    caseType: "ROUTINE",
    name: "心脏称重流程",
    description: "完整杜阿特审判，心脏与羽毛称重",
    nodes: [
      // 全流程发生在**两真之殿（Hall of Two Truths）**，不在芦苇原。
      // 依据：Budge《亚尼纸草》1895 图版 III–IV（pp. 255–259，公版）；大英博物馆
      // Hunefer 纸草 BM EA 9901 同一场景独立印证。顺序为：
      //   阿努比斯操秤 → 亡者向四十二判官作否定告白 → 托特记录并向九神会宣读
      //   判词 → 众神批准 → 荷鲁斯牵手引见 → 奥西里斯接纳。
      // 阿米特只在失败时动作（见下 n5）。
      //
      // 阿努比斯是**操秤者**不是判官：图版 III 铭文称他「O weigher of
      // righteousness」，BD 30B 称「him who keepeth the scales」；托特持芦苇笔与
      // 调色板**记录**，并「Hear ye this judgment…」向九神会宣读。二者不可互换，
      // 此前把托特的节点排在告白之前，等于让书记先于陈述宣读判词。
      { id: "n1", name: "Anubis · 引导与称量", court: "两真之殿", type: "灵魂引导", order: 1 },
      // One aggregate node, not shorthand for 42 nodes. The forty-two
      // assessors do exist as 42 real Actor rows (powers_json.assessor_index
      // 1-42), but the negative confession is one step of the weighing: the
      // soul makes all 42 declarations in a single passage of the Hall of Two
      // Truths, and no assessor approves or rejects on their own. A workflow
      // node is an approval step, so 42 of them would model 42 sequential
      // sign-offs that the rite does not have. apps/workflow/services.py holds
      // the same shape server-side ("四十二神官 · 罪行核实", one TRIAL node),
      // and this preset must stay in step with it — a preset the backend would
      // not accept is worse than an abstract one. Pick individual assessors in
      // the editor if a case genuinely needs a named one.
      //
      // 位置已核实并前移：四十二条否定告白是亡者**入殿时一次性说完的陈述**
      // （BD 125B，Budge 1904 底比斯本；UCL/Quirke 由 Papyrus of Nu BM EA 10477
      // 转写作「the 42 gods who are with you in this broad court」），发生在托特
      // 宣读判词之前。原来的「42审判者 · 初审」既排在托特之后，又用「初审」
      // 暗示这是一级审级——四十二判官不作审级裁断，故改称「否定告白」。
      { id: "n2", name: "42审判者 · 否定告白", court: "两真之殿", type: "42审判", order: 2 },
      { id: "n3", name: "Thoth · 记录与宣读判词", court: "两真之殿", type: "功过记录", order: 3 },
      // 奥西里斯在**两真之殿**受理并接纳，芦苇原（Aaru）是判决通过之后才去的
      // 地方——原值把审判地点写成了结果地点。依据：Budge/亚尼 图版 IV
      //「Ani, found just, is led into the presence of Osiris… enthroned on the
      // right within a shrine」，该 shrine 就在同一座殿内。
      { id: "n4", name: "Osiris · 终审", court: "两真之殿", type: "终审", order: 4 },
      // 阿米特是**失败分支**，不是主流程里的一步：她在天平旁等待，只有心脏未
      // 通过时才吞噬（「第二次死亡」，即不再存在，而非去某个地狱）。九神会对托特
      // 的答复正是「Let it not be given to the devourer Amemet to prevail over
      // him」——可见吞噬是判词之后的**否定后果**。原值把她排在终审之前，等于让
      // 刑罚先于判决。type 标为「失败分支」以便本 schema（线性 order）也能看出
      // 它不在主链上。
      { id: "n5", name: "Ammit · 吞噬（未通过分支）", court: "两真之殿", type: "失败分支", order: 5 },
    ],
  },
  EGYPTIAN_APPEAL: {
    civilization: "EGYPTIAN",
    caseType: "APPEAL",
    name: "埃及申诉流程",
    description: "奥西里斯委员会重审",
    nodes: [
      // 伊西斯与奈芙蒂斯立于奥西里斯宝座之后，在**两真之殿**内（Budge/亚尼
      // 图版 IV：「Behind him stand Nephthys on his right hand and Isis on his
      // left」），不在芦苇原、也不是泛指的「埃及」。
      { id: "n1", name: "Isis · 受理", court: "两真之殿", type: "申诉受理", order: 1 },
      { id: "n2", name: "Nephthys · 复核", court: "两真之殿", type: "复核", order: 2 },
      // 芦苇原 → 两真之殿：同 EGYPTIAN_ROUTINE n4，审判地点不是结果地点。
      { id: "n3", name: "Osiris · 终审", court: "两真之殿", type: "终审", order: 3 },
    ],
  },
  EGYPTIAN_AFTERLIFE: {
    civilization: "EGYPTIAN",
    caseType: "SPECIAL",
    name: "死后世界分流",
    description: "根据生前功德分流",
    nodes: [
      // 分流的**裁定**在两真之殿作出；芦苇原只是通过者的去向。n2/n3 是同一个
      // 判决的两条分支，不是两个先后步骤。
      { id: "n1", name: "功德评定", court: "两真之殿", type: "功德分类", order: 1 },
      { id: "n2", name: "Osiris · 判入芦苇原", court: "两真之殿", type: "天堂分流", order: 2 },
      // 埃及没有可去的地狱：心脏未通过则被阿米特吞噬，是「第二次死亡」——停止
      // 存在，不是迁往某个冥界。依据：Budge/亚尼 p.258 及其注（阿米特立于天平
      // 旁）；docs/lore-verification/verify-egyptian.md §3.3。原值的
      //「Ammit · 冥界分流 @ 冥界 / 地狱分流」把湮灭实体化成了一个目的地。
      { id: "n3", name: "Ammit · 吞噬（第二次死亡）", court: "两真之殿", type: "失败分支", order: 3 },
    ],
  },
  EGYPTIAN_TRIALS: {
    civilization: "EGYPTIAN",
    caseType: "SPECIAL",
    name: "神判流程",
    description: "神明直接审判",
    nodes: [
      // 荷鲁斯不作任何初审。他在称量**之后**牵着已获判无罪的亡者的手，把他引入
      // 奥西里斯的神龛——依据：Budge/亚尼 图版 IV「the hawk-headed god Horus,
      // the son of Isis… takes Ani by the hand and leads him forward towards
      //『Osiris, the lord of eternity』」；BM EA 9901（Hunefer）同。角色是
      // CONDUIT（引见），不是 JUDGE，也不是杜阿特入口的守卫。
      { id: "n1", name: "Horus · 引见", court: "两真之殿", type: "引见", order: 1 },
      { id: "n2", name: "Osiris · 终审", court: "两真之殿", type: "终审", order: 2 },
    ],
  },
  EGYPTIAN_EMERGENCY: {
    civilization: "EGYPTIAN",
    caseType: "EMERGENCY",
    name: "紧急审判流程",
    description: "神庙紧急处置",
    nodes: [
      { id: "n1", name: "紧急受理", court: "埃及", type: "紧急受理", order: 1 },
      // 芦苇原 → 两真之殿：同 EGYPTIAN_ROUTINE n4，奥西里斯在殿内审判，
      // 芦苇原是通过之后的去处。
      { id: "n2", name: "Osiris · 紧急审判", court: "两真之殿", type: "紧急审判", order: 2 },
    ],
  },
};

export type TemplateKey = keyof typeof WORKFLOW_TEMPLATES;

/**
 * 名字解析不到任何 Actor 的节点，以及每一个这样的节点的理由。
 *
 * 规则（backend/tests/test_workflow_template_cast.py 强制）：一个节点的名字，
 * 取「·」之前的一段（没有「·」就取整串），要么能在 `seed_mythology` 播下的名册里
 * 解析到一位 Actor，要么在这张表里写明为什么解析不到。**不许两者皆有，也不许
 * 两者皆无**——两者皆有意味着理由过期了（那个人现在名册里有了），两者皆无意味着
 * 这一步指着一个系统拿不出的人。
 *
 * 这张表是后端 `apps/workflow/services.py::TEMPLATE_NODES_WITHOUT_AN_APPROVER`
 * 的前端对应物，措辞刻意一致：同名的节点两边理由相同，跨端断言也核对这一点。
 * 前后端模板是两套（键不同、节点集不同、后端没有欧洲 ROUTINE 一套），共有的只有
 * 「节点名指的人必须真实存在」这条约束，所以约束写在一处、两套数据各自遵守。
 *
 * 为什么这件事有后果：本文件的预设可以在 /workflow 里被「编辑」保存成后端的
 * WorkflowTemplate.nodes_json，`WorkflowService.create_from_judgment` 会照它建
 * ApprovalNode。落库的节点名指着谁，界面上就说谁在审这一步。名字指不到人的时候，
 * 系统不会报错，只会安静地把这一步记成 SYSTEM——`can_approve` 之后谁都不能批，
 * 只能走审计过的 escalate。
 */
export const NODES_THAT_NAME_NO_ACTOR: Record<string, string> = {
  // ── 中国 ──────────────────────────────────────────────
  "原殿阎王 · 复核": "「原殿」是先前审理此案的那一殿，节点没说是哪一殿，模型里也没有这一列。要解析就得在十王里挑一个。",
  "上级殿阎王": "「上一殿」相对于哪一殿未知，理由同上。",
  "酆都大帝 · 终审": "酆都大帝在任何一套名册里都没有对应的 Actor 行（seed_mythology 里 0 处）。为了让模板解析得通而造一行，等于凭空往神谱里加人。",
  "酆都大帝直审": "同上，紧急流程里的同一位。",
  "案件分类": "名字说的是一件事，不是一个人。",
  "城隍初审": "城隍是许多地方城隍共有的职位而不是一个座位，没有 Actor 行；court 列写的「城隍体系」已经把这一点说明白了。",
  "城隍申诉审理": "同上。",
  "十殿联审": "十王合议。approver 是单个外键，挑其中一位就把合议记成了一位王的裁断。",
  "枉死城登记": "登记动作。",
  "寿数折抵": "等待与折抵，不是谁的裁断。",
  "罪行核定": "名字说的是一件事。",
  "阿鼻地狱入狱": "执行动作；阿鼻地狱是地方不是人。",
  "功德核定": "名字说的是一件事。",
  "轮回分流": "名字说的是一件事。",
  "功德评定": "名字说的是一件事。",
  "紧急受理": "受理动作。中国 / 欧洲 / 埃及三套紧急流程共用这个节点名，理由相同。",
  "申诉受理": "受理动作。原来这里写的是「Gabriel · 受理」，见欧洲一节顶部为什么传信天使不受理亡魂案件。",
  // ── 埃及 ──────────────────────────────────────────────
  "42审判者 · 否定告白": "四十二判官确实是四十二行真实的 Actor（powers_json.assessor_index 1-42），但一个外键装不下一整席，而否定告白是向他们全体一次说完的（BD 125）。后端同一节点（「四十二神官 · 罪行核实」）记的是同一条理由。",
};
