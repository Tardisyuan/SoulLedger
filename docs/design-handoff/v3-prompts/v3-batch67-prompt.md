# SoulLedger · Design v3 · 第六十七批 · 流程严审修复后的 egy 补词与词义复核(2026-11-01)

11-01 做了一轮流程与易用性严审，修了约五十处，三端都有新文案。这一批只要 egy,不用画新画布(界面都沿用现有组件);第三节是请你顺手看一眼的新界面，有问题再说。

## 一、egy 补词(128 条)
闭合词表；需要新词根请先在回复里单列并说明词义。回 `egy-fill-2026-11-01-67.json`(键 → egy,平铺)。占位符(`{{…}}` / `{…}`)三种语言必须一致。

几组的用途：
- `soul_app.chat.*`:书信申请的「拒绝」「拉黑」、已拉黑名单(设置里)、被拉黑方只看到「无法送达」(**不能透露被拉黑**)、禁言理由。
- `permission.names.*`:「无权限」页写明缺哪个权限，这里是权限的可读名称(与后端权限名同义)。
- `death_sync.next.*`:死亡登记失败行的「下一步」提示。
- `soul_app.help.*`:帮助页新增「名词解释」组(第一条讲三种申诉)。
- `officer_app.me.logout_*` / `officer_app.outbox.*`:官员端退出前提示「还有 N 封没发出、M 份草稿」。
- `soul_accounts.credentials.*`:凭据页三步指引与「标记已交付」确认。

