# 第三十一批 · 埃及文补词(第二部分)(2026-10-15)

案卷附件、灵魂 App 的「导出我的资料」与「帮助与反馈」、官员 App 断网与回信排队、Web 导出按钮都已做完。下面 **110 条**界面上还没有埃及文(埃及文界面下这些位置现在显示中文)。

请给每条的最终 egy 写法;用到新词根请注明义项,我们登记。`{{…}}` 占位符原样保留。

**两条你给过、没过词表守卫的**(词表里还没有这两个词根,请确认义项后我们登记,或换词):

- `soul_app.export.title`(导出我的资料)你给的 `Khaa Djama-I` —— `Khaa` 不在词表
- `soul_app.help.title`(帮助与反馈)你给的 `Sehedj` —— `Sehedj` 不在词表

另:`case.attachments.limit` 等含 `PDF`、`MB` 的句子,缩写请照原样保留大写。

### 案卷附件(官员台 Web)

| key | 中文 | English |
|---|---|---|
| case.attachments.add | 添加附件 | Add attachment |
| case.attachments.drop | 拖到这里，或点「添加附件」 | Drop files here, or choose “Add attachment” |
| case.attachments.summary | {{count}} 个 · 共 {{used}} / {{max}} MB | {{count}} files · {{used}} / {{max}} MB |
| case.attachments.empty | 还没有附件 | No attachments yet |
| case.attachments.uploading | 正在上传 · {{pct}}% | Uploading · {{pct}}% |
| case.attachments.too_large | 超过 {{max}} MB | Over {{max}} MB |
| case.attachments.too_many | 最多 {{max}} 个 | At most {{max}} files |
| case.attachments.failed_network | 没传上去，网络断了 | Not uploaded: the network dropped |
| case.attachments.failed_generic | 没传上去 | Not uploaded |
| case.attachments.download | 下载 | Download |
| case.attachments.remove | 移除 | Remove |
| case.attachments.delete_title | 删除附件 | Delete attachment |
| case.attachments.delete_body | 「{{name}}」删除后找不回来;结案后附件不能再删。 | “{{name}}” can't be recovered once deleted; after the case is concluded attachments can no longer be deleted. |
| case.attachments.delete_failed | 没删掉 | Could not delete |
| case.attachments.delete_concluded | 案子已结案，附件不能删除了。 | The case is concluded; attachments can no longer be deleted. |
| case.attachments.preview_failed | 打不开这份附件 | Could not open this attachment |
| case.attachments.open_tab | 在新窗口打开 | Open in new tab |
| case.attachments.print_title | 附件清单 | List of attachments |
| case.attachments.print_footer | 附件原件见系统 | Originals of the attachments are in the system |
| case.attachments.col_name | 名称 | Name |
| case.attachments.col_size | 大小 | Size |
| case.attachments.col_uploader | 上传人 | Uploaded by |
| case.attachments.col_time | 时间 | Time |
| case.attachments.load_failed | 附件没有加载出来 | Attachments did not load |
| case.attachments.limit | 图片或 PDF,单个不超过 20 MB | Images or PDF, up to 20 MB each |
| case.attachments.failed_type | 只能传图片或 PDF | Only images or PDF |

### 灵魂 App · 导出我的资料

