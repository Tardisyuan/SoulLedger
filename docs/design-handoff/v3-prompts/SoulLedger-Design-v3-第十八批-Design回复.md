# 第十八批 · Design 回复(2026-10-11)

稿：`SoulMfaBoard.dc.html`(19 屏)。单屏组件 `SoulMfaApp.dc.html` 有 `screen` / `state` / `civ` / `theme` 四个属性，你们可以对着切换。

## 一、5 个问题

1. **自愿**:同意。不加横幅，不催。设置里那一行写「○ 未开启」就够了。
2. **丢了手机、也没有恢复码：选 (a),只能找本殿官员。不做 (b)。**
   - 找回密码已经走联系邮箱。如果邮箱还能关闭两步验证，拿到邮箱的人就能同时绕过两道锁，两步验证等于没开。一家人共用一个邮箱时，这个风险更现实。
   - 官员台加一个动作，见第三节。
   - 转生：同意你们的理解。两步验证跟着「这一世的账号」走，新一世的账号默认未开启。上一世的密钥和恢复码在转生时一起作废。
3. **重置密码不关两步验证**:同意，和官员一样。
4. **流程：底层不变，向导从四步并成三步，第一步多写一些。**
   - **① 准备**:讲清楚验证器是什么(6 位数字、30 秒一换、只在你手机上)和为什么要开。不推荐具体的 App,只写「在应用商店搜索『验证器』或『Authenticator』,免费的任选一款」。点名某一款等于替它背书，而且各地区能装到的 App 不一样。
   - **② 添加 + 输码，放在同一屏**:灵魂要在两个 App 之间来回切。切回来时，输码框就在眼前，不用再翻一屏。密钥按每 4 位一组、每行 4 组排(和官员 App 一样),长按选中的是整串。
   - **③ 恢复码**:不能返回，必须勾选后才能完成，同官员。勾选的文字改成「**我已把恢复码存在这部手机以外的地方**」。灵魂最可能把恢复码截图存在同一部手机上，手机一丢，两样一起没了。按钮是「复制全部」和「存为文件」。
5. **登录第二步**:照官员 App,在同一屏换内容。

## 二、稿上的决定

- **设置页**分组排列:
  - 偏好：语言、通知;
  - 账号安全：修改密码、两步验证;
  - 关于;
  - 退出登录。
  两步验证放在修改密码下面，两者都是「怎么登进来」的事。页底保留灵魂编号。
- **用词**:灵魂端说「6 位数字」,不说「动态码」。「动态码」是给官员用的术语。
- **管理屏**:
  - 恢复码剩 2 个或更少时，出一条 warning 提示。
  - 关闭两步验证要输 6 位数字;手机不在身边时可以改用密码。
  - 重新生成恢复码不用输码，只要确认，因为生成后旧码立即作废，不会被人拿去用。
  - 最下面一行小字「换手机时：先在旧手机上关闭，再在新手机上重新开启」。灵魂最常遇到的情况就是换手机，提前告诉它。
- **登录状态**(C1–C5、D1):
  - **发请求中**:输入框变灰，按钮显示「验证中…」并且不可点。
  - **码不对**:写出还能试几次。
  - **超时**:按钮变成「重新输入密码」,并隐藏「这部手机 30 天内不再询问」和「手机和恢复码都没有了」这两项。
  - **锁定**:写出几点以后可以再试，按钮不可点。
  - **网络失败**:保留已经输入的数字，告诉灵魂数字还在。
- **丢失屏**(D3):
  - 告诉灵魂：去找本殿官员，报上灵魂编号。屏上直接显示殿名和灵魂编号，方便截图带去。
  - 明确写出「联系邮箱不能用来关闭两步验证」,免得灵魂去试。
  - 不放「写信」按钮，因为登不进来就写不了信。
- **四种文明的色彩**:不另做令牌。顶部 3px 封皮线、主按钮和底部弹层的上边线用 `--color-main`,随 `data-civ` 切换。状态色 danger / warning 四种文明通用。深色模式照 `.dark`。D4 是华夏 + 深色的例子。
- **版式**:方角、不用衬线、3px 封皮线，照卷宗版式。

## 三、官员台要加的一个动作

- **位置**:灵魂详情 →「账号」区，只在灵魂已开启两步验证时显示「关闭两步验证」。只有本殿官员能用，并且需要权限 `souls.mfa_reset`。
- **确认弹层**:理由必填，写进审计日志;确认按钮用 danger 样式。不能替灵魂开启两步验证。
- **通知灵魂**:关闭之后，灵魂下次登录时看到一条通知「本殿官员 {{name}} 已关闭你的两步验证」。如果不是本人去找的官员，灵魂能马上发现。

## 四、文案与 egy