| 键 | 中文 | English |
|---|---|---|
| `sentence_plan.last_refusal_not_started` | 上次调拨没能发起（例如还有一条调拨在途，或执行地闭殿） | The last dispatch could not be started (for example another dispatch is in flight, or the destination hall is closed) |
| `reincarnation.error.open_judgment` | {{name}}还有未结案的审判，结案或撤案之后才能转世。 | {{name}} still has an open judgment; conclude or withdraw it before the rebirth. |
| `dispatch.soul_not_in_underworld` | 这个灵魂不在冥府（在世、轮回中、已终局或失踪），不能调拨 | This soul is not in the underworld (alive, awaiting rebirth, settled or lost); it cannot be dispatched |
| `dispatch.soul_on_sentence_plan` | 这个灵魂的受刑计划正在进行，调拨按计划走 | This soul has a sentence plan in progress; its dispatches follow the plan |
| `soul_app.chat.block.confirm` | 拉黑 | Block |
| `soul_app.chat.block.confirm_body` | 拉黑之后，对方不能再给你写信，你们这段书信也停在这里。可在设置 › 已拉黑 里解除。 | Once blocked, they cannot write to you, and this thread stops here. You can undo it in Settings › Blocked. |
| `soul_app.chat.block.confirm_title` | 拉黑{{name}}？ | Block {{name}}? |
| `soul_app.chat.block.done` | 已拉黑 | Blocked |
| `soul_app.chat.block.failed` | 没能拉黑，稍后再试 | Could not block. Try again shortly. |
| `soul_app.chat.blocks.empty` | 没有拉黑任何灵魂。 | You have not blocked anyone. |
| `soul_app.chat.blocks.failed` | 没能解除，稍后再试 | Could not unblock. Try again shortly. |
| `soul_app.chat.blocks.title` | 已拉黑 | Blocked |
| `soul_app.chat.blocks.unblock` | 解除 | Unblock |
| `soul_app.chat.blocks.unblocked` | 已解除 | Unblocked |
| `soul_app.chat.closed.declined` | 对方没有接受这次申请。这段话留着；一日之后可以再写一封。 | They did not accept this request. These words remain; you may write again in a day. |
| `soul_app.chat.closed.peer_blocked` | 你已拉黑对方。在设置 › 已拉黑 里可以解除。 | You blocked this soul. You can undo it in Settings › Blocked. |
| `soul_app.chat.closed.undeliverable` | 无法送达。 | Cannot be delivered. |
| `soul_app.chat.errors.declined` | 对方没有接受这次申请。 | They did not accept this request. |
| `soul_app.chat.errors.not_a_request` | 这封已不是待回的申请。 | This is no longer an unanswered request. |
| `soul_app.chat.errors.peer_blocked` | 你已拉黑对方。 | You blocked this soul. |
| `soul_app.chat.errors.undeliverable` | 无法送达。 | Cannot be delivered. |
| `soul_app.chat.menu.block` | 拉黑 | Block |
| `soul_app.chat.request.block` | 拉黑 | Block |
| `soul_app.chat.request.decline` | 拒绝 | Decline |
| `soul_app.chat.request.declined` | 已拒绝这次申请 | Request declined |
| `soul_push.social_muted.body` | 你被禁言 {{days}} 日，期间朋友圈只读，也不能与灵魂通信。 | You are muted for {{days}} days: the circle is read-only and you cannot write to other souls. |
| `soul_push.social_muted.title` | 你已被禁言 | You are muted |
| `soul_push.social_muted_reason.body` | 你被禁言 {{days}} 日：{{reason}} | You are muted for {{days}} days: {{reason}} |
| `soul_push.social_muted_reason.title` | 你已被禁言 | You are muted |
| `officer_app.me.logout_pending` | 还有 {{unsent}} 封回信没发出、{{drafts}} 份回信草稿。退出后会从这台设备上清除。 | {{unsent}} unsent replies and {{drafts}} reply drafts are still on this device. Signing out removes them. |
| `officer_app.me.logout_retry` | 先重试发送 | Try sending first |
| `officer_app.me.logout_anyway` | 仍然退出 | Sign out anyway |
| `officer_app.outbox.discard_confirm` | 删除这份草稿？写的内容不能找回。 | Delete this draft? What you wrote can't be recovered. |
| `officer_app.outbox.discard_ok` | 删除 | Delete |
| `officer_app.wangsi.reject_title` | 认定{{name}}的申诉不属实？ | Find {{name}}'s grievance not upheld? |
| `officer_app.wangsi.reject_body` | 申诉将记为不属实，连同你的审核意见。 | The grievance is recorded as not upheld, with your review note. |
| `officer_app.wangsi.late_title` | 认定{{name}}的申诉属实？ | Find {{name}}'s grievance upheld? |
| `officer_app.wangsi.final` | 结论记下后不能更改。 | A finding can't be changed once recorded. |
| `officer_app.tabs.notices_unread` | 通知 · 有未读 | Notices · unread |
| `officer_app.letter.moved` | 灵魂已调往别处，暂不能回信。 | This soul has been moved elsewhere, so you can't reply for now. |
| `officer_app.outbox.moved` | 灵魂已调往别处，暂不能回信。你写的内容还留着。 | This soul has been moved elsewhere, so you can't reply for now. What you wrote is kept. |
| `soul_app.applications.state_reason.ALIVE` | 你还在世。本世结束、审判与处置都完成后，才能申请转生。 | You are still alive. You can apply for rebirth once this life has ended and its judgment and disposition are complete. |
| `soul_app.applications.state_reason.JUDGING` | 审判还没结束。结案、处置执行完之后，才能申请转生。 | Your judgment is not over yet. You can apply for rebirth once it is concluded and its disposition carried out. |
| `soul_app.applications.state_reason.DISPOSED` | 处置已执行，但你还没进入轮回。殿司把你转入轮回之后，才能申请转生。 | Your disposition has been carried out, but you have not entered the cycle of rebirth yet. You can apply once the hall moves you into it. |
| `soul_app.applications.state_reason.LOST` | 你的记录处于「失踪」状态，暂不能申请。请写信给殿司。 | Your record is marked lost, so you cannot apply for now. Please write to the hall. |
| `soul_app.applications.state_reason.SETTLED` | 本世已结算，不再受理新的转生申请。 | This life is settled; no new rebirth application can be made. |
| `soul_app.settings.email_nudge_title` | 添加联系邮箱 | Add a contact email |
| `soul_app.settings.email_nudge_body` | 忘记密码时，验证码发到联系邮箱。没有它，就只能到本殿窗口重设密码。 | If you forget your password, the code goes to your contact email. Without one, only the hall's counter can reset it. |
| `soul_app.circle.me.short` | 我的 | Me |
| `appeals.open_note` | {{n}} 件审判可申诉 · 最早 {{date}} 截止 | {{n}} judgment(s) open to appeal · the first closes {{date}} |
| `soul_app.feedback.appeal_link` | 去「本世 › 审判」申诉 | Go to This life › Judgments to appeal |
| `soul_app.feedback.send_needs_body` | 先写下情况，才能发出。 | Write what happened first, then it can be sent. |
| `soul_app.security.lost_phone_hint` | 手机丢了？用另一部手机登录，在「登录设备与记录」让丢的那部退出，再改密码。 | Lost your phone? Sign in on another one, sign the lost phone out under “Devices and sign-ins”, then change your password. |
| `soul_app.biometric.prompt_login` | 用来登录灵魂簿，不用输密码。 | Sign in to Soul Ledger without a password. |
| `soul_app.biometric.prompt_unlock` | 用来解锁灵魂簿。 | Unlock Soul Ledger. |
| `soul_app.biometric.prompt_export` | 用来确认是你本人，导出你的资料。 | Confirm it is you, to export your records. |
| `soul_app.help.group_terms` | 名词解释 | Terms |
| `soul_app.help.q_appeals` | 三种申诉有什么不同 | The three kinds of appeal |
| `soul_app.help.a_appeals` | 审判申诉：对已结案审判的结果不服，在截止日前提出，每件审判最多两次，撤回也算一次。转生申诉：转生申请被驳回后，每份申请可以申诉一次。冤情申诉：押在枉死城、认为自己冤死时向城隍提出；查明不属实，之后可以再提。 | Judgment appeal: you dispute a concluded judgment; file it before its deadline, at most twice per judgment, and a withdrawal counts. Rebirth appeal: a rejected rebirth application can be appealed once. Grievance: held in the City of the Wrongly Dead and believing your death unjust, you petition the City God; if it is found untrue you may file again later. |
| `soul_app.help.q_merit` | 功与过 | Merit and demerit |
| `soul_app.help.a_merit` | 功过记录是这一世的账：做的好事记功，过错记过。两者相减，就是「本世账目」上面那个数。 | Your records are this life's account: good deeds are merit, wrongs are demerit. Merit minus demerit is the number above “This life's ledger”. |
| `soul_app.help.q_disposition` | 处置 | Disposition |
| `soul_app.help.a_disposition` | 审判结案之后，对你去向的安排：例如去哪里受刑、往哪一道投生。 | What is decided for you once a judgment is concluded: where you serve a sentence, or which path you are reborn into. |
| `soul_app.help.q_sentence` | 受刑计划 | Sentence plan |
| `soul_app.help.a_sentence` | 处置里要服的刑，按站排成的一份计划。一站执行完才去下一站；全部完成后才能申请转生。 | The sentence in your disposition, laid out station by station. Each station is served before the next; rebirth can be applied for only once all are done. |
| `soul_app.help.q_cooldown` | 冷却期 | Cooling-off period |
| `soul_app.help.a_cooldown` | 转生申请被驳回之后的等待期，期内不能重新申请。每段冷却期可以申请缩短一次。 | The wait after a rebirth application is rejected; you cannot apply again until it ends. Each cooling-off period can be asked to be shortened once. |
| `soul_app.help.q_residing` | 暂居 | Residing |
| `soul_app.help.a_residing` | 人在另一个文明，籍不变：页面换成那里的样子，转生与申诉仍由你原属的文明受理。 | You are in another civilization but still belong to your own: the pages take on where you are, while rebirth and appeals stay with your home civilization. |
| `soul_app.help.q_hall` | 殿司 | The hall |
| `soul_app.help.a_hall` | 你所在殿的办事处。写信给殿司，由官员以殿司的名义回复。 | The office of the hall you are in. Write to the hall and an officer replies in its name. |
| `soul_app.circle.muted.reason` | 殿司写的理由：{{reason}} | The hall's reason: {{reason}} |
| `permission.needs` | 这一页需要「{{names}}」权限。 | This page needs the “{{names}}” permission. |
| `permission.needs_admin` | 这一页只对管理员开放。 | This page is open to administrators only. |
| `permission.names_or` | 」或「 | ” or “ |
| `permission.names.actors.read` | 查看角色 | View figures |
| `permission.names.capture.read` | 查看勾魂牒 | View summons warrants |
| `permission.names.city_god.read` | 查看城隍 | View City Gods |
| `permission.names.dispatch.manage` | 管理调度 | Manage transfers |
| `permission.names.dispatch.read` | 查看调度 | View transfers |
| `permission.names.disposition.read` | 查看处置 | View dispositions |
| `permission.names.judgment.read` | 查看审判 | View judgments |
| `permission.names.ledger.read` | 查看功德 | View merit |
| `permission.names.menu.read` | 查看菜单 | View menus |
| `permission.names.org.read` | 查看组织 | View organizations |
| `permission.names.realms.read` | 查看领域 | View realms |
| `permission.names.reincarnation.read` | 查看轮回 | View reincarnation |
| `permission.names.scheduler.read` | 查看定时任务 | View scheduled tasks |
| `permission.names.session.manage` | 管理在线会话 | Manage online sessions |
| `permission.names.social.moderate` | 审核灵魂朋友圈 | Moderate the soul circle |
| `permission.names.soul.read` | 查看灵魂 | View souls |
| `permission.names.soul_account.read` | 查看灵魂账号 | View soul accounts |
| `permission.names.soul_inbox.read` | 查看殿司收件箱 | View the hall inbox |
| `permission.names.system.settings` | 系统设置 | System settings |
| `permission.names.tudi.read` | 查看土地公 | View Tudi Gong |
| `permission.names.workflow.read` | 查看工作流 | View workflows |
| `profile.default_view_admin` | 管理员 | Administrator |
| `profile.default_view_unset` | 还没选过：按你的角色落地 —— 官员先到审判队列，管理员先到统计概览。 | Not chosen yet: you land by role — officers on the judgment queue, administrators on the overview. |
| `soul_accounts.account.provisioned_sent` | 已开通本世账号。初始密码正发往 {{to}}；发送失败会转入「待交付」列表。 | This life's account is open. The initial password is being sent to {{to}}; if sending fails it moves to the pending list. |
| `soul_accounts.account.provisioned_pending` | 已开通本世账号。没有联系方式，初始密码在「待交付」列表里，请查看或打印交付单后当面交给灵魂。 | This life's account is open. There is no contact on file, so the initial password is waiting in the pending list — view it or print the slip and hand it to the soul in person. |
| `soul_accounts.credentials.steps.1` | 查看密码，或打印交付单 | View the password, or print the delivery slip |
| `soul_accounts.credentials.steps.2` | 当面交给灵魂本人 | Hand it to the soul in person |
| `soul_accounts.credentials.steps.3` | 交到之后再点「标记已交付」 | Only then press “Mark delivered” |
| `soul_accounts.credentials.deliver_confirm_title` | 确认已把密码交给 {{name}}？ | Has the password reached {{name}}? |
| `soul_accounts.credentials.deliver_confirm_body` | 标记后这一份会离开「待交付」清单，不再有人跟进。还没交到手就先别标。 | Once marked, it leaves the pending list and nobody follows it up. If it has not been handed over yet, do not mark it. |
| `soul_accounts.credentials.deliver_confirm` | 确认已当面交付 | Yes, handed over in person |
| `death_sync.error.HALL_INACTIVE` | 本殿已停用，不收新的登记 | This hall is deactivated and accepts no new registrations |
| `death_sync.next.SOUL_NOT_FOUND` | 在灵魂名册里按姓名、生辰核对；登记内容有误时，请来源系统改正后换一个幂等键重新提交（原样重发会被当成同一次）。 | Check the name and birth date in the soul roster. If the registration is wrong, the source system must correct it and resubmit under a new idempotency key (resending it as is counts as the same request). |
| `death_sync.next.SOUL_NOT_ALIVE` | 这个灵魂已不在阳世，多半已经登记过；到灵魂详情看他现在的状态，通常无需再处理。 | This soul is no longer among the living and has most likely been registered already; check its current state — usually nothing more is needed. |
| `death_sync.next.INVALID_TRANSITION` | 灵魂当前的状态不能转入审判；到灵魂详情看他的状态与时间线，再决定要不要人工处理。 | The soul's current state cannot move into judgment; check its state and timeline before deciding whether to handle it by hand. |
| `death_sync.next.INTERNAL_ERROR` | 系统内部出错，可以点「重试」。 | An internal error; you can press “Retry”. |
| `death_sync.next.VALIDATION_ERROR` | 登记内容不合格式（见上方原文）；请来源系统改正后换一个幂等键重新提交。 | The registration is malformed (see the text above); the source system must correct it and resubmit under a new idempotency key. |
| `death_sync.next.NO_CITY_GOD` | 先在城隍页为本殿设一位能收案的城隍，再点「重试」。 | First give this hall a City God that can take the case on the City Gods page, then press “Retry”. |
| `death_sync.next.HALL_INACTIVE` | 本殿已停用；要收这条登记，先由管理员重新启用本殿。 | This hall is deactivated; an administrator must reactivate it before this registration can be taken. |
| `death_sync.next.retry_exhausted` | 重试次数已用完；请把这一行的来源编号交给系统维护人员。 | No retries left; pass this row's source reference to whoever maintains the system. |
| `death_sync.next.unknown` | 请把这一行的来源编号交给系统维护人员核查。 | Pass this row's source reference to whoever maintains the system to look into. |
| `death_sync.next.link_roster` | 去灵魂名册 | Open the soul roster |
| `death_sync.next.link_soul` | 看这个灵魂 | View this soul |
| `death_sync.next.link_city_gods` | 去城隍页 | Open City Gods |
| `judgment.concluded_filter.search` | 搜灵魂姓名、案号 | Search soul name or case number |
| `audit.filter_operator` | 操作人（用户名） | Operator (username) |
| `users.row_menu` | {{name}} 的更多操作 | More actions for {{name}} |
| `social_moderation.confirm_approve_title` | 放行这一条？ | Let this through? |
| `social_moderation.confirm_approve_body` | 举报会被驳回，内容照常显示；被词表拦下的也一并放行。 | The report is dismissed and the content stays up; anything the word list held back is approved too. |
| `social_moderation.confirm_mute_title` | 禁言 {{name}} {{n}} 天？ | Mute {{name}} for {{n}} days? |
| `social_moderation.confirm_mute_body` | 禁言期间对方不能发帖、评论。到期自动解除，也可以在「禁言」里提前解除。 | While muted they cannot post or comment. It lifts by itself when it ends, or you can lift it early under “Mutes”. |
| `social_moderation.tab_count_sr` | ，{{n}} 条 | , {{n}} items |
| `soul_inbox.errors.not_current_hall` | 灵魂已调往别处，暂不能回信 | This soul has been transferred elsewhere; you cannot reply for now |

