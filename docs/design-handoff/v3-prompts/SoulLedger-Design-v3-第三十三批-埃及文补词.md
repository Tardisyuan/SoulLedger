# 第三十三批 · 埃及文补词(2026-10-16)

这一轮做了：案卷附件与图片上传支持 HEIC、四张列表的列菜单、无障碍修补、审计详情页、CSV 导入提示、初始密码窗口关闭前确认、交付单补印、单字母快捷键开关、审批「已超时」筛选、审判「即将标记为滞留」提示、官员密码策略(首登改密、不得重复使用、管理员至少 12 位)、官员 App 列表「加载更多」等。

下面 **41 条**界面上还没有埃及文(埃及文界面下显示中文)。请给每条的最终 egy 写法;用到新词根请注明义项。`{{…}}` 占位符原样保留，`PDF`、`CSV`、`HEIC`、`JPEG`、`PNG`、`WebP`、`MB` 照原样大写。

## 一、两条要**更新**的(已有 egy,但中文 / 英文加了 HEIC)

| key | 中文(新) | English(新) | 现在的 egy |
|---|---|---|---|
| social.avatar_upload_hint | PNG、JPEG、WebP 或 HEIC,不超过 5 MB | PNG, JPEG, WebP or HEIC, up to 5 MB | PNG, JPEG, WebP — 5 MB |
| soul_app.circle.media.errors.not_an_image | 只能上传 PNG、JPEG、WebP 或 HEIC 图片 | Only PNG, JPEG, WebP or HEIC images | PNG, JPEG Er WebP Wa |

## 二、还没有 egy 的

### 灵魂 App

| key | 中文 | English |
|---|---|---|
| soul_app.circle.search.more | 显示更多结果 | Show more results |
| soul_app.mfa.manage.codes_lost | 两步验证已经开启，但这次没能显示恢复码。请点下面的「重新生成」拿一组新的，并妥善保存。 | Two-step verification is on, but the recovery codes were not shown this time. Tap Regenerate below to get a new set, and keep it safe. |

### 官员 App

| key | 中文 | English |
|---|---|---|
| officer_app.list.more | 加载更多 | Load more |
| officer_app.state.refresh_failed | 没能刷新，下面显示的可能不是最新的。 | Couldn't refresh. What's shown may be out of date. |
| officer_app.mfa.setup.abandon | 放弃设置并退出 | Give up setup and leave |

### 审计日志与详情页

| key | 中文 | English |
|---|---|---|
| audit.detail.open | 详情 | Details |
| audit.detail.not_found | 找不到这条记录 | Record not found |
| audit.detail.resource | 对象 | Resource |
| audit.detail.user_agent | 客户端 | Client |
| audit.detail.trace_id | 请求编号 | Request ID |
| audit.detail.trace_filter | 看本次请求的全部记录 | Show all records of this request |
| audit.detail.changes | 变更 | Changes |
| audit.detail.no_changes | 这条记录没有变更内容 | This record has no changes |
| audit.detail.field | 字段 | Field |
| audit.detail.before | 原值 | Before |
| audit.detail.after | 新值 | After |

### CSV 导入

| key | 中文 | English |
|---|---|---|
| souls.import.row_codes.invalid_characters | 含有无法保存的字符 | Contains characters that cannot be saved |
| souls.import.file_codes.bad_encoding_gbk | 文件不是 UTF-8 编码(像是 GBK):请在 Excel 里另存为「CSV UTF-8」 | File is not UTF-8 (looks like GBK): in Excel, save as "CSV UTF-8" |

### 初始密码与交付单

| key | 中文 | English |
|---|---|---|
| soul_accounts.reveal.close_confirm_title | 密码只显示这一次 | The password is shown only once |
| soul_accounts.reveal.close_confirm_body | 密码只显示这一次，确定关闭？关闭后无法再次查看，需要重置才能拿到新的初始密码。 | The password is shown only once. Close anyway? It cannot be viewed again; you would have to reset it to get a new initial password. |
| soul_accounts.reveal.close_confirm | 确定关闭 | Close anyway |
| soul_accounts.reveal.close_back | 返回 | Go back |
| soul_accounts.credentials.slip.reprint | 补印 | Reprint |

### 密码规则与个人资料

| key | 中文 | English |
|---|---|---|
| password_rules.min_length_admin | 至少 12 位（管理员） | At least 12 characters (administrators) |
| profile.password_reason_reused | 这个密码最近用过，请换一个新的 | That password was used recently. Choose a new one. |
| profile.password_locked | 密码尝试过于频繁，请稍后再试 | Too many password tries. Try again later. |
| profile.password_must_change | 请先修改密码，改好后才能继续使用。 | Change your password first. You can carry on once it is changed. |

### 键盘快捷键

| key | 中文 | English |
|---|---|---|
| shortcuts.title | 键盘快捷键 | Keyboard shortcuts |
| shortcuts.single_keys | 启用单字母快捷键 | Single-key shortcuts |
| shortcuts.single_keys_hint | 关闭后，J、K、1–4 这类单个字母或数字键不再触发；Esc、方向键和 ⌘/Ctrl 组合键不受影响。 | When off, single letter or digit keys such as J, K and 1-4 do nothing; Esc, arrow keys and ⌘/Ctrl combinations still work. |
| shortcuts.move_rows | 下移 / 上移一行 | Move down / up one row |
| shortcuts.select_row | 选中 / 取消选中当前行 | Select / unselect the current row |
| shortcuts.pick_verdict | 选择裁决 | Choose a verdict |
| shortcuts.conclude | 落判（第一下确认，第二下提交） | Conclude (first press confirms, second submits) |
| shortcuts.toggle_case | 展开 / 收起全案 | Expand / collapse the whole case |
| shortcuts.next_prev_case | 下一件 / 上一件 | Next / previous case |

