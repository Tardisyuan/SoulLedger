# egy 语言包的词根 —— 出处核对

**只做核对,没有改任何文案或词表。** egy 的用词由 Design 定(见
`docs/design-handoff/`),这份报告是给下一批修订用的证据。
2026-11-13 编写。方法沿用本目录其他报告:写明用的是哪一版、优先一手或标准工具书、
查不到就写查不到,不替它补。

核对对象:`frontend/src/__tests__/egyLexiconRules.test.ts` 里的词根表
(`ROOTS` … `ROOTS_BATCH67`、`ROOTS_V4`、`ROOTS_BATCH29`、`PARTICLES`、`PROPER_NAMES`、
`WHOLE_PHRASES`)与生成的用量表 `frontend/src/__tests__/support/egyVocabulary.json`
(454 个词形,合计出现 30,759 次)。「次数」一列取自那张用量表。

---

## 0. 结论

- **egy 不是古埃及语。** 它是把中埃及语词根的简化转写,按中文 / 英文的语序排起来的界面语言:
  没有古埃及语的语法(动词变位、性数一致、词序都没有),整套「已…」用的是一个生造的后置词
  `Seth`。把它当作「用埃及词根做的演示语言」是准确的;当作古埃及语句子是不准确的。
- **词根大多是真的。** 233 组本土词根与小词里,168 组是查得到的中埃及语词、义项对得上;
  48 组是真词但义项被借远了或转写不标准;**17 组查不到对应的词**。
- **但那 17 组用得很多。** 它们合计出现 2,324 次,其中 `Seth` 一个就 1,050 次,
  `Khemen`(修改)301 次、`Wetep`(处置)221 次、`Ahet`(时间)204 次。
  `Seth` 一个词就占全部词次的 3.4%(1,050 / 30,759)。
- **有几处是真词用反了或用错了**,比查不到更该先改:`Unemu`(食物)当「颜色」、
  `Gerh`(夜)当「禁言」、`Senb`(健康)当「同步」、`Shepet`(恼怒)当「受刑」、
  `Maakheru`(判为义人)当「已读」。见第 6 节。
- **没有发现伪造的神名或地名。** 埃及的神名、厅名、芦苇之野、两种门(`Arrwt` / `Sebkhet`)
  都查得到。七个星期名里的行星名这一轮**没有核到出处**(见第 5 节)。

| 类别 | 词根(组) | 词形 | 出现次数 |
|---|---:|---:|---:|
| 真实 —— 查得到,义项对得上 | 168 | 175 | 24,977 |
| 近似 —— 真词,义项借远了或转写不标准 | 48 | 50 | 2,696 |
| 自创 —— 查不到对应的词 | 17 | 17 | 2,324 |
| 组合写法 —— 由上面的词拼成,不另归类 | 11 | 11 | 190 |
| 专名 · 埃及(神名、地名、厅名、星期名) | 18 | 18 | 83 |
| 专名 · 希腊 / 拉丁 / 但丁 / 梵语 | 55 | 55 | 190 |
| 专名 · 汉语拼音 | 92 | 92 | 227 |
| 专名 · 技术词、厂商名、键名 | 36 | 36 | 72 |
| 合计 | | 454 | 30,759 |

「组」是把同一个词的几种写法并在一起数的(`Medu` / `Medew`、`Hemes` / `Hems`、
`-Ef` / `-Ek` / `-I` 各算一组)。分类是我的判断,判据写在各节开头;
「真实」只说这个词存在且义项相符,**不说整句是通的**。

---

## 1. 用了什么来源,没用上什么

实际打开过的:

- **W** —— 英文维基词典的埃及语词条(`en.wiktionary.org`,经其公开 API 读取词条原文,
  2026-11-13)。它是三手来源,但每个词条列了自己引的工具书。表里括号内的
  **F 页码**(Faulkner, *A Concise Dictionary of Middle Egyptian*, Oxford 1962)和
  **Wb 卷, 页.行**(Erman & Grapow, *Wörterbuch der ägyptischen Sprache*)
  **是照抄该词条的引注,我没有翻开这两部书的原页去对。** 引注缺卷号的(如 `Wb 439.6`)照原样留着。
  没有括号的行,是该词条只引了 Allen、Hoch、Loprieno 等语法书或词源书。
- **D** —— Paul Dickson, *Dictionary of Middle Egyptian in Gardiner Classification Order*
  (2006,自 Faulkner 等汇编),archive.org 上的全文识别文本(条目 `DictionaryOfMiddleEgyptian`)。
  按方括号里的 Manuel de Codage 词头整词检索,表里写的 `D [xxx]` 就是检索到的词头。
  **D 一列只说明这个词头查得到**;逐条读过释义的,是第 3、4、6 节正文里引到的那些。
  识别文本有错字(`[DAD At]` 即 ḏꜣḏꜣt),没有页码可引。

打开了但没用来引的:

- Faulkner 词典的 2017 年重排本(Jegorovic 整理,archive.org 条目 `pj1425.f3`)的识别文本:
  转写里的变音符全部识别坏了,按词头查不了,只用来按英文释义找过几个词。

没用上的:

- **Thesaurus Linguae Aegyptiae(TLA)没有查成。** 站点对自动访问弹出人机验证页,
  我没有绕过它。所以这份报告**没有一个 TLA 词条号**。下一轮由人在浏览器里补最省事:
  表里的标准转写可以直接贴进 TLA 的词条检索。
- 行星名(星期名用到的)要查 Neugebauer & Parker, *Egyptian Astronomical Texts* III,没有打开。

转写体例:表里的「标准转写」用莱比锡式(ꜣ ꜥ ḥ ḫ ẖ š ṯ ḏ,弱辅音写 j,区分 z / s),
与 W 的词条名一致。egy 的拉丁写法是把它们去掉变音符、补上 e 的惯例读法
(ꜥnḫ → Ankh),这是埃及学界通行的念法,不是错;但它会把不同的词压成同一个写法,
第 6.3 节列了已经撞上的几对。

---

## 2. 真实

判据:W 或 D 里查得到这个词,且这里的用法就是它的本义,或是界面上常见的、说得通的引申
(「进入」作登录、「取来」作加载、「封印」作结案)。备注栏写明了个别义项不合的地方。