## 二、词义变了、egy 还是旧义的(23 条)
这些键的中英文在本轮改了意思,egy 原值没动。请逐条看要不要改，改了一并写进同一个 JSON;不用改的在回复里写「不改」。
最要紧的是「申诉」拆成三种：**审判申诉**(`appeals.*`)、**转生申诉**(`soul_app.detail.appeal*`)、**冤情申诉**(`soul_app.wangsi.*`)—— 现在三处 egy 都是 `Nehet`,读者分不出来。还有「绑定邮箱」统一成「联系邮箱」。

| 键 | 原中文 | 新中文 | English | 现 egy |
|---|---|---|---|---|
| `soul_app.forgot_password.email_intro` | 填写灵魂账号绑定的邮箱，我们把 6 位验证码发过去。 | 填写灵魂账号的联系邮箱，我们把 6 位验证码发过去。 | Enter your soul account's contact email and we will send a 6-digit code to it. | Sesh Wat Sesh Em Aq En Ba-Ek. Hesb Maa Sesh 6 Hab Er Wat Sesh Pen. |
| `soul_app.forgot_password.sent_neutral` | 如果这个邮箱绑定了灵魂账号，验证码已发出 | 如果这个邮箱是某个灵魂账号的联系邮箱，验证码已发出 | If this is a soul account's contact email, a code has been sent | Hesb Maa Hab Seth Er Aq Ba Neb Em Wat Sesh Pen |
| `soul_app.forgot_password.step1_title` | 填写绑定的邮箱 | 填写联系邮箱 | Enter your contact email | Sesh Wat Sesh |
| `soul_app.forgot_password.no_email_link` | 没有绑定邮箱？ | 没有联系邮箱？ | No contact email? | Nen Wat Sesh? |
| `soul_app.forgot_password.no_email_step_1` | 写信给所在殿的殿司，说明你的姓名和灵魂编号。 | 到本殿窗口，带上交付单，说明你的姓名和灵魂编号。 | Come to the hall's counter with your delivery slip, and give your name and soul code. | Sesh Er Wesekhet-Ek: Ren-Ek Hena Ren Hesb Ba-Ek. |
| `soul_app.forgot_password.no_email_note` | 登录不上就没法在 App 里写信：请托同殿的灵魂转达，或在殿前的登记处当面说明。 | 去不了殿里的，可以请同殿的灵魂写信给殿司代为转达。重设后登录，记得到「设置 › 联系邮箱」添加邮箱，下次就能自己重设。 | If you cannot come, ask a soul of your hall to write to the hall for you. Once you are back in, add an address under Settings › Contact email, so next time you can reset it yourself. | Nen Aq: Nen Sesh Em Medjat Ba. Dbh Ba Ky En Wesekhet-Ek; Ky: Djed Em Wesekhet-Ek. |
| `soul_app.detail.appeal` | 申诉 | 转生申诉 | Rebirth appeal | Nehet |
| `soul_app.detail.appeal_submit` | 提交申诉 | 提交转生申诉 | Submit rebirth appeal | Dbh Nehet |
| `soul_app.detail.appealed` | 申诉已提交 | 转生申诉已提交 | Rebirth appeal submitted | Nehet Dbh Seth |
| `soul_app.errors.initial_password_expired` | 初始密码已过期,请联系官员重置 | 初始密码已过期。绑定了联系邮箱的,可以在登录页点「忘记密码」用邮箱自己重置;否则请联系官员重置 | The initial password has expired. If you have a contact email, reset it yourself with “Forgot password” on the sign-in page; otherwise ask an officer to reset it | Sekhem Tepy Mut. Dbh Sab Er Wehem Sekhem |
| `soul_app.circle.compose.vis.tenant_hint` | 本文明已登录的灵魂。 | 本文明的所有灵魂都能看到，包括没关注你的。不出本文明。 | Every soul in this civilization, including those who do not follow you. Never beyond it. | Ba Em Aq, Em Taui Pen. |
| `soul_app.help.write` | 写给本殿 | 写信给殿司 | Write to the hall | Sesh Er Wesekhet |
| `soul_app.help.a_forgot` | 在登录页点「忘记密码」,验证码会发到你登记的联系邮箱。没有登记邮箱的，请到本殿窗口办理，带上交付单。 | 在登录页点「忘记密码」，验证码会发到你的联系邮箱。还没有联系邮箱的，登录后到「设置 › 联系邮箱」添加；已经登录不上的，请到本殿窗口办理，带上交付单。 | On the sign-in page tap “Forgot password”; a code is sent to your contact email. No contact email yet? Add one under Settings › Contact email once signed in. Already unable to sign in? Come to the hall's counter with your delivery slip. | Em Aq: Khemen «Nen Rekh Sekhem»; Hesb Maa Hab Er Wat Sesh-Ek. Nen Wat Sesh: Iyi Er Wesekhet Hena Djama Redi. |
| `soul_app.help.a_contact` | 在这页底部点「写给本殿」,回复会出现在书信里。急事请到本殿窗口。 | 在这页底部点「写信给殿司」，回复会出现在书信里。急事请到本殿窗口。 | Tap “Write to the hall” at the bottom of this page; the reply appears in your letters. For anything urgent, come to the hall's counter. | Khemen «Sesh Er Wesekhet» Em Khery Medjat Pen; Wesheb Em Sesh-Ek. Medu Em Khet Seth: Iyi Er Wesekhet. |
| `soul_app.feedback.appeal_hint` | 对审判结果有异议，请走申诉。 | 对审判结果有异议，请走审判申诉。 | To dispute a judgment, file a judgment appeal. | Wedja Nen Maat Er-Ek: Dbh Nehet. |
| `soul_app.feedback.failed` | 没有发出去。检查网络后再试。 | 没能发出。检查网络后再试。 | Not sent. Check your connection and try again. | Nen Hab. Maa Senb, Wehem Iri. |
| `soul_app.wangsi.file` | 申诉 | 冤情申诉 | Grievance | Nehet |
| `soul_app.wangsi.file_title` | 枉死城申诉 | 枉死城 · 冤情申诉 | Grievance to the City God | Nut Mut Nen Maat · Nehet |
| `soul_app.wangsi.submit` | 提交申诉 | 提交冤情申诉 | Submit grievance | Hab Nehet |
| `soul_app.wangsi.submitted_toast` | 申诉已提交 | 冤情申诉已提交 | Grievance filed | Nehet Hab Seth |
| `appeals.file` | 申诉 | 审判申诉 | Judgment appeal | Nehet |
| `appeals.submit` | 提交申诉 | 提交审判申诉 | Submit judgment appeal | Hab Nehet |
| `appeals.submitted_toast` | 申诉已提交 | 审判申诉已提交 | Judgment appeal submitted | Nehet Hab Seth |

## 三、新界面(请看一眼，不用画；有问题写在回复里)
- 灵魂端书信：申请横条下「拒绝」「拉黑」两个按钮;拉黑前的确认底板;设置 › 已拉黑。
- 灵魂端本世：埃及、欧洲的进度条去掉「轮回中」一步(阶段数随文明变);首次改密后的「添加联系邮箱」提示卡;账目下方的申诉期限一行。
- 官员端：退出前的「还有 N 封没发出」三选一(先重试发送 / 取消 / 仍然退出);枉死「不属实」「属实(只记结论)」的确认底板;灵魂调走后回信框换成一行说明。
- Web:无权限页写出缺的权限;个人资料「默认视图」一节;用户表每行收成「编辑」+「⋯」;凭据页三步指引。

回复写在 `v3-batch67-reply.md`,JSON 写在 `egy-fill-2026-11-01-67.json`,都发布到这个目录。
