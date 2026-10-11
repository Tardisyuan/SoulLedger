# 第十九批 · Design 回复(2026-10-11)

## 一、落地与稿的出入

1. **开启前输当前密码：同意，放在第 ① 步页底合适**，不单独排。
   - 顺序：说明 → 「还没有验证器？」→ 分隔线 → 提示句 `password_hint` → 「当前密码」输入框 → 主按钮。
   - 密码不对：框描边 danger,框下出 `wrong_password`,焦点回到框内，留在第 ① 步。
   - 锁定：框下出 `password_locked`,按钮不可点。
   - 官员台、官员 App 同样处理。
2. **存为文件：同意。** 文件名用 `soulledger-recovery-{灵魂编号}.txt`,不要本地化，各系统都能存。
3. **多一步「输入灵魂编号」:同意，不例外。** 输入框占位显示编号本身(mono),要求逐字一致，大小写不敏感。
4. **key 拆分：同意。**
5. **`Authenticator`:登记为允许的专名。** 它是去应用商店搜索的关键词，翻成 egy 就搜不到了。egy 仍用第十八批那一句，专名放在 «» 里。以后同类情况(要用户照抄去别处输入的词)都按这条处理。
6. **语言、通知：照落地，用页内控件，不改成子页。** 只有两个选项，点进子页再选是多一步。稿上这两行的 › 作废，其余照稿。
7. 知悉。
8. **重新生成恢复码：要输 6 位数字。** 第十八批我说「不用输码」,理由没站住：重新生成会让本人手里的码作废，危害和关闭两步验证一样。改为和「关闭」同一种底部弹层：6 位数字框 +「手机不在身边？改用密码」。复用 `disable` 那几条文案，不加新 key。

## 二、4 处

**A. 帖子编辑**
- **入口**:同意放在卡片头部，排在「删除」左边，两个都是文字按钮，muted,点按区 44,中间间距 16。只在自己的帖子上出现。
- **弹层**:同意。图片在正文框下面照原样显示缩略图，不带任何控件，下面一行 12 muted「图片不能修改」。这一句沿用你们已有的文案，如果没有就告诉我。
- **「已编辑」**:放在可见范围后面，用「 · 」隔开，字号和颜色同时间那一行。不加图标，不加颜色。
  - Web 悬停显示 `edited_at`。
  - 393 宽没有悬停，只显示「已编辑」。
  - 审核后台直接显示完整的 `edited_at`,不靠悬停，审核员要看得到时间。

**B. 取消移交**
- **次级按钮：同意。** 排在动作区最左边，和右边的主动作隔开(左右两端对齐),免得和「催办」之类的主动作挨着误点。
- **确认键不用红色，也不加「输入名称」。** 后果可以挽回：灵魂留在本殿，随时可以重新发起。用普通主按钮。

**C. 待办条第四格**
- **排法**:桌面四格等宽一行;393 宽排成 2×2,顺序从左到右、从上到下，第四格在右下。
- **标题**:中文改成「待重发的调拨」,和「已重发 N 次」对上。key 不变。
- **官员 App:不显示。** 官员 App 的待办只放在 App 里能办完的事，App 里没有重发调拨的动作。以后 App 加了这个动作，再加一组，排在「移交」后面，不并进「移交」组(对象是受刑计划，不是移交提案)。

**D. 发起方的移交通知**
- **要一个只读详情屏。** 版式沿用接收方的移交详情，去掉底部动作栏，换成一行状态:
  - ◐ 等对方批准
  - ✓ 对方已批准
  - ✕ 对方已驳回(下一行「理由：…」)
  - ○ 已取消(下一行「理由：…」)
- 状态和理由的文案沿用 Web 移交详情已有的 key。
- 「取消移交」先不进 App,只在 Web。
- 「收到移交提案」是发给接收方的，点了照现在进接收方详情。

## 三、egy 50 条

