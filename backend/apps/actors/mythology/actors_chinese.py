"""The cast of Diyu — the ten kings and the officers of the courts.

Moved verbatim out of ``seed_mythology.py``.

Cross-references in the comments below ("above", "below", "this file") were
written when every table in this package was one module; see the package
docstring in ``apps/actors/mythology/__init__.py``. Every table they name is
importable from that package.
"""
from apps.actors.models import ActorRole

# --------------------------------------------------------------------------
# Actors
# Fields: name, name_zh, name_en, name_egy, role, realm_code,
#         title, title_zh, title_en, title_egy, description
#
# COURT NUMBERING — canon, decided. The standard 十殿阎罗 ordering is the one
# source of truth for which king sits in which court:
#
#   1 秦广王  2 楚江王  3 宋帝王  4 五官王  5 阎罗王
#   6 卞城王  7 泰山王  8 都市王  9 平等王  10 转轮王
#
# Two other places in this repo already spell it that way — apps/org's
# init_organizations (DIYU_05=阎罗王, DIYU_09=平等王, DIYU_10=转轮王) and
# apps/workflow/services.py's 十殿审判流程 template. This file and
# seed_chinese_data.py were the two that disagreed (阎罗王 as 十殿阎王, 转轮王 as
# 第九殿, 平等王 as 第十殿); they now match. A third opinion used to live in
# populate_chinese_actors, which rewrote the titles at runtime — that command
# is gone (see the judicial-personnel note below).
# tests/test_seed_mythology.py::test_ten_kings_carry_their_canonical_court_number
# locks the mapping so it cannot drift again.
#
# The realm a king sits in is no longer a separate axis. It used to be — there
# were fewer seeded realms than courts, so 秦广王 and 楚江王 shared one row and
# the court number lived in the title only, which is how DY_10_YAMA came to be
# called 第十殿 while its resident 阎罗王 is the fifth court. CHINESE_REALMS now
# carries one DY_COURT_NN row per court, each king sits in his own, and
# test_seed_mythology asserts king N is in DY_COURT_NN and nowhere else.
# --------------------------------------------------------------------------
CHINESE_ACTORS = [
    ("阎罗王", "阎罗王", "Yama King", "Yanluo", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "第五殿阎罗王", "第五殿阎罗王", "Fifth Court Yama", "Yanluo",
     "Fifth court judge - the best-known of the ten kings. He sat at the first "
     "court and was demoted here for leniency, by his own account: 「吾本前居第一"
     "殿，因憐屈死，屢放還陽伸雪；降調司掌…叫喚大地獄、並十六誅心小地獄」. His "
     "court tries the intent behind the act, and the 望乡台 stands in it"),
    ("秦广王", "秦广王", "Qinguang Wang", "Qinguang", ActorRole.JUDGE, "DY_COURT_01_QINGUANG",
     "第一殿秦广王", "第一殿秦广王", "First Court Qinguang", "Qinguang",
     "First court judge - evaluates the Ledger of Life and Death"),
    # FOUR OF THESE DESCRIPTIONS CONTRADICTED THE COURT THEY SIT IN. The realm
    # rows above were right in *those four* cases and the actor rows had never
    # been updated to match, so the same court described itself two ways
    # depending on which table you read.
    #
    # A FIFTH ROW WAS WRONG AND THIS PASS COULD NOT SEE IT. 阎罗王 above said
    # "tries the gravest sins" and so did DY_COURT_05_YANLUO, so the two tables
    # agreed and the row looked settled. They were agreeing on something neither
    # of them had a source for: 阿鼻 — the deepest hell — is the ninth court, as
    # the ninth realm row says on its own line. Agreement between two rows is
    # not evidence when nothing checked either against 《玉历》; the method that
    # caught the four could not catch the fifth, because it was looking for
    # disagreement. 楚江王 "awards merit for good deeds" against a
    # 活大地狱; 卞城王 "manages reincarnation scheduling", which is the *tenth*
    # king's work and the one thing the sixth court does not do; 都市王 "judge
    # of merchants and craftsmen", reading 「都市」 as a marketplace when it is
    # the capital and his docket is unfilial conduct; 泰山王 "judge of the
    # mountains", which borrows 泰山府君 and is not what 《玉历》 gives the
    # seventh court. All four now say what their own realm row says.
    ("楚江王", "楚江王", "Chujiang Wang", "Chujiang", ActorRole.JUDGE, "DY_COURT_02_CHUJIANG",
     "第二殿楚江王", "第二殿楚江王", "Second Court Chujiang", "Chujiang",
     "Second court judge - presides over 活大地狱, the mildest punishment court: "
     "abduction, appropriating what belongs to others, maiming"),
    ("宋帝王", "宋帝王", "Songdi Wang", "Songdi", ActorRole.JUDGE, "DY_COURT_03_SONGDI",
     "第三殿宋帝王", "第三殿宋帝王", "Third Court Songdi", "Songdi",
     "Third court judge - presides over 黑绳大地狱: defying one's elders, "
     "inciting litigation, betraying a trust"),
    ("五官王", "五官王", "Wuguan Wang", "Wuguan", ActorRole.JUDGE, "DY_COURT_04_WUGUAN",
     "第四殿五官王", "第四殿五官王", "Fourth Court Wuguan", "Wuguan",
     "Fourth court judge - presides over 合大地狱: withholding grain tax and rent, "
     "fraud in trade"),
    ("卞城王", "卞城王", "Biancheng Wang", "Biancheng", ActorRole.JUDGE, "DY_COURT_06_BIANCHENG",
     "第六殿卞城王", "第六殿卞城王", "Sixth Court Biancheng", "Biancheng",
     "Sixth court judge - presides over 大叫唤大地狱: sacrilege against images "
     "and scriptures, irreverence toward heaven and earth"),
    ("泰山王", "泰山王", "Taishan Wang", "Taishan", ActorRole.JUDGE, "DY_COURT_07_TAISHAN",
     "第七殿泰山王", "第七殿泰山王", "Seventh Court Taishan", "Taishan",
     "Seventh court judge - presides over 热恼大地狱: taking bones for medicine, "
     "and the scattering of kin from one another"),
    ("都市王", "都市王", "Dushi Wang", "Dushi", ActorRole.JUDGE, "DY_COURT_08_DUSHI",
     "第八殿都市王", "第八殿都市王", "Eighth Court Dushi", "Dushi",
     "Eighth court judge - presides over 大热恼大地狱: unfilial conduct, the "
     "parent left unkept in life and unburied in death. 「都市」 is the capital, "
     "not a marketplace"),
    ("平等王", "平等王", "Pingdeng Wang", "Pingdeng", ActorRole.JUDGE, "DY_COURT_09_PINGDENG",
     "第九殿平等王", "第九殿平等王", "Ninth Court Pingdeng", "Pingdeng",
     "Ninth court judge - presides over 阿鼻大地狱, the deepest hell: murder, arson, "
     "poisoning, the gravest crimes"),
    ("转轮王", "转轮王", "Zhuanlun Wang", "Zhuanlun", ActorRole.JUDGE, "DY_COURT_10_ZHUANLUN",
     "第十殿转轮王", "第十殿转轮王", "Tenth Court Zhuanlun", "Zhuanlun",
     "Tenth court - the wheel of rebirth; assigns fate for the next life"),
    # 孟婆 MOVED FROM THE HOLDING PEN TO THE TENTH COURT. 《玉历宝钞》
    # 「孟婆神」 places her 醧忘台 「居第十殿，冥王殿前六桥之外」 — the tenth
    # court, outside the six bridges before the king's hall — and the broth is
    # drunk after sentence, on the way to the next life. Seating her at
    # DY_00_PURGATORY had her erasing a soul's memory of the life it was about
    # to be tried for. DY_COURT_10_ZHUANLUN's own description already said this
    # ("the broth of forgetting drunk"), so the two tables disagreed about the
    # same act.
    ("孟婆", "孟婆", "Meng Po", "Mengpo", ActorRole.CONDUIT, "DY_COURT_10_ZHUANLUN",
     "孟婆", "孟婆", "Meng Po", "Mengpo",
     "The Meng Po - keeps the 醧忘台 at the tenth court, 「居第十殿，冥王殿前六桥"
     "之外」, and serves the broth of forgetting to souls already sentenced and "
     "bound for the next life"),
    # 牛头/马面 stay in the holding pen. 《玉历》 shows them at the fifth court
    # 「牛头、马面，押赴高台」, escorting the condemned up the 望乡台, but escort
    # duty is by nature not confined to one court and the fifth court is the one
    # place the text happens to name them. Recording that in the description is
    # what the source supports; moving the rows would assert a posting the text
    # does not give them either.
    ("牛头", "牛头", "Ox Head", "Niutou", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "牛头马面", "牛头马面", "Ox Head and Horse Face", "Niuma",
     "Ox Head - one of the two guardians who escort the dead. 《玉历》 names the "
     "pair at the fifth court, 「牛头、马面，押赴高台」, marching the condemned up "
     "the 望乡台; the escort itself runs across all ten courts"),
    ("马面", "马面", "Horse Face", "Mamian", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "马面", "马面", "Horse Face", "Mamian",
     "Horse Face - companion guardian of the underworld dead; see 牛头 for the "
     "fifth-court 望乡台 escort 《玉历》 names them in"),
    ("白无常", "白无常", "White Impermanence", "Bai Wuchang", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "白无常", "白无常", "White Wuchang", "BaiWuchang",
     "White Impermanence (七爷 谢必安) - captures wandering souls, brings gentle death"),
    ("黑无常", "黑无常", "Black Impermanence", "Hei Wuchang", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "黑无常", "黑无常", "Black Wuchang", "HeiWuchang",
     "Black Impermanence (八爷 范无救) - captures wicked souls with chains of darkness"),
    ("判官", "判官", "Registrar", "Panguan", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "判官", "判官", "Clerk-Registrar of the Dead", "Panguan",
     "Registrars who compile and verify the Book of Life and Death"),
    # 钟馗 IS KEPT AND LABELLED, NOT REMOVED. He does not appear anywhere in
    # 《玉历宝钞》, so nothing in the ten-court system gives him a torture-chamber
    # post; "assists in torture" was a modern popular reading written as if it
    # were canon. His attested character is the opposite end of the business —
    # 驱邪捉鬼, hunting malignant ghosts and warding a household, from 沈括
    # 《梦溪笔谈·补笔谈》卷三 (Wu Daozi's painting, Xuanzong's dream) and the
    # Dunhuang Tang manuscript 《除夕钟馗驱傩文》, both New Year exorcism
    # material. Removing him would delete a real figure over a placement error;
    # what the data owed was the note that he is not part of this system.
    ("钟馗", "钟馗", "Zhong Kui", "Zhongkui", ActorRole.EXECUTOR, "DY_COURT_05_YANLUO",
     "钟馗", "钟馗", "Zhong Kui - Demon Queller", "Zhongkui",
     "Demon queller - hunts malignant ghosts and wards the household (沈括 "
     "《梦溪笔谈·补笔谈》卷三; Dunhuang 《除夕钟馗驱傩文》). NOT A 《玉历宝钞》 "
     "FIGURE: he appears nowhere in that text and holds no office in the ten "
     "courts. His pairing with the 罚恶司 of the 四大判官 is a late popular "
     "attribution, and this row is filed at the fifth court for want of a "
     "posting, not on a source"),
    # Named judicial personnel beyond the ten kings. These three used to live in
    # a separate `populate_chinese_actors` command that could never run: it
    # defined a bare `run()` instead of a `Command` class, so `manage.py
    # populate_chinese_actors` died on AttributeError, and it did
    # `sys.path.insert` + `django.setup()` at import time against a hardcoded
    # path from somebody else's machine. The three rows were therefore
    # unreachable from any supported entry point while the rest of the app went
    # on referencing them — apps/org's init_organizations files 崔珏（崔府君）and
    # 魏征 as 四大判官 org units, apps/workflow/services.py opens the 申诉审判流程
    # appeal template with a 魏征 · 察查司 node (mirrored in the frontend's
    # workflow-templates.ts), and apps/perm/migrations/0015 names 地藏 as the
    # Chinese analogue of Osiris when describing the per-civilization overseer
    # role. They are canon; they now seed here like everything else.
    #
    # Realms match on realm_code, not on the display strings the old command
    # looked up. It searched for `name_zh='阎罗殿'` and `name_zh='齐世寺'` and
    # degraded to realm=None when it missed — and both of those rows are now
    # gone, renamed by the DY_COURT_NN restructure above, so a display-name
    # lookup would today attach all three to nothing. 阎罗殿 became
    # DY_COURT_05_YANLUO and 齐世寺's kings moved to DY_COURT_01_QINGUANG.
    # 地藏王's own seat in the source material (莲花台 / 九华山) is not a realm
    # this system models, so he keeps the court he was filed under rather than
    # getting one invented for him.
    ("魏征", "魏征", "Wei Zheng", "Weizheng", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "察查司正堂", "察查司正堂", "Head of the Appeals Court", "Weizheng",
     "Head of the 察查司 - audits wrongful convictions and overturns a king's "
     "misjudgment; the opening node of the Chinese appeal workflow. 察查司 is "
     "this system's term, not a classical office: 魏征 appears in the underworld "
     "narrative of 《西游记》 ch. 10 as a living chancellor writing to 崔珏, not "
     "as a seated judge, and the popular four-registrar lists that do place him "
     "usually give him the 赏善司 instead"),
    ("崔府君", "崔府君", "Cui Fujun", "Cuifujun", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "崔判官", "崔判官", "Cui the Registrar", "Cuifujun",
     "崔珏 - senior registrar and judge of the underworld courts; keeps the "
     "Ledger of Life and Death and assists the Ten Kings"),
    ("地藏王菩萨", "地藏王菩萨", "Ksitigarbha", "Dizang", ActorRole.OVERSEER, "DY_COURT_01_QINGUANG",
     "地藏王菩萨", "地藏王菩萨", "Ksitigarbha Bodhisattva", "Dizang",
     "Bodhisattva of the Great Vow - 地狱不空，誓不成佛. Delivers souls out of "
     "the hells; relief path for wrongful deaths and those in the torture chambers"),
    # 酆都大帝 — the Daoist / folk head of the underworld, the ten kings' superior
    # (docs/01_地府整体架构.md 「主管阴间行政与审判」; docs/02_地府人物详解.md §一).
    # Seeded so the final node of the appeal and cross-realm flows and the
    # emergency preset's 直审 name somebody (apps/workflow/templates.py). JUDGE,
    # not OVERSEER: what the system asks of him is the last decision on a case,
    # and only JUDGE sits a decision seat (apps/dispatch/services.py).
    # The appeal ladder itself is this system's own (docs/11 §3.2: 「查无出处」,
    # and 《玉历》 does not have him try cases); the row records the Daoist
    # pantheon the docs hold, not a 《玉历》 office.
    # REALM IS A COMPROMISE, the same one 地藏王菩萨 above makes: his seat, 罗酆山 /
    # 酆都城, is not a realm this system models, so he is filed at the intake
    # court rather than getting a realm invented for him.
    ("酆都大帝", "酆都大帝", "Emperor of Fengdu", "Fengdu", ActorRole.JUDGE, "DY_COURT_01_QINGUANG",
     "北阴酆都大帝", "北阴酆都大帝", "Great Emperor of Fengdu", "Fengdu",
     "北阴大帝 - head of the whole underworld from 罗酆山 (酆都城), superior of the "
     "ten kings in the Daoist pantheon; hears the last instance of an appeal"),
    # ------------------------------------------------------------------
    # THE 2026-10-28 ADDITIONS (owner's decision). Every row below is a figure
    # docs/01_地府整体架构.md and docs/02_地府人物详解.md already list and the
    # seed did not have. None of them is a 《玉历宝钞》 office; the docs file them
    # under the Daoist / folk pantheon and say so, and the descriptions carry the
    # same caveats the docs do rather than upgrading them.
    #
    # REALMS ARE COMPROMISES, THE SAME ONES 地藏王菩萨 AND 酆都大帝 MAKE. None of
    # 罗酆山, 泰山, 桃止山, 嶓冢山, 罗浮山, 抱犊山 or 鬼门关 is a realm this system
    # models, and no realm was invented for them:
    #   * the supreme deities (后土, 东岳) and 地藏's mount 谛听 go to the intake
    #     court, where 地藏 and 酆都大帝 already stand;
    #   * 鬼门关 is the passage from the living world into the underworld, before
    #     any court — the nearest modelled place is DY_00_PURGATORY, so the gate
    #     pair 神荼/郁垒 stands there, and so do the four other 鬼帝 (their
    #     mountains are not modelled either) and the 鬼差 who work the arrest
    #     side, beside 牛头马面 and 黑白无常.
    #
    # ROLES. 后土 and 东岳 are OVERSEER like 地藏: neither tries a case, and the
    # docs give them none. Of the 五方鬼帝, the gate pair is GUARDIAN; the other
    # four 「管辖」 a quarter's ghost domain, which is OVERSEER's meaning in this
    # schema (administration of a realm). 陆判 is JUDGE beside 崔府君. 谛听 is
    # GUARDIAN as the least-wrong value, the same compromise Ma'at carries: it
    # discerns true from false testimony and decides nothing, and ActorRole has
    # no word for that. 枷锁将军 is GUARDIAN with 牛头马面 (custody, not
    # punishment). 日游神/夜游神 are CONDUIT with 黑白无常: they work the living
    # world's side; for 日游神, whose doc line is patrol-and-record, CONDUIT is
    # again the least-wrong value.
    #
    # 五方鬼帝 ARE SIX ROWS. docs/02 §二 lists two eastern emperors (神荼 and 郁垒
    # together hold 鬼门关 — 「特有配置」, docs/01 第二层). Where the docs give two
    # candidates for one seat (赵文和/王真人, 张衡/杨云), the row takes the first
    # and the description names the second; 中央鬼帝 is the docs' 周文, whose name
    # the docs themselves call disputed.
    # ------------------------------------------------------------------
    ("后土", "后土", "Houtu", "Houtu", ActorRole.OVERSEER, "DY_COURT_01_QINGUANG",
     "后土皇地祇", "后土皇地祇", "Sovereign Earth Goddess", "Houtu",
     "后土皇地祇 - source of both the living and the dead, keeper of birth, death "
     "and rebirth, of the earth and the underworld; one of the Daoist 四御, "
     "called 「大地之母」 and held to be the underworld's founder (docs/01 第一层; "
     "docs/02 §一.1). Above 酆都大帝 and 东岳大帝 in the docs' ordering. REALM IS A "
     "COMPROMISE: she has no seat this system models, so she is filed at the "
     "intake court beside 地藏王菩萨 and 酆都大帝"),
    ("东岳大帝", "东岳大帝", "Emperor of the Eastern Peak", "Dongyue", ActorRole.OVERSEER,
     "DY_COURT_01_QINGUANG",
     "东岳泰山天齐仁圣大帝", "东岳泰山天齐仁圣大帝", "Great Emperor of Mount Tai", "Dongyue",
     "泰山神 - holds authority over the birth of all things and protects the souls "
     "going round the wheel of rebirth; very high in popular cult (docs/01 第一层; "
     "docs/02 §一.3). NOT 泰山王: the seventh court's king is a different seat, "
     "and that row's own note records that 《玉历》 does not give the seventh "
     "court Mount Tai. REALM IS A COMPROMISE: Mount Tai is not a modelled realm"),
    ("谛听", "谛听", "Diting", "Diting", ActorRole.GUARDIAN, "DY_COURT_01_QINGUANG",
     "谛听", "谛听", "Diting - Mount of Ksitigarbha", "Diting",
     "地藏王菩萨's mount - discerns true from false in a soul's testimony and helps "
     "deliver the dead; white, between dog and lion in form (docs/02 §一). A "
     "subordinate, not a deity in its own right, and a figure of Chinese folk "
     "tradition and 《西游记》, not of Buddhist scripture - the docs say so. Filed "
     "with 地藏 at the intake court. GUARDIAN is the least-wrong role: it decides "
     "nothing"),
    ("神荼", "神荼", "Shentu", "Shentu", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "东方鬼帝", "东方鬼帝", "Ghost Emperor of the East", "Shentu",
     "Ghost Emperor of the East - holds 鬼门关 on 桃止山 and drives out malignant "
     "ghosts; with 郁垒 one of the two ancient door gods who bind ghosts with reed "
     "rope (docs/02 §二, which gives 《山海经》 as the earliest record). 鬼门关 is "
     "not modelled; filed at the holding pen, the nearest place before the first "
     "court"),
    ("郁垒", "郁垒", "Yulei", "Yulei", ActorRole.GUARDIAN, "DY_00_PURGATORY",
     "东方鬼帝", "东方鬼帝", "Ghost Emperor of the East", "Yulei",
     "Ghost Emperor of the East - keeps 鬼门关 together with 神荼; the east is the "
     "one quarter with two emperors (docs/01 第二层; docs/02 §二). Placement as "
     "for 神荼"),
    ("赵文和", "赵文和", "Zhao Wenhe", "Zhaowenhe", ActorRole.OVERSEER, "DY_00_PURGATORY",
     "西方鬼帝", "西方鬼帝", "Ghost Emperor of the West", "Zhaowenhe",
     "Ghost Emperor of the West - governs the western ghost domain from 嶓冢山 "
     "(docs/02 §二). The seat has a second candidate, 王真人; the docs list both. "
     "嶓冢山 is not modelled; filed at the holding pen"),
    ("杜子仁", "杜子仁", "Du Ziren", "Duziren", ActorRole.OVERSEER, "DY_00_PURGATORY",
     "南方鬼帝", "南方鬼帝", "Ghost Emperor of the South", "Duziren",
     "Ghost Emperor of the South - governs the southern ghost domain from 罗浮山 "
     "and subdues violent souls (docs/02 §二). 罗浮山 is not modelled; filed at "
     "the holding pen"),
    ("张衡", "张衡", "Zhang Heng", "Zhangheng", ActorRole.OVERSEER, "DY_00_PURGATORY",
     "北方鬼帝", "北方鬼帝", "Ghost Emperor of the North", "Zhangheng",
     "Ghost Emperor of the North - sits at 罗酆山 in 酆都 and keeps the underworld's "
     "punishments (docs/02 §二). The seat has a second candidate, 杨云; the docs "
     "list both. 罗酆山 is not modelled; filed at the holding pen"),
    ("周文", "周文", "Zhou Wen", "Zhouwen", ActorRole.OVERSEER, "DY_00_PURGATORY",
     "中央鬼帝", "中央鬼帝", "Ghost Emperor of the Centre", "Zhouwen",
     "Ghost Emperor of the Centre - on 抱犊山, coordinates the other four quarters "
     "and keeps the balance of yin and yang (docs/02 §二). The docs record few "
     "sources for this seat and call its holder's name disputed. 抱犊山 is not "
     "modelled; filed at the holding pen"),
    # 陆判 — the fourth of the 「四大判官」, which docs/01 第四层 and docs/02 §四
    # call a modern folk compilation. The name is 陆判, not 陆之道: 《聊斋志异·陆判》
    # says only 「陆判」「陆公」, and 陆之道 is a later folk name (docs/02 §四). The
    # 阴律司 office has no source either and appears in neither the 城隍 24 司 nor
    # the 东岳庙 76 司 lists; the description says so. Same court as 崔府君 and 魏征.
    ("陆判", "陆判", "Judge Lu", "Lupan", ActorRole.JUDGE, "DY_COURT_05_YANLUO",
     "陆判官", "陆判官", "Judge Lu", "Lupan",
     "Underworld judge of 《聊斋志异·陆判》, where the text calls him only 陆判 or "
     "陆公 (the name 陆之道 is a later folk addition). Popular lists of the 四大判官 "
     "give him the 阴律司, revising the underworld's laws - an office with no "
     "source, absent from the 城隍 twenty-four bureaus (docs/02 §四)"),
    ("枷锁将军", "枷锁将军", "General of Cangue and Chains", "Jiasuo", ActorRole.GUARDIAN,
     "DY_00_PURGATORY",
     "枷锁将军", "枷锁将军", "General of Cangue and Chains", "Jiasuo",
     "Puts the cangue and chains on the dead so they cannot escape; has charge of "
     "the gravest offenders (docs/01 第五层; docs/02 §六). Custody rather than "
     "punishment, so GUARDIAN with 牛头马面"),
    ("日游神", "日游神", "Day Patrol God", "Riyou", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "日游神", "日游神", "Day Patrol God", "Riyou",
     "Patrols the living world by day and records good and evil (docs/01 第五层; "
     "docs/02 §六). CONDUIT with 黑白无常 as the least-wrong role: ActorRole has no "
     "term for patrol-and-record"),
    ("夜游神", "夜游神", "Night Patrol God", "Yeyou", ActorRole.CONDUIT, "DY_00_PURGATORY",
     "夜游神", "夜游神", "Night Patrol God", "Yeyou",
     "Patrols the living world by night and seizes wandering souls (docs/01 第五层; "
     "docs/02 §六) - the arrest side of the underworld, with 黑白无常"),
]
