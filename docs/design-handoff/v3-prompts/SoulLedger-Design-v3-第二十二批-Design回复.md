# 第二十二批 · Design 回复(2026-10-11)

## 一、修改密码页 · 已改过密码的人

**确认用 Sekhem-Ek。** 第二十批说过,Sekhem Tepy 只留给「初始密码」。

| key | 中文 | English | egy |
|---|---|---|---|
| soul_app.change_password.current_password(新) | 当前密码 | Current password | Sekhem-Ek |

- 首次登录那种情况,继续用 `title` 和 `old_password`,不改。
- 同一页上如果还有提到「初始密码」的报错(比如「初始密码不正确」),请用同样的办法分开:第二种情况复用 `profile.password_old_wrong`(第二十批已改为 Sekhem-Ek Nen Maat),中文写「当前密码不正确」。

## 二、退出登录的确认

**写两种,并去掉「初始密码已失效」。** 能点「退出登录」的人都已经改过密码了,这半句对谁都没有信息量。

| key | 用在 | 中文 | English | egy |
|---|---|---|---|---|
| soul_app.logout.body(改) | (a) 没开面容登录 | 这部手机会记住你的编号,下次只要输入密码。 | This phone remembers your soul number. Next time, just enter your password. | Medjat Pen Rekh Ren Hesb Ba-Ek. Wehem Aq: Sesh Sekhem-Ek Wa. |
| soul_app.logout.body_bio(新) | (b) 开了面容 / 指纹登录 | 这部手机会记住你的编号,下次用{{bio}}就能登录,也可以输入密码。 | This phone remembers your soul number. Next time, sign in with {{bio}} or your password. | Medjat Pen Rekh Ren Hesb Ba-Ek. Wehem Aq Em {{bio}}, Mi Sesh Sekhem-Ek. |
| soul_app.logout.forget_hint(新) | (a)(b) 都放,排在正文下面一行,13 muted | 要让这部手机忘掉编号,在登录页点「换一个账号」。 | To make this phone forget your number, tap Use another account on the sign-in page. | Medjat Pen Nen Rekh Djer: «Aq Em Ba Ky» Em Aq. |

- 加 `forget_hint` 的原因:灵魂多半以为「退出」就是不留痕迹。共用手机的人要知道,真正让手机忘掉编号的是哪个按钮。
- `{{bio}}` 在 egy 里渲染成 Djes-Ek,读作「用你自己登录」,和 `bio.button` 一致。
- `title`、确认按钮不改。

## 三、间距

**同意取 8 和 16,不加刻度。** 稿已经改成刻度上的值:

| 稿上 | 改为 |
|---|---|
| 14 | 16 |
| 10 | 8 |
| 6 | 8 |

- 唯一要守住的一处:分组编号组与组之间的间距(现在是 16)必须明显大于字距。上机看是对的,不用动。
