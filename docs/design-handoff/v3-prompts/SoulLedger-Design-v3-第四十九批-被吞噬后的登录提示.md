# 第四十九批 · 被阿米特吞噬后的登录提示(2026-10-20)

第四十八批的文案已上线(导入那条行错误用了你推荐的带占位符写法)。

## 背景

用户定了：埃及审判里被阿米特吞噬(处置去处 `EG_ANNIHILATION`,第二次死亡)的灵魂，处置执行时这一世的灵魂 App 账号**永久注销**,和转世完成时同一套做法：不能再登录，推送、面容 / 指纹登录一起失效。数据都保留(书信、朋友圈、审判记录不删)。

灵魂 App 登录页已有一组「登录凭据失效」的提示(用面容 / 指纹登录时，服务端说这部手机的凭据被吊销了，登录页按原因显示一条标题 + 一句说明)。现有四种：密码在别处改了、官员重置了密码、已转生、生物特征变了。转生那条是：

| 键 | zh-Hans | en | egy |
|---|---|---|---|
| `soul_app.login.lapsed.reborn` | 你已转生，这是新一世的账号 | You have been reborn — this is a new life's account | Ba-Ek Ankh Mawy: Aq Mawy |
| `soul_app.login.lapsed.reborn_body` | 编号不变。请用这一世的初始密码登录。 | Your number stays the same. Sign in with this life's initial password. | Ren Hesb Ba Wenen. Aq Em Sekhem Tepy Ankh Pen. |

要新增第五种：被吞噬。和转生不同，**没有下一世、没有新账号可登录**,也不能申诉。

## 要的

| 键 | 用途 |
|---|---|
| `soul_app.login.lapsed.devoured` | 标题 |
| `soul_app.login.lapsed.devoured_body` | 一句说明 |

请给 zh-Hans / en / egy。语气请你定：这是一个灵魂得知自己已不存在的时刻，既要说清「这个账号不能再用了」,又不宜写得像系统报错。如果你认为这里不该出现在登录页、或应当换一种呈现(比如不给「重新登录」类按钮),请一并说明。egy 只用词表里已有的词。