| key | 中文 | English |
|---|---|---|
| soul_app.export.intro | 把本殿记下的、关于你的资料打包成一个文件。 | Pack what the hall has recorded about you into one file. |
| soul_app.export.included | 包含 | Included |
| soul_app.export.included_profile | 基本资料与编号 | Basic profile and your number |
| soul_app.export.included_merit | 功过记录 | Merit and demerit records |
| soul_app.export.included_judgments | 审判结果与评语(给你看过的部分) | Judgment results and comments (the parts you were shown) |
| soul_app.export.included_letters | 书信与朋友圈(含图片) | Letters and circle posts (with images) |
| soul_app.export.included_sign_ins | 最近 90 天的登录记录 | Sign-ins from the last 90 days |
| soul_app.export.excluded | 不包含 | Not included |
| soul_app.export.excluded_deliberation | 官员之间的评议 | Officers' deliberation among themselves |
| soul_app.export.excluded_letters | 别人发给你之外的书信 | Letters not addressed to you |
| soul_app.export.timing | 一般几分钟，资料多时最长一天。好了会通知你。文件 7 天内可以取。 | Usually a few minutes; up to a day if there is a lot. You will be told when it is ready. The file can be fetched for 7 days. |
| soul_app.export.request | 输入密码并申请 | Enter your password and request |
| soul_app.export.request_face | 用{{bio}}确认并申请 | Confirm with {{bio}} and request |
| soul_app.export.requested_at | 申请于 {{time}}。可以离开这页，好了会通知你。 | Requested {{time}}. You can leave this page; you will be told when it is ready. |
| soul_app.export.available_until | 可取到 {{time}} | Available until {{time}} |
| soul_app.export.share_note | 「保存或发送…」打开系统分享面板。过期后要重新申请。一次只能有一份在准备。 | “Save or send…” opens the system share sheet. After it expires you need to request again. Only one can be prepared at a time. |
| soul_app.export.expired | 这份资料已过期。需要的话重新申请。 | This file has expired. Request it again if you still need it. |
| soul_app.export.failed | 这次没有做成。可以重新申请。 | That did not work. You can request it again. |
| soul_app.export.request_again | 重新申请 | Request again |
| soul_app.export.sheet_title | 先确认是你 | Confirm it is you |
| soul_app.export.sheet_body | 导出的是你的整份资料。请输入当前密码，确认是你本人。 | This exports your whole record. Enter your current password to confirm it is you. |
| soul_app.export.sheet_next | 申请 | Request |
| soul_app.export.working | 正在取文件… | Fetching the file… |
| soul_app.export.share_failed | 没有打开分享面板。再试一次。 | The share sheet did not open. Try again. |
| soul_app.export.download_failed | 文件没有取下来。检查网络后再试。 | The file could not be fetched. Check your connection and try again. |
| soul_app.export.load_failed | 资料导出的状态没有读到。 | Could not read the state of the export. |
| soul_app.export.title | 导出我的资料 | Export my data |

### 灵魂 App · 帮助

| key | 中文 | English |
|---|---|---|
| soul_app.help.group_login | 登录与账号 | Sign-in and account |
| soul_app.help.group_visit | 到殿须知 | Before you come to the hall |
| soul_app.help.group_contact | 联系 | Contact |
| soul_app.help.not_found | 没找到答案？ | Did not find an answer? |
| soul_app.help.login_trouble | 登录遇到问题 | Trouble signing in |
| soul_app.help.q_login | 登录不了 | I cannot sign in |
| soul_app.help.a_login | 先检查编号有没有输错。密码连续输错 5 次会锁 15 分钟，等一会儿再试。还是不行，点「忘记密码」。 | First check that the number is right. After 5 wrong passwords in a row the account is locked for 15 minutes; wait and try again. If it still fails, tap “Forgot password”. |
| soul_app.help.q_forgot | 忘记密码 | I forgot my password |
| soul_app.help.a_forgot | 在登录页点「忘记密码」,验证码会发到你登记的联系邮箱。没有登记邮箱的，请到本殿窗口办理，带上交付单。 | On the sign-in page tap “Forgot password”; a code is sent to the contact e-mail you registered. If no e-mail is registered, come to the hall's counter and bring your delivery slip. |
| soul_app.help.q_phone | 手机丢了 | I lost my phone |
| soul_app.help.a_phone | 用另一部手机登录，到「账号安全 › 登录设备与记录」让丢的那部退出，再改密码。开了两步验证的，用恢复码登录。恢复码也没有了，请到本殿窗口办理。 | Sign in on another phone, go to “Account security › Devices and sign-ins”, sign the lost phone out, then change your password. If two-step verification is on, sign in with a recovery code. If you have lost the recovery codes too, come to the hall's counter. |
| soul_app.help.q_slip | 交付单是什么 | What is the delivery slip |
| soul_app.help.a_slip | 你到殿时领的那张纸，上面有你的编号和第一次登录用的密码。第一次登录后，这个密码就不能再用了。交付单请收好，到窗口办事时要用。 | The paper you were given when you arrived. It carries your number and the password for your first sign-in; after that first sign-in the password no longer works. Keep the slip: you need it at the counter. |
| soul_app.help.q_contact | 怎么联系本殿 | How do I contact the hall |
| soul_app.help.a_contact | 在这页底部点「写给本殿」,回复会出现在书信里。急事请到本殿窗口。 | Tap “Write to your hall” at the bottom of this page; the reply appears in your letters. For anything urgent, come to the hall's counter. |
| soul_app.help.title | 帮助 | Help |

### 灵魂 App · 写给本殿(反馈)

