# 第三十四批 · 功能缺口出稿(2026-10-16)

10-16 对网页、灵魂 App、官员 App 各做了一次只读检查，找出 35 处功能缺口。产品定了先做其中 21 处(P1 + P2)。
不需要新画稿的那些已经在做(复用现有组件)。下面 8 组需要你出稿和三语文案(zh-Hans / en / egy)。

产品另定了一条方向：**官员 App 要覆盖日常操作**。放回、暂缓、书信转派这些动作在手机上也能做;
只有宣判盖印、流程编辑仍然只在电脑上做。

每组都写了现状、要什么，以及后端已经有的东西。后端已有的接口不用改，你的稿只要落在这些字段和动作上。

---

## 一、网页 · 有判决的记录「删不掉」时改为归档(W-2)

**现状**:灵魂、审判、处置三类记录，如果已经有判决牵连，删除时后端返回 409 并标明「可以归档」。
网页只弹一句失败提示，没有下一步，管理员不知道该怎么办。

**后端已有**:三类各有归档、取消归档接口，归档时可以带理由。处置列表支持「显示已归档」。

**要的稿**:
1. 删除被拒时的提示：说明为什么不能删，并给出「改为归档」按钮。
2. 归档弹层：理由(选填还是必填，请定)和确认按钮。
3. 已归档记录在列表和详情里怎么显示，以及在哪里取消归档。
4. 列表上的「显示已归档」开关：三类列表都要，还是只做处置列表(后端目前只有处置列表支持)?

---

## 二、网页 · 机构页的增删改(W-4)

**现状**:机构页只能看树，不能新建、改名、移动、删除。后端是完整的增删改，权限码是 `org.manage`。

**要的稿**:
1. 树上每个节点的操作入口(行内菜单还是选中后出现操作)。
2. 新建和编辑表单。字段以后端为准，至少有名称、上级机构。
3. 移动节点：拖拽还是在表单里改上级?
4. 删除确认：节点下面还有子机构或人员时怎么处理(拒绝并说明原因，还是要求先移走)?

---

## 三、网页 · 用户 CSV 导入(W-5 的导入部分)

**现状**:导出按钮在做，复用案卷等页面现有的「导出 CSV」。导入接口已有，也会逐行校验，但页面上没有入口。

**要的稿**:导入弹层，包括选文件、预览、逐行错误清单、确认导入、导入结果。
灵魂档案的 CSV 导入已经有一套(逐行校验、编码提示、行号)。请定用户导入能不能直接沿用那套版式，还是要单独出稿。

---

## 四、官员 App · 批准前看清申请内容(O-01,最重要)

**现状**:审批详情只显示流程名、时间、加签人。官员在手机上批准时看不到这些:

- 当前是哪个节点；
- 申请从哪来、为什么；
- 前面几步是谁批的；
- 案卷附件。

调拨详情没有「从哪殿到哪殿」和理由，转生详情没有申请理由。

确认底页只有一句通用的「批准后流程进入下一步」。第九批原定这个底页要「列出对象和后果」。

**后端**:详情接口要补字段，我们这边会加。网页审批详情的「历史」和「附件」就是要补的内容。

**要的稿**:
1. 四类详情的字段版式：审批、调拨、转生、缩短冷却。
2. 历史步骤在手机上怎么排(时间线还是折叠列表)。
3. 附件怎么列，点开怎么看。可复用书信图片查看，PDF 用系统打开。
4. 批准、驳回确认底页上「对象和后果」的写法，四类各一句。

---

## 五、官员 App · 书信转派、归档、放回(O-04)

**现状**:官员在 App 里只能回信。后端和网页都能做指派给别人、取消指派、归档、取消归档，网页有指派弹窗。

**要的稿**:
1. 书信详情的操作入口：转给别人、放回(取消指派)、归档。
2. 选人：列表从后端「可指派的人」取，要不要带搜索?
3. 待办里要不要看到「未分配的信」?目前官员只看到分给自己的。

---

## 六、官员 App · 审判放回、暂缓、请求改派(O-09)

**现状**:手机上只能认领。认领错了只能去电脑上放回。从通知或搜索进入一个还没认领的案件，详情页上也没有认领按钮。

**后端已有**:放回、暂缓(带理由)、取消暂缓、请求改派(带理由)。

