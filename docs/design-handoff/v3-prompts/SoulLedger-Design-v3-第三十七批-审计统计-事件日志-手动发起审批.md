# 第三十七批 · 审计时间线与统计、全殿事件日志、手动发起审批(2026-10-17)

产品从 P3 里又挑了三件网页上的事。后端接口都已就绪，只差页面。下面每组都写了现状、后端给的字段，以及要你定的问题。
文末附本批埃及文补词。

---

## 一、审计 · 权限变更时间线与操作统计(W-9)

**现状**:审计页(`/audit`)有两个页签:「审计日志」「登录日志」(登录日志只给管理员)。列表有动作 / 资源 / 殿 / 日期(全部 · 7 天 · 30 天)筛选、
导出，同一请求的行合并、重复行折叠成 ×N、按日期分组。详情页有「变更」表(字段 / 前 / 后)。

**后端已有，页面没接**:

1. **权限变更时间线** `GET /audit-logs/timeline/`
   - 不带资源筛选时只返回 8 类权限资源：角色、角色权限、菜单、菜单按钮、字段权限、行级数据范围、数据范围、权限。
   - 可按资源(模糊)、动作、起止日期筛;最多 500 条，默认 50,按时间倒序，不分页。
   - 每行与审计列表同形：时间、操作人(显示名 / 用户名)、殿、动作、资源与编号、描述、变更(前 / 后)、IP、请求编号。
2. **操作统计** `GET /audit-logs/stats/`
   - 返回：按动作的条数分布(16 种动作)、受影响最多的资源前 20、总条数。
   - **没有任何筛选参数**:不能按日期、按殿筛，统计的是「本殿全部历史」(全局管理员是全部殿)。
   - 管理员和版主可看(本批起版主也开放)。

**要的稿**:
1. 两者放在哪：审计页加第三个页签「权限变更」? 统计放在列表上方的一条，还是单独页签?
2. 时间线的版式：按日分组的竖线时间线，还是沿用审计列表的表格?每一条要不要直接展开「变更」(前 / 后)?
3. 统计的样子：动作分布用横条还是数字格;「最常变动的资源」前 20 怎么排;没有日期筛选这件事要不要在界面上说明(「全部历史」)。
4. 空状态与「没有权限」的写法(没有审计读权限的人看不到这两块)。

---

## 二、全殿事件日志(W-13)

**现状**:事件只在灵魂详情页里按单个灵魂显示(「生命周期时间线」:系统事件默认收起，勾「含系统事件」才显示;
连续同类事件合并成 ×N)。没有「全殿所有灵魂的事件」页面。

**后端已有** `GET /events/`:
- 按殿与数据范围划界，持有灵魂读权限的人都能看。
- 筛选只有三项：灵魂、事件类型、操作人。**没有日期范围筛选**(如需要，我们后端加，很小)。
- 排序：按时间(默认倒序)或按事件类型。每页 20 条。
- 每条字段：时间、灵魂(编号 + 姓名)、事件类型、操作人、附加数据(只有「状态变更」和「功过重算」两类会读出具体内容:旧状态 → 新状态 · 原因;功过差值)。
- 会写进这张表的事件类型共 39 种(灵魂生命周期、审批流、调拨、死亡同步、灵魂账号与转生、受刑计划;社交事件与系统通知不进这张表)。
  本批已给灵魂时间线补齐了中英文名称(见附录)。

**要的稿**:
1. 页面放在哪(侧栏哪一组下面)，叫什么。
2. 一行的版式：时间 · 灵魂 · 事件 · 操作人 · 细节，哪些可点(点灵魂到灵魂详情?点操作人?)。
3. 筛选条：事件类型(39 种怎么选——按大类分组的下拉?)、操作人、灵魂搜索;要不要日期范围(要的话我们后端加)。
4. 系统事件默认收起还是展示(灵魂详情页是默认收起)。连续同类合并成 ×N 要不要沿用。

---

## 三、手动发起审批(W-11)

**现状**:审批流只能在审判结案时勾选「同时发起审批」生成。审批页「实例」页签只有列表、「只看已超时」和导出，没有「发起」入口。

**产品定了**:持有「发起审批」权限的官员(目前是管理员和版主，审判官没有)可以为**任一灵魂**手动发起审批，不必先有审判。

**后端已有** `POST /workflows/start/`:
| 字段 | 必填 | 说明 |
|---|---|---|
| 灵魂 | 是 | 本殿的灵魂(管理员可选任一殿) |
| 案件类型 或 模板 | 二选一 | 案件类型按灵魂的文明给出可选项(后端接口);模板列表已有，按灵魂文明与「启用」筛 |
| 优先级 | 否 | 普通 / 紧急 / 特急;不选就用模板默认 |
| 理由 | 是 | 最长 1000 字，记入审计 |
| 关联审判 | 否 | 必须是这个灵魂的审判 |

