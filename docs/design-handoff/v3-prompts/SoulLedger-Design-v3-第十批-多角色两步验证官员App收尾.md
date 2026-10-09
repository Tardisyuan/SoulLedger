# SoulLedger Design v3 · 第十批:多角色 / 两步验证 / 官员 App 收尾(2026-10-09)

第八批(两步验证)和第九批(官员 App)已按你的稿实现，多角色 `/users` 也做完了。
这一批是实现时**偏离了稿子**或**稿子没覆盖**的地方，以及**埃及语缺词**。
请逐条答「同意 / 改成…」;画面类的请在 `templates/soulledger-v3-pages/` 里补稿。

---

## 一、画面(请补稿或确认)

### 1. 官员 App 图标(上架前必需)
- 现在 `mobile-officer/` 用的是**灵魂端的金标深底图标**的拷贝(含 Android adaptive icon)。
- 你在 A13 定了官员端是「**墨标配纸色底**」。需要:
  - iOS 1024 主图标;
  - Android adaptive 前景 + 背景;
  - 通知小图标(单色)。
- 启动屏背景已经是纸色 `#EFEFEB`,九笔墨色 `#181A17`;请确认这两个值。

### 2. 个人资料页的「两步验证」区
- 你的稿是**左侧子导航 + 720 宽面板**。现在个人资料页没有子导航，实现成了页面里新增的一节「丁 · 两步验证」。
- 问：是要我们给个人资料页加子导航，还是接受「分节」写法?

### 3. 管理员「重置两步验证」对话框
- 稿是 560 宽原生 alertdialog;实现用的是站内统一的 `BaseModal`(640),里面 `role="alertdialog"`。
- 问：接受 640,还是坚持 560?

### 4. 殿设置 › 安全
- 殿设置对话框没有页签，「必须开两步验证的角色」这一组放在了对话框**最底部**。
- 问：可以吗，还是要给殿设置加页签(常规 / 安全)?

### 5. 仪表盘「趋势」面板(之前在 egy 第三批里提过，再催一次)
- 无稿，按 A4 图表约定先做了：冷灰蓝明度梯度、线型区分、字形图例。
- 两组开关：区间(30 天 / 90 天 / 12 个月)与维度(状态 / 文明)。
- 请给一张正式稿，含空态(部署后还没有快照)。

### 6. 官员 App 的两处功能空缺(画面要怎么表达)
- **加签**:候选人列表已做(只列本殿)，**但后端还没有「提交加签」这个动作**。现在确认按钮置灰并写明原因。
  - 问：置灰时那一行字怎么写?
- **审判写评议**:后端没有评议接口，审判页签目前只能「认领 / 查看」。
  - 问：评议入口先隐藏，还是显示为置灰?

---

## 二、埃及语缺词

规则照旧：只用封闭词表里的词;§7 失败写法「Nen + 动词」,Nen Kheper 只限白名单。
下面没有 egy 值的 key 现在回退到中文。

### A. 多角色(`/users`)
| key | 中文 |
|---|---|
| users.roles_dialog.primary_hint | 主角色决定是否为管理员，以及权限高低的排名。 |
| users.roles_dialog.extra_hint | 权限取主角色与全部兼任角色的并集;殿主的禁令只管殿主那一份，兼任判官仍可经判官审批。管理员专属的操作仍只认主角色。(措辞随 2026-10-09 的决定修订中) |
| users.roles_dialog.extra_none | 没有可兼任的角色 |
| users.roles_dialog.admin_locked | 管理员已拥有全部权限，不能再兼任其它角色。 |
| users.batch.skipped_note | 管理员账号和你自己不在批量范围内。 |

缺的概念：排序、合并(并集)、被排除在批量之外、不能、没有可选。

### B. 两步验证 —— 子代理用现有词拼的近似，请审定
| 中文 | 暂用 egy |
|---|---|
| 验证器 App | Kat Medu Ahet |
| 手机 / 设备 | Kat |
| 二维码 | Tut Medu |
| 密钥 | Medu Khetem(Sekhem 已留给「密码」) |
| 扫描 | Maa |
| 两步验证 | Maa Sep Sen |
| 恢复码 | Medu Ankh Wehem |

### C. 官员 App
**1. 词表里没有的词(整类缺):**
官员、待办、查询 / 查灵魂、我的、加签、在电脑上继续、只读、推送、名字或编号、官员台、宣判 / 待宣判、没取到。

**2. 现有词里同一个中文对应两个 egy 值，请指定用哪个:**
- 审判(页签)
- 通知(页签)
- 待我处理
- 转生申请(分组)
- 批准
- 语言
- 用户名

**3. 子代理建议复用的现有词，请确认:**

| 中文 | 建议 egy |
|---|---|
| 审判 | Wedja |
| 通知 | Sedjem Sab |
| 驳回 | Khesef |
| 批准 | Hesy |
| 转生申请 | Dbh Wehem Mesut |
| 缩短冷却申请 | Dbh Khebi Ahet Qebeh |
| 问一问 | Hehy Medu |
| 待认领 | Nen Shesep Djer |

**4. 需要整句的 key(文案见第九批表格):**
- 名称与页签：`officer_app.name`,`tabs.*`。
- 待办与审判：`todo.*`,`queue.*`。
- 跳转与查询：`continue_on_desk`,`search.*`。
- 详情与确认：`detail.*`,`confirm.*`(含 `reasons.already_handled / deadline_passed / permission_changed / network / other`)。
- 落地与状态：`landing.handled`,`state.*`。
- 推送与设置：`push.lock`,`me.*`。

**5. 实现时新增、第九批表里没有的 key:**
- 登录与验证：`login.*`(含选殿步骤),`mfa.*`。
- 横幅：`banner.mfa_required`(必须开两步验证但还没开)。
- 加签与分类：`cosign.*`,`kinds.*`,`areas.*`。
- 空态与查询：`notices.empty_*`,`search.no_souls_*`,`search.residing`(外文明暂居)。
- 我的：`me.profile / name / hall / mfa_note / push_note / push_denied / push_unavailable / push_failed / version / logout_title / logout_ok`。
- 确认：`confirm.requester / approve_body.* / remaining_days / days_label / days_invalid`。
- 其他：`landing.someone`,`queue.claim_failed`。

如果方便，请给一份 `officer_app.*` 完整 egy 表(key → egy),我们直接导入。

### D. 旧欠
语言名「English」「Kemet / egy」仍无词，殿设置的语言下拉里在用替代写法。