**要的稿**:
1. 审判详情的操作区：认领、放回、暂缓、恢复、请求改派，各在什么状态下出现。
2. 暂缓和请求改派的理由输入底页。

---

## 七、官员 App · 审判详情里的案情(O-10)

**现状**:审判详情只有编号、名字、法庭、认领人。官员能在手机上写评议，却看不到案情。

**要的稿**:案由、证据、附件在手机上怎么排。产品已定宣判和盖印只在电脑上做，所以这里只是看，不做判决。

---

## 八、官员 App · 通知按类别静音的入口(O-06)

**现状**:网页个人中心能按类别静音通知，官员 App 的推送这边正在改成也遵守这份设置。
但官员 App 的「我的」页没有入口，官员在手机上改不了。

**要的稿**:「我的」页里的入口，以及类别开关页。类别和网页一致，可参考灵魂 App 的「推送设置」页。

---

## 附：埃及文补词(31 条)

这两轮新上线的文案，zh-Hans / en 已在线上，请给 egy。`{{name}}` 原样保留。
「租户」沿用移交页现有的「来源租户 / 目标租户」叫法。

| key | zh | en |
|---|---|---|
| scheduler.jobs.officer_app_check_receipts | 官员推送:查回执 | Officer push: fetch receipts |
| users.reset_password.action | 重置密码 | Reset password |
| users.reset_password.confirm_title | 重置 {{name}} 的密码？ | Reset the password for {{name}}? |
| users.reset_password.confirm_body | 将生成一个新的随机密码，旧密码立即作废，此人所有已登录的设备都会退出，下次登录必须自己改密码。新密码只显示一次。 | A new random password is generated. The old one stops working at once, every device this person is signed in on is signed out, and they must change the password at next sign-in. The new password is shown only once. |
| users.reset_password.confirm | 确认重置 | Reset |
| users.reset_password.failed | 重置失败，请重试 | Reset failed, please try again |
| users.reset_password.shown_title | {{name}} 的新密码（仅此一次） | New password for {{name}} (shown once) |
| users.reset_password.shown_warning | 关闭窗口后无法再次查看。请立即告知本人；首次登录须修改密码。 | You cannot see it again after closing. Pass it on now; they must change it at first sign-in. |
| users.reset_password.copy | 复制密码 | Copy password |
| users.reset_password.copied | 已复制到剪贴板 | Copied to clipboard |
| users.reset_password.copy_failed | 复制失败，请手动抄写 | Copy failed, please write it down |
| users.reset_password.close | 我已记下，关闭 | I have noted it, close |
| users.reset_password.close_confirm_title | 密码只显示这一次 | The password is shown only once |
| users.reset_password.close_confirm_body | 密码只显示这一次，确定关闭？关闭后无法再次查看，需要重新重置才能拿到新密码。 | The password is shown only once. Close anyway? You cannot see it again; you would have to reset it to get a new one. |
| users.reset_password.close_confirm | 确定关闭 | Close |
| users.reset_password.close_back | 返回 | Back |
| judgment.claim.undefer | 恢复 | Restore |
| judgment.claim.done_undefer | 已恢复，案子回到队列 | Restored; the case is back in the queue |
| souls.detail.load_more | 加载更多记录 | Load more records |
| souls.detail.load_more_failed | 部分记录没有加载出来，请再点一次 | Some records did not load; try again |
| dispatch.filter.search | 搜索灵魂姓名或理由... | Search soul name or reason... |
| dispatch.filter.all_status | 所有状态 | All statuses |
| dispatch.filter.all_tenants | 所有租户 | All tenants |
| dispatch.filter.from | 发起日期（起） | Proposed from |
| dispatch.filter.to | 发起日期（止） | Proposed to |
| dispatch.filter.clear | 清除筛选 | Clear filters |
| officer_app.me.email | 邮箱 | Email |
| officer_app.notices.on_desk | 在电脑上查看 | View on the desk |
| officer_app.queue.deferred | 暂缓 | Deferred |
| officer_app.queue.others | 他人手上 | With others |
| officer_app.me.email_none | 没有邮箱：忘记密码时收不到重置邮件，请让管理员补上。 | No email on file: password-reset mail can't reach you. Ask an administrator to add one. |
