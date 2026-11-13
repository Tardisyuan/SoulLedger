"""封圣第二站的 court,以及一个更早的旧名(用户 2026-11-13 决定)。

1. **court(可倒回)**:封圣流程第二站「列圣部审查」是罗马圣部的审查,court 由 ``Archdiocese`` 改成 ``Vatican``
   (workflow/0032 只改了名字,court 当时不在决定之内)。只动节点名是「列圣部审查」、且 court 仍是 ``Archdiocese``
   的行:别的站(哪怕也是 Archdiocese)、court 被人改过的第二站都不碰。倒回按同一条件反着走
   (名字「列圣部审查」且 court 是 ``Vatican`` → ``Archdiocese``)。

2. **旧名「主教座堂初审」→「教区主教调查」(单向)**:``489d2f603``(2026-11-07)把模板里的「主教座堂初审」改成
   「教区初审」时没有写迁移,0032 的表从「教区初审」起,所以更早建的行可能还停在「主教座堂初审」。这里把仍是这个
   旧值的行改到现名;英文仍是 0030 写的 ``Cathedral's first review`` 的一并改,被人改过的英文不动。
   **backwards 不动名字**:倒回之后这些行与 0032 写出的「教区主教调查」同名,分不出哪些原先是「主教座堂初审」、
   哪些是「教区初审」,往任何一个倒都会改错另一半。0032 自己的 backwards 会把它们一起带回「教区初审」——
   那是模板在 0032 之前的名字,不是错值。

写法同 workflow/0031、0032:``ApprovalNode`` 的列,以及 ``WorkflowTemplate`` / ``WorkflowTemplateVersion`` 的
``nodes_json``(名字键 ``node_name`` / ``name``,court 键 ``court_code`` / ``court``)。走 ``_base_manager``:
迁移里没有租户上下文。
"""
from django.db import migrations

STATION = "列圣部审查"
OLD_COURT, NEW_COURT = "Archdiocese", "Vatican"

OLD_NAME, NEW_NAME = "主教座堂初审", "教区主教调查"
OLD_NAME_EN, NEW_NAME_EN = "Cathedral's first review", "Diocesan bishop's inquiry"

NAME_KEYS = ("node_name", "name")
COURT_KEYS = ("court_code", "court")


def _rewrite(nodes, court_from, court_to, rename):
    """`nodes` with the court moved (and, when `rename`, the old name brought up), or None when nothing matched."""
    if not isinstance(nodes, list):
        return None
    changed = False
    for node in nodes:
        if not isinstance(node, dict):
            continue
        names = {node.get(key) for key in NAME_KEYS}
        if STATION in names:
            for key in COURT_KEYS:
                if node.get(key) == court_from:
                    node[key] = court_to
                    changed = True
        if rename and OLD_NAME in names:
            for key in NAME_KEYS:
                if node.get(key) == OLD_NAME:
                    node[key] = NEW_NAME
            if node.get("name_en") == OLD_NAME_EN:
                node["name_en"] = NEW_NAME_EN
            changed = True
    return nodes if changed else None


def _apply(apps, schema_editor, court_from, court_to, rename):
    alias = schema_editor.connection.alias
    nodes = apps.get_model("workflow", "ApprovalNode")._base_manager.using(alias)
    nodes.filter(node_name=STATION, court_code=court_from).update(court_code=court_to)
    if rename:
        nodes.filter(node_name=OLD_NAME, node_name_en=OLD_NAME_EN).update(node_name_en=NEW_NAME_EN)
        nodes.filter(node_name=OLD_NAME).update(node_name=NEW_NAME)
    for model_name in ("WorkflowTemplate", "WorkflowTemplateVersion"):
        manager = apps.get_model("workflow", model_name)._base_manager.using(alias)
        for row in manager.all().only("pk", "nodes_json").iterator():
            rewritten = _rewrite(row.nodes_json, court_from, court_to, rename)
            if rewritten is not None:
                manager.filter(pk=row.pk).update(nodes_json=rewritten)


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, OLD_COURT, NEW_COURT, rename=True)


def backwards(apps, schema_editor):
    # The court goes back; the name does not (see the file header).
    _apply(apps, schema_editor, NEW_COURT, OLD_COURT, rename=False)


class Migration(migrations.Migration):
    dependencies = [("workflow", "0032_anubis_leads_and_canonization_steps")]
    operations = [migrations.RunPython(forwards, backwards)]
