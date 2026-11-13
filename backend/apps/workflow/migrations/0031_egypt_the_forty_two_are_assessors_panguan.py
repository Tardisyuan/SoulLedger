"""四十二位的节点统一叫「四十二判官 · 否定告白」(civ-audit-2026-11-13 EG-22;docs/02 §2.2 与语言包作「判官」)。

此前后端模板作「四十二神官 · 否定告白」(workflow/0012 写进已有的行),前端预设作「42审判者 · 否定告白」
(另存为模板时进了 ``nodes_json``)。三处改:

* ``ApprovalNode.node_name`` / ``node_name_en``;
* ``WorkflowTemplate.nodes_json`` 与 ``WorkflowTemplateVersion.nodes_json`` 里节点的 ``node_name`` / ``name`` / ``name_en``。

只动仍是旧值的字段:名字被人改过的节点不碰。倒回去时两个旧名合不回两份,一律还原成后端那个
(「四十二神官 · 否定告白」);英文同理还原成 "The forty-two assessors · negative confession"(它本来就是后端那份)。
走 ``_base_manager``:迁移里没有租户上下文。
"""
from django.db import migrations

NEW = "四十二判官 · 否定告白"
NEW_EN = "The forty-two assessors · negative confession"
#: old -> new, and the English the old name carried.
RENAMES = {
    "四十二神官 · 否定告白": NEW,
    "42审判者 · 否定告白": NEW,
}
OLD_EN = {"The 42 assessors · negative confession": NEW_EN}
NAME_KEYS = ("node_name", "name")


def _rewrite(nodes, names, english):
    """`nodes` with the renames applied, or None when nothing in it matched."""
    if not isinstance(nodes, list):
        return None
    changed = False
    for node in nodes:
        if not isinstance(node, dict) or not any(node.get(key) in names for key in NAME_KEYS):
            continue
        for key in NAME_KEYS:
            if node.get(key) in names:
                node[key] = names[node[key]]
        if node.get("name_en") in english:
            node["name_en"] = english[node["name_en"]]
        changed = True
    return nodes if changed else None


def _apply(apps, schema_editor, names, english):
    alias = schema_editor.connection.alias
    ApprovalNode = apps.get_model("workflow", "ApprovalNode")
    for old, new in names.items():
        rows = ApprovalNode._base_manager.using(alias).filter(node_name=old)
        for old_en, new_en in english.items():
            rows.filter(node_name_en=old_en).update(node_name_en=new_en)
        rows.update(node_name=new)
    for model_name in ("WorkflowTemplate", "WorkflowTemplateVersion"):
        manager = apps.get_model("workflow", model_name)._base_manager.using(alias)
        for row in manager.all().only("pk", "nodes_json").iterator():
            nodes = _rewrite(row.nodes_json, names, english)
            if nodes is not None:
                manager.filter(pk=row.pk).update(nodes_json=nodes)


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, RENAMES, OLD_EN)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, {NEW: "四十二神官 · 否定告白"}, {})


class Migration(migrations.Migration):
    dependencies = [("workflow", "0030_backfill_english")]
    operations = [migrations.RunPython(forwards, backwards)]