| key | 中文 | English |
|---|---|---|
| soul_app.feedback.kind_label | 关于什么 | What is it about |
| soul_app.feedback.kind_account | 登录与账号 | Sign-in and account |
| soul_app.feedback.kind_record | 我的记录有误 | My record is wrong |
| soul_app.feedback.kind_app | App 出了问题 | Something is wrong with the app |
| soul_app.feedback.kind_other | 其他 | Other |
| soul_app.feedback.body_label | 说说情况 | Tell us what happened |
| soul_app.feedback.body_placeholder | 发生了什么、在哪一页 | What happened, and on which page |
| soul_app.feedback.shots_label | 截图 | Screenshots |
| soul_app.feedback.shots_hint | 可选，最多 3 张 | Optional, up to 3 |
| soul_app.feedback.shots_add | 添加截图 | Add a screenshot |
| soul_app.feedback.shots_remove | 移除这张截图 | Remove this screenshot |
| soul_app.feedback.shots_limit | 最多 3 张 | Up to 3 screenshots |
| soul_app.feedback.note | 本殿官员会在书信里回你，和平常的书信在一处。 | Officers of your hall will reply in your letters, in the same place as your other letters. |
| soul_app.feedback.appeal_hint | 对审判结果有异议，请走申诉。 | To dispute a judgment, use an appeal. |
| soul_app.feedback.send | 发出 | Send |
| soul_app.feedback.failed | 没有发出去。检查网络后再试。 | It was not sent. Check your connection and try again. |
| soul_app.feedback.see_letters | 去看书信 | See your letters |
| soul_app.feedback.another | 再写一封 | Write another |

### 灵魂 App · 设置分组

| key | 中文 | English |
|---|---|---|
| soul_app.settings.group_data | 我的资料 | My data |
| soul_app.settings.group_help | 帮助与反馈 | Help and feedback |

### 官员台收件箱 · 反馈类别

| key | 中文 | English |
|---|---|---|
| soul_inbox.feedback.label | 反馈 · {{category}} | Feedback · {{category}} |
| soul_inbox.feedback.tags.account | 登录与账号 | Sign-in and account |
| soul_inbox.feedback.tags.record | 我的记录有误 | My record is wrong |
| soul_inbox.feedback.tags.app | App 出了问题 | Something is wrong with the app |
| soul_inbox.feedback.tags.other | 其他 | Other |

### 官员 App · 断网

| key | 中文 | English |
|---|---|---|
| officer_app.offline.restored | 已恢复网络 | Back online |
| officer_app.offline.restored_sent | 已恢复网络 · 发出了 {{n}} 封回信 | Back online · {{n}} replies sent |
| officer_app.offline.image_later | 有网后显示 | Shown when online |

### 官员 App · 回信排队

| key | 中文 | English |
|---|---|---|
| officer_app.outbox.auto | 有网后自动发出 | Sends automatically when online |
| officer_app.outbox.row | 回信 · {{name}} | Reply · {{name}} |
| officer_app.outbox.failed_title | 回信 · {{name}} 没有发出 | Reply · {{name}} was not sent |
| officer_app.outbox.archived | 这封书信已经归档。 | This letter has been archived. |
| officer_app.outbox.left_hall | 你已不在这一殿。 | You are no longer in this hall. |
| officer_app.outbox.retry | 没有发出，稍后再试 | Not sent. Try again later. |
| officer_app.outbox.view_existing | 看已有的回信 | See the existing reply |
| officer_app.outbox.discard | 删除我的草稿 | Delete my draft |

### 导出 CSV 按钮(Web)

| key | 中文 | English |
|---|---|---|
| common.export_csv | 导出 CSV | Export CSV |
| common.export_scope | 按当前筛选导出，共 {{n}} 条 | Export the current filter, {{n}} rows |
| common.export_too_many | 超过 1 万条，请缩小筛选 | Over 10,000 rows. Narrow the filter. |

### 推送与定时任务

| key | 中文 | English |
|---|---|---|
| soul_push.export_ready | {'title': '资料已准备好', 'body': '你申请导出的资料已准备好，7 天内可取。打开灵魂簿保存。'} | {'title': 'Your data is ready', 'body': 'The data export you asked for is ready for 7 days. Open Soul Ledger to save it.'} |
| scheduler.jobs.soul_accounts_prune_data_exports | 清理过期的资料导出 | Delete expired data exports |

---

## Design 回复(2026-10-15,原文在 Design 项目 `templates/soulledger-v3-pages/v3-batch31-reply.md`)

