# SoulLedger · Design v3 · 第六十八批 · egy 十三条与一条词义(2026-11-02)

这批都是缺陷修复带出来的小文案。不用画新东西。闭合词表；需要新词根请先列出来。回 `egy-fill-2026-11-02-68.json`(键 → egy),回复写在 `v3-batch68-reply.md`(没有问题就只写「已填」),都发布到这个目录。占位符三种语言必须一致。

## 一、补词(13 条)

用在哪:
- `soul_inbox.assign.*`、`soul_inbox.errors.assigned_to_other`、`officer_app.outbox.assigned`:信已由别的官员经办时,官员要先「转给我」才能回(用户 11-02 定,三端一致)。
- `soul_app.chat.receipt.*`:发不出去的信可以删掉;删除时没有输入框可放回,文字复制到剪贴板。
- `officer_app.me.logout_pending_unsent / _drafts`:退出前只说有的那一样,不再写「0 封」。
- `official_notify.sentence_node_not_dispatched.*`:受刑计划这一站没能发起调拨(不是被拒)。
- `scheduler.jobs.chat_sync_all_rooms`:定时任务页的任务名。

| 键 | 中文 | English |
|---|---|---|
| `scheduler.jobs.chat_sync_all_rooms` | 校对书信房间的发言权 | Reconcile who may speak in letter rooms |
| `soul_app.chat.receipt.copied` | 已复制这封信 | Letter copied |
| `soul_app.chat.receipt.delete` | 删除 | Delete |
| `official_notify.sentence_node_not_dispatched.body` | 灵魂「{{soul}}」受刑计划第 {{order}} 站（{{tenant}}）没能发起调拨，该节点仍待执行，请处理后重新发起。 | The transfer for stop {{order}} ({{tenant}}) of the sentence plan of soul {{soul}} could not be started. The stop is still pending; sort out the cause and start it again. |
| `official_notify.sentence_node_not_dispatched.title` | 受刑节点未能发起调拨 | Sentence stop not dispatched |
| `mfa.manage.regenerate_failed` | 没能重新生成，请检查动态码 | Could not regenerate — check the code |
| `officer_app.me.logout_pending_unsent` | 还有 {{unsent}} 封回信没发出。退出后会从这台设备上清除。 | Unsent replies on this device: {{unsent}}. Signing out removes them. |
| `officer_app.me.logout_pending_drafts` | 还有 {{drafts}} 份回信草稿。退出后会从这台设备上清除。 | Reply drafts on this device: {{drafts}}. Signing out removes them. |
| `sentence_plan.inbox_show_all` | 查看全部受刑请求 | All sentence requests |
| `soul_inbox.errors.assigned_to_other` | 这封信已由别的官员经办，先转给自己才能回。你写的内容还留着。 | Another officer is handling this letter. Take it over before replying. What you wrote is kept. |
| `soul_inbox.assign.handled_by` | 由 {{name}} 经办 | Handled by {{name}} |
| `soul_inbox.assign.take_over` | 转给我 | Take it over |
| `officer_app.outbox.assigned` | 这封信已由别的官员经办，没有发出。你写的内容还留着。 | Another officer is handling this letter, so it did not go out. What you wrote is kept. |

## 二、词义变了(1 条)

| 键 | 原中文 | 新中文 | English | 现 egy |
|---|---|---|---|---|
| `souls.events.SENTENCE_NODE_REFUSED` | 受刑节点调拨被拒 | 受刑节点调拨未成 | Sentence stage transfer did not go through | Hab-Ba Sekhet Wetep Khesef |

这个事件既记「被拒」也记「没能发起」,所以不能再说被拒。现在的 egy 用 `Khesef`(驳回),请给一个两种情况都成立的写法,写进同一个 JSON。

另有两条只是统一动词,意思没变,egy 不用改:`soul_app.forgot_password.sent_neutral`、`soul_app.circle.comment.send`。
