# 第十九批 · 第十八批落地反馈 + egy 待定 50 条 + 4 处请定(2026-10-11)

第十八批(灵魂端两步验证)已按稿落地。这一批三件事：落地时和稿不一样的地方请确认；新增文案 50 条请给 egy；另有 4 处没有稿的小界面请定。

---

## 一、灵魂端两步验证：落地与稿的出入

**1. 开启前要先输当前密码(产品加的，稿上没有)。**
原因：已登录就能直接开启的话，偷到登录状态的人可以给账号绑上自己的验证器，把本人锁在外面。现在的做法：密码框放在第 ① 步页底，点「我已装好 · 下一步」时一并提交，步数仍是 1/3、2/3、3/3，没有多出一屏。官员台和官员 App 的开启向导也同样加了。
请看：密码框放在第 ① 步页底是否合适，还是你想单独排一下。相关新文案在下表 `soul_app.mfa.intro.password_hint`、`mfa.setup.password_*`。

**2.「存为文件」做了。** 点了之后出系统分享面板，由灵魂自己选存到哪；面板关掉后临时文件立刻删除。文件第一行是一句说明，第二行是灵魂编号，下面是 10 个恢复码。说明那一句是新文案(`soul_app.mfa.codes.file_header`)，存失败的提示是 `codes.save_failed`。

**3. 官员台「关闭两步验证」的确认弹层多了一步「输入灵魂编号」。**
你的规格是「理由必填 + danger 确认按钮」。我们的界面规矩是：红色的确认键只出现在「先输入名称才能点」的对话框里(删除角色、重置官员两步验证都是这样)。所以这个弹层是：三条后果说明 → 理由(必填) → 输入灵魂编号 → 红色「关闭」。请确认，或告诉我们这里可以例外。

**4. 标「复用」的 key 没有全部直接复用。** 官员那几条的中文是「动态码」，而你定了灵魂端说「6 位数字」。所以中文不同的那些新建在 `soul_app.mfa.*` 下，egy 沿用你指的那一条；中文完全相同的三处(标题、「验证」、设置行)才直接用官员的 key。显示结果与你的表一致。

**5. `intro.no_app_body` 的 egy 被词表守卫拦下了。** 原因是句子里的 `Authenticator`(拉丁词，不在词表)。这一条现在显示中文。请定：把 `Authenticator` 登记为允许的专名，还是 egy 这一句换个说法(中文里它是让灵魂去应用商店搜的关键词)。

**6. 设置页的「语言」「通知」仍是页内的控件**，没有做成带 › 的子页(稿上画的是带 ›)。分组与顺序照稿：偏好 / 账号安全 / 关于 / 退出登录，灵魂编号在页底。请定要不要改成子页。

**7. 发图图标已换上**，读屏标签用 `soul_app.chat.image.button`。

**8. 重新生成恢复码只要点确认(照你的稿)。** 提醒一个后果：偷到登录状态的人可以用它让本人手里的恢复码作废。你若想让它也输一次 6 位数字或密码，请说。

---

## 二、没有稿的 4 处，请定(都已按现有组件先做出来)

**A. Web 帖子卡片 ·「编辑」与「已编辑」。**
官员现在可以编辑自己发的帖子(文字与可见范围；图片不能改)。入口是卡片头部「删除」旁边的一个文字按钮「编辑」，点开是一个弹层：预填原文、可见范围、「保存」(内容没变时不可点)、取消时有未保存改动会先确认。正文被改过的帖子在可见范围后面显示「已编辑」，悬停显示「编辑于 时间」；审核后台的帖子上同样显示。
请看：入口的位置、「已编辑」的位置与样式。

**B. Web 移交 ·「取消移交」。**
发起方在对方批准之前可以取消。详情页和「我方发起的」列表里各有一个「取消移交」，点开是确认弹层：理由(必填)+ 确认。对方批准后这个入口消失。
请看：按钮在详情页动作区里的位置与样式(现在是次级按钮)；确认键要不要用红色(照我们的规矩，红色就要加「输入名称」一步；现在没用红色)。

**C. Web 仪表盘待办条 · 第四格「待重发的调拨」。**
你的稿是三格(待认领 / 待我审批 / 死亡同步异常)。新增第四格放在最后：受刑计划里被执行地拒绝或取消、等原属判官重新发起的调拨。只有能执行判决的人看得到。有的时候显示数字与「去处理 →」，没有时是 0 与「已清空」，和另外三格一致。
请看：四格在桌面与 393 宽下的排法；这一格的标题(现在是 `dashboard.todo.resend_dispatch`)。
另：官员 App 里这类待办**还没有**呈现。你定过官员 App 待办五组的顺序，我们没有擅自加第六组。请定：加一组(排在哪)，并进「移交」组并加行内标记，还是官员 App 不显示。

