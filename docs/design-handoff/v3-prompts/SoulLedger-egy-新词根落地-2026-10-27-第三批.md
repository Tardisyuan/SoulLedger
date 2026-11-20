# SoulLedger · egy 新词根落地(2026-10-27 第三批)

用户已决定采用你建议的全部新词根:Swri(饮)、Nis(召唤 / 邀请)、Wer(大)、Djehuty(托特)、Shewet(应用商店)、Browser(拉丁字母原样)。

已由 Claude Code 直接替换(按你给的对应，无需再改):孟婆汤四处 Shesep → Swri;称心三处 Sab Sesh → Djehuty;`soul_app.update_required.open_failed` 改为 `Nen Wen Shewet. Hehy Iri Mawy Em Shewet, Er Wen Menf Em Browser: {{url}}`;`officerInvite.action` / `title` = Nis Sab,`resend` = Wehem Nis,`pending_badge` = Nis Em Smen。请把这几个词根和改动同步进你的词表。

下面 12 条需要你按新词根重写整句(邀请类把暂代的 Menf / Hab Menf 换成 Nis;`halls.code_hint` 用 Wer 补上「大写字母开头」)。
注意:Wer 在第十二节废止名单里(第十七批曾因此换词)。用户这次明确采用，请从废止名单里拿出来并在回复里写明它现在的唯一义项(大写 / 大)。

回复格式同上次：在设计系统发布 `egy-fill-2026-10-27-3.json`(只有 `{"键": "egy 文本"}`),并把键加进词表。

| 键 | 中文 | 现在的 egy |
|---|---|---|
| `officerInvite.send` | 发送邀请 | Hab Menf |
| `officerInvite.sent_toast` | 邀请已发到 {{email}} | Menf Hab Seth Er {{email}} |
| `officerInvite.resent_toast` | {{email}} 已邀请过，这次是重发 | {{email}}: Menf Wehem Hab Seth |
| `acceptInvite.subtitle` | 你被邀请为官员。设好密码后，用用户名和这个密码登录。 | Sab Mawy: Sesh Sekhem, Er Khet Aq. |
| `acceptInvite.invalid_title` | 这个邀请链接用不了 | Menf Nen Wenen |
| `acceptInvite.invalid_body` | 请联系本殿管理员，重新给你发一次邀请。 | Dbh Sab Hery: Wehem Hab Menf. |
| `acceptInvite.link_note` | 邀请链接 7 天有效，只能用一次。 | Menf: Hru 7, Sep Wa. |
| `users.import.template_notes` | username 必填。写了 email、没写 password 的行发邀请信，本人 7 天内自设密码；写了 password 的行用它作初始密码，首次登录须改。两样都没写的行不导入。邀请信的行，role 不能是 ADMIN。 | Ren Em Tepy. Djeret, Nen Sekhem: Menf Hab, Sesh Sekhem Djes Em Hru 7. Sekhem: Sekhem Tepy, Khemen Em Aq Tepy. Nen Djeret, Nen Sekhem: Nen Ini. Menf: Nen Netjer Em Tepy. |
| `users.import.success` | 已导入 {{created}} 人：{{invited}} 人收到邀请信，{{password}} 人首次登录须改密码 | Ini Seth {{created}}: Menf {{invited}} · Khemen Em Aq Tepy {{password}} |
| `users.import.delivery.invite` | 邀请信 | Menf |
| `users.import.delivery_summary` | 邀请信 {{invite}} · 初始密码 {{password}} | Menf {{invite}} · Sekhem Tepy {{password}} |
| `halls.code_hint` | 大写字母开头，只用大写字母、数字和下划线，2–50 位。建好后不能改。 | Medu: Medu Hena Hesb Wa; 2 Er 50. Nen Khemen Er Khet. |
