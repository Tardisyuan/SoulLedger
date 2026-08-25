/**
 * 预设步骤名 → `NodeType` 成员。
 *
 * 为什么需要这张表
 * ----------------
 * `workflow-templates.ts` 里每个节点的 `type` 是一个**中文步骤名**（「分流」
 * 「初审」「申诉受理」…），而 `apps/workflow/models.py::NodeType` 只有五个成员
 * （TRIAL / EVALUATION / APPEAL / FINAL / EXECUTION）。`app/workflow/page.tsx`
 * 的「编辑」按钮原样把 `n.type` 塞进 `node_type`，`WorkflowEditor` 保留它，
 * `getTemplateNodes()` 再 POST 出去，于是：
 *
 *     POST /api/v1/workflow/templates/  ->  400
 *     {'nodes': [{'node_type': ['"分流" is not a valid choice.']},
 *                {'node_type': ['"初审" is not a valid choice.']},
 *                {'node_type': ['"终审" is not a valid choice.']}]}
 *
 * ——任何被「编辑」保存的预设都必定 400（实测，见
 * `backend/tests/test_workflow_preset_node_types.py` 的头部）。
 *
 * 关键的一点：前后端两张模板表对 `type` 这个键的**含义**根本不一致，不只是取
 * 值不同。`apps/workflow/services.py::WORKFLOW_TEMPLATES` 的 `type` 写的就是
 * `NodeType` 成员；这里的 `type` 写的是步骤名。所以这不是
 * `apps/workflow/node_shape.py` 处理的那类问题——那里是同一个值的两种**拼法**
 * （`name` ↔ `node_name`），一张改名表就够；这里是一个标签需要被**判读**成一
 * 个枚举，而且同一个标签在不同节点上判读结果可以不同（后端就把
 * 「秦广王 · 分流」记作 TRIAL、把「案件分类」记作 EVALUATION）。改名表表达不
 * 了判读，所以这里是一张决策表。
 *
 * 为什么这张表在前端
 * ------------------
 * 1. 词汇是预设自己的。新增预设节点时新的步骤名写在 `workflow-templates.ts`
 *    里，红必须出现在作者正在编辑的那一侧——`src/__tests__/presetNodeTypes.test.ts`
 *    就在这里断言这张表对预设是全覆盖的。放到后端，红会出现在一个写预设的人
 *    永远不会打开的文件里。
 * 2. `node_shape.py` 自己的说明把 ChoiceField 列为「规范形状」胜出的理由之一：
 *    「它是唯一经过校验边界到达的形状……另一种形状的 `type` 是自由文本（前端
 *    预设把「分流」「初审」……写在那里），未经校验地拷进一个 `choices` 受限的
 *    列」。让后端认这四十个中文串，等于把那条性质删掉，而且第四十一个标签仍
 *    然要么被静默归一、要么照样 400。
 * 3. 影响面。后端一张表会作用于所有租户的所有存储模板（包括手工改过的行），
 *    永远有效；这张表只作用于内置的 17 套预设，也就是真正出问题的那一批。
 *
 * 后端仍然守着自己的边界：`WorkflowTemplateNodeSerializer.node_type` 的
 * ChoiceField 一行没动，`normalize_template_node` 另外把**已存**行里越界的
 * `node_type` 归一到 TRIAL（见 `node_shape.py`）——那是修已经落库的数据，不是
 * 放宽入口。
 *
 * 判读规则
 * --------
 * 逐条判断按这个次序问，第一个命中的就是答案：
 *
 *   1. 这一步是在**执行**一个已经作出的处置，而不是作出处置？ → EXECUTION
 *   2. 这一步是**受理**一桩申诉/冤情？ → APPEAL
 *      （受理之后的复审、复核是 TRIAL——后端「魏征 · 察查司」= APPEAL 而同一
 *       套流程后三节点 TRIAL/TRIAL/FINAL，规则从那里读出来的）
 *   3. 这一步是在**衡量或分类**，本身不裁断案子？ → EVALUATION
 *   4. 这一步是裁断，且是本预设里**最后一次**裁断？ → FINAL
 *   5. 否则是裁断 → TRIAL
 *
 * 这套规则不是发明的：后端 `WORKFLOW_TEMPLATES` 与本文件共有 12 个同名节点，
 * 规则对这 12 个的判读与后端逐条一致，
 * `backend/tests/test_workflow_preset_node_types.py::test_the_two_sides_agree_on_a_shared_node_s_type`
 * 断言这一点。唯一的例外在后端一侧：`create_from_judgment` 无模板时兜底造的
 * 「审批节点」是单节点却记作 TRIAL——它是占位符不是被建模的步骤，没有跟着改。
 */