**D. 官员 App 通知页 · 四种移交通知点了没有落点。**
移交的提案 / 批准 / 驳回 / 取消现在都有了本地化的专门通知。官员 App 的通知页点它们目前不跳转：批准与驳回是发给发起方的，而官员 App 的移交详情只有接收方视角(批准 / 驳回对方的提案)。
请定：发起方视角的移交在官员 App 里要不要有一个只读的详情屏；没有的话这几条通知点了就只标已读(现状)。

---

## 三、egy 待定 50 条

占位符请原样保留(单括号、双括号都照中文那一列)。egy 暂时显示中文。用处：
- `official_notify.dispatch_*`：移交的四种站内通知(驳回有带理由与不带理由两句)。只发站内，不发邮件，不上锁屏。
- `dispatch.cancel_*`：取消移交的按钮、弹层与提示。
- `social.*`：帖子编辑弹层、放弃改动的确认、「已编辑」。
- `soul_accounts.account.mfa_reset.*`：官员台关闭灵魂两步验证的弹层。
- `soul_app.mfa.*`、`mfa.setup.*`：开启前输密码、存为文件相关。
- `dashboard.todo.*`、`sentence_plan.last_refusal_redispatched`：待办第四格、「已重发 N 次」。
- `breadcrumb.menu.recycle_bin`：侧边栏新加的「回收站」入口(系统设置下，仅管理员)。
- `auth.reset_open_in_app`：网页重置密码页上的「在官员 App 中打开」。
- `notifications.open_dispatch`：通知页里移交通知上的「打开移交」。

### `auth`(1 条)

| key | 中文 | English |
|---|---|---|
| auth.reset_open_in_app | 在官员 App 中打开 | Open in the officer app |

### `social`(9 条)

| key | 中文 | English |
|---|---|---|
| social.post_updated | 已保存 | Saved |
| social.post_update_error | 保存失败 | Failed to save post |
| social.edit_title | 编辑帖子 | Edit post |
| social.edit_discard_title | 放弃修改? | Discard changes? |
| social.edit_discard_message | 已改动的内容不会保存。 | Your edits will not be saved. |
| social.edit_discard_confirm | 放弃修改 | Discard changes |
| social.edit_keep | 继续编辑 | Keep editing |
| social.edited | 已编辑 | Edited |
| social.edited_at | 编辑于 {{time}} | Edited {{time}} |

### `dashboard.todo`(2 条)

| key | 中文 | English |
|---|---|---|
| dashboard.todo.resend_dispatch | 待重新发起的调拨 | Dispatches to send again |
| dashboard.todo.go_resend | 去处理 → | Handle → |

### `sentence_plan`(1 条)

| key | 中文 | English |
|---|---|---|
| sentence_plan.last_refusal_redispatched | 已重发 {{n}} 次 | Sent again {{n}} time(s) |

### `dispatch`(9 条)

| key | 中文 | English |
|---|---|---|
| dispatch.cancel_dispatch | 取消移交 | Cancel dispatch |
| dispatch.cancel_title | 取消这次移交? | Cancel this dispatch? |
| dispatch.cancel_warning | 对方还没有批准。取消后这次移交作废,灵魂仍留在本殿,对方会收到通知。 | The other hall has not approved it yet. Cancelling voids the dispatch, the soul stays in this hall, and the other hall is notified. |
| dispatch.cancel_reason | 取消理由 | Reason for cancelling |
| dispatch.cancel_placeholder | 请说明为什么取消 | Say why you are cancelling |
| dispatch.confirm_cancel | 确认取消移交 | Cancel the dispatch |
| dispatch.cancel_success | 移交已取消 | Dispatch cancelled |
| dispatch.cancel_error | 取消移交失败 | Could not cancel the dispatch |
| dispatch.cancel_not_cancellable | 对方已经处理了这次移交,不能再取消 | The other hall has already acted on this dispatch; it can no longer be cancelled |

### `breadcrumb.menu`(1 条)

| key | 中文 | English |
|---|---|---|
| breadcrumb.menu.recycle_bin | 回收站 | Recycle Bin |

### `soul_app.mfa`(6 条)