能复用的，直接用官员 App 已有的 key(`officer_app.mfa.*`),下表注明「复用」;其余是新 key,放在 `soul_app.mfa.*` 下。

| key | 中文 | egy |
|---|---|---|
| settings.group_prefs | 偏好 | Smen |
| settings.group_security | 账号安全 | Senb Ren Aq |
| settings.mfa | 两步验证 | 复用 `mfa.title` Aq Sep Sen |
| settings.mfa_off | ○ 未开启 | ○ Nen Wen Djer |
| settings.mfa_on | ✓ 已开启 | ✓ Wen Seth |
| setup.title | 开启两步验证 | Wen Aq Sep Sen |
| intro.title | 先在手机上装一个验证器 | Redi Kat Medu Ahet Em Medjat-Ek |
| intro.body | 开启后，登录时除了密码，还要输入一个 6 位数字。这个数字由「验证器」App 生成，每 30 秒换一次，只在你的手机上。 | Wen Seth: Er Aq, Sesh Sekhem Hena Medu Ahet 6. Kat Medu Ahet Iri Medu Ahet Mawy; Wenen Em Medjat-Ek Wa. |
| intro.no_app_title | 还没有验证器？ | Nen Kat Medu Ahet Djer? |
| intro.no_app_body | 在手机的应用商店搜索「验证器」或「Authenticator」,免费的任选一款。已经装过的，直接下一步。 | Hehy «Authenticator» Em Medjat-Ek; Setep Wa. Wenen Seth: Nemet Ky. |
| intro.why | 开了以后，就算别人知道你的密码，没有你的手机也登不进来。 | Rekh Ky Sekhem-Ek: Nen Medjat-Ek, Nen Aq. |
| intro.next | 我已装好 · 下一步 | Wenen Seth · Nemet Ky |
| setup.exit_note | 中途退出不会开启 | Sehen: Nen Wen. |
| bind.title | 把灵魂簿添加到验证器 | 复用 `setup_key_title` Redi Er Kat Medu Ahet |
| bind.add | ① 添加 | ① Redi Hena |
| bind.open | 在验证器 App 中打开 ↗ | Wen Em Kat Medu Ahet ↗ |
| bind.manual | 打不开的话，复制下面的密钥，在验证器里选「手动输入」: | Nen Wen: Senn Medu Imen, Sesh Em Djeret. |
| bind.copy | 复制 | Senn |
| bind.select_hint | 长按选中的是整串。 | 复用 `select_hint` Djer Medu: Setep Hena Senn. |
| bind.code_label | ② 输入验证器上「{{app}}」那一项的 6 位数字 | ② Sesh Medu Ahet 6 Em {{app}} |
| bind.wrong | ! 数字不对。数字每 30 秒换一次，请输入现在显示的那个。 | ! Medu Ahet Nen Maat. Sesh Medu Ahet Tepy. |
| bind.next | 验证 · 下一步 | Maa · Nemet Ky |
| codes.title | 保存恢复码 | Smen Medu Ankh Wehem |
| codes.body | 手机丢了或换了，用恢复码登录。每个只能用一次，只显示这一次。 | Medjat Nen Gem, Mi Mawy: Aq Em Medu Ankh Wehem. Medu Wa: Sep Wa. Maa Sep Wa. |
| codes.copy_all | 复制全部 | Senn Neb |
| codes.save_file | 存为文件 | Smen Em Djama |
| codes.confirm | 我已把恢复码存在这部手机以外的地方 | Smen-I Medu Ankh Wehem, Nen Em Medjat Pen. |
| codes.done | 完成 | Khetem |
| codes.no_back | 这一步不能返回，勾选后才能完成 | Nen Er Hat. Setep: Khetem. |
| manage.body | 登录时要输入验证器上的 6 位数字。 | Er Aq: Sesh Medu Ahet 6. |
| manage.enabled_at | 开启于 | Wen Seth Em |
| manage.last_used | 最近一次使用 | Pehwy |
| manage.via_code | 6 位数字 | Medu Ahet 6 |
| manage.codes_left | 恢复码 · 剩 {{n}} / 10 | Medu Ankh Wehem · Khery {{n}} / 10 |
| manage.regen | 重新生成 | Wehem Iri |
| manage.low | 恢复码只剩 {{n}} 个。用完之前请重新生成。 | Medu Ankh Wehem Khery {{n}}: Wehem Iri. |
| manage.disable | 关闭两步验证 | Khetem Aq Sep Sen |
| manage.new_phone | 换手机时：先在旧手机上关闭，再在新手机上重新开启。 | Medjat Mawy: Khetem Em Medjat Tepy, Wen Em Medjat Mawy. |
| disable.title | 关闭两步验证？ | Khetem Aq Sep Sen? |
| disable.body | 关闭后，登录只要密码。剩下的恢复码一起作废。 | Khetem: Er Aq, Sekhem Wa. Medu Ankh Wehem Khery: Hedj. |
| disable.ok | 关闭 | Khetem |
| disable.use_password | 手机不在身边？改用密码 | Iri Em Sekhem |
| regen.title | 重新生成恢复码？ | Wehem Iri Medu Ankh Wehem? |
| regen.body | 旧的 {{n}} 个立即作废。新的 10 个只显示一次。 | Medu Tepy {{n}}: Hedj. Medu Mawy 10: Maa Sep Wa. |
| login.title | 两步验证 | 复用 `mfa.title` |
| login.code_label | 验证器上的 6 位数字 | 复用 `mfa.code_label` Medu Ahet |
| login.auto_submit | 输满 6 位自动提交。 | Medu 6: Hab Em Djes-Ef. |
| login.submit | 验证 | 复用 `mfa.submit` Maa |
| login.sending | 验证中… | Maa Djer… |
| login.wrong | ! 数字不对 | 复用 `reasons.wrong` |
| login.tries_left | 还可以再试 {{n}} 次。 | Wehem Iri: Sep {{n}}. |
| login.expired | ! 这一步超时了 / 请重新输入密码。 | 复用 `reasons.expired` |
| login.expired_button | 重新输入密码 | Wehem Sesh Sekhem |
| login.locked | ◐ 试错太多次，先暂停 | 复用 `reasons.locked` |
| login.locked_until | {{time}} 后可以再试。 | Wehem Iri Em {{time}}. |
| login.network | ! 没有连上 | 复用 `reasons.network` Nen Em Senb |
| login.network_body | 检查网络后再点「验证」。输入的数字还在。 | Medu-Ek Wenen Djer. Wehem Maa. |
| login.remember | 这部手机 30 天内不再询问 | 复用 `mfa.remember` |
| login.use_recovery | 手机不在身边？改用恢复码 | 复用 `use_recovery` |
| login.use_code | 改回 6 位数字 | 复用 `use_code` |
| login.recovery_title | 用恢复码登录 | Aq Em Medu Ankh Wehem |
| login.recovery_hint | 输入保存的 10 个恢复码之一，每个只能用一次。 | 复用 `recovery_body` |
| login.lost | 手机和恢复码都没有了 | Nen Medjat, Nen Medu Ankh Wehem |
| lost.title | 请本殿官员帮你关闭 | Sab Wesekhet: Khetem Aq Sep Sen |
| lost.body | 官员核对你的身份后，会替你关闭两步验证。关闭后用密码就能登录，你可以再重新开启。 | Sab Wesekhet Maa Ba-Ek, Khetem Aq Sep Sen. Er Khet: Aq Em Sekhem; Wen Mawy Er Khet. |
| lost.hall | 本殿 | Wesekhet |
| lost.bring | 报上 | Djed |
| lost.same_as_password | 和找回密码收不到验证码时一样，去找本殿官员就行。 | Mi Nen Rekh Sekhem: Sab Wesekhet. |
| lost.no_email | 联系邮箱不能用来关闭两步验证。 | Nen Khetem Aq Sep Sen Em ⟨邮箱⟩. |
| notice.reset_by_officer | 本殿官员 {{name}} 已关闭你的两步验证 | Sab {{name}}: Khetem Aq Sep Sen-Ek Seth. |
| (官员台) souls.mfa_reset | 关闭两步验证 | Khetem Aq Sep Sen |

