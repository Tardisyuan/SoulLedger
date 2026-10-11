# 第二十批 · 你要核对的现有 egy 词条(2026-10-11)

你问的三个词,语言包里都已经有定稿:

| 概念 | 现有 egy | 出处 |
|---|---|---|
| 灵魂编号 | **Ren Hesb Ba** | `soul_app.login.soul_code` |
| 初始密码 | **Sekhem Tepy** | `soul_accounts.credentials.title` 等 |
| 联系邮箱 | **Wat Sesh** | `soul_app.mfa.lost.no_email`(第十八批) |

所以画稿里的 `Ren Ta` 请换成 `Ren Hesb Ba`,`⟨初始密码⟩` 请换成 `Sekhem Tepy`。下面是原文,供你对照。

## 灵魂 App 登录页(`soul_app.login.*` 里带「编号」的)

| key | 中文 | egy |
|---|---|---|
| soul_app.login.subtitle | 使用随初始密码一起发给你的灵魂编号登录 | Iri Ren Hesb Ba Hab Hena Sekhem Tepy |
| soul_app.login.soul_code | 灵魂编号 | Ren Hesb Ba |
| soul_app.login.required | 请填写灵魂编号与密码 | Sesh Ren Hesb Ba Hena Sekhem |
| soul_app.login.verifying | 正在核验编号与密码。请勿离开此页。 | Em Maa Ren Hesb Ba Hena Sekhem. Nen Per Em Per Pen. |

## 官员台「初始密码交付」页(`soul_accounts.credentials.*` 全部)

| key | 中文 | egy |
|---|---|---|
| title | 待交付初始密码 | Sekhem Tepy Em Djeret |
| subtitle | 未能自动发送的灵魂初始密码:查看一次、线下交付,或重试发送 | Sekhem Ba Nen Hab: Maa Wa, Djeret, Wehem Hab |
| manage_hint | 需要 soul_account.manage 权限才能查看密码、标记交付或重试发送 | Maa Sekhem, Sesh Djeret, Wehem Hab: Was soul_account.manage |
| filters.label | 按状态筛选 | Setep Em Kheperu |
| filters.PENDING | 待交付 | Em Djeret |
| filters.REVEALED | 已查看,待交付 | Maa Seth, Em Djeret |
| filters.DELIVERED | 已线下交付 | Djeret Seth |
| filters.VOID | 已作废 | Nen Wenen |
| filters.all | 全部 | Neb |
| reason.no_contact | 无可用联系方式 | Nen Wat |
| reason.send_failed | 发送失败({{error}}),已尝试 {{attempts}} 次 | Nen Hab ({{error}}), Iri {{attempts}} |
| reason.channel | 经 {{channel}} 发送 | Hab Em {{channel}} |
| reason.expired | 初始密码已过期 | Sekhem Tepy Mut |
| reason.voided | 已被重置、灵魂改密或转世作废 | Nen Wenen Em Wehem Sekhem, Khemen Sekhem Ba, Em Wehem Mesut |
| revealed_by | {{by}} 于 {{time}} 查看 | {{by}} Maa Em {{time}} |
| delivered_by | {{by}} 于 {{time}} 交付 | {{by}} Djeret Em {{time}} |
| expired | 已过期 | Mut |
| expired_go_reset | 该初始密码已过期,请到灵魂详情页重置 | Sekhem Tepy Mut; Wehem Sekhem Em Per Ba |
| actions.reveal | 查看密码 | Maa Sekhem |
| actions.retry | 重试发送 | Wehem Hab |
| actions.mark_delivered | 标记已交付 | Sesh Djeret |
| actions.go_reset | 去重置 | Wehem Sekhem |
| retry_sent | 已重新发送 | Wehem Hab Seth |
| retry_failed | 重试失败 | Nen Hab |
| retry_not_pending | 该项已不在待交付状态,不能重试 | Nen Em Djeret Djer; Nen Wehem Hab |
| delivered_ok | 已标记为线下交付 | Sesh Djeret Seth |
| deliver_failed | 标记失败 | Nen Sesh Djeret |
| deliver_not_revealed | 只有已查看的项可以标记为已交付 | Maa Seth Tepy, Er Sesh Djeret |
| empty.pending | 没有待交付的初始密码 | Nen Sekhem Tepy Em Djeret |
| empty.pending_reason | 有联系方式的灵魂,初始密码会自动发送,不会出现在这里 | Ba Em Wat: Sekhem Hab Djes-Ef, Nen Dy |
| empty.filtered | 该状态下没有记录 | Nen Sesh Em Kheperu Pen |

## 另一件

词根 **Ra**(光,手电筒)我们这边登记进词表。
