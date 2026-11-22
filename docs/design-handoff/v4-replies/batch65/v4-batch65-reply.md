# v4 · 第六十五批 · 回复：35 个 egy 词

**交付文件：**

| 文件 | 内容 |
|---|---|
| `v4-batch65-egy.json` | 35 个键，扁平键 → egy |
| `_egy_lexicon.tsv` | 7710 行：改 3 行，追加 32 行 |
| `v4-batch65-reply.md` | 本回复 |

**新词根：没有。**35 条都只用词表里已有的词，逐词核过。

## 词表里改的 3 行

`auth.error_attempts_body`、`auth.error_locked_body`、`auth.error_locked_title` 三个键早就在词表里，但那是旧文案（「锁 {{m}} 分钟」「或请管理员解锁」「账号已锁」）。第五十批把锁定改成了「递增等待、到时直接登录」，egy 跟着现行文案重写，词表的英文列也换成现行的。

## 逐条

| 键 | egy | 说明 |
|---|---|---|
| `audit.civilization_halls` | Wesekhet Neb Taui Pen | 「本文明的各殿」 |
| `audit.stats.scope_civilization` | Wesekhet Neb Taui Pen · Sesh Neb · Sep {{count}} | 「全部历史」写成 Sesh Neb（全部记录） |
| `auth.account_or_email_hint` | Djeret: Smen Em Djes, Er Khet Aq. | 「邮箱：在个人中心验证，然后才能登录」 |
| `auth.error_attempts_body` | Wehem Iri: Sep {{n}}. Er Khet: Smen, {{m}} At Er Pehwy. | 「最长 m 分钟」用 Er Pehwy，同 `judgment.claim.batch_limit` |
| `auth.error_locked_body` | Sep Hau Nen Maat. Er Khet {{time}}: Aq. Nen Iri Ky. | 「到时直接登录，别的不用做」 |
| `auth.error_locked_title` | Aq Smen | 「暂停」用 Smen，同 `soul_app.errors.soul_recycled`；不用 Khetem，因为它不是终止 |
| `dashboard.todo.reassign_requests` | Dbh Hab Ky | Hab Ky 是改派，同 `judgment.claim.reassign` |
| `dispatch.frozen` | Hab-Ba Hena Wedja Taui Ky: Smen-N (Hemsu Em Iri). Er Khet Wen: Wehem Iri. | 「系统维护中」写成 Hemsu Em Iri（系统正在做事） |
| `judgment.wangsi.filed_at` | Hru Hab | 同 `appeals.col.filed_at` |
| `judgment.wangsi.queue_hint` | Chenghuang Djes Wa: Sepret Nen Wedja Djer. Wen Ren Ba, Er Wedja. | 中文原文有「你名下」；官员一侧 egy 不用 -I，写成「本人名下的城隍」（Djes Wa） |
| `officer_app.bio_login.button` | Aq Em {{bio}} | |
| `officer_app.bio_login.enable_body` | Sesh Sekhem Min, Er Khet Maa {{bio}}. | 「当前密码」写 Sekhem Min，不用 Sekhem-Ek |
| `officer_app.bio_login.expired` | Medjat Pen: Aq Em {{bio}} Khetem-N. Sesh Sekhem. | |
| `officer_app.bio_login.failed` | {{bio}}: Nen Rekh. Sesh Sekhem. | 同官员端 `biometric.off_failed` 的写法 |
| `officer_app.bio_login.locked` | {{bio}}: Sep Hau. Medjat Smen-N. Sesh Sekhem, Mi Wehem Iri Er Khet. | 「或」用 Mi，同 `soul_app.scan.denied_body` |
| `officer_app.bio_login.prompt_login` | Aq: Nen Sekhem. | |
| `officer_app.bio_login.prompt_unlock` | Wen Medjat Ba. | 同灵魂端 `biometric.prompt_unlock` |
| `officer_app.bio_login.row_unavailable` | Nen Djes Em Medjat Pen | 同灵魂端 `bio.row_unavailable` |
| `officer_app.bio_login.toggle_failed` | Nen Wen. Wehem Iri Er Khet. | |
| `officer_app.bio_login.wrong_password` | Sekhem Min Nen Maat | |
| `officer_app.login.email_hint` | Djeret: Smen Em Djes, Er Khet Aq. | 与网页那条同一句；「网页的」没有单独写进 egy |
| `officer_app.search.first_only` | {{n}} Tepy Wa | 「只前 n 件」 |
| `official_notify.sentence_request_not_filed.body` | {{tenant}}: Wedja Semawy Sekhet «{{soul}}» Khetem-N, Dbh Semawy Sekher. Sekher Em Dbh Nen Wedja Djer, Mi Nen Shesep Semawy: Nen Hab-N. Henen: Dbh Wehem. | 修正审判 = Wedja Semawy Sekhet，同 `sentence_plan.amend.hint` |
| `….body_by_civ.cn` | （同上） | egy 里去处计划与受刑计划同为 Sekher（词表里本来就是这样），两条一样 |
| `….title` | Wedja Semawy Sekhet: Semawy Sekher Nen Hab-N | |
| `….title_by_civ.cn` | （同上） | |
| `scheduler.jobs.sharding_relay_outbox` | Hab Medu Taui Ky Em Smen | 「发出在等的跨文明消息」 |
| `scheduler.jobs.sharding_sync_shards` | Demedj Sesh Taui Neb | 「同步各文明的记录」；「分库」没有专词，用 Sesh（记录） |
| `social_moderation.scope_civilization` | Wesekhet Neb Taui Pen | 同 `audit.civilization_halls` |
| `soul_app.login.email` | Djeret | 「联系」不另写 |
| `soul_app.login.email_hint` | Djeret Smen · Per Wa, Djeret Wa: Aq Em Ren Hesb Ba | 「一家一个邮箱」写成 Per Wa, Djeret Wa |
| `soul_app.login.reset_filled` | ✓ Ren Hesb Ba-Ek: Gem-N | 灵魂一侧，可以用 -Ek |
| `soul_app.login.use_code` | Aq Em Ren Hesb Ba | |
| `soul_app.login.use_email` | Aq Em Djeret | |
| `users.roles.SYSTEM_ADMIN` | Sab Hery Hemsu | 与 `users.roles.ADMIN`（Iaut Em Tepy）分开 |

## 拿不准的

- **`dispatch.frozen` 里的「维护」：**词表里没有「维护」，用的是 Hemsu Em Iri（系统正在做事）。如果想说得更清楚，可以加新词根，我建议先这样用。
- **`scheduler.jobs.sharding_sync_shards` 里的「分库」：**同上，用 Sesh（记录）代替。这是后台任务名，只有管理员看得到，够用。

**检查：**

- 占位符逐键和英文对过，一致；`«{{soul}}»` 照 egy 里引名字的习惯加了书名号。
- egy 都是词表里已有的词。
- 官员一侧（除 `soul_app.login.*` 外的 31 个键）没有 -Ek / -I。