| key | egy |
|---|---|
| auth.reset_open_in_app | Wen Em Medjat Sab |
| social.post_updated | Smen Seth |
| social.post_update_error | Nen Smen |
| social.edit_title | Sesh Mawy |
| social.edit_discard_title | Hedj Sesh Mawy? |
| social.edit_discard_message | Sesh Mawy-Ek Nen Smen. |
| social.edit_discard_confirm | Hedj Sesh Mawy |
| social.edit_keep | Sesh Mawy Djer |
| social.edited | Sesh Mawy Seth |
| social.edited_at | Sesh Mawy Em {{time}} |
| dashboard.todo.resend_dispatch | Hab-Ba Er Wehem |
| dashboard.todo.go_resend | Iri → |
| sentence_plan.last_refusal_redispatched | Wehem Hab-Ba: Sep {{n}} |
| dispatch.cancel_dispatch | Sehen Hab-Ba |
| dispatch.cancel_title | Sehen Hab-Ba Pen? |
| dispatch.cancel_warning | Wesekhet Ky Nen Hesy Djer. Sehen: Hab-Ba Pen Hedj; Ba Wenen Em Wesekhet Pen; Sedjem Sab Er Wesekhet Ky. |
| dispatch.cancel_reason | Khet Sehen |
| dispatch.cancel_placeholder | Sesh Khet Sehen |
| dispatch.confirm_cancel | Sehen Hab-Ba |
| dispatch.cancel_success | Sehen Hab-Ba Seth |
| dispatch.cancel_error | Nen Sehen Hab-Ba |
| dispatch.cancel_not_cancellable | Wesekhet Ky Iri Seth: Nen Sehen Hab-Ba Pen. |
| breadcrumb.menu.recycle_bin | Per Khet Hedj |
| soul_app.mfa.copied | Senn Seth |
| soul_app.mfa.wrong_password | ! Sekhem Nen Maat |
| soul_app.mfa.intro.no_app_body | Hehy «Authenticator» Em Medjat-Ek; Setep Wa. Wenen Seth: Nemet Ky. |
| soul_app.mfa.intro.password_hint | Sesh Sekhem-Ek Tepy: Maa Ba-Ek. |
| soul_app.mfa.codes.file_header | Medu Ankh Wehem Medjat Ba: Medjat Nen Gem, Mi Mawy — Aq Em Medu Ankh Wehem. Medu Wa: Sep Wa. Smen Nen Em Medjat Pen. |
| soul_app.mfa.codes.save_failed | Nen Smen Em Djama |
| soul_accounts.account.mfa_reset.title | Khetem Aq Sep Sen {{name}}? |
| soul_accounts.account.mfa_reset.consequence_1 | Medu Imen, Medu Ankh Wehem, «Medjat Pen: Nen Hehy Djer» Neb: Hedj. Medjat Aq Seth: Wehem Er Aq. |
| soul_accounts.account.mfa_reset.consequence_2 | Er Khet: Ba Aq Em Sekhem Wa; Ba Maa Ren Sab Em Sedjem Sab. |
| soul_accounts.account.mfa_reset.consequence_3 | Khetem Wa, Nen Wen Er Ba. Ba Djes-Ef Wen Mawy. |
| soul_accounts.account.mfa_reset.done | Khetem Aq Sep Sen Seth |
| soul_accounts.account.mfa_reset.not_enabled | Ba Pen Nen Wen Aq Sep Sen |
| soul_accounts.account.mfa_reset.not_home_hall | Sab Wesekhet Ba Wa: Khetem Aq Sep Sen-Ef. |
| official_notify.dispatch_proposed.title | Dbh Hab-Ba Iyi |
| official_notify.dispatch_proposed.body | {{source}}: Dbh Hab-Ba Ba «{{soul}}» Er Wesekhet-Ek. Er Hesy-Ek. |
| official_notify.dispatch_approved.title | Dbh Hab-Ba Hesy Seth |
| official_notify.dispatch_approved.body | {{target}}: Hesy Dbh Hab-Ba Ba «{{soul}}» Em Wesekhet-Ek. |
| official_notify.dispatch_rejected.title | Dbh Hab-Ba Khesef Seth |
| official_notify.dispatch_rejected.body | {{target}}: Khesef Dbh Hab-Ba Ba «{{soul}}» Em Wesekhet-Ek. Khet Khesef: {{reason}} |
| official_notify.dispatch_rejected_bare.title | Dbh Hab-Ba Khesef Seth |
| official_notify.dispatch_rejected_bare.body | {{target}}: Khesef Dbh Hab-Ba Ba «{{soul}}» Em Wesekhet-Ek. |
| official_notify.dispatch_cancelled.title | Dbh Hab-Ba Sehen Seth Em Tepy Iri |
| official_notify.dispatch_cancelled.body | {{source}}: Sehen Dbh Hab-Ba Ba «{{soul}}». Khet Sehen: {{reason}} |
| notifications.open_dispatch | Wen Hab-Ba |
| mfa.setup.password_hint | Sesh Sekhem-Ek Tepy: Maa Ba-Ek. |
| mfa.setup.password_wrong | Sekhem Nen Maat |
| mfa.setup.password_locked | Sep Menmen. Wehem Iri Er Khet. |

**用词说明**
- **编辑 = Sesh Mawy**(重新写)。由已登记的 Sesh + Mawy 拼成，不开新词根。没有改「东西」,所以不用 Iri Mawy(那是「更新」)。
- **取消 = Sehen**,同 `last_refusal_cancelled`、`batch_clear`;**理由 = Khet + 动词**,同 `Khet Khesef`。
- **移交提案 = Dbh Hab-Ba**:Dbh = 请求，同 `Dbh Wehem Mesut`;Hab-Ba 照第十七批。
- **回收站 = Per Khet Hedj**(放删掉的东西的屋子)。不写 Per Hedj:Per 在 `Per Aq` 里是动词「出去」,两个词时容易读成「删掉的出去」。
- **官员 App = Medjat Sab**,同 `read_only`;**灵魂簿 = Medjat Ba**,同 `about`。
- `password_locked` 直接用 `login.reasons.locked` 那一句。
- **引号**:egy 里中文「」一律写成 «»,同第十七批 `confirm_hint`。
- **新词根：没有。** 登记的只有专名 `Authenticator`。

## 四、仍欠的一条

第十八批 `lost.no_email` 里的 ⟨邮箱⟩:还要灵魂端找回密码页上「联系邮箱」那个 egy 词。请贴过来，或把那张表给我。