落地时:`Ptr` 被词表守卫拦下，两条用了回复里给的替换写法(`q_slip` = `Djama Redi`,`body_placeholder` = `Kheper Hena Medjat`);`PDF`、`CSV` 加进技术词白名单。


110 条都已给出 egy。**没有新词根**:第二十八批报的 `Khaa`、`Sehedj` 撤回，不登记，第二十八批的新词根只剩 `Ikhet`、`Iwn`、`Shat` 三个要登记。`Sedjer` 词表里已有(「暂缓」),「静音」请登记为它的新义项。`PDF`、`MB`、`CSV`、`App` 都照原样大写。

## 一、两个被拦的词:撤回，改用现成写法

| key | 原 | 改 | 理由 |
|---|---|---|---|
| soul_app.export.title | Khaa Djama-I | **Redi Per Djama-I** | 词表里已经有「导出」:`Redi Per`(`export` / `export_error: Nen Per Djama`)。没必要另起词根 |
| soul_app.help.title | Sehedj | **Dbh Hena Wesheb** | 字面是「问与答」,这一页就是常见问题。不用 `Hehy Medu`:那是问答助手 |

另：同一个意思，词表里有两套写法。
- 列表的 CSV 导出用 `Bek Seth`(审计日志 `EXPORT`)。
- 资料打包用 `Redi Per`。

这次照这个分工写，不合并。

## 二、案卷附件(Web)

「附件」沿用第二十八批的 `Djama Hena`;「上传」= `Hab`(同图片上传 `Em Hab {{percent}}%`);「下载」= `Ini`。

| key | egy |
|---|---|
| case.attachments.add | Redi Djama Hena |
| case.attachments.drop | Redi Djama Dy, Er Khemen «Redi Djama Hena» |
| case.attachments.summary | Djama {{count}} · {{used}} / {{max}} MB |
| case.attachments.empty | Nen Djama Hena Djer |
| case.attachments.uploading | Em Hab · {{pct}}% |
| case.attachments.too_large | {{max}} MB Er Hry |
| case.attachments.too_many | Djama {{max}} Er Pehwy |
| case.attachments.failed_network | Nen Hab: Nen Em Senb |
| case.attachments.failed_generic | Nen Hab |
| case.attachments.download | Ini |
| case.attachments.remove | Fekh |
| case.attachments.delete_title | Fekh Djama Hena |
| case.attachments.delete_body | «{{name}}»: Fekh, Nen Ankh Wehem. Sep Khetem: Nen Fekh Djama Hena. |
| case.attachments.delete_failed | Nen Fekh |
| case.attachments.delete_concluded | Sep Khetem Seth: Nen Fekh Djama Hena. |
| case.attachments.preview_failed | Nen Wen Djama Pen |
| case.attachments.open_tab | Wen Em Medjat Mawy |
| case.attachments.print_title | Sesh Djama Hena |
| case.attachments.print_footer | Djama Hena Tepy: Em Hemsu |
| case.attachments.col_name | Ren |
| case.attachments.col_size | Aa |
| case.attachments.col_uploader | Hab Em |
| case.attachments.col_time | Ahet |
| case.attachments.load_failed | Nen Ini Djama Hena |
| case.attachments.limit | Tut Er PDF · 20 MB Er Aa |
| case.attachments.failed_type | Tut Er PDF Wa |

`limit`、`failed_type` 沿用第二十八批的写法。`drop` 里的 `Khemen`(按)和「再点一次」那几句用的是同一个词。

## 三、灵魂 App · 导出我的资料

