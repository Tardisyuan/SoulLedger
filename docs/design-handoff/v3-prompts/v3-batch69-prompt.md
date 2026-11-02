# SoulLedger · Design v3 · 第六十九批 · egy 十条:作品演示版(2026-11-02)

Web 多了一个只给作品展示用的演示版:没有后端,登录页换成三个「以 X 身份进入」,每页顶部一条细横幅。这些词只在演示构建里出现。不用画新东西。

闭合词表;需要新词根请先列出来。回 `egy-fill-2026-11-02-69.json`(键 → egy),回复写在 `v3-batch69-reply.md`(没有问题就只写「已填」),都发布到这个目录。占位符三种语言必须一致。

| 键 | 中文 | English |
|---|---|---|
| `demo.banner` | 演示环境 · 数据只在你的浏览器里,重新登录即恢复 | Demo · your data stays in this browser; sign in again to reset it |
| `demo.enter_as` | 以{{role}}身份进入 | Enter as {{role}} |
| `demo.login_desc` | 这是作品演示,没有后端,不用密码。你做的任何改动只留在这个标签页里,登出或重新登录后恢复原样。 | This is a portfolio demo: no backend, no password. Whatever you change stays in this tab and resets when you sign out or back in. |
| `demo.login_title` | 选一个身份进入 | Choose who to enter as |
| `demo.role_admin` | 管理员 | Administrator |
| `demo.role_admin_desc` | 四个文明都看得到:用户、角色权限、系统配置、审计。 | Sees all four civilizations: users, roles and permissions, configuration, audit. |
| `demo.role_judge` | 判官 | Judge |
| `demo.role_judge_desc` | 官员日常:认领案件、结案、出处置、审批。 | An officer's day: claim cases, conclude them, issue dispositions, approve. |
| `demo.role_moderator` | 版主 | Moderator |
| `demo.role_moderator_desc` | 朋友圈审核:举报、禁言、敏感词。 | Soul circle review: reports, mutes, sensitive words. |
