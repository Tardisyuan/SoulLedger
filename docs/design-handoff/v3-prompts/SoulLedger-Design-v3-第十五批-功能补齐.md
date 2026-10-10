# 第十五批 · 功能补齐(2026-10-10)

这一轮补了几块此前没有稿的功能。代码已按现有组件先做出来了，没有新造视觉样式。请你做两件事：
一、给 18 条 egy 文案；二、看 7 个没有稿的界面，要改的画出来，不用改的回一句「照现在」。

另有两块还在做(App 的「需要更新」整屏、权限配置导入导出)，做完如有新文案会追加在本文件末尾。

---

## 一、egy 待定 18 条

egy 暂时显示中文。占位符 `{{reason}}` `{{soul}}` `{{order}}` 请原样保留。

### 1. 官员 App · 开启两步验证(4 条)

| key | 中文 | English | 用在哪里 |
|---|---|---|---|
| officer_app.mfa.setup_key_title | 添加到验证器 | Add to your authenticator | 向导第 2 步的标题 |
| officer_app.mfa.setup_key_body | 点下面的按钮在验证器 App 中打开；打不开就把密钥长按选中复制，在验证器里手动输入。 | Tap the button to open it in your authenticator app. If nothing opens, press and hold the key to select and copy it, then enter it in the app by hand. | 第 2 步的说明 |
| officer_app.mfa.open_failed | 没有找到可打开它的验证器 App。请手动输入下面的密钥。 | No authenticator app could open it. Enter the key below by hand. | 点「在验证器 App 中打开」失败时 |
| officer_app.mfa.select_hint | 长按文字可以选中并复制。 | Press and hold the text to select and copy it. | 密钥和恢复码下方的小字 |

参考：Web 的两步验证已有全套 egy(`mfa.setup.*`、`mfa.manage.*`、`mfa.banner.*`)，App 里其余文字都复用了那一套。

### 2. 定时任务名(2 条)

| key | 中文 | English | 用在哪里 |
|---|---|---|---|
| scheduler.jobs.audit_prune_logs_for_tenant | 清理过期审计与登录日志 | Prune old audit and login logs | 管理员的定时任务列表里的任务名 |
| scheduler.jobs.audit_prune_untenanted_logs | 清理无租户的审计与登录日志 | Prune untenanted audit and login logs | 同上；清的是不属于任何一殿的记录(如登录失败) |

参考：同组 `scheduler.jobs.*` 已有的写法。

### 3. 受刑计划 · 重新发起调拨(12 条)

背景：某一站的调拨被执行地拒绝或被取消后，原属判官可以在受刑计划卡片的那一站上重新发起。

| key | 中文 | English | 用在哪里 |
|---|---|---|---|
| sentence_plan.retry_dispatch | 重新发起调拨 | Send dispatch again | 那一站上的按钮 |
| sentence_plan.retry_title | 重新发起「{{soul}}」第 {{order}} 站的调拨 | Send the dispatch for stop {{order}} of {{soul}} again | 确认框标题 |
| sentence_plan.retry_warning | 将向执行地重新提出一次调拨，等它批准并执行；与上一次一样不会自动重试，再被拒还要再来。 | This proposes a new dispatch to the destination hall and waits for it to approve and carry it out. Like the last one it is not retried automatically; if it is refused again you must send it again. | 确认框正文 |
| sentence_plan.retried | 调拨已重新发起 | Dispatch sent again | 成功提示 |
| sentence_plan.last_refusal_rejected | 上次调拨被执行地拒绝：{{reason}} | The last dispatch was refused by the destination: {{reason}} | 那一站上的原因行(有理由时) |
| sentence_plan.last_refusal_rejected_bare | 上次调拨被执行地拒绝 | The last dispatch was refused by the destination | 同上(没有理由时) |
| sentence_plan.last_refusal_cancelled | 上次调拨已被取消 | The last dispatch was cancelled | 同上(被取消时) |
| sentence_plan.errors.node_not_retryable | 这一站不是调拨被拒后等着的那一站 | This is not a stop waiting after a refused dispatch | 失败提示 |
| sentence_plan.errors.not_refused | 这一站的调拨没有被拒绝或取消过 | This stop's dispatch was never refused or cancelled | 失败提示 |
| sentence_plan.errors.not_next | 前面还有没开始的站，先处理它 | An earlier stop has not started yet; deal with that one first | 失败提示 |
| sentence_plan.errors.soul_away | 灵魂不在原属地，不能重新发起 | The soul is not at home, so the dispatch cannot be sent again | 失败提示 |
| sentence_plan.errors.dispatch_not_started | 调拨没能发出(例如还有一条手动调拨在途)，稍后再试 | The dispatch could not be sent (for example another manual dispatch is in flight); try again later | 失败提示 |

