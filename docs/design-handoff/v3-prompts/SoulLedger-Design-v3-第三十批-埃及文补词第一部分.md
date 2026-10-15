# 第三十批 · 埃及文补词(第一部分)(2026-10-15)

第二十八批的安全相关一组(登录设备、应用锁、以此人身份查看、批准前认面容)和通知类别已经上线。下面 **61 条**界面上还没有埃及文:
多数是稿面上有、词条表里没给的句子(中文照稿,英文是我们写的);另有 7 条是你给过、但没过词表守卫的(下面单独列出原因)。
埃及文界面下这些位置现在显示中文。

请给每条的最终 egy 写法;用到新词根请注明义项,我们登记。`{{…}}` 占位符原样保留。

**这一批只是第一部分。** 案卷附件、灵魂 App 的「导出我的资料」与「帮助与反馈」、官员 App 断网这几块还在做,做完会有第二部分(预计也有几十条)。

---

## 一、你给过、没过词表守卫的 7 条(请改词或确认新词根)

| key | 中文 | English | 你给的 egy 与卡住的原因 |
|---|---|---|---|
| profile.devices.mfa_until | 免两步验证至 {{date}} | No second step until {{date}} | `Nen Sen-Nu Er {{date}}` —— `Sen-Nu` 不在词表 |
| profile.devices.stranger | 不认识的设备：先退出它，再修改密码。 | Don't recognise a device? Sign it out, then change your password. | `Ikhet Nen Rekh: Per Em Es, Ir Sekhem-Ek Mawy.` —— `Es`、`Ir` 不在词表(是否应为 `Ef` / `Iri`?) |
| soul_app.biometric.app_lock | 切回 App 时也要验证 | Also verify when returning to the app | `Wehem Rekh Her Em Wehem Ii` —— `Her`、`Ii` 不在词表,且命中已废止写法规则 |
| soul_app.biometric.app_lock_hint | 离开超过 5 分钟再回来，要先认一次{{bio}} | After 5 minutes away, check your {{bio}} first | `Er-Sa At 5: Rekh Her-Ek` —— `Er-Sa`、`Her` 不在词表 |
| soul_app.lock.title | 已锁定 | Locked | `Khetem Seth` —— 实现时被一并挂起,请确认可否直接用 |
| officer_app.biometric.setting | 批准、驳回前认面容 | Check face before approving or rejecting | `Rekh Her Hat Hesy, Khesef` —— `Her` 不在词表,且命中已废止写法规则 |
| officer_app.biometric.failed | 没有认出面容，还没批准。再点一次确认重试。 | Face not recognised. Not approved yet. Tap Confirm to try again. | `Nen Rekh Her; Nen Hesy Djer. Wehem.` —— 同上 |

另:官员 App 的「认面容」几句写死了「面容」。只有指纹的手机也会读到「没有认出面容」。灵魂 App 用 `{{bio}}` 按设备换成「面容 / 指纹」。官员 App 要不要也这样?如果要,请连同上面两条一起给出带 `{{bio}}` 的写法(三语)。

---

## 二、其余还没有 egy 的词条

### 官员台 · 个人中心「通知」(第二十八批 W3)

| key | 中文 | English |
|---|---|---|
| profile.notifications.category_header | 类别 | Category |
| profile.notifications.settings | 通知设置 | Notification settings |
| profile.notifications.footnote | 「必收」的不能关：账号安全、密码求助两类全收；审批超时的站内一列也必收。 | “Always on” can't be turned off: Account security and Password help are always delivered, and so is the in-app side of Approval timeouts. |
| profile.notifications.categories.account_security | 账号安全 | Account security |
| profile.notifications.categories.approval | 待审批 | Pending approvals |
| profile.notifications.categories.approval_timeout | 审批超时 | Approval timeouts |
| profile.notifications.categories.reassign | 改派请求 | Reassignment requests |
| profile.notifications.categories.password_help | 密码求助 | Password help |
| profile.notifications.categories.dispatch | 移交 | Dispatches |
| profile.notifications.categories.letter_handoff | 书信交接 | Letter handoffs |
| profile.notifications.notes.account_security | 别处登录、密码已改、两步验证变更、有人以你的身份查看 | Sign-in elsewhere, password changed, two-step changes, someone viewing as you |
| profile.notifications.notes.approval | 有新的审批轮到你 | A new approval is waiting on you |
| profile.notifications.notes.approval_timeout | 站内不能关，超时影响时限 | In-app can't be turned off: a timeout affects the deadline |
| profile.notifications.notes.password_help | 只有管理员收 | Only administrators receive these |
| profile.notifications.notes.dispatch | 提出、批准、驳回、取消 | Proposed, approved, rejected, cancelled |

### 官员台 · 个人中心「登录设备」(W2)

