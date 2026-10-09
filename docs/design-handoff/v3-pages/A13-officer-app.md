# A13 · 官员端 App「灵魂簿 · 官员」(Design 2026-10-09,v3-batch9-officer-app-reply.md)

画面取自 Design 项目「SoulLedger v3」中 `templates/soulledger-v3-pages/` 的 `OfficerApp`(393)。props:
- `tab`:todo / queue / search / notices / me
- `state`:normal / loading / empty / error / denied
- `detail`:none / approval / reject / empty / fail
- `highlight`、`theme`

## 一、形态
- **单独做一个 App**:与灵魂端共用组件包(Screen、Notice、列表行、令牌)。
  - 官员账号和灵魂账号不重叠。
  - 官员端必须两步验证(A12),会话更短。
  - 两边的推送类别、锁屏规则分开：官员端锁屏只写「有 N 件待你处理」。
- **品牌标**:九笔天平标。灵魂端是金标配品牌底;官员端是墨标配纸色底，冷启动用同一套九笔动画，换成纸底墨笔。
- **范围**
  - 做：审批、改派、缩短冷却、转生申请四类待办(看详情、做决定);审判的认领、查看、写评议;通知;只读查灵魂;问一问;个人设置。
  - 不做：宣判与盖印;流程编辑器、权限矩阵、界域拓扑、殿设置、用户管理。
  - 案子页底部放「在电脑上继续」,发一个链接到官员台的同一页。

## 二、页签(底栏 56,五等分)
| 页签 | 字形 | 内容 |
|---|---|---|
| 待办 | ◐ | 按四类分组，组标题写数量 |
| 审判 | § | 「我手上 / 待认领」;待宣判的行写「◇ 待宣判 · 请在官员台」 |
| 查询 | ⌕ | 分段切换「查灵魂(只读)/ 问一问(官员版)」 |
| 通知 | ○ | 与官员台通知中心同一数据源;未读 ● 粗体，已读 ○ |
| 我的 | □ | 个人信息、两步验证、语言、主题、推送、关于、退出 |

- 当前页签用文明色，字重 600。
- 底栏 surface-1,顶边 1px line。

## 三、身份带
- `Plaque3` compact,高 48,显示官员所属的殿，不随灵魂变化。
- 外文明的暂居灵魂只在行内和详情里用字形加文字标出，如「▲ 埃及杜阿特 · 暂居」;不用文明色。

## 四、决定流程
- **底栏三个按钮**,都是 44 高、方角：
  - 「加签」:次要按钮;
  - 「驳回」:墨色描边;
  - 「批准」:primary。
- **批准**:底页「批准这一签？」,列出对象和后果，按钮「确认批准」。
- **驳回**:底页「驳回这一签？」,写明「驳回后流程退回{发起人},不能撤回」;下面是「驳回理由 · 必填，发起人会读到」。
  - 理由为空时，在点确认那一刻才标红并提示「! 驳回必须写理由」;按钮不预先禁用。
  - 确认按钮是墨色实底，不用文明色。
- **失败**:底页内出 Notice「! 没能提交 · {原因}」,保留已写的理由。原因如：他人已代签、时限已过、权限已变、网络错误。
- 缩短冷却、转生申请的决定区沿用 A11 的字段，对话框改为底页。

## 五、推送落地
- 推送直接落到对应条目的详情。
- 返回列表后，那一行盖 `ink / .07`,1.2 秒淡出;系统开启「减少动态效果」时不显示。
- 条目已被别人处理时：顶部显示 Notice「○ 已由{人}处理」,不显示操作栏。

## 六、四种状态(每个页签都一样)
- **加载**:5 行骨架，每行 72 高，`aria-busy`。
- **空**:标题(衬线 600 20)加一句说明。
- **出错**:Notice「! 没取到」加「重试」(44)。
- **无权限**:「□ 没有权限」加「你的角色 {role} 看不到{区域}。需要时请找本殿管理员。」;页签不隐藏。

