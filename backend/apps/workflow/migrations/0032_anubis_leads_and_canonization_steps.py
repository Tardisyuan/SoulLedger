"""两处节点改名(civ-audit-2026-11-13,用户 2026-11-13 决定)。

* EG-23:称心流程第一站「阿努比斯 · 引导与称量」→「阿努比斯 · 引导」(前端预设的拼法「Anubis · 引导与称量」→
  「Anubis · 引导」)。名字里的「称量」排在了下一站的否定告白之前;顺序不动,只改名。
* EU-10:封圣流程三站改成现行程序(*Divinus Perfectionis Magister*,1983;docs/01「系统自设」)的步骤名:
  教区初审 → 教区主教调查,教省复审 → 列圣部审查,罗马教廷终审 → 教宗裁定。

写法同 workflow/0031:改 ``ApprovalNode.node_name`` / ``node_name_en``,以及 ``WorkflowTemplate`` /
``WorkflowTemplateVersion`` 的 ``nodes_json`` 里节点的 ``node_name`` / ``name`` / ``name_en``。只动仍是旧值的字段:
名字被人改过的节点不碰,英文被人改过的只改名字。五对名字一一对应,倒回去按同一张表反着走。
走 ``_base_manager``:迁移里没有租户上下文。
"""
from django.db import migrations

#: old name -> new name.
RENAMES = {
    "阿努比斯 · 引导与称量": "阿努比斯 · 引导",
    "Anubis · 引导与称量": "Anubis · 引导",
    "教区初审": "教区主教调查",
    "教省复审": "列圣部审查",
    "罗马教廷终审": "教宗裁定",
}
#: old name -> (the English it carried, the English the new name carries).
ENGLISH = {
    "阿努比斯 · 引导与称量": ("Anubis · leads and weighs", "Anubis · leads"),
    "Anubis · 引导与称量": ("Anubis · guides and weighs", "Anubis · guides"),
    "教区初审": ("Diocese's first review", "Diocesan bishop's inquiry"),
    "教省复审": ("Province's review", "Congregation for the Causes of Saints' examination"),
    "罗马教廷终审": ("Holy See's final review", "The Pope's decision"),
}
#: name as stored -> (name to write, English as stored, English to write)
FORWARD = {old: (new, *ENGLISH[old]) for old, new in RENAMES.items()}
BACKWARD = {new: (old, ENGLISH[old][1], ENGLISH[old][0]) for old, new in RENAMES.items()}
NAME_KEYS = ("node_name", "name")


def _rewrite(nodes, table):
    """`nodes` with the renames applied, or None when nothing in it matched."""
    if not isinstance(nodes, list):
        return None
    changed = False
    for node in nodes:
        if not isinstance(node, dict):
            continue
        stored = next((node[key] for key in NAME_KEYS if node.get(key) in table), None)
        if stored is None:
            continue
        new, old_en, new_en = table[stored]
        for key in NAME_KEYS:
            if node.get(key) == stored:
                node[key] = new
        if node.get("name_en") == old_en:
            node["name_en"] = new_en
        changed = True
    return nodes if changed else None


def _apply(apps, schema_editor, table):
    alias = schema_editor.connection.alias
    nodes = apps.get_model("workflow", "ApprovalNode")._base_manager.using(alias)
    for stored, (new, old_en, new_en) in table.items():
        nodes.filter(node_name=stored, node_name_en=old_en).update(node_name_en=new_en)
        nodes.filter(node_name=stored).update(node_name=new)
    for model_name in ("WorkflowTemplate", "WorkflowTemplateVersion"):
        manager = apps.get_model("workflow", model_name)._base_manager.using(alias)
        for row in manager.all().only("pk", "nodes_json").iterator():
            rewritten = _rewrite(row.nodes_json, table)
            if rewritten is not None:
                manager.filter(pk=row.pk).update(nodes_json=rewritten)


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, FORWARD)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, BACKWARD)


class Migration(migrations.Migration):
    dependencies = [("workflow", "0031_egypt_the_forty_two_are_assessors_panguan")]
    operations = [migrations.RunPython(forwards, backwards)]