/** `apps/workflow/models.py::NodeType` 的五个成员。 */
export type NodeTypeMember = "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";

/**
 * 每个预设步骤名判读成哪个 `NodeType`。
 *
 * 键是 `WorkflowNodeTemplate.type` 的取值，全集由
 * `src/__tests__/presetNodeTypes.test.ts` 对着 `WORKFLOW_TEMPLATES` 双向核对：
 * 少一个键（新增预设漏映射）红，多一个键（步骤名改了没删）也红。
 */
export const PRESET_NODE_TYPE: Record<string, NodeTypeMember> = {
  // ── 中国 ────────────────────────────────────────────────────
  // 十殿是一条审级链：每一殿都作裁断，前九殿都不是最后一殿。后端
  // WORKFLOW_TEMPLATES 的同名十节点逐条记作 TRIAL×9 + FINAL。
  分流: "TRIAL",
  初审: "TRIAL",
  二审: "TRIAL",
  三审: "TRIAL",
  四审: "TRIAL",
  五审: "TRIAL",
  六审: "TRIAL",
  七审: "TRIAL",
  八审: "TRIAL",
  // NodeType.FINAL 的中文标签就是「终审」。转轮王 · 终审 / 酆都大帝 · 终审
  // 在后端也是 FINAL；欧洲的 Christ · 公审判、Christ · 终审与埃及三处
  // Osiris · 终审同样是各自流程里最后一次裁断。
  终审: "FINAL",
  // 受理一桩申诉：魏征 · 察查司在后端记作 NodeType.APPEAL，这里的
  // 「申诉受理」（欧洲）与「Isis · 受理」（埃及）是同一个动作。受理不裁断
  // 案情，它决定申诉是否进入流程——APPEAL 正是为申诉环节留的成员。
  申诉受理: "APPEAL",
  // 受理之后的重审/复核是审判工作，不是受理。后端把「原殿阎王 · 复核」和
  // 「上级殿阎王」都记作 TRIAL——流程的申诉属性由 ApprovalWorkflow.is_appeal
  // 与 case_type=APPEAL 承载，不需要每个节点再重复一遍。
  原殿复核: "TRIAL",
  上级复核: "TRIAL",
  // 城隍初审：地方一级的初审，后端同名节点 TRIAL。
  地方初审: "TRIAL",
  // 十殿联审：十王合议仍是裁断，且后面还有酆都终审。后端同名节点 TRIAL。
  联审: "TRIAL",
  // 案件分类（跨域流程第一步）：名字说的是一件事不是一个人
  //（NODES_THAT_NAME_NO_ACTOR），没有判官的分类是衡量不是审判。后端同名节点
  // 记作 EVALUATION——这也是这张表**不能**只按「分流」一个键来的原因：后端把
  // 「秦广王 · 分流」判作 TRIAL、把「案件分类」判作 EVALUATION，同一个旧标签
  // 「分流」要两个答案。所以跨域第一步的 type 已改写成它自己的名字。
  案件分类: "EVALUATION",
  // 枉死城登记：登记动作，不衡量也不裁断，写一条记录而已。
  登记: "EXECUTION",
  // 城隍申诉审理：冤死者的申诉在这里被受理并审理，本预设没有另设受理节点
  //（n1 是登记入城，不是受理冤情）。判作 FINAL 会把这条流程唯一表明「这是冤
  // 情通道」的信号抹掉，而枉死城整套预设就是为冤死者存在的。
  申诉: "APPEAL",
  // 地藏王菩萨 · 超度：超度是施于亡魂的法事，地藏不在此裁断。
  超度: "EXECUTION",
  // 寿数折抵：亡魂在枉死城等到本该有的阳寿走完。这是把后果执行完，不是裁断，
  // 也不是为了得出一个结论而衡量。**这是全表最勉强的一条**：折抵本身含算术，
  // 读成 EVALUATION 也讲得通；取 EXECUTION 是因为这一步的主体是「服完」而不是
  // 「算出」，算出的部分在别处已经完成。
  等待: "EXECUTION",
  // 罪行核定（阿鼻流程第一步）：核定五逆十恶的轻重，为第二步的入狱定性。
  // 衡量在前、执行在后，与后端「忏悔赦免审核」= EVALUATION 同形。
  罪行评定: "EVALUATION",
  // 阿鼻地狱入狱 / Satan · 第九层收监：判决的执行。
  入狱执行: "EXECUTION",
  // 功德核定：功德与阈值（≥500）相比较，教科书式的衡量。
  功德评定: "EVALUATION",
  // 轮回分流（直送轮回流程第二步）：这套流程的前提就是不审——功德≥500 直接
  // 轮回，唯一的裁断在 n1 的功德核定。名字说的是一件事不是一个人，所以这一步
  // 是把已定的结果送出去。十殿流程里真正作裁断的第十殿节点是「转轮王 · 终审」，
  // 指名道姓且记作 FINAL，两者不是一回事。
  轮回分流: "EXECUTION",
  // 三套紧急流程共用的受理动作，名字说的是一件事不是一个人。它确认案件够得上
  // 紧急队列——是对案件的分诊，与「案件分类」同形，故 EVALUATION。它不是申诉
  // 受理：这三套流程受理的是新案，不是对既有裁断的再审。
  //
  //（原句写的是「这三套流程的 case_type 是 EMERGENCY 不是 APPEAL」。`EMERGENCY`
  // 从来不是 `CaseType` 的成员，那正是这三套预设保存必定 400 的原因；三套现已分别
  // 归入 SPECIAL / ROUTINE / DIVINE_TRIAL，理由见 workflow-templates.ts 里
  // CHINESE_EMERGENCY 顶部。分诊出来的「紧急」落在 ApprovalWorkflow.priority 上。）
  紧急受理: "EVALUATION",
  // 酆都大帝直审：紧急案件直达酆都，跳过十殿审级。酆都大帝之上没有更高的一级，
  // 他的话就是最后一句；后端两处「酆都大帝 · 终审」也都是 FINAL。
  直审: "FINAL",

  // ── 欧洲 ────────────────────────────────────────────────────
  // Christ · 私审判：CCC 1021-1022 死时的个别裁断，是裁断，且后面还有公审判。
  私审判: "TRIAL",
  // Michael · 引领入光 / 引领呈上：安魂弥撒奉献经的 signifer / repraesentet
  // ——掌旗引入、呈到台前。文件自己反复写明「引领的人不作裁断」，所以这是对
  // 亡魂施加的动作而非裁断。
  引领: "EXECUTION",
  // Aeacus / Rhadamanthus · 分区审判：《高尔吉亚篇》524a 按亡魂来处并列分区
  // 各自审判，是裁断；Minos 的终裁在后面，所以不是最后一次。
  分区审判: "TRIAL",
  // Minos · 终裁：524a「to Minos I will give the privilege of the final
  // decision」，字面上的最终裁定。
  终裁: "FINAL",
  // Minos · 判定圈层：《地狱篇》V.4-15「Judges, and sends according as he
  // girds him」——他**判**并且发送。步骤名沿用了更早的「分类」说法，但节点做
  // 的事是裁断；本预设第二步是收监（执行），所以这是唯一也是最后一次裁断。
  罪行分类: "FINAL",
  // Christ · 紧急审判 / Osiris · 紧急审判：队列的紧急程度改变不了谁审判，两处
  // 都是各自宇宙里唯一的审判者作出的、无可再上诉的裁断，且是流程最后一步。
  紧急审判: "FINAL",

  // ── 埃及 ────────────────────────────────────────────────────
  // Anubis · 引导与称量：图版 III 铭文称他「O weigher of righteousness」，
  // BD 30B「him who keepeth the scales」——他**操秤**，不是判官（文件的埃及一节
  // 反复写明这点）。称量产出的是一个量度，判词由托特宣读、九神会批准、
  // 奥西里斯接纳。所以是衡量。
  //
  // 后端同一套流程里的节点现在叫「阿努比斯 · 引导与称量」，也记作 EVALUATION
  //（`apps/workflow/services.py`，已落库的行由 workflow/0012 更正）。它此前叫
  //「阿努比斯 · 引渡审判」并记作 TRIAL，即名字与类型各说了一遍「阿努比斯是判官」
  // 这个被否定的读法；两边现已一致。节点名仍不逐字相同——后端用中文神名、本文件
  // 用英文——所以两张表不构成同名冲突，各自的命名习惯保留。
  灵魂引导: "EVALUATION",
  // 42审判者 · 否定告白：四十二条否定告白是入殿时一次说完的**陈述**（BD 125），
  // 四十二判官不作审级裁断——文件正是为此把「初审」改成了「否定告白」。判作
  // TRIAL 会把那次改名撤销回去。步骤名里的「审判」二字是同一处旧读法的残留。
  // 后端的同一个节点此前叫「四十二神官 · 罪行核实」并记作 TRIAL（「核实」把陈述
  // 说成了由判官执行的核查），现已改名为「四十二神官 · 否定告白」并同样记作
  // EVALUATION。
  "42审判": "EVALUATION",
  // Thoth · 记录与宣读判词：他持芦苇笔与调色板**记录**，再向九神会宣读。判词
  // 不是他的，接纳在 n4 的奥西里斯。记录一个量度即衡量。
  功过记录: "EVALUATION",
  // Ammit · 吞噬：只在心脏未通过时动作，是判词之后的否定后果（「第二次死亡」）。
  // 她不裁断任何事。lore 测试锁定这个步骤名本身
  //（workflowTemplateLore.test.ts：每个 Ammit 节点的 type 必须是「失败分支」）。
  失败分支: "EXECUTION",
  // Nephthys · 复核：埃及申诉流程里 Isis 受理之后的重审，与中国的
  // 「原殿阎王 · 复核」同形，后面还有 Osiris 终审。
  复核: "TRIAL",
  // 功德评定（死后世界分流第一步，节点名与「功德核定」的步骤名互为镜像）：
  // 按生前功德衡量，名字说的是一件事不是一个人。
  // Osiris · 判入芦苇原：文件的注写明「分流的**裁定**在两真之殿作出；芦苇原
  // 只是通过者的去向」，n2/n3 是同一个判决的两条分支。裁定在这一步作出，且
  // n3 是失败分支（执行），所以这是最后一次裁断。
  // Horus · 引见：图版 IV，他牵着**已获判无罪**的亡者的手引入神龛，角色是
  // CONDUIT。与 Michael 的引领同形。
  引见: "EXECUTION",
};

/**
 * 一个预设步骤名对应的 `NodeType`。
 *
 * 没有映射时**抛错，不回退**。回退到 TRIAL 意味着替一个没人判读过的步骤发明
 * 一个类型，然后把它静默地存进模板——那正是本次要修的缺陷本身，只是下沉了一
 * 层：不再是 400，而是一条谁也没决定过的数据。
 *
 * 这条分支在 `src/__tests__/presetNodeTypes.test.ts` 绿着的时候不可达：那个
 * 测试断言 `PRESET_NODE_TYPE` 覆盖 `WORKFLOW_TEMPLATES` 里出现过的每一个
 * `type`，而本函数只被预设的 `type` 调用。
 */
export function nodeTypeFor(step: string): NodeTypeMember {
  const mapped = PRESET_NODE_TYPE[step];
  if (!mapped) {
    throw new Error(
      `workflow preset step 「${step}」 has no NodeType in PRESET_NODE_TYPE ` +
        `(src/config/workflow-node-types.ts). Saving it would POST an invalid ` +
        `node_type and the API would answer 400. Decide which of TRIAL / ` +
        `EVALUATION / APPEAL / FINAL / EXECUTION this step is and record it ` +
        `there, with the reason.`
    );
  }
  return mapped;
}
