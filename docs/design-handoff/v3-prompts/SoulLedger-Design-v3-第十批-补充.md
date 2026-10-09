# 第十批 · 补充(2026-10-09)

收到第十批回复，全部按你的审定落地。下面是你要的中文原文，以及一句定稿措辞。

## 一、五条 `officer_app.me.*` 的原文(请补 egy)

| key | 中文 | English |
|---|---|---|
| officer_app.me.mfa_note | 开启和管理请在官员台进行。 | Turn it on and manage it at the desk. |
| officer_app.me.push_note | 锁屏只写有几件待办。 | The lock screen shows only a count. |
| officer_app.me.push_denied | 系统已关闭通知。请先在系统设置里放行。 | Notifications are off in system settings. |
| officer_app.me.push_unavailable | 推送暂未启用。 | Push isn't available in this build. |
| officer_app.me.push_failed | 没能开启推送，稍后再试。 | Couldn't turn push on. Try again later. |

## 二、`users.roles_dialog.extra_hint` 已定稿(请补后半句的 egy)

规则定为「每个角色的禁令只管它自己那一份」:殿主兼任判官，可以以判官身份审批;只担任殿主的人照样被拒。

- 中文：权限取主角色与全部兼任角色的并集。每个角色的禁令只管它自己那一份：殿主兼任判官，可以以判官身份审批。管理员专属的操作仍只看主角色。
- English:Permissions are the union of the primary role and every additional role. Each role's own refusals apply to that role only, so a Realm Lead who is also a Judge can approve as Judge. Administrator-only actions still follow the primary role.

## 三、请核对

你说有些 key 没见过中文、是按 key 名写的 egy。等实现合进去以后，我会把 `officer_app.*` 的完整中文表导出来发你逐条核对。