后端会拒绝的情况(每一种界面都要有一句话):
- 这个灵魂已有**同一案件类型**的审批在进行中(会带上那条审批的编号，界面可以给「去看那条」);不同类型可以并存。
- 灵魂不存在或不属于本殿;模板不属于本殿、未启用或文明不符;这个文明不接受该案件类型;关联的审判已经有审批了。
- 理由为空。没有发起权限。

**要的稿**:
1. 入口在哪：审批页「实例」页签右上角?灵魂详情页的 ⋯ 菜单?两处都要?
2. 发起弹层：选灵魂(搜索)、选案件类型还是选模板(还是两步：先类型，类型下有多个模板再选模板)、优先级、理由。
3. 成功后去哪(跳到新审批的详情?留在列表并提示?)。
4. 上面每种拒绝的提示写法;「已有同类审批进行中」时的「去看那条」。

---

## 附：埃及文补词

本批新上线的文案(灵魂时间线补齐的事件名、审计资源名),zh-Hans / en 已写好，请给 egy。共 23 条。

| key | zh | en |
|---|---|---|
| souls.events.SOUL_ACCOUNT_CREATED | 灵魂账号开通 | Soul account opened |
| souls.events.SOUL_ACCOUNT_RETIRED | 灵魂账号停用 | Soul account retired |
| souls.events.REBIRTH_APPLICATION_SUBMITTED | 转生申请提交 | Rebirth application submitted |
| souls.events.REBIRTH_STATUS_CHANGED | 转生申请状态变更 | Rebirth application status changed |
| souls.events.REBIRTH_CROSS_CIV_DECIDED | 跨文明转生裁定 | Cross-civilization rebirth decided |
| souls.events.COOLDOWN_SHORTENING_DECIDED | 缩短冷却裁定 | Cooldown shortening decided |
| souls.events.SENTENCE_PLAN_CREATED | 受刑计划生成 | Sentence plan created |
| souls.events.SENTENCE_NODE_ACTIVATED | 受刑节点开始 | Sentence stage started |
| souls.events.SENTENCE_NODE_WAITING | 受刑节点待前往 | Sentence stage awaiting the soul |
| souls.events.SENTENCE_NODE_COMPLETED | 受刑节点服完 | Sentence stage served |
| souls.events.SENTENCE_NODE_REFUSED | 受刑节点调拨被拒 | Sentence stage transfer refused |
| souls.events.SENTENCE_NODE_REDISPATCHED | 受刑节点重新调拨 | Sentence stage transfer resent |
| souls.events.SENTENCE_PLAN_AMENDED | 受刑计划变更 | Sentence plan amended |
| souls.events.SENTENCE_REQUEST_CREATED | 受刑请求提交 | Sentence request submitted |
| souls.events.SENTENCE_REQUEST_DECIDED | 受刑请求裁定 | Sentence request decided |
| souls.events.SENTENCE_PLAN_COMPLETED | 受刑计划服完 | Sentence plan completed |
| souls.events.SENTENCE_PLAN_CANCELLED | 受刑计划取消 | Sentence plan cancelled |
| audit.resources.soul | 灵魂 | Soul |
| audit.resources.user | 用户 | User |
| audit.resources.workflow | 工作流 | Workflow |
| audit.resources.judgment | 审判 | Judgment |
| audit.resources.soulrecord | 功过记录 | Soul record |
| audit.resources.permission | 权限 | Permission |


---

## Design 回复(2026-10-17)

稿:`templates/soulledger-v3-pages/Batch37Web.dc.html`(W-9a–c、W-13a–b、W-11a–c);决定与三语文案全文:`templates/soulledger-v3-pages/v3-batch37-reply.md`。

Design 定的:
- W-9:审计页四个页签(审计日志 · 权限变更 · 统计 · 登录日志)。统计单独成页签——放在列表上方，筛选后数字不动，会被当成筛选结果。
  权限变更是按日分组的竖线时间线，每条直接展开前 / 后(最多三行，另 N 项)，不折叠 ×N;默认 50 条，「显示更多」到 200、500。
- W-13:侧栏「灵魂」组「灵魂事件」(`/events`)。只有灵魂可点;×N 只在同一灵魂、同一事件、相邻时合并;系统事件默认收起;默认最近 7 天。
- W-11:两处入口(实例页签右上、灵魂详情 ⋯);一张表单先类型后模板;成功跳到新审批详情;每种拒绝一句话，「已有同类」带「去看那条」。
- 要后端补:`GET /events/` 加起止日期筛选。
- 新组合:`events.groups.punishment` = `Sesh Wetep`(处置的书),全库查过不撞车。
- 附录的 23 条事件名 / 资源名 egy 另行回复。
