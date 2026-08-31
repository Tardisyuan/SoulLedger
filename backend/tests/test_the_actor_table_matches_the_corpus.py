"""live actor 与 seed 语料的差集,必须是**列出来的**,不是攒出来的。

115 实测(2026-08-31 之前):40 行 actor 在 seed 表里没有对应行,**每一行都恰好
挂着一个启用中的用户账号**。`consolidate_eu_pantheon` 一直在,也一直会正确地
报 ACTION REQUIRED —— **只是没有人做过那个 ACTION**。一个会说话的守卫和一个
没人听的守卫,在日志里长得一样。

`actors/0012` 处理了其中七行(`Maat` 合并进 `Ma'at`,六个不在 `EUROPEAN_ACTORS`
里的欧洲角色退役)。剩下 33 个埃及神祇是**刻意保留**的:它们是真实的埃及神,
只是不在四十二位陪审官或但丁语料的名单里 —— 用户 2026-08-31 的决定。

这个文件把那个决定写成可执行的:差集里出现一个没被列名的新名字,这里报红。
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.actors.mythology import (
    CHINESE_ACTORS,
    CIVILIZATION_ASSESSORS,
    EGYPTIAN_ACTORS,
    EUROPEAN_ACTORS,
    GREEK_ACTORS,
)

#: 真实存在、但不在语料名单里的埃及神。保留(用户 2026-08-31 决定)。
#:
#: 它们不是错误数据 —— 是四十二位陪审官之外的埃及万神殿。删掉会连带停用 33 个
#: 账号;纳入 seed 表则要为每一行补出处,而这个仓库对「没有出处的条目」是拒绝的。
KEPT_EGYPTIAN = {
    "Aah", "Aker", "Anat", "Anpu", "Aped", "Apuat", "Ba-Pef", "Babi", "Bastet",
    "Bes", "Ced", "Duamutef", "Geb", "Hapi", "Hathor", "Heka", "Hu", "Imsety",
    "Mafdet", "Neith", "Nekhbet", "Nut", "Ptah", "Qebehsenuef", "Satet",
    "Sebut", "Sekhmet", "Serket", "Set", "Shu", "Sia", "Tau", "Tefnut",
}


def _seeded_names():
    names = set()
    for table in (CHINESE_ACTORS, EGYPTIAN_ACTORS, EUROPEAN_ACTORS, GREEK_ACTORS):
        names |= {row[0] for row in table}
    for rows in CIVILIZATION_ASSESSORS.values():
        names |= {row["name"] for row in rows}
    return names


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


@pytest.mark.django_db
def test_a_fresh_database_has_nothing_but_the_corpus(seeded):
    """种子库里差集为空 —— 那 40 行是历史遗留,不是 seeder 产生的。"""
    live = {a.name for a in Actor.objects.filter(is_deleted=False)}
    extra = sorted(live - _seeded_names())
    assert extra == [], (
        f"`seed_mythology` 之后出现了语料里没有的 actor:{extra}"
    )


def test_the_kept_list_names_only_things_the_corpus_does_not_have():
    """保留名单不能和语料重叠 —— 重叠说明其中一句是假的。"""
    overlap = sorted(KEPT_EGYPTIAN & _seeded_names())
    assert overlap == [], (
        f"这些名字既在 KEPT_EGYPTIAN 里、又在语料里:{overlap}"
    )


def test_the_retired_european_six_are_not_in_the_corpus_either():
    """`actors/0012` 退役的六行,退役理由就是「语料不认」—— 断言那句是真的。

    如果哪天有人把 Lucifer 写进 `EUROPEAN_ACTORS`,这条会红,而那正是该重新
    审视那个迁移的时刻。
    """
    import importlib

    module = importlib.import_module(
        "apps.actors.migrations.0012_retire_the_pantheon_the_corpus_does_not_name"
    )
    seeded = _seeded_names()
    still_there = sorted(set(module.RETIRE) & seeded)
    assert still_there == [], (
        f"这些名字已经被 actors/0012 退役,却又出现在语料里:{still_there}"
    )
    assert module.MERGE[1] in seeded, (
        f"合并的目标 {module.MERGE[1]!r} 不在语料里 —— 那就不是正规行"
    )
    assert module.MERGE[0] not in seeded, (
        f"被合并掉的 {module.MERGE[0]!r} 在语料里 —— 那它不该被合并"
    )
