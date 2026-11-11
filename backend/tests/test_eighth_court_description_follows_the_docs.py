"""第八殿的界域描述只写文档列的罪目(审计 2026-11-11 D-02)。

`docs/01_地府整体架构.md` 的十殿表:第八殿「**不孝**(亲存不养、亲殁不葬)」;罪目枚举
(`apps/judgment/models.py`)归到第八殿的也只有 `NEGLECTING_PARENTS` / `UNBURIED_PARENTS` 两项。
`realms.py` 的描述曾多写一句「betrayal of one's own house」,文档与枚举都没有;用户规定以文档为准。

什么改动会让它红:把「betrayal」或别的不在文档里的罪名写回 `DY_COURT_08_DUSHI` 的描述;
改了描述却没改 `english.py` 里以描述为键的那一条(英文列会落成空);
或者罪目枚举给第八殿加了 / 减了一项而描述没跟着对一遍。
"""
from apps.actors.mythology.english import REALM_DESCRIPTION_EN
from apps.actors.mythology.realms import CHINESE_REALMS
from apps.judgment.models import OFFENCE_COURT, ChineseOffence

EIGHTH = next(row for row in CHINESE_REALMS if row[0] == "DY_COURT_08_DUSHI")
DESCRIPTION = EIGHTH[7]


def test_the_eighth_court_names_only_the_documented_offences():
    assert "betrayal" not in DESCRIPTION.lower()
    assert "unfilial" in DESCRIPTION
    assert "unkept in life" in DESCRIPTION and "unburied in death" in DESCRIPTION


def test_the_offence_enum_still_gives_the_eighth_court_exactly_these_two():
    eighth = {o for o, court in OFFENCE_COURT.items() if court == 8}
    assert eighth == {ChineseOffence.NEGLECTING_PARENTS, ChineseOffence.UNBURIED_PARENTS}


def test_the_english_column_follows_the_rewritten_description():
    english = REALM_DESCRIPTION_EN.get(DESCRIPTION)
    assert english and "betrayal" not in english.lower()