| egy 写法 | 次数 | 标准转写 | 本义 | 这里的用法 | 出处 | 备注 |
|---|---:|---|---|---|---|---|
| Em | 1467 | m | 在、以、从(介词) | 在 / 中 / 于 | W «m»；D [m] |  |
| Nen | 2098 | nn | 没有、不(否定) | 不 / 未 / 无 / 失败 | W «nn»；D [nn] |  |
| Er | 1294 | r | 向、至、对(介词) | 到 / 至 / 给 / 比 | W «r»（F 145–146；Wb 1, 103.6–103.9）；D [r] | W 的 r 页首义是名词「口」,介词义在同页 |
| Hena | 294 | ḥnꜥ | 与、和 | 和 / 且 / 关联 | W «ḥnꜥ»；D [Hna] |  |
| Mi | 136 | mj | 如、像 | 如 / 同 / 跟随 | W «mj»；D [mi] |  |
| En | 88 | n(j) | 属格「…的」 | 属格 | W «n»（F 124）；D [n] |  |
| In | 18 | jn | 施事标记「由」 | 由 / 被 | W «jn»；D [in] |  |
| Pw | 1 | pw | 系词「这是」 | 它是 | W «pw»；D [pw] |  |
| Pen | 568 | pn | 这(阳性指示词) | 这 / 本 | W «pn»；D [pn] |  |
| Ky | 390 | ky | 另一个 | 其他 / 对方 / 下一个 | W «ky»（F 285；Wb 5, 110.4）；D [ky] |  |
| Neb | 388 | nb | 每、所有;主人 | 全部 / 每 | W «nb»（F 128–129；Wb 2, 227.5–230.14）；D [nb] |  |
| Wa | 426 | wꜥ | 一、唯一 | 一 / 仅 / 同一 | W «wꜥ»；D [wa] |  |
| Wehem | 738 | wḥm | 重复、再 | 再 / 重新 | W «wḥm»；D [wHm] |  |
| Tepy / Tepyu | 711 | tpj | 第一、在上、首要 | 首 / 原 / 内置 / 上一个 / 开始 | W «tpj»；D [tpy] | 「开始」义牵强 |
| Pehwy | 185 | pḥwj | 末端、后部 | 最后 / 最近 | W «pḥwj»；D [pHwy] |  |
| Dy | 54 | dy | 这里、那里 | 这里 | W «dy»；D [dy] |  |
| Djes / Djes-Ef / Djes-Ek | 134 | ḏs | 自己(ḏs.f 他自己) | 本人 / 自动 / 你 | W «ḏs»；D [Ds] |  |
| -Ef / -Ek / -I | 437 | .f / .k / .j | 后缀代词:他的 / 你的 / 我的 | 其 / 你的 / 我的 | W «.f»；W «.k»；W «.j»（F 7；Wb 1, 25） | 界面不分性别,一律 -Ef |
| Ba | 584 | bꜣ | 巴(灵魂的一种形态) | 灵魂 | W «bꜣ»；D [bA] |  |
| Ren / Renu | 280 | rn | 名字 | 名 / 编号 | W «rn»；D [rn] |  |
| Ankh | 203 | ꜥnḫ | 活、生命 | 生 / 世 / 激活;Ankh Wehem 恢复 | W «ꜥnḫ»（Wb 1, 193.2–201.4）；D [anx] | wḥm ꜥnḫ「再活」见 D [wHm anx],这里词序颠倒 |
| Medjat | 244 | mḏꜣt | 纸草卷、书、信 | 簿 / 文件 / 页 / App / 端 | W «mḏꜣt»；D [mDAt] | 「App / 端」义牵强 |
| Sesh | 813 | zẖꜣ | 书写、文书 | 写 / 文书 / 保存中 | W «zẖꜣ»；D [sS] |  |
| Medu / Medew | 705 | mdw | 话、言辞 | Medu 词 / 帖子 / 事由;Medew 事件 / 日志 | W «mdw»（F 122；Wb 2, 178.1–178.14）；D [mdw] | 同一个 mdw 写成两个词形、分担两组义项 |
| Wedja | 650 | wḏꜥ | 裁断、审判 | 审判 / 裁决 | W «wḏꜥ»；D [wDa] | 简写 Wedja 与 wḏꜣ「安康」同形;wḏꜥ-mdw 见 D [wDa mdw] |
| Mesut | 199 | mswt | 出生 | Wehem Mesut 转生 | W «mswt»（F 117；Wb 2, 140.16–141.13）；D [mswt] | wḥm mswt「再生」见 D [wHm mswt] |
| Dbh | 255 | dbḥ | 请求、需要 | 申请 / 请求 | W «dbḥ»（Wb 439.6–440.1）；D [dbH] |  |
| Khesef | 139 | ḫsf | 挡回、惩罚 | 驳回 | W «ḫsf»；D [xsf] |  |
| Wesekhet | 295 | wsḫt | 宽厅、庭 | 殿 / 法庭 | W «wsḫt»（Wb 1, 365.13–365.15）；D [wsxt] |  |
| Sab | 428 | zꜣb | 官衔 sꜣb「显贵、法官」 | 官员 / 判官 | W «zꜣb»（F 209）；D [sAb] | W 只列「豺」,官衔义见 D |
| Nefer | 129 | nfr | 好、美 | 功 / 善 | W «nfr»（Wb 2, 253.1–256.15）；D [nfr] |  |
| Isfet | 154 | jzft | 虚妄、罪、不义 | 过 / 罪 | W «jzft»；D [isft] |  |
| Shut | 36 | šwt | 羽毛(同形:影子) | 羽 | W «šwt»（F 262–263；Wb 4, 423.10–425.14）；D [Swt] |  |
| Ib | 75 | jb | 心 | 心 | W «jb»（F 14–15；Wb 1, 59.10–60.13）；D [ib] |  |
| Wat | 394 | wꜣt | 路 | 道 / 去向 / 连线 | W «wꜣt»（F 52；Wb 1, 244.4–244.5）；D [wAt] |  |
| Kheper / Kheperu | 100 | ḫpr / ḫprw | 成为;形态 | 成 / 状态 / 性质 | W «ḫpr»；W «ḫprw»（F 189；Wb 265.20–266.17）；D [xpr] |  |
| Gem | 116 | gmj | 找到 | 命中 / 找到 | W «gmj»（Wb 5, 166.6–169.8）；D [gmi] |  |
| Mut | 168 | mwt | 死 | 死 | W «mwt»；D [mwt] |  |
| Khetem | 487 | ḫtm | 封印、关闭 | 结案 / 关 | W «ḫtm»（Wb 3, 350–352.3）；D [xtm] |  |
| Hab | 283 | hꜣb | 派遣、送信 | 发送 / 提交 | W «hꜣb»；D [hAb] |  |
| Aq | 426 | ꜥq | 进入 | 登录 / 入 | W «ꜥq»（F 49–50；Wb 1, 230.3–232.9）；D [aq] |  |
| Wenen | 175 | wnn | 存在 | 有 / 留着 | W «wnn»；D [wnn] |  |
| Baku | 22 | bꜣkw | 劳作、工役 | 任务 / 业务 | W «bꜣkw»（F 78；Wb 1, 427.13–428.15）；D [bAkw] |  |
| Renpi | 1 | rnpj | 年轻 | 少年 | W «rnpj» |  |
| Qebeh | 45 | qbḥ / qbb | 凉;qbḥw 凉水 | 冷却 | W «qbb»；W «qbḥw»（F 278；Wb 5, 27.15–29.4）；D [qbb] |  |
| Duat | 165 | dwꜣt | 冥界 | 冥界 | W «dwꜣt»；D [dwAt] |  |
| Pet | 46 | pt | 天 | 天国;另作「类别」(Pet Sep、Pet Aq) | W «pt»；D [pt] | 「类别」义无据,见问题清单 |
| Wesheb | 91 | wšb | 回答 | 评论 / 回复 | W «wšb»；D [wSb] |  |
| Imen | 42 | jmn | 隐藏 | 隐藏 | W «jmn»（F 21；Wb 1, 83.4–83.6）；D [imn] |  |
| Fekh | 169 | fḫ | 松开、解除、放弃 | 删除 / 解除 | W «fḫ»（F 98）；D [fx] |  |
| Per | 403 | pr / prj | 房屋;(prj)出去 | 殿 / 域 / 租户;出 / 退出 | W «pr»（F 89；Wb 1, 511.7–516.1）；W «prj»（F 90–91；Wb 1, 518–525.6）；D [pr] | 两个词共用一个写法 |
| Redi | 207 | rḏj | 给、放 | 添加 / 交 / 粘贴 | W «rḏj»（F 154–156；Wb 2, 464.1–468.15）；D [rdi] |  |
| Betau | 1 | btꜣ | 罪行、过犯 | 违法有害 | W «btꜣ»（F 85；Wb 1, 483–484.13）；D [btA] |  |
| Shemsu | 24 | šmsw | 随从 | 朋友圈 | W «šmsw»；D [Smsw] |  |
| Khet / Ikhet | 573 | ḫt / jḫt | 东西;m-ḫt 之后 | Khet 事 / 之后;Ikhet 设备 | W «ḫt»；D [xt] | 同一个词的两种转写被分成了两个词 |
| Remetj | 19 | rmṯ | 人 | 人 | W «rmṯ»（F 149–150；Wb 2, 421.9–424.18）；D [rmT] |  |
| Sep / Sepu | 329 | zp | 次、事、案 | 条 / 案 / 次 / 队列 | W «zp»（F 221–222；Wb 3, 435.1–438.12）；D [sp] |  |
| Aaru | 14 | jꜣrw | 芦苇(sḫt-jꜣrw 芦苇之野) | 芦苇之野 | W «jꜣrw»（F 9；Wb 1, 32.5）；W «sḫt-jꜣrw»（F 9；Wb 1, 32.6）；D [iArw] |  |
| Wser | 7 | wsr | 强 | 强度(effort) | W «wsr»（Wb 1, 360.7–362.9）；D [wsr] |  |
| Smen | 336 | smn | 确立、固定 | 设置 / 确认 / 复核 | W «smn»（F 228；Wb 4, 131–134.22）；D [smn] |  |
| Wen | 235 | wn | 打开 | 开 / 启用 | W «wn»（F 60–61；Wb 1, 307.9）；D [wn] |  |
| Wer / Weret | 43 | wr / wrt | 大 | 大 / 极 / 大写 | W «wr»（Wb 1, 326–327.19）；W «wrt»（F 64；Wb 1, 330.1–330.6）；D [wr] |  |
| Fai | 48 | fꜣj | 举、扛;称量 | 称(心) | W «fꜣj»；D [fAi] | 「称量」义见 D |
| Sebkhet | 14 | sbḫt | 门、关(亡灵书 145/146 的门) | 门 | W «sbḫt»；D [sbxt] |  |
| Arrwt | 2 | ꜥrrwt | 门、听讼之所(亡灵书 144 的七道) | 七道通路 | W «ꜥrrwt»（F 45；Wb 1, 209.13–209.14）；D [arrwt] |  |
| Hep | 30 | hp | 法、规 | 律 | W «hp»（F 158；Wb 2, 488.7–489.2）；D [hp] |  |
| Djadjat | 3 | ḏꜣḏꜣt | 裁判团、议事会 | 裁判团 | W «ḏꜣḏꜣt»（F 319；Wb 5, 528.1–529.20）；D [DAD At] |  |
| Gesu | 5 | gs | 侧、半 | 侧边栏 | W «gs»；D [gs] |  |
| Setep | 295 | stp | 挑选 | 选择 / 筛选 | W «stp»；D [stp] |  |
| Ini | 185 | jnj | 取来 | 加载 / 导入 | W «jnj»；D [ini] |  |
| Ta | 217 | tꜣ | 土地、国 | 界域 | W «tꜣ»；D [tA] |  |
| Iri | 714 | jrj | 做 | 做 / 执行 / 新建 | W «jrj»（F 25–27；Wb 1, 103.18–105.8）；D [iri] |  |
| Seshem | 29 | sšm | 引导、带领 | 推进 | W «sšm»（F 247；Wb 4, 289.10–290.4）；D [sSm] |  |
| Hetep | 11 | ḥtp | 安宁、满足 | 福地;Em Hetep 再会;另作「主题」 | W «ḥtp»（F 179–180；Wb 3, 183.4–183.7）；D [Htp] | 「主题」义无据 |
| Hemes / Hems | 102 | ḥmsj | 坐、居住 | 暂居 / 居所 / 坐 | W «ḥmsj»（F 170；Wb 3, 96.13–98.22）；D [Hmsi] | 两个词形同出一词 |
| Ahau | 15 | ꜥḥꜥw | 一段时间、寿数 | 刑期 / 时长 | W «ꜥḥꜥw»；D [aHaw] |  |
| Sekha | 1 | sḫꜣ | 记得;sḫꜣw 记忆 | 念 | W «sḫꜣw»；D [sxAw] | D 的 [sxA] 只有另一个同形词 |
| Dua | 10 | dwꜣ | 赞美、礼拜 | 赞 | W «dwꜣ»；D [dwA] |  |
| Iakeb | 1 | jꜣkb | 哀悼 | 哀 | W «jꜣkb»（F 9；Wb 1, 34.5–34.12）；D [iAkb] |  |
| Sau | 126 | zꜣw | 守护 | 保存 | W «zꜣw»（Wb 3, 420.1）；D [sAw] |  |
| Khesbedj | 0 | ḫsbḏ | 青金石 | 墨蓝 | W «ḫsbḏ»；D [xsbD] |  |
| Shesep | 169 | šzp | 接受、收下 | 认领 / 收 | W «šzp»（F 271–272；Wb 4, 530.1–534.2）；D [Ssp] |  |
| Sepy | 28 | zpj | 剩下 | 余 | W «zpj»（F 222；Wb 3, 439.7–439.15）；D [spi] |  |
| Djed | 92 | ḏd | 说 | 引用 / 诵 | W «ḏd»（F 325；Wb 5, 618.9–625.2）；D [Dd] |  |
| Khenn | 4 | ẖnn | 扰乱 | 冲突 | W «ẖnn»；D [Xnn] |  |
| Djai | 1 | ḏꜣj | 渡过 | 越界 | W «ḏꜣj»；D [DAi] |  |
| Qab | 1 | qꜣb | 中间 | 中途 | W «qꜣb»；D [qAb] |  |
| Shem | 95 | šmj | 走 | 行 / 启程 | W «šmj» |  |
| Maa | 573 | mꜣꜣ | 看 | 看 / 查 | W «mꜣꜣ»（F 100；Wb 2, 7.1–10.14）；D [mAA] |  |
| Maat | 209 | mꜣꜥt | 真、正;玛阿特 | 真 / 实 / 证据 | W «mꜣꜥt»；D [mAat] |  |
| Hru | 210 | hrw | 日 | 日 / 天 | W «hrw»（F 159；Wb 2, 496.6–497.20）；D [hrw] |  |
| Renpet | 140 | rnpt | 年 | 年 | W «rnpt»；D [rnpt] |  |
| Abed | 63 | ꜣbd | 月 | 月 | W «ꜣbd»（F 2；Wb 1, 8.22）；D [Abd] |  |
| Unut | 72 | wnwt | 时辰 | 小时 | W «wnwt»（F 61；Wb 1, 316.1–317.8）；D [wnwt] |  |
| At | 26 | ꜣt | 片刻(W:约一分钟) | 分钟 | W «ꜣt»（F 1, 6；Wb 1, 1.11–2.5）；D [At] |  |
| Djet | 53 | ḏt | 永恒 | 永久 | W «ḏt»；D [Dt] |  |
| Neheh | 6 | nḥḥ | (循环的)永恒 | 始终 | W «nḥḥ»（F 137；Wb 2, 299.2–302.15）；D [nHH] |  |
| Hery | 118 | ḥrj | 在上的、主管 | 上级 / 管理员 | W «ḥrj»（F 174–176；Wb 3, 133.1–136.6） |  |
| Heri-Tep | 3 | ḥrj-tp | 首领 | 殿主 | W «ḥrj-tp»（Wb 3, 140.6–140.15） |  |
| Senn | 39 | snn | 肖像;(文书的)副本 | 复制 | D [snn] |  |
| Khery | 76 | ẖrj | 在下的 | 下 / 剩余 | W «ẖrj» |  |
| Rekh / Rekh-Tw | 59 | rḫ | 知道(rḫ.tw 被动「为人所知」) | 知;常见的 | W «rḫ»；D [rx] |  |
| Tut | 93 | twt | 像、形象 | 图 / 头像 | W «twt»（F 295–296；Wb 5, 255.8–257.18）；D [twt] |  |
| Sen | 85 | sn / snw | 兄弟、同伴;snw 二 | 二 / 同侪 | W «sn»；D [sn] |  |
| Iyi | 81 | jj / jwj | 来 | 来 / 返回 | W «jj»（F 10；Wb 1, 37.1–37.36）；W «jwj»（F 11–12；Wb 1, 44.1–45.6）；D [ii] |  |
| Hehy | 135 | ḥḥj | 寻找 | 搜索 | W «ḥḥj»；D [HHy] |  |
| Qen | 4 | qnj | 勇 | 勇 | W «qnj»；D [qni] |  |
| Nut | 50 | njwt | 城、镇 | 出身地 / 城 | W «nwt»；D [nwt] | W 把此词列在 nwt 页 |
| Sepat | 8 | spꜣt | 州、区 | 时区 | W «spꜣt»；D [spAt] |  |
| Hesb | 228 | ḥsb | 计数 | 数 / 排序 / 编号 | W «ḥsb»（F 177–178；Wb 3, 166.6–167.15）；D [Hsb] |  |
| Mer | 13 | mrj | 爱、想要 | 期望 | W «mrj»（F 111；Wb 2, 98.12–101.13）；D [mri] |  |
| Shu | 13 | šwj | 空 | 空 | W «šwj»（F 263；Wb 4, 426.6–427.19） |  |
| Bin | 6 | bjn | 坏 | 恶 | W «bjn»（F 81；Wb 1, 442.15–443.17）；D [bin] |  |
| It | 11 | jt | 父 | 父级 | W «jt»；D [it] |  |
| Sa | 3 | zꜣ | 护佑 | 安全 | W «zꜣ»；D [sA] |  |
| Sedjer | 40 | sḏr | 躺下、过夜 | 延后 / 静音 | W «sḏr»；D [sDr] |  |
| Desher | 0 | dšr | 红 | 红 | W «dšr»（F 316；Wb 5, 487.9–490.13）；D [dSr] |  |
| Wadj | 0 | wꜣḏ | 绿 | 绿 | W «wꜣḏ»；D [wAD] |  |
| Kem | 9 | km | 黑 | 黑 / 深色 | W «km»（F 286）；D [km] |  |
| Hedj | 36 | ḥḏ | 白 | 白 / 浅色 | W «ḥḏ»；D [HD] |  |
| Nedjes | 25 | nḏs | 小 | 小 | W «nḏs»（F 145；Wb 2, 384.8–385.13）；D [nDs] |  |
| Nub | 0 | nbw | 金 | 金 / 琥珀 | W «nbw»；D [nbw] |  |
| Gereg | 7 | grg | 谎言 | 欺 / 伪 | W «grg»；D [grg] |  |
| Sma | 3 | smꜣ | 杀 | 杀 | W «smꜣ»；D [smA] |  |
| Sebi | 6 | sbj | 反叛 | 叛 | W «sbj»；D [sbi] |  |
| Awn | 2 | ꜥwn | 贪 | 贪 | W «ꜥwn-jb»；D [awn] |  |
| Awt | 2 | ꜥwt | 牲畜 | 畜生道 | W «ꜥwt»（F 8, 39；Wb 1, 29.15–29.16）；D [awt] |  |
| Heqer | 1 | ḥqr | 饿 | 饿 | W «ḥqr»；D [Hqr] |  |
| Sia | 64 | sjꜣ | 洞察、领会 | 智 / 解读;另作「模型」 | W «sjꜣ»；D [siA] |  |
| Wah | 24 | wꜣḥ | 放置;持久 | 久 / 等 | W «wꜣḥ»；D [wAH] |  |
| Mu | 23 | mw | 水 | 水 / 汤 | W «mw»（F 105；Wb 2, 50.7–53.1）；D [mw] |  |
| Itru | 32 | jtrw | 河 | 河 | W «jtrw»；D [itrw] |  |
| Iaut | 7 | jꜣwt | 职位 | 职能角色 | W «jꜣwt»（F 7–8；Wb 1, 26.13）；D [iAwt] |  |
| Dens | 31 | dns | 重 | 重 / 权重 | W «dns»（F 314；Wb 5, 468.3–469.8）；D [dns] |  |
| Khebi | 35 | ḫbj | 扣减、减少 | 衰减 | D [xbi] | W 的 ḫbj 页只有「跳舞」义 |
| Hem | 1 | ḥm | 仆人 | Worker | W «ḥm»；D [Hm] |  |
| Imy-Ra | 1 | jmj-r | 监督、总管 | 监理 | W «jmj-r»（F 18–19；Wb 1, 74.11） |  |
| Sip | 37 | sjp | 检查、核验 | 测试 / 评测 | W «sjp»（F 212；Wb 4, 35.2–36.2）；D [sip] |  |
| Sebayt | 7 | sbꜣyt | 教诲 | 警告 | W «sbꜣyt»；D [sbAyt] |  |
| Wedj | 1 | wḏ | 命令、敕令 | 授权(版权许可) | W «wḏ»（Wb 1, 394.10–395.22）；D [wD] |  |
| Wekha | 7 | wḫꜣ | 寻找 | 检索 | W «wḫꜣ»；D [wxA] |  |
| Shad | 2 | šꜥd | 割断 | 截断 | W «šꜥd»；D [Sad] |  |
| Hat | 22 | ḥꜣt | 前部 | 前 / 上一步 | W «ḥꜣt»（F 160, 162；Wb 3, 12.19–13.1）；D [HAt] |  |
| Djama | 77 | ḏmꜥ | 纸草页、纸草卷(晚期埃及语) | 文件 / 资料 / 附件 | W «ḏmꜥ»（Wb 5, 574.3–574.9） |  |
| Nemet | 7 | nmtt | 步伐 | 步 | W «nmtt»（F 133–134；Wb 2, 271.1–271.18）；D [nmtt] |  |
| Smi | 1 | smj | 报告;告发 | 报告 | W «smj»（F 227；Wb 4, 127.7–129.12）；D [smi] |  |
| Mawy | 190 | mꜣwj | 变新 | 新 / 更新 | W «mꜣwj» |  |
| Sni | 14 | znj | 经过、越过 | 跳过 | W «znj»；D [sni] |  |
| Iwn | 3 | jwn | 柱子(同形:颜色) | 列 | W «jwn»（F 13；Wb 1, 52.7–52.20）；D [iwn] |  |
| Shat | 2 | šꜥt | 文书 | 邮件 | D [Sat] | W 的 šꜥt 页前几义是「屠戮、刀」 |
| Swri | 7 | zwr / swr | 喝 | 饮 | W «zwr»（F 217；Wb 3, 428.5–429.2）；D [swr] |  |
| Nis | 19 | njs | 呼唤、召唤 | 邀请 | W «njs»；D [nis] |  |
| Wet | 5 | wt | 裹缠、制木乃伊 | 木乃伊 | W «wt»（F 71；Wb 1, 378.7–379.13）；D [wt] |  |
| Qeres | 15 | qrs | 安葬 | 葬仪 | W «qrs»；D [qrs] |  |
| Khat | 7 | ẖꜣt | 尸身 | 身体 | W «ẖꜣt»（F 200；Wb 3, 359.9–359.20）；D [XAt] |  |
| Heka | 2 | ḥkꜣ | 法术 | 咒 | W «ḥkꜣ» |  |
| Pekhret | 11 | pẖrt | 药方 | 药 | W «pẖrt»；D [pXrt] |  |
| Mesha | 3 | mšꜥ | 军队、远征 | 战争 / 军队 | W «mšꜥ»；D [mSa] |  |
| Nesret | 1 | nsrt | 火焰 | 火 | W «nsrt»（F 140；Wb 2, 336.1–336.6）；D [nsrt] |  |
| Tash | 14 | tꜣš | 边界 | 数据范围 | W «tꜣš» |  |
| Hut | 26 | ḥwt | 大宅、庙、庄园 | 机构 | W «ḥwt»；D [Hwt] |  |
| Shena | 17 | šnꜥ | 驱退、挡开 | 拉黑 | W «šnꜥ»（F 269；Wb 4, 504.5–505.13）；D [Sna] |  |
| Wenmy | 2 | wnmj | 右 | 右 | W «wnmj» |  |
| Semehy | 3 | smḥj | 左 | 左 | W «smḥj»（Wb 4, 140.10–140.14） |  |
| Tephet | 5 | ṯpḥt | 洞穴 | 口 / 洞口 | D [TpHt] |  |
| Gereh | 2 | grḥ | 夜 | 夜 | W «grḥ»；D [grH] |  |
| Tera | 2 | tr | 时节、时候 | 季 | W «tr»（F 300；Wb 5, 313.12–316.11）；D [tr] |  |
| Meh | 5 | mḥ | 充满 | 满 | W «mḥ»（F 113；Wb 2, 116.6–118.10）；D [mH] |  |

