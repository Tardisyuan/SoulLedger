# officer_app.* 全表 · 2026-10-09

`packages/core/messages` 里 `officer_app` 树的现状:key / 中文 / English / egy。共 136 条,egy 已有 92 条、**待 Design 44 条**
(表里 egy 列写「—」;名单在 `frontend/src/__tests__/support/egyPendingKeys.json`)。

egy 取自第十批回复(`v3-pages/A14-officer_app.egy.json`)。有三类需要 Design 看一眼:

1. **Design 的 key 名与实现不一致**,按语义对到了现有 key(egy 值未改):`kinds.reassign` → `kinds.reassignment`;
   `mfa.verify` → `mfa.submit`;`mfa.error_wrong / error_expired / error_locked / error_network` → `mfa.reasons.wrong / expired / locked / network`;
   `login.choose_hall` → `login.hall_title`;`cosign.unavailable` 对到 `cosign.unavailable`(原 `cosign.no_endpoint`,2026-10-09 加签接口上线后改名,文案改为「现在不能加签，只能查看候选人。」)。
2. **占位符与实现对不上、没有导入**:`queue.claim_failed`(Design 带 `{reason}`,实现的「没能认领」不带)、`search.residing`(Design `{tenant}`,实现 `{where}` 且带 ▲)、
   `me.version`(Design 无占位符,实现 `{version}`)、`mfa.remember`(Design `{days}`,实现写死 30 天)、`mfa.error_wrong`(Design `{n}`)、`mfa.error_locked`(Design `{time}`)。
3. **违反词表规则、没有导入**:`confirm.reasons.network` 与 `mfa.reasons.network`(Design「Nen Aq Er Per Hemsu」,而 Hemsu 只允许出现在中文含系统/服务器/队列/连接的 key 里,第十四节)。

另:`queue.scope_note` 的 egy 值按 Design 原样保留(不含「写评议」);中文与 English 已恢复「写评议」(2026-10-09 评议接口上线)—— **egy 需 Design 补**。
`cosign.title / hint / ok`(Design 有、实现没有这三个 key)未导入。

