# SoulLedger · 规范 v3 · 给 Design 的 egy 待审词(2026-10-08)

这一轮新增了几个页面：外部接入密钥、登录日志、殿设置。其中有 egy 文案在词表里找不到贴切的词，我们先用了词表里的近似词顶上，以免门禁报红。请逐条给出正式写法。

规则照旧：
- 只用已审定词表里的词;要新增词根，请一并给出。
- 每个词首字母大写，不用撇号，不用全大写。

## 一、语言名(殿设置对话框)

| key | 中文 | English | 现用 egy(近似) | 问题 |
|---|---|---|---|---|
| tenants.settings.hall_name_en | 殿司展示名(English) | Hall name (English) | Ren Wesekhet · Europa | 「English」这门语言没有词，借用了文明名 Europa |
| tenants.settings.hall_name_egy | 殿司展示名(egy) | Hall name (egy) | Ren Wesekhet · Kemet | 「egy / Kemet 语」这门语言没有词，借用了文明名 Kemet |

请定下「英语」和「埃及语(egy)」作为**语言名**的写法。以后语言切换处也会用到。

## 二、外部系统类型(Death-Sync · API 密钥)

| key | 中文 | English | 现用 egy |
|---|---|---|---|
| death_sync.api_keys.system_type.GOVERNMENT | 政府户籍 | Civil registry | Per Hery |
| death_sync.api_keys.system_type.HOSPITAL | 医院死亡证明 | Hospital death certificates | Per Senb |
| death_sync.api_keys.system_type.POLICE | 公安户籍 | Police household registration | Per Sau |
| death_sync.api_keys.system_type.MESSAGE_BUS | 消息总线 | Message bus | Wat Medu |
| death_sync.api_keys.system_type.CUSTOM | 自定义 | Custom | Djes |

注意两处重复：
- 「Wat Medu」已经用作「导航菜单」和「联系手机号」;
- 「Djes」已经用作「个人中心」。

请给出不撞车的写法。

## 三、其他

| key | 中文 | English | 现用 egy | 问题 |
|---|---|---|---|---|
| death_sync.api_keys.can_manage_webhooks | 管理 Webhook | Manage webhooks | Hab Medu Ky | Webhook 没有词;「Hab Medu Ky」意为「送往别处的话」,是否可以 |
| audit.login_log.user_agent | 客户端 | Client | Wat Aq | 「Wat Aq」意为「进入之路」,是否可以表示「客户端」 |

请在回复里给出每条的最终 egy 和理由。如果需要新增词根，请注明它进词表的哪一节。