---

## 3. 近似

判据:词是真的,但这里的义项离本义远到读的人对不上;或者写法对不上任何一个确定的词、
只能猜是哪个;或者转写不是标准的。「更合适的词」集中写在第 6 节。

| egy 写法 | 次数 | 标准转写 | 本义 | 这里的用法 | 出处 | 备注 |
|---|---:|---|---|---|---|---|
| Iu | 5 | jw | 句首小词,肯定其后的陈述 | 「是」(与 Nen 相对)、「或」 | W «jw»（F 11–12；Wb 1, 5）；D [iw] | jw 不能单独作「是的」,也不是「或」 |
| Djer | 382 | ḏr | 界限;自…以来 | …中 / 尚未 / 待 / 截止 | W «ḏr»；D [Dr] | 真词,但在这里成了万能的时态标记(Aq Djer… 登录中、Nen Djer 已清空) |
| Hry | 18 | ḥrj / r-ḥrw | 在上的;向上 | Er Hry:最小 / 至少 / 右上角 / 升 | W «ḥrj»（F 174–176；Wb 3, 133.1–136.6） | 同一个词组担了方向相反的几个义项 |
| Sekhem | 243 | sḫm | 有力、权能 | 密码 | W «sḫm»（F 241；Wb 4, 243.3–249.16）；D [sxm] |  |
| Hesy | 181 | ḥzj | 称赞、嘉许 | 批准 | W «ḥzj»（F 176；Wb 3, 154.2–155.25）；D [Hsi] |  |
| Taui | 145 | tꜣwj | 两地(= 埃及) | 文明 | W «tꜣwj»；D [tAwy] |  |
| Was | 96 | wꜣs | 统治权、was 权杖 | 权限 | W «wꜣs»（F 54；Wb 1, 259.16）；D [wAs] |  |
| Sedjem | 113 | sḏm | 听;听审 | 举报 / 通知 | W «sḏm»；D [sDm] | 「告发」的现成词是 smj(已登记为 Smi) |
| Djeseru | 24 | ḏsrw | 隔绝、私密、神圣 | 敏感(词) | W «ḏsr»（F 324；Wb 609.11–614.14）；D [Dsrw] |  |
| Gerh | 28 | grḥ | 夜;完结 | 禁言 | W «grḥ»；D [grH] | 「沉默」是 gr;与 Gereh(夜)是同一个词 |
| Aat | 21 | jꜣt / ꜥt | 土丘、地域 / 房间 | 范围 / 分区 / 文件夹 | W «jꜣt»（F 7；Wb 1, 2）；W «ꜥt»；D [iAt] | 对应哪个词不明确 |
| Mehy | 1 | mhj | 健忘、疏忽 | 垃圾信息 | D [mhy] |  |
| Kher | 13 | ẖr | 在…之下 | 类型 / 架构 / 辱骂 | W «ẖr»（Wb 3, 386.1–388.15）；D [Xr] | 三个义项都牵强 |
| Hemet | 1 | ḥmt | 女人、妻 | 色情(Khet Hemet) | W «ḥmt»（F 168–169；Wb 3, 76.16–77.19）；D [Hmt] |  |
| Menkh | 94 | mnḫ | 有效、出色 | 通过 / 正确 | W «mnḫ»；D [mnx] |  |
| Mekher | 7 | mẖrw | 事务、安排 | 详情 / 属性 | D [mXrw] |  |
| Maakheru | 3 | mꜣꜥ-ḫrw | (审判后)被判为义、「声音为真」 | 已读 / 未读 / 原文 | W «mꜣꜥ-ḫrw» | 义项完全不符 |
| Hesmen | 27 | ḥsmn | 泡碱(洁净用);青铜 | 炼狱(Ta Hesmen) | D [Hsmn] |  |
| Aha | 56 | ꜥḥꜥ / ꜥḥꜣ | 站立 / 战斗 | 按钮 / 操作 | W «ꜥḥꜥ»（F 47；Wb 1, 218.3–219.20）；W «ꜥḥꜣ»（F 46；Wb 1, 215.1–216.1）；D [aHa] | 对应哪个词不明确,两个都不通 |
| Netjer / Netjeru | 200 | nṯr | 神 | 角色 / 人物 / 身份 | W «nṯr»（F 142；Wb 2, 358.1–360.14）；D [nTr] |  |
| Mesqet | 5 | msqt | 天上的一处(或指银河) | 矩阵 | W «msqt»（F 118；Wb 2, 149.15–149.17）；D [msqt] |  |
| Sepdet | 21 | spdt | 天狼星、索提斯 | 时间 / 时戳 | W «spdt»；D [spdt] |  |
| Djedu | 30 | ḏdw | 布西里斯(地名) | 条文 / 依据 | W «ḏdw»；D [Ddw] | 想写的大概是 ḏdt「所说的话」 |
| Menmen | 38 | mnmn | 移动、摇晃 | 连续 / 太频繁 / 超时 | W «mnmn»（F 109；Wb 2, 80–81.15）；D [mnmn] |  |
| Shemes | 37 | šms | 跟随、侍奉 | 书信 | W «šms»；D [Sms] |  |
| Hen | 4 | hn / hnw | 箱子 / 同伴 | (书信)会话 | W «hn»（F 158；Wb 2, 491.9–492.5）；W «hnw»（F 158–159；Wb 2, 493.2–493.14）；D [hn] | 对应哪个词不明确 |
| Weshed | 19 | wšd | 致意、问询 | 回复(与 Wesheb 并用) | W «wšd»（F 71；Wb 1, 375.7–375.15）；D [wSd] |  |
| Senb | 70 | snb | 健康 | 互关 / 连接 / 同步;Per Senb 医院 | W «snb»（Wb 4, 158.2–159.17）；D [snb] | 只有「医院」一处合本义 |
| Nehet | 139 | nḥt | 祈祷、祈愿 | 申诉 | D [nHt] | 「申诉、请愿」的现成词是 spr / sprt(D) |
| Shepet | 31 | špt | 恼怒、不满 | 受刑 | D [Spt] |  |
| Nedj | 10 | nḏ | 询问;保护、搭救 | 赦免 / 减免 | W «nḏ»（F 143；Wb 2, 370.16–371.14）；D [nD] |  |
| Sehed | 9 | sḥḏ | 照亮、阐明 | 表态 | W «sḥḏ»；D [sHD] |  |
| Hai | 2 | hy | 欢呼声 | 喜(另:亥时的拼音) | W «hy»（F 157；Wb 2, 482.12-16）；D [hy] | 写法 Hai 更像 hꜣj「下降」 |
| Khabes | 12 | ḫbs ? | (想写的是「灯」) | 灯 | **未核到出处** | W 与 D 的 ḫbs 都只有「犁地」义 |
| Nehes / Nehesu | 38 | nhzj | 醒来 | 关注 / 关注者 | W «nhzj»（F 136；Wb 2, 287.3–287.9）；D [nhsi] |  |
| Nehem | 43 | nḥm | 拿走;搭救 | 移到 / 归档 | W «nḥm»；D [nHm] |  |
| Iru | 36 | jrw | 形状、性质 | 类别 | W «jrw»（Wb 1, 113.1–113.2）；D [irw] |  |
| Hesep | 14 | ḥzp | 园圃 | 层 / 阶段 | W «ḥzp»；D [Hsp] |  |
| Sekhet | 322 | sḫt | 田野、沼地 | 位置 / 站 / 节点 | W «sḫt»；D [sxt] | Sekhet Aaru(芦苇之野)一处合本义 |
| Sefekh | 9 | sfḫw | 七 | 周 | W «sfḫw»；D [sfxw] | 埃及的「周」是十天(D [tp ra mD]) |
| Kat | 37 | kꜣt | 工作、营造 | 组件 / 工具 | W «kꜣt»；D [kAt] |  |
| Khent | 11 | ḫnt | 在…之前、面 | 向量 | W «ḫnt»；D [xnt] |  |
| Aa | 17 | ꜥꜣ | 大 | 大小 / 维度 / 条数 | W «ꜥꜣ»（F 37–38；Wb 1, 161.3–162.12）；D [aA] |  |
| Pesh | 2 | psš | 分、分享 | 页 | W «psš»；D [psS] |  |
| Ra | 2 | rꜥ | 太阳 | 手电筒(光) | W «rꜥ»（F 147；Wb 2, 401.5–401.10）；D [ra] | 星期名 Hru Ra 里合本义 |
| Shewet | 2 | šwtj | 商人 | 应用商店 | D [Swty] |  |
| Khaibit | 1 | šwt / šwyt | 影子 | 鬼(饿鬼道) | W «šwt»（F 262–263；Wb 4, 423.10–425.14）；D [Swyt] | Khaibit 像是 Budge 一系的旧转写(本轮没有查到它的出处);标准转写里它与 Shut(羽)同形 |
| Djeret | 77 | ḏrt | 手 | 交付 / 邮箱 / 布施 | W «ḏrt»；D [Drt] |  |