| key | 中文 | English | egy |
|---|---|---|---|
| `officer_app.areas.notices` | 通知 | notices | — |
| `officer_app.areas.queue` | 审判 | judgments | — |
| `officer_app.areas.search` | 查询 | look-up | — |
| `officer_app.areas.todo` | 待办 | the to-do list | — |
| `officer_app.back` | 返回 | Back | Wehem Er Medjat Pehwy |
| `officer_app.banner.mfa_required` | 你的角色必须使用两步验证，但还没有设置。请到官员台完成设置。 | Your role must use two-step verification and it isn't set up yet. Set it up at the desk. | Aq Sep Sen: Nen Shu. Iri Emu. |
| `officer_app.comment.empty` | 还没有评议 | No comments yet | — |
| `officer_app.comment.failed` | 没能发表评议，稍后再试。 | Couldn't post the comment. Try again later. | — |
| `officer_app.comment.send` | 发表 | Post | — |
| `officer_app.comment.title` | 评议 | Comments | — |
| `officer_app.comment.write` | 写评议 | Write a comment | — |
| `officer_app.confirm.approve_body.approval` | 批准后流程进入下一步。 | The flow moves to the next step. | — |
| `officer_app.confirm.approve_body.cooldown` | 批准后冷却缩短到你填的天数。 | The cooling-off period is shortened to the days you enter. | — |
| `officer_app.confirm.approve_body.reassignment` | 批准后这次调拨成立。 | The dispatch goes ahead. | — |
| `officer_app.confirm.approve_body.rebirth` | 批准后这份转生申请进入下一步。 | This rebirth application moves to the next step. | — |
| `officer_app.confirm.approve_ok` | 确认批准 | Approve | Hesy |
| `officer_app.confirm.approve_title` | 批准这一签？ | Approve this step? | Hesy Sekhet Pen? |
| `officer_app.confirm.days_invalid` | 天数要是整数，且小于剩余天数 | Enter a whole number below the days left | — |
| `officer_app.confirm.days_label` | 批准天数 | Days to approve | — |
| `officer_app.confirm.failed` | 没能提交 · {{reason}} | Couldn't submit · {{reason}} | Nen Hab · {{reason}} |
| `officer_app.confirm.reason_label` | 驳回理由 · 必填，发起人会读到 | Reason · required, the requester will read it | Khet Khesef · Nen Shu · Tepy Iri Maa |
| `officer_app.confirm.reason_required` | 驳回必须写理由 | A reason is required to reject | Khesef: Sesh Khet Khesef |
| `officer_app.confirm.reasons.already_handled` | 他人已代签 | Someone else already signed | Iri Seth Em Ky |
| `officer_app.confirm.reasons.deadline_passed` | 时限已过 | The deadline has passed | Unut Khetem |
| `officer_app.confirm.reasons.network` | 网络错误 | Network error | — |
| `officer_app.confirm.reasons.other` | 服务器没有接受 | The server didn't accept it | Ky |
| `officer_app.confirm.reasons.permission_changed` | 权限已变 | Your permissions changed | Was Khemen Seth |
| `officer_app.confirm.reject_body` | 驳回后流程退回{{name}}，不能撤回。 | The flow goes back to {{name}}; this can't be undone. | Wat Iyi Er {{name}}; Nen Wehem Djer. |
| `officer_app.confirm.reject_ok` | 确认驳回 | Reject | Khesef |
| `officer_app.confirm.reject_title` | 驳回这一签？ | Reject this step? | Khesef Sekhet Pen? |
| `officer_app.confirm.remaining_days` | 还剩 {{n}} 天 | {{n}} days left | — |
| `officer_app.confirm.requester` | 发起人 | the requester | Tepy Iri |
| `officer_app.confirm.verdict_label` | 批准用的裁决 | Verdict to approve with | — |
| `officer_app.continue_on_desk` | 在电脑上继续 | Continue on desktop | Em Khet Em Medjat Sab |
| `officer_app.cosign.added` | 已加签。对方签完后，你的批准才生效。 | Signer added. Your approval counts once they have signed. | — |
| `officer_app.cosign.confirm` | 确认加签 | Add signer | — |
| `officer_app.cosign.duplicate` | 已经是联署人，或本来就能单独决定这一步。 | Already a co-signer, or already able to decide this step alone. | — |
| `officer_app.cosign.empty` | 没有可选的人 | Nobody to choose | — |
| `officer_app.cosign.not_eligible` | 这个人不能被加签（要是本殿、有审批权限的在职官员）。 | This person can't be added (an active officer of this hall who may approve). | — |
| `officer_app.cosign.search` | 搜索姓名或用户名 | Search name or username | — |
| `officer_app.cosign.unavailable` | 现在不能加签，只能查看候选人。 | Adding a signer isn't possible right now; you can only look at the candidates. | Redi Sab Hena Nen Wenen Djer: Maa Wa. |
| `officer_app.detail.approve` | 批准 | Approve | Hesy |
| `officer_app.detail.cosign` | 加签 | Add signer | Redi Sab Hena |
| `officer_app.detail.reject` | 驳回 | Reject | Khesef |
| `officer_app.detail.your_step` | 轮到你的节点 | Your step | Sekhet-Ek |
| `officer_app.kinds.approval` | 审批节点 | Approval step | Sekhet Wat Hesy |
| `officer_app.kinds.cooldown` | 缩短冷却申请 | Cooling-off request | Dbh Khebi Ahet Qebeh |
| `officer_app.kinds.reassignment` | 改派请求 | Reassignment | Dbh Hab Ky |
| `officer_app.kinds.rebirth` | 转生申请 | Rebirth application | Dbh Wehem Mesut |
| `officer_app.landing.handled` | 已由{{name}}处理 | Already handled by {{name}} | Iri Seth Em {{name}} |
| `officer_app.landing.someone` | 他人 | someone | Sab Ky |
| `officer_app.login.forgot_password` | 忘记密码 | Forgot password | Nen Rekh Sekhem |
| `officer_app.login.hall_body` | 这个账号在多个殿任职，请选择要进入的殿。 | This account serves in more than one hall. Choose which to enter. | — |
| `officer_app.login.hall_title` | 选择殿 | Choose a hall | Setep Wesekhet |
| `officer_app.login.password` | 密码 | Password | Sekhem |
| `officer_app.login.reasons.bad_credentials` | 用户名或密码不对 | Wrong username or password | — |
| `officer_app.login.reasons.locked` | 尝试次数过多，请稍后再试 | Too many attempts. Try again later | — |
| `officer_app.login.reasons.network` | 网络错误 | Network error | — |
| `officer_app.login.reasons.other` | 没能登录，请稍后再试 | Couldn't sign in. Try again later | — |
| `officer_app.login.submit` | 登录 | Sign in | Aq |
| `officer_app.login.username` | 用户名 | Username | Ren Aq |
| `officer_app.me.about` | 关于 | About | Khet Medjat Ba |
| `officer_app.me.hall` | 所属殿 | Hall | Wesekhet |
| `officer_app.me.language` | 语言 | Language | Medew Seth |
| `officer_app.me.logout` | 退出登录 | Sign out | Per Aq |
| `officer_app.me.logout_ok` | 退出 | Sign out | Per Aq |
| `officer_app.me.logout_title` | 退出登录？这台设备将不再收到推送。 | Sign out? This device will stop receiving pushes. | Per Aq? |
| `officer_app.me.mfa` | 两步验证 | Two-step verification | Aq Sep Sen |
| `officer_app.me.mfa_note` | 开启和管理请在官员台进行。 | Turn it on and manage it at the desk. | Wen Hena Iri: Em Medjat Sab. |
| `officer_app.me.mfa_off` | 未开启 | Off | Nen Wen |
| `officer_app.me.mfa_on` | 已开启 | On | Wen Seth |
| `officer_app.me.mfa_required_off` | 必须开启 · 尚未设置 | Required · not set up | — |
| `officer_app.me.name` | 姓名 | Name | Ren |
| `officer_app.me.profile` | 个人信息 | Profile | Djes |
| `officer_app.me.push` | 推送 | Push notifications | Sedjem Sab |
| `officer_app.me.push_denied` | 系统已关闭通知。请先在系统设置里放行。 | Notifications are off in system settings. | Smen Hemsu: Sedjem Sab Nen Wenen. Redi Wenen Em Smen Hemsu. |
| `officer_app.me.push_failed` | 没能开启推送，稍后再试。 | Couldn't turn push on. Try again later. | Nen Wen Sedjem Sab. Wehem Iri Er Khet. |
| `officer_app.me.push_note` | 锁屏只写有几件待办。 | The lock screen shows only a count. | Sedjem Sab Wa: Hesb Nen Iri-I Djer. |
| `officer_app.me.push_off` | 已关闭 | Off | Khetem Seth |
| `officer_app.me.push_on` | 已开启 | On | Wen Seth |
| `officer_app.me.push_unavailable` | 推送暂未启用。 | Push isn't available in this build. | Sedjem Sab Nen Wenen Djer. |
| `officer_app.me.role` | 角色 | Role | Netjer |
| `officer_app.me.theme` | 主题 | Theme | Hetep |
| `officer_app.me.theme_dark` | 深色 | Dark | Kem |
| `officer_app.me.theme_light` | 浅色 | Light | Hedj |
| `officer_app.me.theme_system` | 跟随系统 | System | Mi Hemsu |
| `officer_app.me.version` | 版本 {{version}} | Version {{version}} | — |
| `officer_app.mfa.body` | 输入验证器 App 上的 6 位动态码。 | Enter the 6-digit code from your authenticator app. | — |
| `officer_app.mfa.code_label` | 动态码 | Code | Medu Ahet |
| `officer_app.mfa.reasons.expired` | 这次登录已超时，请重新登录 | This sign-in timed out. Sign in again | Mut · Sesh Medu Renpi |
| `officer_app.mfa.reasons.locked` | 尝试次数过多，请稍后再试 | Too many attempts. Try again later | — |
| `officer_app.mfa.reasons.network` | 网络错误 | Network error | — |
| `officer_app.mfa.reasons.other` | 没能验证，请稍后再试 | Couldn't verify. Try again later | — |
| `officer_app.mfa.reasons.wrong` | 动态码不对 | Wrong code | Medu Ahet Nen Maat |
| `officer_app.mfa.recovery_body` | 输入一个还没用过的恢复码。 | Enter a recovery code you haven't used. | — |
| `officer_app.mfa.recovery_label` | 恢复码 | Recovery code | Medu Ankh Wehem |
| `officer_app.mfa.remember` | 在此设备上 30 天内不再询问 | Don't ask again on this device for 30 days | — |
| `officer_app.mfa.submit` | 验证 | Verify | Maa |
| `officer_app.mfa.title` | 两步验证 | Two-step verification | Aq Sep Sen |
| `officer_app.mfa.use_code` | 改用动态码 | Use an authenticator code | — |
| `officer_app.mfa.use_recovery` | 改用恢复码 | Use a recovery code | Medu Ankh Wehem |
| `officer_app.name` | 灵魂簿 · 官员 | SoulLedger · Officers | Medjat Ba · Sab |
| `officer_app.notices.empty_body` | 新的通知会出现在这里。 | New notices will appear here. | — |
| `officer_app.notices.empty_title` | 没有通知 | No notices | Nen Sedjem Sab |
| `officer_app.push.lock` | 有 {{n}} 件待你处理 | {{n}} items waiting on you | Nen Iri-Ek Djer: {{n}} |
| `officer_app.queue.claim` | 认领 | Claim | Shesep |
| `officer_app.queue.claim_failed` | 没能认领 | Couldn't claim | — |
| `officer_app.queue.desk_only` | 待宣判 · 请在官员台 | Ready for verdict · use the desk | Nen Djed Wedja Djer · Em Medjat Sab |
| `officer_app.queue.empty_body` | 到「待认领」里认领一件。 | Claim one from Unclaimed. | Shesep Wa Em «Nen Shesep Djer». |
| `officer_app.queue.empty_title` | 手上没有案子 | No cases in hand | Nen Shesep-I Djer |
| `officer_app.queue.mine` | 我手上 | Mine | Shesep-I |
| `officer_app.queue.scope_note` | 手机上可以认领、查看、写评议。宣判和盖印请在官员台完成。 | On the phone you can claim, read and comment. Verdicts and seals are done at the desk. | Em Medjat Ba: Shesep Hena Maa. Djed Wedja Hena Khetem: Em Medjat Sab. |
| `officer_app.queue.unclaimed` | 待认领 | Unclaimed | Nen Shesep Djer |
| `officer_app.search.ask` | 问一问 | Ask | Hehy Medu |
| `officer_app.search.no_souls_body` | 换个名字或编号再试。 | Try another name or ID. | Khemen Ren, Er Sesh Ren Ta Neb. |
| `officer_app.search.no_souls_title` | 没有找到 | Nothing found | Nen Gem Ba |
| `officer_app.search.placeholder` | 名字或编号 | Name or ID | Ren Er Ren Ta |
| `officer_app.search.read_only` | 只读。改动请在官员台进行。 | Read-only. Make changes at the desk. | Maa Wa. Khemen: Em Medjat Sab. |
| `officer_app.search.residing` | ▲ {{where}} · 暂居 | ▲ {{where}} · Resident | — |
| `officer_app.search.souls` | 查灵魂 | Souls | Hehy Ba |
| `officer_app.state.denied_body` | 你的角色「{{role}}」看不到{{area}}。需要时请找本殿管理员。 | Your role {{role}} can't see {{area}}. Ask your hall admin if you need it. | Netjer-Ek «{{role}}» Nen Maa {{area}}. Hehy Sab Hery En Wesekhet Pen. |
| `officer_app.state.denied_title` | 没有权限 | No access | Nen Was |
| `officer_app.state.error_body` | 检查网络后重试。已打开的条目不受影响。 | Check your connection and retry. Open items aren't affected. | Maa Wat Hena Wehem Iri. Sesh Wen Nen Khemen. |
| `officer_app.state.error_title` | 没取到 | Couldn't load | Nen Ini |
| `officer_app.tabs.me` | 我的 | Me | Djes |
| `officer_app.tabs.notices` | 通知 | Notices | Sedjem Sab |
| `officer_app.tabs.queue` | 审判 | Judgments | Sepu Wedja |
| `officer_app.tabs.search` | 查询 | Look up | Hehy |
| `officer_app.tabs.todo` | 待办 | To do | Nen Iri-I Djer |
| `officer_app.todo.empty_body` | 新的审批、改派和申请会推送给你。 | New approvals, reassignments and requests will be pushed to you. | Wat Hesy, Dbh Hab Ky Hena Dbh Renpi: Sedjem Sab. |
| `officer_app.todo.empty_title` | 此刻没有轮到你的事 | Nothing waiting on you | Nen Iri-Ek Djer |
| `officer_app.todo.groups.approvals` | 审批节点 | Approval steps | — |
| `officer_app.todo.groups.cooldowns` | 缩短冷却申请 | Cooling-off requests | Dbh Khebi Ahet Qebeh |
| `officer_app.todo.groups.reassignments` | 改派请求 | Reassignments | — |
| `officer_app.todo.groups.rebirths` | 转生申请 | Rebirth applications | — |
| `officer_app.todo.title` | 待我处理 | Waiting on me | Nen Iri-I Djer |
