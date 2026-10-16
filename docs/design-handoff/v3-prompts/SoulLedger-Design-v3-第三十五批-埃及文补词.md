# 第三十五批 · 埃及文补词(2026-10-16)

第三十四批落地时新加了一些文案，zh-Hans / en 已在线上，请给 egy。`{{…}}` 原样保留。共 25 条。

## 一、用户 CSV 导入(W-5)

第三十四批回复说「沿用灵魂档案导入，不单独出稿」,所以导入弹层的文案是我们照灵魂档案导入的口吻写的。能复用的现有键都已复用(选文件、模板、检查中、汇总、只看出错、文件错误)。下面这些是用户导入特有的：列名、按钮、逐行问题码、模板说明。

## 二、请求改派带理由的通知(`official_notify.judgment_reassign_requested_with_reason.*`)

产品定了：审批人收到的「请求改派」通知要带理由。有理由时用新的一句，没有理由的老通知仍用原句。

## 全部待补(两部分合在一张表)

| key | zh | en |
|---|---|---|
| official_notify.judgment_reassign_requested_with_reason.body | {{by}} 请求改派案件 {{soul}}。理由：{{reason}} | {{by}} asks for the case of {{soul}} to be reassigned. Reason: {{reason}} |
| official_notify.judgment_reassign_requested_with_reason.title | 请求改派 | Reassignment requested |
| users.import.back | 上一步 | Back |
| users.import.blocked | 有 {{n}} 行有问题，导入被禁用。修正文件后重新选择。 | {{n}} rows have problems; import is disabled. Fix the file and choose it again. |
| users.import.button | 导入 CSV | Import CSV |
| users.import.col_issue | 问题 | Issue |
| users.import.col_name | 姓名 | Name |
| users.import.col_username | 用户名 | Username |
| users.import.commit | 导入 {{n}} 人 | Import {{n}} people |
| users.import.row_codes.email_invalid | 邮箱格式不对 | Email format is wrong |
| users.import.row_codes.email_taken | 邮箱已属于另一个账号，或与文件前面的行重复 | Email belongs to another account, or repeats an earlier row |
| users.import.row_codes.password_required | 缺密码 | Password missing |
| users.import.row_codes.password_weak | 密码不符合规则 | Password does not meet the rules |
| users.import.row_codes.role_invalid | 不是已知的角色 | Not a known role |
| users.import.row_codes.unknown | 这一行没能检查 | This row could not be checked |
| users.import.row_codes.username_required | 缺用户名 | Username missing |
| users.import.row_codes.username_taken | 用户名已被占用，或与文件前面的行重复 | Username is taken, or repeats an earlier row |
| users.import.step | {{n}} / 3 · {{label}} | {{n}} / 3 · {{label}} |
| users.import.steps.choose | 选文件 | Choose file |
| users.import.steps.preview | 预览 | Preview |
| users.import.steps.result | 结果 | Result |
| users.import.success | 已导入 {{n}} 人。他们第一次登录必须先改密码。 | Imported {{n}} people. They must change their password at first login. |
| users.import.template_notes | 模板列说明：username 必填；password 必填，由你设定，对方第一次登录必须先改；role 选填，默认 VIEWER；email、display_name 选填。 | Template columns: username is required; password is required — you set it, and the person must change it at first login; role is optional (default VIEWER); email and display_name are optional. |
| users.import.title | 导入用户 | Import users |
| users.import.view_users | 查看用户列表 | View users |


## 三、顺带告诉你们的

- 「案由」:产品定了给审判加一个单独的「案由」字段，官员 App 的案情页「案由」一段显示它，空则整段不显示。网页审判台的输入框标签复用 `officer_app.case.summary`。
- 官员 App 的「已请求改派 · 等审批」现在由后端记录，重开页面也在。
- 书信归档：维持「已归档」横条 + 「取消归档」,不做带撤销的 toast(产品定)。
- 删除空机构的确认键：按仓库现有规则(确认框里的危险操作用次级样式，不涂红),不照稿里的 danger 色。
- 调拨记录一条只有一个灵魂，稿里「12 魂 · 还有 10 个」那种列表现在没有数据，界面上就是一个灵魂。

## 四、请你定一件事：官员 App「通知类别」页的开关样式

第三十四批 O-06b 的稿里，每个类别右边是**滑动开关**(圆角滑块，开为文明色)。
现在实现成了**整行可点 + 右边一个 ✓**(开着显示 ✓,关掉不显示;「必收」的类别右边写「必收」,不能点)。
行为和稿一样：点一下立即保存，失败时复原并出提示；类别、顺序、说明、脚注都照稿。

两种都能用，差别只在看起来像不像「开关」。请定：

1. 改成稿里的滑动开关(和灵魂 App「推送设置」一致);
2. 保持 ✓(官员 App 别处的多选行用的也是 ✓,和它们一致)。

选 1 我们照稿改，不需要新文案。