---

## 4. 自创

判据:按这个写法、这个意思,W 和 D 里都查不到对应的词 —— 可能是生造,可能是拼写讹变,
也可能是写法碰巧同于一个意思无关的真词。**「查不到」只对这两个来源成立**:
TLA 没查成,所以这一节每一条都值得在 TLA 里再查一次,再下结论。

| egy 写法 | 次数 | 这里的用法 | 查到了什么 |
|---|---:|---|---|
| Seth | 1050 | 「已…」的完成标记,兼作「项 / 类」(Aq Seth、Kher Seth) | 古埃及语没有这样的后置完成标记。写法与塞特神的英文名 Seth 相同;W 的 sṯ 是「气味」,jsṯ 是「当…时」。 |
| Emu | 78 | 现在 / 立即 | 未找到。W 的 jm 是「在那里」;「今天、现在」是 mjn(D [min])。 |
| Wetep | 221 | 处置 / 去处 / 了结 | 未找到。W 无 wtp 页,D 无 [wtp]。 |
| Sethet | 24 | (技术)错误 | W 的 sṯt 是「亚洲」,D 的 [sTt] 是「亚洲、点燃、啤酒罐」,都不是「错误」。 |
| Khemen | 301 | 修改 / 编辑 / 更新 | W 只有 ḫmnw「八、赫尔摩波利斯」;D 无 [xmn]。 |
| Ahet | 204 | 时间 / 延迟 / 定时 | W 的 ꜣḫt 是「地平线、泛滥季」,ꜣḥt 是「田地」,都不是「时间」。 |
| Sesen | 86 | 批准 / 许可 / 适用 | W 与 D 的 ssn 是「呼吸、闻」,zšn 是「莲花」。 |
| Sehen | 131 | 取消 / 撤销 | D 的 [sHn] 是「命令、装饰」,[sxn] 是「拥抱、寻访」;W 无此页。 |
| Hemsu | 55 | 系统 | 未找到。W 无 ḥmsw 页,D 无 [Hmsw];形似 ḥmsj「坐」的派生。 |
| Menf | 66 | 令牌 / 密钥 | D 的 [mnf] 是「不当地」,[mnfAt] 是「步兵」。 |
| Unemu | 2 | 颜色 / 配色 | W 与 D 的 wnmw 是「食物」(wnm 吃)。颜色是 jwn。 |
| Redu | 7 | 分布 / 占比 / 维度 | D 的 [rdw] 是「台阶、阶梯、墓井」;W 无此页。 |
| Bek | 11 | 导出 / 开除 | 未找到。W 的 bꜣk 是「劳作、仆人」,bkꜣ 是「明天、怀孕」;D 无 [bk]。 |
| Khedu | 8 | 活动(最近活动) | W 的 ḫdj 是「顺流北行、流」;D 无 [xdw]。 |
| Ates | 2 | 一日一封 | 未找到。D 无 [Ats]。 |
| Sherer | 32 | 中国 / 中文 | W 的 šrr 是「变小」。未见古埃及语对中国的称呼。 |
| Menu | 46 | 菜单 | 英语借词。(古埃及语的 mnw 是「纪念物」。) |