### 审批流

| key | 中文 | English |
|---|---|---|
| workflow.filter_overdue | 只看已超时 | Overdue only |
| workflow.overdue_badge | 已超时 | Overdue |

### 审判队列

| key | 中文 | English |
|---|---|---|
| judgment.claim.stale_soon | 即将标记为滞留 | Will be flagged as stale soon |

### 定时任务

| key | 中文 | English |
|---|---|---|
| scheduler.jobs.authentication_prune_expired_push_registrations | 停用登录已到期的手机推送登记 | Deactivate push registrations whose sign-in has expired |
| scheduler.jobs.audit_prune_retained_data | 清理过期的运行数据(投递记录、已读通知、停用设备等) | Prune expired operational data (delivery logs, read notices, inactive devices) |

---

## Design 回复(2026-10-16,`templates/soulledger-v3-pages/v3-batch33-reply.md`)

41 条新增 + 2 条更新，没有新词根，已全部写入 `egy.json`。

- `judgment.claim.stale_soon`:Design 不确定「滞留」的写法，建议若词表已有就换。词表里没有现成的「滞留」词，照 Design 给的 `Er Khet: Shesep Tepy`。
- 技术词登记进词表守卫:HEIC、GBK、UTF、Excel(菜单名「CSV UTF-8」要用户照抄)、Ctrl;`shortcuts.single_keys_hint` 的 J / K 按键名豁免。

| key | egy |
|---|---|
| social.avatar_upload_hint | PNG, JPEG, WebP, HEIC — 5 MB |
| soul_app.circle.media.errors.not_an_image | PNG, JPEG, WebP Er HEIC Wa |
| soul_app.circle.search.more | Maa Gem Ky |
| soul_app.mfa.manage.codes_lost | Aq Sep Sen Wen Seth; Medu Ankh Wehem Nen Maa Em Sep Pen. Setep «Iri Wehem» Em Khery: Medu Wehem Mesut. Sau Seth. |
| officer_app.list.more | Ini Ky |
| officer_app.state.refresh_failed | Nen Wehem Maa — Medu Em Khery Nen Mawy |
| officer_app.mfa.setup.abandon | Sehen, Per |
| audit.detail.open | Maa |
| audit.detail.not_found | Nen Gem Medew Pen |
| audit.detail.resource | Khet |
| audit.detail.user_agent | Kat Wen Aq |
| audit.detail.trace_id | Hesb Dbh |
| audit.detail.trace_filter | Medew Neb En Dbh Pen |
| audit.detail.changes | Khemen |
| audit.detail.no_changes | Nen Khemen Em Medew Pen |
| audit.detail.field | Medu |
| audit.detail.before | Tepy |
| audit.detail.after | Mawy |
| souls.import.row_codes.invalid_characters | Nen Menkh · Sesh Nen Smen |
| souls.import.file_codes.bad_encoding_gbk | Nen Menkh · Nen UTF-8 (Mi GBK): Em Excel, Sau Mi «CSV UTF-8» |
| soul_accounts.reveal.close_confirm_title | Maa Sekhem Sep Wa |
| soul_accounts.reveal.close_confirm_body | Maa Sekhem Sep Wa. Khetem? Er Khet Khetem: Nen Maa Djer; Wehem Sekhem Er Sekhem Tepy Mawy. |
| soul_accounts.reveal.close_confirm | Khetem |
| soul_accounts.reveal.close_back | Er Hat |
| soul_accounts.credentials.slip.reprint | Wehem Sesh |
| password_rules.min_length_admin | Sesh 12 Er Hry (Sab Hery) |
| profile.password_reason_reused | Sekhem Pen Iri Seth Tepy. Setep Mawy. |
| profile.password_locked | Sep Menmen. Wehem Iri Er Khet. |
| profile.password_must_change | Er Tepy: Khemen Sekhem-Ek. Er Khet Khemen: Iri Djer. |
| shortcuts.title | Wat-Ha |
| shortcuts.single_keys | Wat-Ha Sesh Wa |
| shortcuts.single_keys_hint | Khetem: J, K, 1–4 (Sesh Wa Er Hesb Wa) Nen Iri. Esc, ↑ ↓ ← →, ⌘/Ctrl: Iri Djer. |
| shortcuts.move_rows | Nehem Er Khet / Er Tepy |
| shortcuts.select_row | Setep / Sehen Setep |
| shortcuts.pick_verdict | Setep Wedja |
| shortcuts.conclude | Khetem (Sep Tepy: Maa; Sep Sen: Hab) |
| shortcuts.toggle_case | Wen / Khetem Sesh En Sep |
| shortcuts.next_prev_case | Sep Em Khet / Sep Tepy |
| workflow.filter_overdue | Unut Khetem Wa |
| workflow.overdue_badge | Unut Khetem |
| judgment.claim.stale_soon | Er Khet: Shesep Tepy |
| scheduler.jobs.authentication_prune_expired_push_registrations | Khetem Sesh Sedjem Em Aq Mut |
| scheduler.jobs.audit_prune_retained_data | Khetem Sesh Mut (Sesh Hab, Sedjem Maa Seth, Ikhet Khetem…) |
