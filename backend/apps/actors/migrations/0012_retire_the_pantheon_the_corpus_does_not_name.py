"""合并 `Maat` → `Ma'at`,并退役六个不属于本系统语料的欧洲角色。

115 实测:live actor 有 40 行在 seed 表里没有对应行,**每一行都恰好挂着一个启用
中的用户账号**。清理命令(`consolidate_eu_pantheon`)一直都在,也一直会正确地
报 ACTION REQUIRED —— 只是没有人做过那个 ACTION。**一个会说话的守卫,和一个
没人听的守卫,在日志里长得一样。**

## 一、`Maat` 与 `Ma'at` 是同一位女神

两行同时在册、同一个 realm、同一个租户,都出现在 actor 选择器里。
`EGYPTIAN_ACTORS` 里的正规拼写是 `Ma'at`。

先把 `Maat` 那个用户改指 `Ma'at`,再软删 `Maat` 行 —— 顺序与 `actors/0010`
的三个重复行一致:`User.actor` 是外键,反过来做会打断绑定。
**账号不停用**:这是一次合并,那个人还在。

## 二、六个欧洲角色,语料不认

    Lucifer         EU_HELL_9TH  "Light Bearer (Fallen)"
    Beelzebub       EU_HELL_8TH  "Lord of the Flies"
    Mephistopheles  EU_HELL_7TH  "Duke of Hell"
    Belial          EU_HELL_6TH  "Duke of Hell"
    Raphael         EU_HEAVEN    "Archangel"
    St. Peter       EU_HEAVEN    "Gatekeeper of Heaven"

`EUROPEAN_ACTORS` 是 God / Christ / Michael / Gabriel / Satan + 但丁的
Charon / Minos / Pluto / Cerberus + Lethe / Eunoe。上面六个一个都不在里面,
而且它们说的话来自别的书:Mephistopheles 是歌德与马洛的,不是但丁的;
Beelzebub 与 Belial 是《所罗门小钥匙》与弥尔顿一路的恶魔学,被安到但丁的
第六、第八圈上 —— **《地狱篇》没有把这几位派作任何一圈的守卫**。这正是
`docs/lore-verification/README.md` §1 拒绝的那种「没有出处的条目」。

**`Lucifer` 与正规行 `Satan` 是同一个位置上的同一个角色**(都在 EU_HELL_9TH)。
这里按用户 2026-08-31 的决定统一退役,而不是把它的账号改指 `Satan` —— 记在这里,
是为了下一次有人想合并时不必重新查一遍。

处置与 Norse 四行同一套(用户 2026-08-31 决定):**停用账号 → 清 `actor_id`
→ 软删 actor**。顺序不能反:`User.actor` 是外键。

软删而不是真删,沿用 `actors/0010` 与 `judgment/0012` 的理由:行留着,历史引用
仍可读,反向迁移能原样恢复;真删掉的东西,回滚回来的只是一个新行。

## 反向

backward 恢复六行、重新启用那六个账号并改指回去,并把 `Maat` 行恢复、把它的
用户改指回来。**恢复不了的是「不知道原来是不是停用的」** —— 所以 forward 只
处理 `is_active=True` 的账号,backward 也只启用它自己停过的那些;115 上六个
都是启用的(实测),别的库里已经停用的账号 forward 会跳过。
"""
from django.db import migrations
from django.utils import timezone

MERGE = ("Maat", "Ma'at")

RETIRE = [
    "Lucifer",
    "Beelzebub",
    "Mephistopheles",
    "Belial",
    "Raphael",
    "St. Peter",
]

REASON = "不在 EUROPEAN_ACTORS 语料里;2026-08-31 决定退役(与 Norse 四行同一套)"


def _actor(actor_model, name):
    return actor_model.all_objects.filter(name=name, is_deleted=False).first()


def forward(apps, schema_editor):
    Actor = apps.get_model("actors", "Actor")
    User = apps.get_model("authentication", "User")

    # 一、合并拼写
    stale, canonical = (_actor(Actor, MERGE[0]), _actor(Actor, MERGE[1]))
    if stale is not None and canonical is not None:
        User.objects.filter(actor=stale).update(actor=canonical)
        stale.is_deleted = True
        stale.deleted_at = timezone.now()
        stale.delete_reason = f"与 {MERGE[1]} 是同一位女神的两种拼写;账号已改指正规行"
        stale.save(update_fields=["is_deleted", "deleted_at", "delete_reason"])

    # 二、退役六行
    for name in RETIRE:
        actor = _actor(Actor, name)
        if actor is None:
            continue
        # 停用账号 → 清 actor_id → 软删 actor。顺序不能反。
        User.objects.filter(actor=actor, is_active=True).update(is_active=False)
        User.objects.filter(actor=actor).update(actor=None)
        actor.is_deleted = True
        actor.deleted_at = timezone.now()
        actor.delete_reason = REASON
        actor.save(update_fields=["is_deleted", "deleted_at", "delete_reason"])


def backward(apps, schema_editor):
    Actor = apps.get_model("actors", "Actor")
    User = apps.get_model("authentication", "User")

    for name in RETIRE:
        actor = Actor.all_objects.filter(name=name, delete_reason=REASON).first()
        if actor is None:
            continue
        actor.is_deleted = False
        actor.deleted_at = None
        actor.delete_reason = ""
        actor.save(update_fields=["is_deleted", "deleted_at", "delete_reason"])
        # 账号按用户名找回来 —— `actor_id` 已经被清空,没有别的线索。
        User.objects.filter(username=name).update(actor=actor, is_active=True)

    stale = Actor.all_objects.filter(name=MERGE[0], is_deleted=True).first()
    canonical = _actor(Actor, MERGE[1])
    if stale is not None:
        stale.is_deleted = False
        stale.deleted_at = None
        stale.delete_reason = ""
        stale.save(update_fields=["is_deleted", "deleted_at", "delete_reason"])
        if canonical is not None:
            User.objects.filter(username=MERGE[0], actor=canonical).update(actor=stale)


class Migration(migrations.Migration):
    dependencies = [
        ("actors", "0011_remove_actor_unique_actor_tenant_civ_name_and_more"),
        ("authentication", "0001_initial"),
    ]
    operations = [migrations.RunPython(forward, backward)]
