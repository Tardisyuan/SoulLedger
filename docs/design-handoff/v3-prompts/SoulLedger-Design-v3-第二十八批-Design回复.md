# 第二十八批回复 · 第一节:取舍、合并、复用(2026-10-13)

稿子按第三节的顺序分批出。这一份先回答第一节。

## 一、不值得做 / 合并

**合并(三处)**
1. **W2 + S1 → 「登录设备」用同一套版式。** 一行写：设备与浏览器、上次活动(`YYYY-MM-DD HH:MM`)、「这台」标记、「退出这台」。Web 用宽行,App 用 393 宽列表。区别只有一处:S1 下方多一段「最近登录记录」;W2 不加，官员的登录记录在审计日志里已经有。
2. **W2 把两步验证的「30 天内不再询问」设备并进同一张表。** 不另做一张表，只在行上加一个「免两步验证至 YYYY-MM-DD」的标签。退出这台的同时撤销免验证。
3. **S2 不单独做，并进 S1 所在的「面容 / 指纹登录」子页。** 在那一页加一个开关「切回 App 时也要验证」,默认关;超时固定为 5 分钟，不给选项。锁屏直接复用面容登录那一屏(SoulLoginApp 的面容态),认不出就退回输密码。不新增设置行。

**不值得做(一项)**
- **S4 不做 App 内字号设置，改为跟随系统字号。** 自设一档就要再维护一份「最大一档」的版式，系统设置已经给了用户。要做的只有一件事：定下最大字号时哪些地方保持一行(编号、时间、金额、状态标签)、哪些可以换行(正文、标题、按钮文案)。这条写成规则附在稿边，不出设置页。

**降级**
- **O3 范围缩小：只做读缓存和断网横条，外加回信排队。** 批准 / 驳回不允许离线，同意你们的判断。断网时这两个按钮置灰，写明原因。工作量从「大」降到「中」。

## 二、不出新稿，直接复用

| 项 | 复用 |
|---|---|
| W5 导出 | 现有 CSV 导出按钮(审计日志页的样式)。案卷页、审批流页都放在筛选条右端，文案沿用「导出 CSV(按当前筛选)」。只给位置说明，不出稿。 |
| W1 在 393 宽 | 不出现列菜单。卡片排法本来就是「角色优先」,隐藏列没有意义。 |
| W3 开关表 | 复用 TwoFactorProfile 的分节卡片和开关行;放在个人中心，替换现有的「邮件通知」总开关。通知页右上角的齿轮直接跳到这一节，不另做弹层。 |
| W6 确认弹层 | 复用 OfficerApp 批准确认弹层的「写理由」版式。 |
| O1 | 复用同一个确认弹层。点「确认」后弹出系统验证，不改弹层本身;只画验证失败 / 取消后的那一行提示和设置开关。 |
| O2 | 复用 Social / CooldownDesk 的筛选条(多选标签 + 数量角标);空状态复用待办的空状态版式，只换文案。 |
| S3 交付 | 系统分享面板，不画。 |
| S5 反馈提交后 | 复用书信「已发出」的状态。反馈落到殿司收件箱，同意。 |

## 三、出稿顺序

1. **第一批(安全相关)**:W2/S1 登录设备(同一套)、W6 模拟登录、O1 生物识别确认。
2. **第二批(小项)**:W1 列菜单、W3 通知类别、O2 待办筛选、S2 开关(并在 S1 页里)。
3. **第三批**:S3 数据导出、S5 帮助与反馈(附第一版常见问题)。
4. **第四批(大项)**:W4 附件、O3 断网。

各批「请定」的问题随稿回答。

---

# 稿子(四批都已出)

- `Batch28Security.dc.html`:W2 登录设备、S1 登录设备与记录、S2 应用锁(并进面容登录页)、W6 以此人身份查看、O1 面容确认
- `Batch28Small.dc.html`:W1 列菜单、W3 通知类别、O2 待办筛选、S4 字号规则
- `Batch28Content.dc.html`:S3 数据导出、S5 帮助与反馈(含常见问题第一版)、W4 附件、O3 断网、W5 位置说明

各项「请定」的答复写在稿边的虚线框里。下面只列要拍板的结论和词条。

## 结论汇总

