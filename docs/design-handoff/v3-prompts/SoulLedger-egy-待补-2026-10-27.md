# SoulLedger · egy 待补(2026-10-27)

请按设计系统的 egy 词表(`_egy_lexicon.tsv`)补两部分。规则同前几批:只用词表里已有的词;确实没有的词，给出新词根建议并标明，同时写一个用现有词的暂代版本。占位符 `{{x}}` 原样保留。

回复格式：第二部分按下面表格的键，给一个 JSON 对象 `{"键": "egy 文案", …}`;第一部分逐条给词。

## 一、词义缺口(第五十四批 Design 回复里的「待补」,现在用暂代词)

- **「孟婆汤」「饮」**:没有对应的词。暂用 `Fekh Rekh`(抹去记忆)代替整碗汤，就是 `souls.detail.memory_reset` 那个说法:「已饮」写成 `Iri Seth`,「登记已饮」写成 `Sesh Fekh Rekh`。有了「汤」和「饮」的词，换掉这几处即可。
- **「邀请」**:没有对应的词。用 `Menf`(链接)和 `Hab Menf`(发链接)代替，和重置密码的「发链接」同一个说法。
- **「移交」**:用的是 `Redi`(交给)。改派仍然是 `Hab Ky`,两者分开。
- **「PDF」「相册」**:没有对应的词。用 `Sesh`(文书)和 `Tut`(图像)代替。
- **「统计」**:用的是 `Hesb`(数)。

## 二、还没有 egy 文案的键(57 条，都是第五十四批「建殿 / 各殿概况 / 只读进入」与菜单)

| 键 | 中文 | English |
|---|---|---|
| `halls.create` | 新建殿 | New hall |
| `halls.create_title` | 新建殿 | New hall |
| `halls.code` | 代号 | Code |
| `halls.code_hint` | 大写字母开头，只用大写字母、数字和下划线，2–50 位。建好后不能改。 | Starts with a capital letter; capitals, digits and underscores only, 2–50 characters. It can't be changed later. |
| `halls.code_taken` | 这个代号已经有殿用了 | A hall already uses this code |
| `halls.code_invalid` | 代号格式不对 | That code isn't in the right form |
| `halls.civilization` | 文明 | Civilization |
| `halls.civilization_pick` | 选一个文明 | Choose a civilization |
| `halls.civ_mismatch` | {{code}} 是{{civ}}的殿 | {{code}} is a hall of {{civ}} |
| `halls.name` | 名称 | Name |
| `halls.hall_names` | 殿的叫法 | What the hall is called |
| `halls.hall_names_hint` | egy 留空时用默认叫法 | Leave egy empty to use the default |
| `halls.description_optional` | 说明 · 选填 | Description · optional |
| `halls.submit` | 新建 | Create |
| `halls.submitting` | 新建中… | Creating… |
| `halls.created_toast` | 已新建{{name}} | Created {{name}} |
| `halls.create_failed` | 没能新建，请重试 | Couldn't create it. Try again. |
| `halls.deactivate` | 停用 | Deactivate |
| `halls.activate` | 重新启用 | Reactivate |
| `halls.row_menu` | 更多操作 | More actions |
| `halls.deactivate_title` | 停用{{name}}？ | Deactivate {{name}}? |
| `halls.deactivate_body` | 数据全部保留，已有的灵魂和案件照常办理。停用后： | Everything is kept, and existing souls and cases carry on. Once it is deactivated: |
| `halls.deactivate_no_souls` | 不能再登记新灵魂； | no new souls can be registered; |
| `halls.deactivate_no_deaths` | 外部系统送来的死亡登记会被拒，重试也一样。 | death registrations sent by outside systems are refused, and retrying won't change that. |
| `halls.deactivate_reversible` | 随时可以重新启用。殿不能删除。 | You can reactivate it at any time. Halls can't be deleted. |
| `halls.deactivated_toast` | 已停用{{name}} | Deactivated {{name}} |
| `halls.activated_toast` | 已重新启用{{name}} | Reactivated {{name}} |
| `halls.action_failed` | 没能完成，请重试 | That didn't go through. Try again. |
| `halls.overview.title` | 各殿概况 | Halls at a glance |
| `halls.overview.subtitle` | 只有件数，不列灵魂名；停用的殿也在内。 | Counts only, no soul names. Deactivated halls are included. |
| `halls.overview.sort_label` | 排序 | Sort |
| `halls.overview.sort_code` | 按代号 | By code |
| `halls.overview.sort_todo` | 待办多的在前 | Most to-do first |
| `halls.overview.col_hall` | 殿 | Hall |
| `halls.overview.col_todo` | 殿内待办 | Hall to-do |
| `halls.overview.col_judgments` | 未结审判 · 城隍 · 枉死城 · 认领 · 无人 | Open judgments · City God · Wangsi City · Claimed · Unclaimed |
| `halls.overview.col_rebirth` | 本月转世 | Rebirths this month |
| `halls.overview.col_appeals` | 待复核申诉 | Appeals to review |
| `halls.overview.col_enter` | 进入 | Enter |
| `halls.overview.todo_approvals` | 审批 {{n}} | Approvals {{n}} |
| `halls.overview.todo_dispatch` | 调入 {{n}} | Transfers in {{n}} |
| `halls.overview.todo_cooldowns` | 冷却 {{n}} | Cool-downs {{n}} |
| `halls.overview.todo_letters` | 书信 {{n}} | Letters {{n}} |
| `halls.overview.judgments_label` | 未结审判：在城隍处 {{at_city_god}} · 在枉死城 {{held}} · 有人认领 {{claimed}} · 无人认领 {{unclaimed}} | Open judgments: at the City God {{at_city_god}} · in Wangsi City {{held}} · claimed {{claimed}} · unclaimed {{unclaimed}} |
| `halls.overview.note` | 殿内待办是殿的数，不是某位官员的「待我处理」。 | Hall to-do is the hall's count, not any one officer's "waiting on me". |
| `halls.overview.legend` | 分段条：浅 → 深 = 在城隍处 · 在枉死城 · 有人认领；最浅的空格 = 无人认领。 | Bar, light to dark: at the City God · in Wangsi City · claimed. The lightest gap is unclaimed. |
| `halls.overview.enter` | 进入 → | Enter → |
| `halls.overview.enter_label` | 进入{{name}}查看 | Enter {{name}} to view |
| `halls.overview.empty` | 还没有殿 | No halls yet |
| `halls.overview.load_failed` | 各殿概况没取到 | Couldn't load the halls |
| `halls.overview.enter_failed` | 没能进入这一殿，请重试 | Couldn't enter this hall. Try again. |
| `halls.viewing.banner` | 正在以全局管理员身份查看{{name}} | Viewing {{name}} as global admin |
| `halls.viewing.back` | 回到各殿概况 | Back to all halls |
| `halls.audit.view_start` | 以全局管理员身份查看 {{hall}} | Viewed {{hall}} as global admin |
| `halls.audit.view_end` | 以全局管理员身份查看 {{hall}} · {{minutes}} 分钟 · 看过 {{pages}} 个页面 | Viewed {{hall}} as global admin · {{minutes}} min · {{pages}} pages |
| `breadcrumb.menu.halls` | 各殿概况 | Halls at a glance |
| `breadcrumb.menu.group_global` | 全局 | Global |