- **⟨邮箱⟩**:用灵魂端找回密码那一屏已有的「联系邮箱」egy 词，我这里没有那张表。
- **新词根：没有。** 上表只用已登记的词，包括第十七批登记的 Mawy。
- **Medjat 在这里指「手机」**,同 `logout_title`。

## 五、3 件小事

**1. egy 2 条**
| key | egy |
|---|---|
| scheduler.jobs.chat_cleanup_unsent_images | **Fekh Tut Sesh Nen Hab** |
| permissions.config.errors.overwrite_disabled | **Hemsu Khetem Hedj Hena Ini: Setep Redi Hena.** |

- 第一条的句式同 `social_cleanup_orphan_post_media`,书信 = Sesh。
- 这也说明 Tut 已经登记(朋友圈在用),第十七批那个问题到此结束。

**2. 发图图标**:用和搜索图标一样的规格，20×20 画布、1.5 描边、`currentColor`、方角。

```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"><rect x="2.75" y="4.25" width="14.5" height="11.5"/><circle cx="7" cy="8.5" r="1.25"/><path d="M2.75 14l4.5-4 3 2.5 3-3 4 3.5"/></svg>
```

放在 44×44 的点按区里居中。读屏标签仍然用 `soul_app.chat.image.button`。

**3. 覆盖导入关闭**:知悉。
