# 第二十二批 · 上模拟器后看到的三处文案(2026-10-11)

第二十批(登录免手输)已经做完并上了 iPhone 17 模拟器。界面照稿,功能都通;下面三处是用的时候读着不对的文字,请给新词。都不需要画稿。

---

## 一、设置里的「修改密码」页,把「初始密码」写在了已经改过密码的人面前

这一页有两种人会看到,现在共用一套文字:

| 谁 | 什么时候 | 现在的标题 | 现在第一个框的标签 |
|---|---|---|---|
| 刚拿到初始密码的灵魂 | 首次登录,必须改密码 | 修改初始密码 | 初始密码 |
| 早就改过密码的灵魂 | 设置 › 账号安全 › 修改密码 | 修改密码 | **初始密码** ← 不对 |

第二种人输的是自己现在的密码,不是初始密码。请给第二种情况的标签(我们的想法是「当前密码」),zh / en / egy。

现有词条(第一种情况继续用,不改):

| key | 中文 | English | egy |
|---|---|---|---|
| soul_app.change_password.title | 修改初始密码 | Change your initial password | Khemen Sekhem Tepy |
| soul_app.change_password.old_password | 初始密码 | Initial password | Sekhem Tepy |

你在第二十批定过「当前密码」写 Sekhem-Ek;这里是不是直接用它,请确认。

---

## 二、退出登录的确认文字,和「记住编号」对不上了

灵魂 App 点「退出登录」时的确认弹层:

| key | 中文 | English | egy |
|---|---|---|---|
| soul_app.logout.title | 退出登录？ | Sign out? | Per Aq? |
| soul_app.logout.body | 再次登录需要你的灵魂编号与新设的密码。初始密码已失效。 | Signing in again takes your soul code and the password you set. The initial password no longer works. | Wehem Aq: Ren Hesb Ba-Ek Hena Sekhem Mawy-Ek. Sekhem Tepy Wenen Khetem Seth. |

第二十批之后,这部手机会记住编号,退出后再登录**只要密码**(开了面容登录的,连密码也不用)。所以「需要你的灵魂编号」这句现在是错的。

请重写 `soul_app.logout.body`。需要几种写法由你定,我们能区分这三种情况:
- (a) 没开面容登录:再次登录只输密码;
- (b) 开了面容 / 指纹登录:再次登录用面容(`{{bio}}` 可用),也可以输密码;
- 「初始密码已失效」那半句要不要留(它对早就改过密码的人没有信息量)。

---

## 三、知悉即可:几个间距取了相邻的刻度

`SoulLoginApp` 稿上有 10 / 14 / 6 这几个间距,不在 App 现有的间距刻度上(4 / 8 / 12 / 16 / 20 / 24…),实现时取了 8 和 16。上机看分组编号、登录卡片、失效提示条都正常。你如果要求严格照稿,请说明是哪几处,我们给刻度加值。

---

## Design 回复

(待填)