- **W1**:入口放在筛选条右端，按钮写「列 · 6/9」。每个列表各记一份。编号列和名称列不能隐藏。导出不受影响;393 宽下不出现。
- **W2**:退出不用再输密码。「这台」不能在这里退出。「30 天内不再询问」作为行上的标签，退出时一起撤销。不显示位置。
- **W3**:放在个人中心，原「邮件通知」改名为「通知」。新增「账号安全」类别;它和「密码求助」都是必收，「审批超时」的站内通知也必收。移交的四个事件合成一行。
- **W4**:只收图片和 PDF。单个 20 MB,合计 100 MB,最多 30 个。上传人在结案前可以删，结案后谁都不能删。打印时附一页附件清单。
- **W5**:导出按钮放在筛选条右端;超过 1 万条时置灰。
- **W6**:只读，最长 30 分钟。只有系统管理员能发起，不能代看另一位管理员。被代看的人会收到通知，而且不能关。
- **S1**:登录记录只保留 90 天。失败的登录也显示，连续失败合成一行。发现陌生设备时，先让它退出，再给「修改密码」按钮。
- **S2**:在面容登录页加一个开关，默认关。超时固定 5 分钟。锁屏复用面容登录那一屏。
- **S3**:排队生成，申请前先输密码(或用面容)。文件 7 天内可取，通过系统分享面板拿到。
- **S4**:不做设置，跟随系统字号，上限为系统第 3 大档。哪些保持一行、哪些可以换行，规则见稿。
- **S5**:反馈落到殿司收件箱，官员用书信回复。
- **O1**:默认开。所有批准、驳回都要验证。验证失败时弹层留着，写的理由不丢。手机没设锁屏密码时开关置灰。
- **O2**:类型多选，带数量角标。不选 = 全部。选择记在这部手机上。
- **O3**:只有回信能排队，批准 / 驳回在断网时置灰。缓存最近 20 份详情。

## 词条

可以复用的已有词条：取消 = `Sehen`,理由 = `Khet`,批准 = `Hesy`,驳回 = `Khesef`,没有网络 = `Nen Em Senb`(同 `offline`),上次 = `Pehwy`,文件 = `Djama`,图片 = `Tut`,手机 = `Medjat`,导入 = `Ini`,打印 = `Sesh Djama`,服务器 = `Per Hemsu`,看 = `Maa`,其他 = `Ky`,别人 = `Ky`,登录 = `Aq`(同第二十批 `Aq Em Ba Ky`)。

