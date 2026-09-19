"""种子里每个界域的 `name_egy` 等于 egy 语言包的 `realms.names.<code>`。

界域名的 egy 显示有两条来源：界域页读语言包 `realms.names`,处置与账本读数据库的
`Realm.name_egy`(`get_localized_name`)。两边曾各写一套 —— 2026-09-19 实测 43 个界域里
15 个对不上(`DuatEntry` 对 `Sebkhet Duat`、十殿只写王号等),同一界域在两个页面叫两个名字。
语言包是 egy 词表定稿的落地处，种子跟它走。注意是 `names`(全名),不是 `codes`(短名)。
"""
import json
from pathlib import Path

from apps.actors.mythology.realms import CHINESE_REALMS, EGYPTIAN_REALMS, EUROPEAN_REALMS, GREEK_REALMS

PACK = Path(__file__).resolve().parents[2] / "packages" / "core" / "messages" / "egy.json"


def test_every_seeded_realm_name_egy_is_the_language_pack_name():
    names = json.loads(PACK.read_text(encoding="utf-8"))["realms"]["names"]
    seeded = [row for table in (CHINESE_REALMS, EUROPEAN_REALMS, GREEK_REALMS, EGYPTIAN_REALMS) for row in table]
    assert len(seeded) > 40  # 不是空扫
    mismatched = {row[0]: (row[4], names.get(row[0])) for row in seeded if row[4] != names.get(row[0])}
    assert mismatched == {}
