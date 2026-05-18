// Workflow templates configuration by civilization and case type

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
    description: "哈迪斯王国特殊管辖",
    nodes: [
      { id: "n1", name: "Minos · 初审", court: "冥界", type: "初审", order: 1 },
      { id: "n2", name: "Aeacus · 复核", court: "冥界", type: "复核", order: 2 },
      { id: "n3", name: "Rhadamanthus · 终审", court: "冥界", type: "终审", order: 3 },
    ],
  },
  EUROPEAN_NORDIC: {
    civilization: "EUROPEAN",
    caseType: "SPECIAL",
    name: "北欧分流流程",
    description: "Valhalla/Folkvangr/Hel分流",
    nodes: [
      { id: "n1", name: "Odin · 审判", court: "Asgard", type: "英灵审判", order: 1 },
      { id: "n2", name: "Freya · 分流", court: "Folkvangr", type: "英灵分流", order: 2 },
      { id: "n3", name: "Hel · 冥界分流", court: "Niflheim", type: "冥界分流", order: 3 },
    ],
  },
  EUROPEAN_HELL_CIRCLE: {
    civilization: "EUROPEAN",
    caseType: "SPECIAL",
    name: "地狱圈层流程",
    description: "九层地狱罪行分类",
    nodes: [
      { id: "n1", name: "罪行核定", court: "地狱第一层", type: "罪行分类", order: 1 },
      { id: "n2", name: " Lucifer · 入狱宣判", court: "第九层", type: "入狱执行", order: 2 },
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
      { id: "n1", name: "Anubis · 引导", court: "杜阿特", type: "灵魂引导", order: 1 },
      { id: "n2", name: "Thoth · 记录", court: "杜阿特", type: "功过记录", order: 2 },
      { id: "n3", name: "42审判者 · 初审", court: "杜阿特", type: "42审判", order: 3 },
      { id: "n4", name: "Ammit · 吞噬宣判", court: "杜阿特", type: "吞噬宣判", order: 4 },
      { id: "n5", name: "Osiris · 终审", court: "芦苇原", type: "终审", order: 5 },
    ],
  },
  EGYPTIAN_APPEAL: {
    civilization: "EGYPTIAN",
    caseType: "APPEAL",
    name: "埃及申诉流程",
    description: "奥西里斯委员会重审",
    nodes: [
      { id: "n1", name: "Isis · 受理", court: "埃及", type: "申诉受理", order: 1 },
      { id: "n2", name: "Nephthys · 复核", court: "埃及", type: "复核", order: 2 },
      { id: "n3", name: "Osiris · 终审", court: "芦苇原", type: "终审", order: 3 },
    ],
  },
  EGYPTIAN_AFTERLIFE: {
    civilization: "EGYPTIAN",
    caseType: "SPECIAL",
    name: "死后世界分流",
    description: "根据生前功德分流",
    nodes: [
      { id: "n1", name: "功德评定", court: "杜阿特", type: "功德分类", order: 1 },
      { id: "n2", name: "Osiris · 芦苇原分流", court: "芦苇原", type: "天堂分流", order: 2 },
      { id: "n3", name: "Ammit · 冥界分流", court: "冥界", type: "地狱分流", order: 3 },
    ],
  },
  EGYPTIAN_TRIALS: {
    civilization: "EGYPTIAN",
    caseType: "SPECIAL",
    name: "神判流程",
    description: "神明直接审判",
    nodes: [
      { id: "n1", name: "Horus · 初审", court: "埃及", type: "初审", order: 1 },
      { id: "n2", name: "Osiris · 终审", court: "芦苇原", type: "终审", order: 2 },
    ],
  },
  EGYPTIAN_EMERGENCY: {
    civilization: "EGYPTIAN",
    caseType: "EMERGENCY",
    name: "紧急审判流程",
    description: "神庙紧急处置",
    nodes: [
      { id: "n1", name: "紧急受理", court: "埃及", type: "紧急受理", order: 1 },
      { id: "n2", name: "Osiris · 紧急审判", court: "芦苇原", type: "紧急审判", order: 2 },
    ],
  },
};

export type TemplateKey = keyof typeof WORKFLOW_TEMPLATES;