---

## 5. 组合写法与专名

**组合写法**(11 个,合计 190 次)由前几节的词用连字符拼成,成分各自归类,合成词本身都是新造的:
Hab-Ba(91,调拨)· Pet-Sesh(32,模板)· Wen-Khetem(17,开关)· Hemet-Sesh(17,版本)·
Wat-Ha(13,快捷键)· Sekhet-Shepet(10)· Wetep-Neb(3)· Tut-Hesb(2,图表)· Wen-Neb(2)·
Ren-Sesen(2,权限名)· Khemen-Shepet(1)。其中 Hemet-Sesh 的 `Hemet` 是「女人」,
看不出「版本」是怎么来的;Wetep-、Khemen-、-Sesen 的成分本身在第 4 节。
用空格写的固定搭配里,两个是查得到的古埃及说法:`Wehem Mesut`(wḥm mswt,再生,D)、
`Ankh Wehem`(wḥm ꜥnḫ,再活,D;这里词序颠倒)。

**埃及专名**(18 个词形,83 次):

| 写法 | 标准转写 | 核对 |
|---|---|---|
| Wesir(2) | wsjr | 奥西里斯。W «wsjr»（F 68；Wb 1, 359.5） |
| Anpu(1) | jnpw | 阿努比斯。W «jnpw» |
| Djehuty(6) | ḏḥwtj | 托特。W «ḏḥwtj» |
| Heru(2) | ḥrw | 荷鲁斯。W «ḥrw»(词条在,释义是模板生成的,没读到正文) |
| Ammit(8) | ꜥm-mwt | 阿米特(「吞食死者的」)。W «ꜥm-mwt» |
| Apep(1) | ꜥꜣpp | 阿佩普。W «ꜥꜣpp»（F 38；Wb 1, 167.14） |
| Wepwawet(1) | wp-wꜣwt | 开路者。W «wp-wꜣwt» |
| Kemet(21) | kmt | 埃及。W «kmt»（F 286；Wb 5, 127.4） |
| Haunebut(15) | ḥꜣw-nbwt | 本义「(爱琴海的)岛民」,W «ḥꜣw-nbwt»（F 161；Wb 3, 11.1）。拿它指希腊是引申,不是原义(晚期有此用法的说法本轮未核到出处) |
| Wesekhet Maaty(1) | wsḫt nt mꜣꜥtj | 两真之殿。W «mꜣꜥtj» 明写双数形是这个厅名的省称 |
| Weret Maaty(17) | — | **没查到这个说法。** 同一个厅在包里有两个名字,见 6.2 |
| Hru Ra、Hru Iah | rꜥ、jꜥḥ | 日、月。W «rꜥ»（F 147）、«jꜥḥ»（F 11；Wb 1, 42.7） |
| Hru Heru Desher、Hru Sebeg、Hru Heru Wepesh、Hru Sebau、Hru Heru Ka Pet | — | 火、水、木、金、土五星的名字。**未核到出处**:W 没有对应词条,D 检索 Mars / Jupiter / Saturn / Venus / Mercury 无结果 |