| key | 中文 | English |
|---|---|---|
| profile.devices.intro | 退出后，那台设备下次打开要重新登录。修改密码时，除这台外会全部退出。 | A device you sign out has to sign in again next time. Changing your password signs out every device except this one. |
| profile.devices.count | {{n}} 台 | {{n}} devices |
| profile.devices.in_use | 正在使用 | In use now |
| profile.devices.sign_out_here | 在右上角退出 | Sign out at the top right |
| profile.devices.signed_out | 已退出 | Signed out |
| profile.devices.confirm_body | 这台不受影响。其他设备上的「30 天内不再询问」也一并作废。 | This device is not affected. "Don't ask for 30 days" is cancelled on the other devices too. |
| profile.devices.confirm_action | 退出 {{n}} 台 | Sign out {{n}} |
| profile.devices.audit_note | 登录记录见审计日志。 | Sign-in history is in the audit log. |
| profile.devices.load_failed | 登录设备加载失败 | Couldn't load your devices |
| profile.devices.sign_out_failed | 退出失败，请重试 | Couldn't sign out. Please try again. |

### 灵魂 App · 账号安全 › 登录设备与记录(S1)

| key | 中文 | English |
|---|---|---|
| soul_app.security.devices | 设备 | Devices |
| soul_app.security.this_phone | 这部手机 | This phone |
| soul_app.security.last_seen | 上次 {{time}} | Last seen {{time}} |
| soul_app.security.sign_out | 退出 | Sign out |
| soul_app.security.sign_out_failed | 退出失败，请重试 | Couldn't sign out. Please try again. |
| soul_app.security.load_failed | 登录设备与记录加载失败 | Couldn't load devices and sign-ins |
| soul_app.security.no_records | 还没有登录记录 | No sign-ins yet |
| soul_app.security.method_recovery | 恢复码 | Recovery code |
| soul_app.security.failed_mfa | 失败 {{n}} 次 · 验证码不对 | Failed {{n}} times · wrong code |
| soul_app.security.failed_face | 失败 {{n}} 次 · {{bio}}没认出 | Failed {{n}} times · {{bio}} not recognised |
| soul_app.security.stranger_title | 有不认识的设备或记录？ | A device or record you don't recognise? |
| soul_app.security.stranger_body | 先让那台退出，再改密码。改完后，除这部手机外全部退出。 | Sign that device out first, then change your password. Changing it signs out everything except this phone. |

### 官员台 · 以此人身份查看(W6)

| key | 中文 | English |
|---|---|---|
| admin.impersonate.title | 以{{name}}的身份查看 | View as {{name}} |
| admin.impersonate.reason_label | 理由 | Reason |
| admin.impersonate.audit_note | 整个过程记进审计日志。 | The whole session is recorded in the audit log. |
| admin.impersonate.start | 开始查看 | Start viewing |
| admin.impersonate.failed | 没能开始查看。 | Could not start viewing. |
| admin.impersonate.readonly | 只读 | Read only |
| admin.impersonate.reason_line | 理由：{{reason}} | Reason: {{reason}} |
| admin.impersonate.remaining | 剩 {{time}} | {{time}} left |
| admin.impersonate.locked | 查看中，不能操作 | Viewing: you can't act |
| audit.descriptions.impersonate_start | 以 {{name}} 的身份查看 · 理由：{{reason}} | Viewing as {{name}} · Reason: {{reason}} |
| audit.descriptions.impersonate_end | 以 {{name}} 的身份查看 · {{minutes}} 分钟 · 看过 {{pages}} 个页面 | Viewed as {{name}} · {{minutes}} min · {{pages}} pages |
| official_notify.impersonation_started.title | 有人在以你的身份查看 | Someone is viewing as you |
| official_notify.impersonation_started.body | {{by}} 正在以你的身份查看（只读，最长 {{minutes}} 分钟）。理由：{{reason}}。整个过程记进审计日志。 | {{by}} is viewing the console as you (read only, up to {{minutes}} minutes). Reason: {{reason}}. The whole session is recorded in the audit log. |

### 官员 App · 批准 / 驳回前认面容(O1)

| key | 中文 | English |
|---|---|---|
| officer_app.biometric.hint | 别人拿到你的手机，也做不了决定 | Nobody else can decide with your phone in hand |
| officer_app.biometric.unavailable | 这部手机还没设锁屏密码，开不了。先在系统设置里设一个。 | This phone has no screen lock yet, so this can't be turned on. Set one in system settings first. |
| officer_app.biometric.failed_reject | 没有认出面容，还没驳回。再点一次确认重试。 | Face not recognised. Not rejected yet. Tap Confirm to try again. |

### 官员台 · 定时任务说明

| key | 中文 | English |
|---|---|---|
| scheduler.jobs.authentication_prune_soul_sign_ins | 清理 90 天前的灵魂登录记录与闲置会话 | Clear soul sign-in records and idle sessions older than 90 days |

---

## Design 回复

(待填)