| key | 中文 | en | egy |
|---|---|---|---|
| profile.devices.title | 登录设备 | Signed-in devices | **Ikhet Aq** |
| profile.devices.this | 这台 | This device | **Ikhet Pen** |
| profile.devices.sign_out | 退出这台 | Sign out this device | **Per Em Ikhet Pen** |
| profile.devices.sign_out_others | 退出其他全部 | Sign out all others | **Per Em Ikhet Ky Neb** |
| profile.devices.confirm_title | 退出其他 {{n}} 台设备？ | Sign out {{n}} other devices? | **Per Em Ikhet Ky {{n}}?** |
| profile.devices.mfa_until | 免两步验证至 {{date}} | No second step until {{date}} | **Nen Sen-Nu Er {{date}}** |
| profile.devices.stranger | 不认识的设备：先退出它，再修改密码。 | Don't recognise a device? Sign it out, then change your password. | **Ikhet Nen Rekh: Per Em Es, Ir Sekhem-Ek Mawy.** |
| soul_app.security.history | 登录设备与记录 | Devices and sign-ins | **Ikhet Hena Aq Pehwy** |
| soul_app.security.history_keep | 最近登录 · 只保留 90 天 | Recent sign-ins · kept for 90 days | **Aq Pehwy · Hru 90** |
| soul_app.security.failed | 失败 {{n}} 次 · 密码不对 | Failed {{n}} times · wrong password | **Nen Aq {{n}} · Sekhem Nen Maa** |
| soul_app.biometric.app_lock | 切回 App 时也要验证 | Also verify when returning to the app | **Wehem Rekh Her Em Wehem Ii** |
| soul_app.biometric.app_lock_hint | 离开超过 5 分钟再回来，要先认一次面容 | After 5 minutes away, check your face first | **Er-Sa At 5: Rekh Her-Ek** |
| soul_app.lock.title | 已锁定 | Locked | **Khetem Seth** |
| admin.users.impersonate | 以此人身份查看 | View as this user | **Maa Em Ba Pen** |
| admin.impersonate.body | 只能看，不能做任何操作。最长 30 分钟。 | View only. You can't do anything. Up to 30 minutes. | **Maa Wa: Nen Iri Neb. At 30 Er Aa.** |
| admin.impersonate.notice | {{name}} 会收到通知，看到你的名字和这条理由。 | {{name}} will be told, with your name and this reason. | **{{name}} Sedjem: Ren-Ek Hena Khet Pen.** |
| admin.impersonate.banner | 正在以 {{name}} 的身份查看 | Viewing as {{name}} | **Em Maa Em Ba {{name}}** |
| admin.impersonate.exit | 退出查看 | Stop viewing | **Sehen Maa** |
| audit.impersonate_start / end | 开始代看 / 结束代看 | Started viewing as / Stopped viewing as | **Maa Em Ba Ky · Wah / Sehen** |
| profile.notifications.title | 通知 | Notifications | **Sedjem** |
| profile.notifications.site / mail | 站内 / 邮件 | In app / Email | **Hena / Shat** |
| profile.notifications.locked | 必收 | Always on | **Nen Sedjer** |
| list.columns.button | 列 · {{shown}}/{{total}} | Columns · {{shown}}/{{total}} | **Iwn · {{shown}}/{{total}}** |
| list.columns.pinned | 不能隐藏 | Always shown | **Nen Imen** |
| list.columns.reset | 恢复默认 | Reset | **Wehem Tepy** |
| case.attachments.title | 附件 | Attachments | **Djama Hena** |
| case.attachments.limit | 图片或 PDF,单个不超过 20 MB | Images or PDF, up to 20 MB each | **Tut Er PDF · 20 MB Er Aa** |
| case.attachments.full | 这份案卷的附件已满 100 MB | This case already has 100 MB of attachments | **Djama Hena Meh: 100 MB** |
| case.attachments.failed_type | 只能传图片或 PDF | Only images or PDF | **Tut Er PDF Wa** |
| soul_app.export.title | 导出我的资料 | Export my data | **Khaa Djama-I** |
| soul_app.export.queued | 正在准备 | Preparing | **Em Iri** |
| soul_app.export.ready | 已准备好 | Ready | **Iri Seth** |
| soul_app.export.share | 保存或发送… | Save or send… | **Smen Er Per…** |
| soul_app.help.title | 帮助 | Help | **Sehedj** |
| soul_app.help.write | 写给本殿 | Write to your hall | **Sesh Er Wesekhet** |
| officer_app.todo.filter_clear | 清除筛选 | Clear filters | **Sehen Djes** |
| officer_app.offline.banner | 没有网络 · 显示的是 {{time}} 的内容 | Offline · showing content from {{time}} | **Nen Em Senb · Pehwy {{time}}** |
| officer_app.offline.no_decide | 没有网络时不能批准或驳回：这期间案卷可能已经变了。 | You can't approve or reject offline: the case may have changed. | **Nen Em Senb: Nen Hesy, Nen Khesef.** |
| officer_app.outbox.pending | 待发出 | Waiting to send | **Nen Per Djer** |
| officer_app.outbox.answered | 这封书信已经由别的官员回过了。你写的内容还留着。 | Another officer already replied. Your draft is kept. | **Ky Wesheb Seth. Sesh-Ek Smen.** |
| officer_app.biometric.setting | 批准、驳回前认面容 | Check face before approving or rejecting | **Rekh Her Hat Hesy, Khesef** |
| officer_app.biometric.failed | 没有认出面容，还没批准。再点一次确认重试。 | Face not recognised. Not approved yet. Tap Confirm to try again. | **Nen Rekh Her; Nen Hesy Djer. Wehem.** |

## 新词根(请登记)

- **Ikhet**:器物。这里指「设备」。
- **Iwn**:柱。这里指表格的「列」。
- **Khaa**:显露、拿出来。这里指「导出」,和 `Ini`(导入)相对。
- **Sehedj**:照亮、指点。这里指「帮助」。不用 Nedj:它和 `Nedjes` 只差词尾，就是 `Seped / Sepdet` 那种问题。
- **Sedjer**:安睡。这里指「静音」,只用在 `Nen Sedjer`(必收)这一条里。
- **Shat**:书写的信件。这里指「邮件」,和书信区分开。

**已废止的写法(Seped 等)都没有用。**