古埃及的「周」是十天(D [tp ra mD]);按行星给七天命名是后来的做法(通行说法,本轮未查出处)。
所以这七个星期名整体是仿造,只有里面的天体名可能是真的。

**希腊 / 拉丁 / 但丁 / 梵语**(55 个词形,190 次):Tartaros、Asphodelos、Lethe、Acheron、Charon、
Hades、Minos、Leimon、Gorgias、Politeia、Ameles、Kristos、Europa、Asia;Limbo、Malebolge、
Antinferno、Dante、Francesca、Inferno、Purgatorio、Paradiso Terrestre、Eunoe、Culpa、Poena、
七罪与 Haeresis / Violentia / Proditio、Baptisma、Epicurei、八个祈祷时辰、SENTENTIA、
出处编号 Inf. III / X;Asura 与四大部洲的梵名。这些是原样引用的外语专名,不是埃及词,
没有逐个核(各文明的专名在本目录其他几份报告里核过)。

**汉语拼音**(92 个词形,227 次):十殿、城隍四级与封号、二十五司、地狱名、鬼差、十三站、十二时辰等。
三个要留意的同形:拼音 `Hai`(亥)与词根 `Hai`(喜)、拼音 `Shen`(申)、`Wu`(午)都只有两三个字母,
读的人分不出它是拼音还是埃及词。

