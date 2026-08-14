// Workflow templates configuration by civilization and case type
//
// The mythological facts encoded here (who acts, where, and in what order) are
// sourced. Before "correcting" a node name, court or order by intuition, read
// docs/lore-verification/verify-egyptian.md and verify-greek.md — both cite
// public-domain primary editions, and the errors they catalogue were all
// intuitive-looking. Node-level comments below name the plate or line each
// value rests on. src/__tests__/workflowTemplateLore.test.ts locks the ones
// that were actually found wrong.

export interface WorkflowNodeTemplate {
  id: string;
  name: string;
  court: string;
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
      { id: "n1", name: "案件分类", court: "第一殿", type: "分流", order: 1 },
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
      { id: "n3", name: "地藏王超度", court: "九华山", type: "超度", order: 3 },
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
  EUROPEAN_ROUTINE: {
    civilization: "EUROPEAN",
    caseType: "ROUTINE",
    name: "末日审判流程",
    description: "完整天堂/地狱分流审判",
    nodes: [
      { id: "n1", name: "Michael · 初审", court: "天堂", type: "初审", order: 1 },
      { id: "n2", name: "Gabriel · 听证", court: "天堂", type: "听证", order: 2 },
      { id: "n3", name: "天使议会 · 复议", court: "天堂", type: "复议", order: 3 },
      { id: "n4", name: "Michael · 终审", court: "天堂", type: "终审", order: 4 },
    ],
  },
  EUROPEAN_APPEAL: {
    civilization: "EUROPEAN",
    caseType: "APPEAL",
    name: "天堂申诉流程",
    description: "大天使公会审核",
    nodes: [
      { id: "n1", name: "Gabriel · 受理", court: "天堂", type: "申诉受理", order: 1 },
      { id: "n2", name: "天使议会 · 复核", court: "天堂", type: "议会复核", order: 2 },
      { id: "n3", name: "Michael · 终审", court: "天堂", type: "终审", order: 3 },
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
      // Lucifer 在第九圈 Judecca 冰中，三口啃噬叛徒，**不宣判**（《地狱篇》
      // XXXIV）。原文「入狱宣判」把 Minos 的职能安在了他身上。
      { id: "n2", name: "Lucifer · 第九层收监", court: "第九层", type: "入狱执行", order: 2 },
    ],
  },
  EUROPEAN_EMERGENCY: {
    civilization: "EUROPEAN",
    caseType: "EMERGENCY",
    name: "紧急审判流程",
    description: "大天使紧急处置",
    nodes: [
      { id: "n1", name: "紧急受理", court: "天堂", type: "紧急受理", order: 1 },
      { id: "n2", name: "Michael · 紧急审判", court: "天堂", type: "紧急审判", order: 2 },
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