| key | 中文 | English |
|---|---|---|
| soul_app.mfa.copied | 已复制 | Copied |
| soul_app.mfa.wrong_password | ! 密码不对 | ! That password is wrong |
| soul_app.mfa.intro.no_app_body | 在手机的应用商店搜索「验证器」或「Authenticator」，免费的任选一款。已经装过的，直接下一步。 | Search your phone's app store for “authenticator”; any free one will do. If you already have one, go straight on. |
| soul_app.mfa.intro.password_hint | 先输入当前密码，确认是你本人。 | Enter your current password first, to show it is you. |
| soul_app.mfa.codes.file_header | 灵魂簿恢复码：手机丢了或换了，用恢复码登录。每个只能用一次。请存在这部手机以外的地方。 | Soul Ledger recovery codes: sign in with one if you lose or change your phone. Each works once. Keep them somewhere other than this phone. |
| soul_app.mfa.codes.save_failed | 没能存成文件 | Could not save the file |

### `soul_accounts.account`(7 条)

| key | 中文 | English |
|---|---|---|
| soul_accounts.account.mfa_reset.title | 关闭 {{name}} 的两步验证？ | Turn off two-step verification for {{name}}? |
| soul_accounts.account.mfa_reset.consequence_1 | 验证器密钥、恢复码和「这部手机不再询问」全部作废；已登录的设备要重新登录。 | The authenticator key, the recovery codes and every “don't ask again on this phone” are voided; signed-in devices must sign in again. |
| soul_accounts.account.mfa_reset.consequence_2 | 灵魂之后只凭密码登录，并会在通知里看到是哪位官员关闭的。 | From then on the soul signs in with its password alone, and sees in its notifications which officer turned it off. |
| soul_accounts.account.mfa_reset.consequence_3 | 只能关闭，不能替灵魂开启；灵魂可以自己再开启。 | It can only be turned off, never on, for a soul; the soul can turn it on again itself. |
| soul_accounts.account.mfa_reset.done | 已关闭两步验证 | Two-step verification turned off |
| soul_accounts.account.mfa_reset.not_enabled | 这个灵魂没有开启两步验证 | This soul has not turned two-step verification on |
| soul_accounts.account.mfa_reset.not_home_hall | 只有灵魂所属的本殿官员能关闭它的两步验证 | Only an officer of the soul's own hall can turn off its two-step verification |

### `official_notify.dispatch_proposed`(2 条)

| key | 中文 | English |
|---|---|---|
| official_notify.dispatch_proposed.title | 收到移交提案 | Dispatch proposal received |
| official_notify.dispatch_proposed.body | {{source}} 提议把灵魂「{{soul}}」移交到你殿，等你批准。 | {{source}} proposes to send soul {{soul}} to your hall. It awaits your approval. |

### `official_notify.dispatch_approved`(2 条)

| key | 中文 | English |
|---|---|---|
| official_notify.dispatch_approved.title | 移交提案已批准 | Dispatch proposal approved |
| official_notify.dispatch_approved.body | {{target}} 批准了你殿移交灵魂「{{soul}}」的提案。 | {{target}} approved your hall's proposal to send soul {{soul}}. |

### `official_notify.dispatch_rejected`(2 条)

| key | 中文 | English |
|---|---|---|
| official_notify.dispatch_rejected.title | 移交提案被驳回 | Dispatch proposal rejected |
| official_notify.dispatch_rejected.body | {{target}} 驳回了你殿移交灵魂「{{soul}}」的提案。理由：{{reason}} | {{target}} rejected your hall's proposal to send soul {{soul}}. Reason: {{reason}} |

### `official_notify.dispatch_rejected_bare`(2 条)

| key | 中文 | English |
|---|---|---|
| official_notify.dispatch_rejected_bare.title | 移交提案被驳回 | Dispatch proposal rejected |
| official_notify.dispatch_rejected_bare.body | {{target}} 驳回了你殿移交灵魂「{{soul}}」的提案。 | {{target}} rejected your hall's proposal to send soul {{soul}}. |

### `official_notify.dispatch_cancelled`(2 条)

| key | 中文 | English |
|---|---|---|
| official_notify.dispatch_cancelled.title | 移交提案已被发起方取消 | Dispatch proposal cancelled by its sender |
| official_notify.dispatch_cancelled.body | {{source}} 取消了移交灵魂「{{soul}}」的提案。理由：{{reason}} | {{source}} cancelled its proposal to send soul {{soul}}. Reason: {{reason}} |

### `notifications`(1 条)

| key | 中文 | English |
|---|---|---|
| notifications.open_dispatch | 打开移交 | Open the dispatch |

### `mfa.setup`(3 条)

| key | 中文 | English |
|---|---|---|
| mfa.setup.password_hint | 先输入当前密码，确认是你本人。 | Enter your current password first, to show it is you. |
| mfa.setup.password_wrong | 密码不对 | That password is wrong |
| mfa.setup.password_locked | 密码尝试过于频繁,请稍后再试 | Too many password tries; try again later |

---

## Design 回复

(待填)