**技术词、厂商名、键名**(36 个词形,72 次):GitHub、JSON 一类,原样引用,不涉及核对。

---

## 6. 问题清单(给 Design)

每条写:现在的写法 → 问题 → 查得到的替代词与出处。**替代词的拉丁写法是我按现有惯例拟的,
用不用、怎么写由 Design 定**;有的会和已登记的词撞形,撞的地方都写出来了。
出现次数在括号里。

### 6.1 生造或用错的词(先改这些)

1. **`Seth`(1,050)** —— 「已…」的完成标记,兼作「项 / 类型」(`Kher Seth`)。古埃及语没有后置的完成标记,
   这个词也查不到;它的写法还和塞特神的通行英文名一模一样,读起来像「登录 · 塞特」。
   这是全包用得最多的生造词,也是「egy 不是古埃及语」最直接的证据。
   没有现成的等价物可换(古埃及语的完成义在动词形态上)。可行的做法是换一个不撞神名的写法,
   或者在说明里明说它是造出来的语法词。
2. **`Unemu`(2,颜色)** —— wnmw 是「食物」(W «wnmw»;D [wnmw] food, sustenance)。
   颜色是 **jwn**(W «jwn»,F 13,Wb 1, 52.7;D [iwn] complexion, colour)。
   第十节废止的 `Iwen` 正是对的词;现在登记的 `Iwn`(列)是同形的另一个词「柱」。
3. **`Ahet`(204,时间 / 延迟 / 定时)** —— ꜣḫt 是地平线、泛滥季,ꜣḥt 是田地。
   「时候、时节」是 **tr**(W «tr»,F 300;已登记为 `Tera` 季),「时间」还有 **nw**(D [nw] time)、
   **ꜥḥꜥw**(已登记为 `Ahau`)。
4. **`Khemen`(301,修改 / 编辑)** —— 只查到 ḫmnw「八」。没有核到一个现成的「修改」;
   最近的是 **smꜣwj**「翻新、更新」(D [smAwy] renovate, renew),与已登记的 `Mawy`(新)同根。
5. **`Wetep`(221,处置 / 去处)** —— 查不到。可考虑 **sḫr**「谋划、裁定、安排」(D [sxr] plan, counsel, determination)。
6. **`Sehen`(131,取消)** —— sḥn 是「命令」(D [sHn]),意思相反。
   可考虑 **ꜥḫm / jḫm**「熄灭、废止」(D [ixm] extinguish, annul),或并入已登记的 `Fekh`(解除)。
7. **`Sesen`(86,批准 / 许可)** —— ssn 是「呼吸」(W «ssn»,F 245)。
   「应允」是 **hnn**(D [hnn] assent (to))。
8. **`Sethet`(24,错误)** —— sṯt 是「亚洲」。「走偏、出错、违犯」是 **thj**(D [thi] go astray, transgress)。
   D 另有 [wn] fault, blame,但写出来与 `Wen`(开)同形。
9. **`Gerh`(28,禁言)** —— grḥ 是「夜」和「完结」(W «grḥ»;D [grH]),v4 新登记的 `Gereh`(夜)就是它。
   「沉默」是 **gr**(W «gr»,F 290,Wb 5, 177)。
