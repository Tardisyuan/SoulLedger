"""但丁的 Pluto 与希腊的 Hades 是两行,没有任何一条路径把他们收回一行。

**这条线在这个仓库里被弄反过一次,所以判据要写清楚。**

2026-08-04 `consolidate_eu_pantheon` 把欧洲的 Pluto 行软删了,理由是「Pluto 是
Hades 的另一个名字」。那条考据本身是对的:Πλούτων 是 Ἅιδης 的希腊祭仪称号,
出自 πλοῦτος「财富」(柏拉图《克拉底鲁》403a),拉丁 Pluto 是它的转写;罗马自己的
冥神是 Dis Pater 与 Orcus。

**用错的地方是:这份阵容不是希腊阵容。** 但丁另有一个 Pluto —— 他在《地狱篇》
第七歌开口「Pape Satàn, pape Satàn aleppe!」,维吉尔喝止他「maladetto lupo」,
守的是贪吝与挥霍的第四圈。`statutes_inferno_entries.py` 早就把 circle 4 的
guardian 记在语料里了,而 `actors_european.py` 正是照这个身份种下 Charon、Minos、
Cerberus 的 —— **只有第四圈的守卫缺着**。

而且这个区分**同一个文件里九行之上就已经做对过一次**:Minos 那一行写着
「THIS ROW IS DANTE'S MINOS。柏拉图的 Minos(Gorgias 524a)另有一行在 GREEK 底下……
不同地府里的不同职务」。Pluto 是同一个情形,被反过来处理了。

下面每一条都断言**两个方向**:两行都在,而且没有被任何机制收回一行。只断言
「Pluto 在」的话,一个把 Hades 也改名成 Pluto 的实现照样通过。
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor


@pytest.fixture
def seeded(db):
    call_command("seed_mythology", stdout=io.StringIO())


def one(name, civilization):
    rows = list(Actor.all_objects.filter(name=name, civilization=civilization))
    assert len(rows) == 1, f"{civilization} {name}: 期望恰好一行,实际 {len(rows)}"
    return rows[0]


@pytest.mark.django_db
def test_both_rows_exist_in_their_own_civilizations(seeded):
    pluto = one("Pluto", "EUROPEAN")
    hades = one("Hades", "GREEK")
    assert pluto.id != hades.id
    # 反向也要断言:没有 GREEK 的 Pluto,也没有 EUROPEAN 的 Hades。那两个才是
    # 当初的合并真正要防的重复。
    assert not Actor.all_objects.filter(name="Pluto", civilization="GREEK").exists()
    assert not Actor.all_objects.filter(name="Hades", civilization="EUROPEAN").exists()


@pytest.mark.django_db
def test_they_hold_different_offices(seeded):
    """名字相近不是重点,职务不同才是。

    Hades 主宰整个希腊地府(OVERSEER);Pluto 守一道门(GUARDIAN)。若哪天两行的
    role 与 realm 都一样了,「不同职务」这句话就没有依据了 —— 那时该重新审视的是
    合并对不对,而不是把这条测试改松。
    """
    pluto = one("Pluto", "EUROPEAN")
    hades = one("Hades", "GREEK")

    assert pluto.role == "GUARDIAN", pluto.role
    assert hades.role == "OVERSEER", hades.role
    assert pluto.realm is not None and pluto.realm.realm_code == "EU_HELL_4TH"
    assert hades.realm is not None and hades.realm.realm_code != "EU_HELL_4TH"


@pytest.mark.django_db
def test_the_cleanup_command_does_not_touch_either_row(seeded):
    """合并步骤已退役。这一条钉住「退役」是真的,不是改小了阈值。"""
    out = io.StringIO()
    call_command("consolidate_eu_pantheon", "--execute", stdout=out, stderr=out)

    pluto = one("Pluto", "EUROPEAN")
    hades = one("Hades", "GREEK")
    assert pluto.is_deleted is False, f"清理命令又把 Pluto 删了:\n{out.getvalue()}"
    assert hades.is_deleted is False, f"清理命令把 Hades 删了:\n{out.getvalue()}"


@pytest.mark.django_db
def test_the_name_resolver_gives_one_answer_per_cast(seeded):
    """一个名字在一个阵容里只有一个答案。

    这是删掉 `GREEK_ACTOR_ALIASES["Hades"] = ["Pluto"]` 的理由:同时存在一个真的
    Pluto 行和一条把 "Pluto" 指向 Hades 的别名时,`_resolve_approver` 对同一个字符串
    有两个答案,给出哪一个取决于列匹配与别名匹配谁先跑。
    """
    from apps.actors.models import resolve_actor_by_any_name

    european = Actor.all_objects.filter(civilization="EUROPEAN")
    greek = Actor.all_objects.filter(civilization="GREEK")

    found = resolve_actor_by_any_name(european, "Pluto")
    assert found is not None and found.name == "Pluto"
    assert resolve_actor_by_any_name(greek, "Pluto") is None, (
        "希腊阵容里 'Pluto' 又解析出东西了 —— 那条别名回来了"
    )
    hades = resolve_actor_by_any_name(greek, "Hades")
    assert hades is not None and hades.name == "Hades"


@pytest.mark.django_db
def test_seeding_twice_does_not_produce_a_second_pluto(seeded):
    """幂等。种子命令按 (name, civilization) 匹配,再跑一次不该多出一行 ——
    而「多出一行」正是当初那个合并步骤真正要清理的东西。"""
    before = Actor.all_objects.filter(name="Pluto").count()
    call_command("seed_mythology", stdout=io.StringIO())
    assert Actor.all_objects.filter(name="Pluto").count() == before == 1
