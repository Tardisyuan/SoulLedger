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

---

## Design 回复(2026-10-15,原文在 Design 项目 `v3-batch30-reply.md`)

# 第三十批 · 第一部分 · Design 回复(2026-10-15)

61 条都已给出 egy。**没有新词根**，没用已废止写法，`{{…}}` 都原样保留。

## 一、改词的 7 条

卡住的原因有两个。一是我把面容写成了 `Her`,可第二十批已经定下 egy 不区分面容和指纹，两种都写 `Djes-Ek`(见 `bio.face / bio.finger`)。二是另外几个词词表里没有，都换成了现成的说法。

| key | egy(改) | 说明 |
|---|---|---|
| profile.devices.mfa_until | **Nen Wehem Dbh Aq Sep Sen Er {{date}}** | 照 `mfa.remember_device`(Nen Wehem Dbh)和 `Aq Sep Sen`(两步验证) |
| profile.devices.stranger | **Ikhet Nen Rekh: Per Em Ikhet Pen Tepy, Er Khet Khemen Sekhem-Ek.** | 去掉 `Es`/`Ir`。「先…再…」用 `Tepy … Er Khet`,「修改密码」用 `Khemen Sekhem`(同 `password_changed`) |
| soul_app.biometric.app_lock | **Iyi Er Medjat Ba: Wehem Aq Em Djes-Ek** | 「切回」= `Iyi Er`(同 `Iyi Er Tepy`) |
| soul_app.biometric.app_lock_hint | **Iyi Er Khet At 5 Er Hry: Aq Em {{bio}} Tepy** | 照 `Aq Em {{bio}}`(pw_changed_body)。egy 下 `{{bio}}` 填 Djes-Ek |
| soul_app.lock.title | **Khetem Seth** | 可以直接用。不能用 `Aq Khetem Seth`:那是「账号被锁」(登录错太多次) |
| officer_app.biometric.setting | **Hesy, Khesef: Aq Em {{bio}} Tepy** | 见下方「官员 App 要不要用 {{bio}}」 |
| officer_app.biometric.failed | **Nen Rekh {{bio}}; Nen Hesy Djer. Wehem Iri.** | 「重试」= `Wehem Iri`(全站通用) |

**顺手更正一条已上线的:** `soul_app.security.failed` 我给的是 `Sekhem Nen Maa`,应为 **`Nen Aq {{n}} · Sekhem Nen Maat`**。`Nen Maa` 是「没看见」,守卫查不出这种错。

### 官员 App 要不要用 {{bio}}:要

道理和灵魂 App 一样。只有指纹的手机读到「没有认出面容」,会以为自己做错了什么。三条都改成带 `{{bio}}`:

| key | zh | en | egy |
|---|---|---|---|
| officer_app.biometric.setting | 批准、驳回前验证{{bio}} | Check {{bio}} before approving or rejecting | Hesy, Khesef: Aq Em {{bio}} Tepy |
| officer_app.biometric.failed | 没有认出{{bio}}，还没批准。再点一次确认重试。 | {{bio}} not recognised. Not approved yet. Tap Confirm to try again. | Nen Rekh {{bio}}; Nen Hesy Djer. Wehem Iri. |
| officer_app.biometric.failed_reject | 没有认出{{bio}}，还没驳回。再点一次确认重试。 | {{bio}} not recognised. Not rejected yet. Tap Confirm to try again. | Nen Rekh {{bio}}; Nen Khesef Djer. Wehem Iri. |

- zh 的「认面容」改成「验证{{bio}}」:「认指纹」读着别扭。
- en 用灵魂 App 现成的 `bio` 取值：句首首字母大写，句中小写。
- egy 里 `{{bio}}` 一律填 `Djes-Ek`,所以 egy 不受这次改动影响。

---

## 二、其余 54 条

### 通知(W3)

| key | egy |
|---|---|
| profile.notifications.category_header | Iru |
| profile.notifications.settings | Smen Sedjem |
| profile.notifications.footnote | «Nen Sedjer»: Nen Khetem. Sau Aq, Dbh Sekhem: Neb. Unut Khetem Wat Hesy: Hena Wa. |
| …categories.account_security | Sau Aq |
| …categories.approval | Wat Hesy |
| …categories.approval_timeout | Unut Khetem Wat Hesy |
| …categories.reassign | Dbh Hab Ky |
| …categories.password_help | Dbh Sekhem |
| …categories.dispatch | Hab-Ba |
| …categories.letter_handoff | Redi Sesh |
| …notes.account_security | Aq Em Ikhet Ky, Sekhem Khemen, Aq Sep Sen Khemen, Ky Maa Em Ba-Ek |
| …notes.approval | Wat Hesy Mawy: Nen Iri-Ek Djer |
| …notes.approval_timeout | Hena: Nen Khetem. Unut Khetem Khemen Ahet. |
| …notes.password_help | Sab Hery Wa |
| …notes.dispatch | Iri, Hesy, Khesef, Sehen |