10. **`Senb`(70,同步 / 互关 / 连接)** —— snb 是「健康」(W «snb»,Wb 4, 158.2)。当初从 `Sema` 改过来,
    是因为与 `Sma`(smꜣ 杀)撞形;但「合、联」正是 **zmꜣ**(W «zmꜣ»,F 226,Wb 3, 445.15;D [smA] unite)。
    要避开撞形,可用 **dmḏ**「合并、汇总」(W «dmḏ»,F 313;D [dmD])或 **ẖnm**「联结」(W «ẖnm»)。
    `Per Senb`(医院)那一处是合本义的,不用动。
11. **`Shepet`(31,受刑)** —— špt 是「恼怒、不满」(D [Spt])。
    「惩罚」是 **ḫsft**(D [xsft] punishment,与已登记的 `Khesef` 同根)或 **jdryt**(D [idryt] punishment)。
12. **`Maakheru`(3,已读 / 未读 / 原文)** —— mꜣꜥ-ḫrw 是死者过了审判之后的称号「声音为真」(W «mꜣꜥ-ḫrw»)。
    在一个以称心审判为主题的系统里,这个词应当留给它本来的意思。「已读」可以就写 `Maa`(看)。
13. **`Shemes`(37,书信)** —— šms 是「跟随、侍奉」。信是 **šꜥt**(D [Sat] document;已登记为 `Shat` 邮件)、
    **mḏꜣt**(D [mDAt] letter, dispatch;已登记为 `Medjat`)、**wstj**(D [wsty] letter)。
14. **`Nehet`(139,申诉)** —— nḥt 是「祈祷」(D [nHt] prayer)。
    「申诉、请愿」是 **spr / sprt**(D [spr] appeal to, petition;[sprt] petition;[sprw] petitioner)。
    写出来要与 `Sep`(条 / 案)分开。
15. **`Netjer`(174,角色 / 人物)** —— nṯr 是「神」。把登录账号的角色叫作「神」,读的人会当成神职。
    「职位」是 **jꜣwt**(W «jꜣwt»,F 7–8),已登记为 `Iaut`(职能角色)。
16. **`Hesep`(14,层)与 `Redu`(7,分布)** —— ḥzp 是「园圃」(W «ḥzp»;D [Hsp] garden),
    而 rdw 恰好是「台阶、阶梯」(D [rdw] stairway, steps)。两个词像是放反了:
    「层」可以用 `Redu`;「份额、分布」是 **psšt**(D [psSt] sharing out, share, portion)。
17. **`Sedjem`(113,举报)** —— sḏm 是「听」。「告发、报告」是 **smj**
    (W «smj»,F 227:to inform on, to lodge a complaint against),已登记为 `Smi`,只用了 1 次。
18. **`Menmen`(38,太频繁 / 超时)** —— mnmn 是「移动、摇晃」(W «mnmn»,F 109)。
    「多出、过度」是 **ḥꜣw**(D [HAw] wealth, increase, excess)。
19. **`Emu`(78,现在)** —— 查不到。「今天、此刻」是 **mjn**(D [min] today)。
20. 其余查不到的:`Hemsu`(55,系统)、`Menf`(66,令牌)、`Bek`(11,导出)、`Khedu`(8,活动)、
    `Ates`(2)、`Sherer`(32,中国)。这几个概念古埃及语里本来就没有,造词无可厚非,
    但应当在词表里标成「造词」,不要和有出处的词根混在同一张表里。
    `Khabes`(12,灯)没有核到;查得到的是 **tkꜣ**「火炬、灯芯、火焰」(D [tkA])。

### 6.2 同一个东西两种写法

- **两真之殿**:`Weret Maaty` 17 次,`Wesekhet Maaty` 1 次。查得到的是后者(wsḫt nt mꜣꜥtj);
  前者字面是「两真的大者」,没查到用作厅名。建议统一成 `Wesekhet Maaty`。
- **影子**:`Shut`(羽)与 `Khaibit`(鬼 / 影)。Khaibit 像是 Budge 一系的旧转写(本轮没有查到它的出处),
  今天的转写是 šwt / šwyt(W «šwt»,F 262–263;D [Swyt] shadow, shade),与「羽」同形。
  如果为了避开同形而保留 Khaibit,应在词表里注明它是旧转写。

### 6.3 一个埃及词被拆成了两个 egy 词

写法不同,读的人会以为是两个词,其实词典里是同一个:

| egy 的两个词 | 是同一个 | 现在各自的意思 |
|---|---|---|
| Medu / Medew | mdw 话 | 词、帖子 / 事件、日志 |
| Khet / Ikhet | ḫt(jḫt)东西 | 事、之后 / 设备 |
| Gerh / Gereh | grḥ 夜 | 禁言 / 夜 |
| Hemes / Hems(/ Hemsu) | ḥmsj 坐、住 | 暂居 / 坐(/ 系统) |

只差一个字母、容易看混的两对不同的词:`Wedja`(wḏꜥ 裁断)/ `Wedj`(wḏ 命令),`Wat`(wꜣt 路)/ `Wet`(wt 裹缠)。

反过来,一个 egy 写法下并了两个埃及词的:`Per`(pr 房屋 / prj 出去)、`Iwn`(柱 / 颜色)、
`Shut`(羽 / 影)、`Hai`(喜 / 亥时)。

### 6.4 真词,但有一个义项没有依据

`Pet`(天)另作「类别」(`Pet Sep` 案件类型、`Pet Aq` 账号类别,`Pet-Sesh` 模板);
`Hetep`(安宁)另作「主题」;`Tepy`(第一)另作「开始」;`Djer`(界限、自从)作万能的时态标记;
`Er Hry`(向上)同时作「最小」「至少」「升」「右上角」;`Iu`(句首小词)作「是」和「或」;
`Mesqet`(天上的一处)作「矩阵」;`Sepdet`(天狼星)作「时戳」;`Djedu`(布西里斯)作「条文」。

### 6.5 体例

- 转写惯例前后一致的地方不必改:补 e、ḏ 写 Dj、ḫ 与 ẖ 都写 Kh、š 写 Sh。
  例外是几个不补元音的:`Dbh`、`Arrwt`、`Iwn`、`Pw`、`Swri`、`Hru`,与其余词的写法不是一套。
- 后缀代词 `-Ef` / `-Ek` / `-I` 是真的(.f / .k / .j),但这里只用阳性单数,
  也接在古埃及语里不会接的位置上。
- 词序是中文 / 英文的:按通行的中埃及语语法(Allen, *Middle Egyptian*,本轮没有翻查),古埃及语的形容词、指示词、属格都在名词后面(这一点 egy 多数时候碰巧是对的),
  而动词句是「动词 – 主语 – 宾语」,否定词在句首。egy 没有照这个来,也不必照,但说明里要讲清楚。

---

## 7. 这份报告没有做的

- 没有查 TLA,没有翻 Faulkner 与 Wb 的原页(见第 1 节)。F 与 Wb 的页码是转引。
- 没有核行星名。
- 没有逐键检查 30,759 处用法,只按词根看了每个词最短的几条文案与它们的中文。
  所以「真实」一类里,个别键的具体用法仍可能不合本义。
- 登记在词表里、但包里已经不用的词(`Sedja`、`Neb-Medu`、`Medu-Sesu`、`Per-Hemsu`)没有核。
- 没有改 `egy.json`、词根表或任何守卫测试。