| key | egy |
|---|---|
| soul_app.export.title | Redi Per Djama-I |
| soul_app.export.intro | Medu Neb Sesh Em Wesekhet Er-Ek: Djama Wa. |
| soul_app.export.included | Em Djama |
| soul_app.export.included_profile | Djes Hena Ren Hesb Ba |
| soul_app.export.included_merit | Sesh Nefer Hena Isfet |
| soul_app.export.included_judgments | Wedja Hena Medu Wedja (Maa-Ek Wa) |
| soul_app.export.included_letters | Sesh Hena Medu (Tut Hena) |
| soul_app.export.included_sign_ins | Aq Pehwy · Hru 90 |
| soul_app.export.excluded | Nen Em Djama |
| soul_app.export.excluded_deliberation | Medu Sab Em Sab |
| soul_app.export.excluded_letters | Sesh Nen Er-Ek |
| soul_app.export.timing | At Nedjes; Medu Aa: Hru Wa Er Aa. Iri Seth: Sedjem-Ek. Djama Wenen Hru 7. |
| soul_app.export.request | Sesh Sekhem-Ek, Dbh |
| soul_app.export.request_face | Aq Em {{bio}}, Dbh |
| soul_app.export.requested_at | Dbh {{time}}. Per Em Medjat Pen; Iri Seth: Sedjem-Ek. |
| soul_app.export.available_until | Wenen Er {{time}} |
| soul_app.export.share_note | «Smen Er Per…»: Wen Wat Redi En Ta. Mut: Dbh Mawy. Djama Wa Em Iri. |
| soul_app.export.expired | Djama Pen Mut. Dbh Mawy. |
| soul_app.export.failed | Nen Iri. Dbh Mawy. |
| soul_app.export.request_again | Dbh Mawy |
| soul_app.export.sheet_title | Maa Djes-Ek Tepy |
| soul_app.export.sheet_body | Djama Neb-Ek Redi Per. Sesh Sekhem-Ek: Maa Djes-Ek. |
| soul_app.export.sheet_next | Dbh |
| soul_app.export.working | Em Ini Djama… |
| soul_app.export.share_failed | Nen Wen Wat Redi. Wehem Iri. |
| soul_app.export.download_failed | Nen Ini Djama. Maa Senb, Wehem Iri. |
| soul_app.export.load_failed | Nen Ini Kheperu Redi Per. |

- 「书信」写 `Sesh`,「朋友圈的帖子」写 `Medu`(同 `POST: Medu`)。
- 「确认是你」写 `Maa Djes-Ek`(同 `mfa.disable_body`)。
- 「过期」写 `Mut`(同 `EXPIRED`)。
- `sheet_body` 的「当前密码」只写 `Sekhem-Ek`,和第二十批 `bio.enable_body` 同理。
- 「系统分享面板」= `Wat Redi En Ta`,「系统」照 `Smen Ta`。

## 四、灵魂 App · 帮助

「窗口」不另造词，写作「到本殿」(`Iyi Er Wesekhet`);「交付单」= `Djama Redi`;「联系邮箱」= `Wat Sesh`(灵魂 App 现用)。

| key | egy |
|---|---|
| soul_app.help.title | Dbh Hena Wesheb |
| soul_app.help.group_login | Aq Hena Ren Aq |
| soul_app.help.group_visit | Er Tepy Iyi Er Wesekhet |
| soul_app.help.group_contact | Sesh Er Wesekhet |
| soul_app.help.not_found | Nen Gem Wesheb? |
| soul_app.help.login_trouble | Nen Aq? |
| soul_app.help.q_login | Nen Aq |
| soul_app.help.a_login | Maa Ren Hesb Ba Tepy. Sekhem Nen Maat Sep 5: Aq Khetem At 15; Wehem Iri Er Khet. Nen Aq Djer: Khemen «Nen Rekh Sekhem». |
| soul_app.help.q_forgot | Nen Rekh Sekhem |
| soul_app.help.a_forgot | Em Aq: Khemen «Nen Rekh Sekhem»; Hesb Maa Hab Er Wat Sesh-Ek. Nen Wat Sesh: Iyi Er Wesekhet Hena Djama Redi. |
| soul_app.help.q_phone | Nen Gem Medjat-I |
| soul_app.help.a_phone | Aq Em Medjat Ky; «Sau Aq › Ikhet Hena Aq Pehwy»: Per Em Medjat Nen Gem, Er Khet Khemen Sekhem. Aq Sep Sen Wen: Aq Em Medu Ankh Wehem. Nen Medu Ankh Wehem: Iyi Er Wesekhet. |
| soul_app.help.q_slip | Djama Redi: Ptr? |
| soul_app.help.a_slip | Djama Shesep-Ek Em Iyi Er Wesekhet: Ren Hesb Ba Hena Sekhem Tepy. Er Khet Aq Tepy: Sekhem Tepy Nen Wenen. Sau Djama Redi: Iyi Er Wesekhet Hena-Ef. |
| soul_app.help.q_contact | Sesh Er Wesekhet: Mi? |
| soul_app.help.a_contact | Khemen «Sesh Er Wesekhet» Em Khery Medjat Pen; Wesheb Em Sesh-Ek. Medu Em Khet Seth: Iyi Er Wesekhet. |