- 词的出处：`Sau`(保住)取自 `Sau Seth`,`Unut Khetem`(超时)取自工作流，`Dbh Hab Ky` 取自 `request_admin`,`Redi`(交给)取自 `Djama Redi`,`Sesh`(书信)取自 `letter: Hab Sesh`。
- footnote 里的 `Hena Wa` 指「只站内」(`Hena` 即第二十八批的「站内」)。

### 登录设备(W2)

| key | egy |
|---|---|
| profile.devices.intro | Per Em Ikhet: Er Khet Aq Mawy. Khemen Sekhem: Per Em Ikhet Ky Neb; Ikhet Pen Nen. |
| profile.devices.count | Ikhet {{n}} |
| profile.devices.in_use | Em Aq Emu |
| profile.devices.sign_out_here | Per Aq Em Hry |
| profile.devices.signed_out | Per Aq Seth |
| profile.devices.confirm_body | Ikhet Pen Nen Khemen. Ikhet Ky: «Nen Wehem Dbh Hru 30» Fekh Seth. |
| profile.devices.confirm_action | Per Em Ikhet {{n}} |
| profile.devices.audit_note | Sesh Aq Em Medew Maa. |
| profile.devices.load_failed | Nen Ini Ikhet Aq |
| profile.devices.sign_out_failed | Nen Per Aq. Wehem Iri. |

- 「退出」有两种写法：退出账号用 `Per Aq`(同顶栏 `logout`),退出某台设备用 `Per Em Ikhet`(同第二十八批)。
- `signed_out` 不能写 `Per Seth`,那是「已提交」。
- `sign_out_here` 的 egy 不写「右」,只写「在上方」(`Em Hry`)。顶栏只有一个退出入口，不会找错。

### 灵魂 App · 登录设备与记录(S1)

| key | egy |
|---|---|
| soul_app.security.devices | Ikhet |
| soul_app.security.this_phone | Medjat Pen |
| soul_app.security.last_seen | Pehwy {{time}} |
| soul_app.security.sign_out | Per Aq |
| soul_app.security.sign_out_failed | Nen Per Aq. Wehem Iri. |
| soul_app.security.load_failed | Nen Ini Ikhet Hena Aq Pehwy |
| soul_app.security.no_records | Nen Aq Pehwy Djer |
| soul_app.security.method_recovery | Medu Ankh Wehem |
| soul_app.security.failed_mfa | Nen Aq {{n}} · Medu Ahet Nen Maat |
| soul_app.security.failed_face | Nen Aq {{n}} · Nen Rekh {{bio}} |
| soul_app.security.stranger_title | Ikhet Er Aq Nen Rekh? |
| soul_app.security.stranger_body | Per Em Ikhet Nen Rekh Tepy, Er Khet Khemen Sekhem. Khemen Seth: Per Em Ikhet Neb; Medjat Pen Nen. |

### 以此人身份查看(W6)

| key | egy |
|---|---|
| admin.impersonate.title | Maa Em Ba {{name}} |
| admin.impersonate.reason_label | Khet |
| admin.impersonate.audit_note | Iri Neb: Sesh Em Medew Maa. |
| admin.impersonate.start | Wah Maa |
| admin.impersonate.failed | Nen Wah Maa. |
| admin.impersonate.readonly | Maa Wa |
| admin.impersonate.reason_line | Khet: {{reason}} |
| admin.impersonate.remaining | {{time}} Wenen |
| admin.impersonate.locked | Em Maa: Nen Iri |
| audit.descriptions.impersonate_start | Maa Em Ba {{name}} · Khet: {{reason}} |
| audit.descriptions.impersonate_end | Maa Em Ba {{name}} · At {{minutes}} · Medjat {{pages}} |
| official_notify.impersonation_started.title | Ky Maa Em Ba-Ek |
| official_notify.impersonation_started.body | {{by}} Maa Em Ba-Ek (Maa Wa · At {{minutes}} Er Aa). Khet: {{reason}}. Iri Neb: Sesh Em Medew Maa. |

- 「剩」照 `hours_left` 写作 `… Wenen`。「页面」用 `Medjat`(同 `not_found`)。「最长」照第二十八批写作 `Er Aa`。

### 官员 App · 认{{bio}}(O1)

| key | egy |
|---|---|
| officer_app.biometric.hint | Ky Em Medjat-Ek: Nen Wedja |
| officer_app.biometric.unavailable | Medjat Pen Nen Sekhem Djer: Nen Wen. Iri Sekhem Em Smen Ta Tepy. |
| officer_app.biometric.failed_reject | Nen Rekh {{bio}}; Nen Khesef Djer. Wehem Iri. |

「系统设置」写作 `Smen Ta`(同 `open_system_settings`)。

### 定时任务

| key | egy |
|---|---|
| scheduler.jobs.authentication_prune_soul_sign_ins | Khetem Aq Ba Hena Aq Nen Iri: Hru 90 Er Hry |

照 `audit_prune_logs_for_tenant`(Khetem … Tepy)的写法。
