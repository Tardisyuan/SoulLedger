# SoulLedger · 规范 v3 · 给 Design 的 egy 待审词(第二批，2026-10-08)

这一轮落地了两项功能：A11 缩短冷却申请和功过记录结构化。新增的 egy 文案都由词表里已有的词组成，没有新增词根，词表守卫也已通过;但这些组合是我们自己拼的，还没经 Design 认可。请逐条审一遍。

格式要求照旧：
- 只用词表里的词;
- 每个词首字母大写;
- 不用撇号，也不用全大写;
- `{{…}}` 占位符原样保留。

## 一、A11 缩短冷却申请

| key | 中文 | English | 现用 egy |
|---|---|---|---|
| soul_app.cooldown.brought_forward | 已提前 | Brought forward | Khebi Seth |
| soul_accounts.cooldown.remaining_progress | 已过 {{past}} / 共 {{total}} 天 | {{past}} of {{total}} days passed | Hru {{past}} Khetem Seth Em {{total}} |
| soul_accounts.cooldown.approve_with_days | 批准 · 还需 {{days}} 天 | Approve · {{days}} days left | Hesy · Hru {{days}} Khery |
| soul_accounts.cooldown.scope_note | 批准只提前这一段冷却；殿的冷却天数不变 | Approval only shortens this cooling-off period; the hall's setting is unchanged | Hesy Khebi Ahet Qebeh Pen Wa; Hru Ahet Qebeh En Per Nen Menmen |
| soul_accounts.cooldown.sort_note | 待决定按剩余冷却从少到多；冷却已结束的排最后 | Pending sorted by days left; ended cooling-off last | Em Wedja Em Ahet Qebeh Khery Khebi Tepy; Ahet Qebeh Khetem Em Pehwy |
| soul_accounts.cooldown.source | 冷却来自转生申请 {{id}} 的终局驳回 | Cooling-off from the final rejection of {{id}} | Ahet Qebeh In Khesef Pehwy En Dbh Wehem Mesut {{id}} |
| soul_accounts.cooldown.decide_failed | 未能决定：{{reason}} | Could not decide: {{reason}} | Nen Wedja: {{reason}} |
| soul_accounts.cooldown.original | 原 {{date}} | was {{date}} | Tepy {{date}} |
| soul_accounts.cooldown.day_unit | 天 | days | Hru |

请特别看两处：
- 「原 {{date}}」用的是 Tepy(第一 / 起初),表示「原来的日期」是否妥当?
- source 一句用了全称「Dbh Wehem Mesut」。这一句属于官员台的详情页，按第四节 Dbh 政策是否应该只写「Dbh」?

## 二、功过记录结构化

| key | 中文 | English | 现用 egy |
|---|---|---|---|
| souls.life_stages.CHILDHOOD | 童年 | Childhood | Ankh Nedjes |
| souls.life_stages.YOUTH | 少年 | Youth | Ankh Renpi |
| souls.life_stages.ADULTHOOD | 壮年 | Adulthood | Ankh Remetj |
| souls.life_stages.OLD_AGE | 老年 | Old age | Ankh Wah |
| souls.evidence_sources.REGISTRY | 司录 | Registry | Sesh Sab |
| souls.evidence_sources.WITNESS | 证人 | Witness | Remetj Maa |
| souls.evidence_sources.SELF_ACCOUNT | 自述 | Self-account | Medu Djes |
| souls.evidence_sources.OTHER | 其他 | Other | Ky |

请特别看三处：
- 四个人生阶段统一以 Ankh(生命)开头，第二个词取「小 / 年轻 / 人 / 久长」之意。是否成立?
- 「Ankh Remetj」读出来更像「人的生命」,不像「壮年」,有没有更好的写法?
- 「司录」用 Sesh Sab(判官的书写),与第五批里「户籍」用的 Sesh Remetj 是否需要区分得更开?

请在回复里给出每条的最终 egy 和理由。如果某条需要新增词根，请注明它进词表的哪一节。