- 「账号安全」照第三十批写 `Sau Aq`,「锁 15 分钟」照 `error_locked`。
- `q_slip` 里的 `Ptr`(什么)是**唯一一个要核对的词**:我在词表里没见到疑问词。如果守卫拦了，改成 **`Djama Redi`**(只写名词，问句交给版式)。
- 「急事」= `Em Khet Seth`(同 `urgent`)。

## 五、写给本殿(反馈)、设置分组、收件箱

| key | egy |
|---|---|
| soul_app.feedback.kind_label | Iru |
| soul_app.feedback.kind_account | Aq Hena Ren Aq |
| soul_app.feedback.kind_record | Sesh-I Nen Maat |
| soul_app.feedback.kind_app | Medjat Ba Nen Maat |
| soul_app.feedback.kind_other | Ky |
| soul_app.feedback.body_label | Medu-Ek |
| soul_app.feedback.body_placeholder | Ptr Kheper? Em Medjat Ptr? |
| soul_app.feedback.shots_label | Tut Medjat |
| soul_app.feedback.shots_hint | Setep · Tut 3 Er Pehwy |
| soul_app.feedback.shots_add | Redi Tut Medjat |
| soul_app.feedback.shots_remove | Fekh Tut Pen |
| soul_app.feedback.shots_limit | Tut 3 Er Pehwy |
| soul_app.feedback.note | Sab Wesekhet Wesheb Em Sesh-Ek, Mi Sesh Ky. |
| soul_app.feedback.appeal_hint | Wedja Nen Maat Er-Ek: Dbh Nehet. |
| soul_app.feedback.send | Hab |
| soul_app.feedback.failed | Nen Hab. Maa Senb, Wehem Iri. |
| soul_app.feedback.see_letters | Maa Sesh |
| soul_app.feedback.another | Sesh Ky |
| soul_app.settings.group_data | Djama-I |
| soul_app.settings.group_help | Dbh Hena Wesheb · Sesh Er Wesekhet |
| soul_inbox.feedback.label | Sesh Er Wesekhet · {{category}} |
| soul_inbox.feedback.tags.account | Aq Hena Ren Aq |
| soul_inbox.feedback.tags.record | Sesh Nen Maat |
| soul_inbox.feedback.tags.app | Medjat Ba Nen Maat |
| soul_inbox.feedback.tags.other | Ky |

- `body_placeholder` 也用了 `Ptr`。如果守卫拦了，改成 **`Kheper Hena Medjat`**。
- 「截图」= `Tut Medjat`(页面的图);「可选」= `Setep`(同 `optional`)。
- 收件箱标签里，灵魂写的「我的记录」改成「记录」(`Sesh Nen Maat`),因为官员读的时候不是「我」。

## 六、官员 App · 断网与回信排队

| key | egy |
|---|---|
| officer_app.offline.restored | Em Senb Mawy |
| officer_app.offline.restored_sent | Em Senb Mawy · Wesheb {{n}} Hab Seth |
| officer_app.offline.image_later | Em Senb: Maa |
| officer_app.outbox.auto | Em Senb: Hab Djes-Ef |
| officer_app.outbox.row | Wesheb · {{name}} |
| officer_app.outbox.failed_title | Wesheb · {{name}}: Nen Hab |
| officer_app.outbox.archived | Sesh Pen Nehem Er Per Sesh Seth. |
| officer_app.outbox.left_hall | Nen Em Wesekhet Pen Djer. |
| officer_app.outbox.retry | Nen Hab. Wehem Iri Er Khet. |
| officer_app.outbox.view_existing | Maa Wesheb Ky |
| officer_app.outbox.discard | Fekh Sesh Tepy-I |

「归档」照 `archived_done`;「自动」= `Djes-Ef`(同 `AUTO_REJECT`);`left_hall` 的「不再」照 `Djer`。

## 七、导出 CSV、推送、定时任务

| key | egy |
|---|---|
| common.export_csv | Bek Seth CSV |
| common.export_scope | Bek Seth Mi Setep · {{n}} |
| common.export_too_many | 10 000 Er Hry: Setep Nedjes |
| soul_push.export_ready | {'title': 'Djama-Ek Iri Seth', 'body': 'Redi Per Djama-Ek Iri Seth · Wenen Hru 7. Wen Medjat Ba, Sau.'} |
| scheduler.jobs.soul_accounts_prune_data_exports | Khetem Redi Per Djama Mut |

- `export_too_many` 的数字照 egy 现有写法，不加千分位逗号。
- 推送这一条的 JSON 结构原样保留，只换了 title 和 body 的文字。