参考：同组 `sentence_plan.errors.*` 与「站」「调拨」「执行地」「原属地」已有的 egy 写法，请沿用。

---

## 二、没有稿的界面(7 处)

前 5 处已经做出来了，请审；后 2 处还没做，等你的稿和产品决定。

### 已做，请审

**1. 官员 App · 开启两步验证向导。** A12 只画了官员台(Web)的开启流程，手机没有稿。现在照 Web 做成四步：
① 准备验证器 App → ② 显示密钥(四位一组，长按可选中)+「在验证器 App 中打开」按钮 → ③ 输 6 位动态码 → ④ 恢复码，勾「我已妥善保存」才能点完成。
手机上没有画二维码(扫自己屏幕没有意义)。第 ④ 步不能返回、底部标签栏冻结。已开启时同一屏显示剩余恢复码数、「重新生成」「关闭」。
入口两个：「我的」页的两步验证行；被要求开启时顶部横幅右侧的「去设置 ›」。
请看：四步的版式、密钥与恢复码的排法、横幅里带动作的样子。

**2. 官员 App · 忘记密码。** 登录页账号密码那一步的「忘记密码」，原来跳浏览器，现在是应用内的一步：输入用户名或邮箱 → 发送 → 一句中性提示「已发送(如果账号存在且邮箱已验证)」。新密码仍在浏览器里设(邮件链接落在官员台)。提示页另有「通知管理员 ↗」。

**3. 官员 App · 修改密码。** 「我的」页新增一行，进入一屏：当前密码、新密码、确认。错误显示在对应输入框下。成功后提示并返回，不退出登录。

**4. Web 审判台 · 评议。** A13 / A14 只画了手机上写评议。Web 现在放在审判详情页资料舱下面，一个默认收起的整行折叠区，标题「评议 · N」；展开是列表(作者、时间、正文)加一个输入框和「发表」。
请定：这个位置对不对；要不要默认展开；开案和结案后都能写(后端规则如此)，结案后的评议要不要有区别。

**5. Web 受刑计划卡片 · 被拒的那一站。** 现在在那一站的行内加了一行原因(「上次调拨被执行地拒绝：……」)和一个「重新发起调拨」按钮，点了先出确认框。只有原属判官看得到按钮，其他人只看到原因。
请看：原因行与按钮在一站里的排法，被拒状态要不要有单独的标记。

### 未做，等稿

**6. 官员 App · 收信箱(给灵魂回信)。** 后端已有官员收件箱和回复模板，Web 也有页面，App 没有。A13 的范围里没写这块。
请定：官员 App 要不要有；要的话放在哪个标签下，列表与会话怎么排，回复模板怎么选。

**7. 灵魂 App · 书信发图。** 现在书信只能发纯文字。朋友圈已经能发图(选图、压缩、上传都有)。
请定：书信要不要能发图；要的话输入栏怎么加入口、图片消息在会话里怎么排、发送中与失败怎么显示、点开看大图的样子。

---

## Design 回复

(待填)