## 七、约束
- 按钮 44 高，方角。
- 列表行最小高 56 / 64 / 72 / 88;间距 4 / 8 / 12 / 16 / 24。
- 文明色只用在身份带、primary 按钮、导航当前项。
- 状态全部用字形加文字表示:◐ ◇ ○ ● ✓ ! □。

## 八、新增文案(egy 按词表处理)
| key | 中文 | English |
|---|---|---|
| officer_app.name | 灵魂簿 · 官员 | SoulLedger · Officers |
| officer_app.tabs.todo / queue / search / notices / me | 待办 / 审判 / 查询 / 通知 / 我的 | To do / Judgments / Look up / Notices / Me |
| officer_app.todo.title | 待我处理 | Waiting on me |
| officer_app.todo.groups | 审批节点 / 改派请求 / 缩短冷却申请 / 转生申请 | Approval steps / Reassignments / Cooling-off requests / Rebirth applications |
| officer_app.todo.empty_title / empty_body | 此刻没有轮到你的事 / 新的审批、改派和申请会推送给你。 | Nothing waiting on you / New approvals, reassignments and requests will be pushed to you. |
| officer_app.queue.mine / unclaimed | 我手上 / 待认领 | Mine / Unclaimed |
| officer_app.queue.empty_title / empty_body | 手上没有案子 / 到「待认领」里认领一件。 | No cases in hand / Claim one from Unclaimed. |
| officer_app.queue.desk_only | 待宣判 · 请在官员台 | Ready for verdict · use the desk |
| officer_app.queue.scope_note | 手机上可以认领、查看、写评议。宣判和盖印请在官员台完成。 | On the phone you can claim, read and comment. Verdicts and seals are done at the desk. |
| officer_app.continue_on_desk | 在电脑上继续 | Continue on desktop |
| officer_app.search.souls / ask | 查灵魂 / 问一问 | Souls / Ask |
| officer_app.search.placeholder / read_only | 名字或编号 / 只读。改动请在官员台进行。 | Name or ID / Read-only. Make changes at the desk. |
| officer_app.detail.your_step | 轮到你的节点 | Your step |
| officer_app.detail.cosign / reject / approve | 加签 / 驳回 / 批准 | Add signer / Reject / Approve |
| officer_app.confirm.approve_title / approve_ok | 批准这一签？ / 确认批准 | Approve this step? / Approve |
| officer_app.confirm.reject_title / reject_body / reject_ok | 驳回这一签？ / 驳回后流程退回{{name}}，不能撤回。 / 确认驳回 | Reject this step? / The flow goes back to {{name}}; this can't be undone. / Reject |
| officer_app.confirm.reason_label / reason_required | 驳回理由 · 必填，发起人会读到 / 驳回必须写理由 | Reason · required, the requester will read it / A reason is required to reject |
| officer_app.confirm.failed | 没能提交 · {{reason}} | Couldn't submit · {{reason}} |
| officer_app.landing.handled | 已由{{name}}处理 | Already handled by {{name}} |
| officer_app.state.error_title / error_body | 没取到 / 检查网络后重试。已打开的条目不受影响。 | Couldn't load / Check your connection and retry. Open items aren't affected. |
| officer_app.state.denied_title / denied_body | 没有权限 / 你的角色「{{role}}」看不到{{area}}。需要时请找本殿管理员。 | No access / Your role {{role}} can't see {{area}}. Ask your hall admin if you need it. |
| officer_app.push.lock | 有 {{n}} 件待你处理 | {{n}} items waiting on you |
| officer_app.me.push | 推送 | Push notifications |

## 我们的答复(2026-10-09,用户定)
- 分发方式：**上架商店**。所以登录要处理「哪个殿」:
  - 优先由账号推断(用户名全局唯一时，服务端按账号找到所属殿);
  - 推断不了时，登录前加一步「选殿」。
- 加签：**只限本殿的人**;跨殿加签留给官员台。
