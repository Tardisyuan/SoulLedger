"""The English the display table (`referenceNames.en.json`, retired with this) held for workflows.

Written into the migration, so it never depends on a file that can change. Only blank columns are filled, so anything
already entered stays. Rows that copied a name when they were built (a workflow, its nodes, its segments) get the same
English, or a running flow would read in two languages. `court_code` needs none: `courtLabel` already names every
court by its spelling, through the language packs.

Reverse: `0029` drops the columns; the only thing left to undo is the `name_en` key inside `nodes_json`.
"""
from django.db import migrations

NAME_EN = {
    "42审判者 · 否定告白": "The 42 assessors · negative confession",
    "Aeacus · 分区审判（欧洲亡魂）": "Aeacus · judges the souls of Europe",
    "Ammit · 吞噬（未通过分支）": "Ammit · devours (failed branch)",
    "Anubis · 引导与称量": "Anubis · guides and weighs",
    "Christ · 公审判": "Christ · the Last Judgment",
    "Christ · 私审判": "Christ · the Particular Judgment",
    "Christ · 紧急审判": "Christ · urgent judgment",
    "Christ · 终审": "Christ · final",
    "Horus · 引导": "Horus · guides",
    "Isis · 受理": "Isis · receives",
    "Michael · 引领入光": "Michael · into the light",
    "Michael · 引领呈上": "Michael · brings the soul forward",
    "Minos · 判定圈层": "Minos · assigns the circle",
    "Minos · 终裁（另二人存疑时）": "Minos · decides when the other two doubt",
    "Nephthys · 复核": "Nephthys · reviews",
    "Osiris · 终审": "Osiris · final review",
    "Rhadamanthus · 分区审判（亚洲亡魂）": "Rhadamanthus · judges the souls of Asia",
    "Satan · 第九层收监": "Satan · holds in the Ninth Circle",
    "Thoth · 记录与宣读判词": "Thoth · records and reads the verdict",
    "上级殿阎王": "King of the court above",
    "主教座堂初审": "Cathedral's first review",
    "九华山": "Mount Jiuhua",
    "九层地狱罪行分类": "Offences sorted by the nine circles of Hell",
    "五官王 · 三审": "King Wuguan · third hearing",
    "优先排队，仍经心脏称重": "Queue priority, still with the weighing of the heart",
    "先认定是否否认灵魂不灭，再由基督审判": "First finding whether the immortality of the soul was denied, then judgment by Christ",
    "冤死灵魂申诉 → 城隍/地藏王处理": "Pleas from wrongly dead souls → handled by the City God or Ksitigarbha",
    "判官初审": "Judge's first review",
    "功德核定": "Confirming the merit",
    "十殿审判流程": "Ten Courts judgment flow",
    "十殿联审": "Ten Courts, sitting jointly",
    "卞城王 · 五审": "King Biancheng · fifth hearing",
    "原殿阎王 · 复核": "King of the original court · review",
    "四十二神官 · 否定告白": "The forty-two assessors · negative confession",
    "地狱圈层流程": "Circles of Hell flow",
    "地藏王菩萨 · 超度": "Ksitigarbha · deliverance",
    "埃及申诉流程": "Egyptian appeal flow",
    "城隍初审": "City God's first review",
    "城隍申诉审理": "City God hears the plea",
    "基督的私审判与公审判；米迦勒引领，不作裁断": "Christ's Particular and Last Judgments; Michael leads and does not rule",
    "大善人(功德≥500)直接轮回": "The greatly virtuous (merit ≥ 500) go straight to rebirth",
    "天堂准入终审": "Final review for Heaven",
    "天堂申诉流程": "Heaven appeal flow",
    "奥西里斯委员会重审": "Rehearing by the council of Osiris",
    "宋帝王 · 二审": "King Songdi · second hearing",
    "完整十殿审判，根据罪行裁定轮回": "The full judgment of the ten courts; rebirth is decided by the offences",
    "完整杜阿特审判，心脏与羽毛称重": "The full judgment of the Duat: the heart weighed against the feather",
    "审批节点": "Approval step",
    "察查司审核 → 原殿复核 → 上级殿 → 酆都大帝终审": "Bureau of Inquiry review → original court's review → court above → final review by the Great Emperor of Fengdu",
    "寿数折抵": "Serving out the allotted years",
    "封圣审查流程": "Canonization review flow",
    "希腊冥界流程": "Hades judgment flow",
    "平等王 · 八审": "King Pingdeng · eighth hearing",
    "异端审判流程": "Heresy trial flow",
    "异端裁定": "Ruling on heresy",
    "心脏称重流程": "Weighing of the Heart flow",
    "忏悔赦免审核": "Review of confession and absolution",
    "托特 · 记录并宣读": "Thoth · records and reads",
    "按出身地域分流": "Divide by region of origin",
    "教省复审": "Province's review",
    "末日审判流程": "Last Judgment flow",
    "枉死城": "City of Wrongful Death",
    "枉死城流程": "City of Wrongful Death flow",
    "枉死城登记": "City of Wrongful Death · registration",
    "柏拉图《高尔吉亚篇》524a：岔路口草地上的分流审判": "Plato, Gorgias 524a: judgment and division in the meadow at the crossroads",
    "案件分类": "Case triage",
    "楚江王 · 初审": "King Chujiang · first hearing",
    "欧西里斯 · 终审": "Osiris · final",
    "欧西里斯称重流程": "Weighing of the heart before Osiris",
    "泰山王 · 六审": "King Taishan · sixth hearing",
    "涉及多地区协调的复杂案件": "Complex cases that need coordinating across regions",
    "炼狱净化评估": "Assessment of purgation",
    "炼狱复核流程": "Purgatory review flow",
    "特殊紧急案件直达酆都": "Special urgent cases go straight to Fengdu",
    "犯五逆者直接入阿鼻地狱，永不轮回": "Those guilty of the five heinous crimes go straight to Avici Hell, never to be reborn",
    "申诉受理": "Appeal received",
    "申诉呈至基督台前；天使不构成审级": "Appeals are brought before Christ; angels are not a level of review",
    "申诉复核": "Appeal review",
    "申诉审判流程": "Appeal flow",
    "申诉终审": "Final appeal review",
    "直送轮回流程": "Straight-to-rebirth flow",
    "神判流程": "Divine judgment flow",
    "神庭 · 确认": "The divine court · confirms",
    "神明主持的审判，同样经心脏称重": "A judgment presided over by the gods, also with the weighing of the heart",
    "秦广王 · 分流": "King Qinguang · triage",
    "第九层": "Ninth Circle",
    "第二层入口": "Entrance to the Second Circle",
    "紧急受理": "Urgent intake",
    "紧急审判流程": "Urgent judgment flow",
    "紧急队列仍由基督审判——没有可以升级到的第二位审判者": "The urgent queue is still judged by Christ: there is no second judge to escalate to",
    "终审": "Final review",
    "结束 · 发往六道": "End · to the six paths",
    "结束 · 各走其路": "End · each to their road",
    "结束 · 称心毕": "End · the weighing is done",
    "罗马教廷终审": "Holy See's final review",
    "罪行核定": "Confirming the offence",
    "荷鲁斯 · 引导": "Horus · leads",
    "跨域审判流程": "Cross-realm judgment flow",
    "转生申请": "Rebirth application",
    "转轮王 · 终审": "King Zhuanlun · final hearing",
    "轮回分流": "Rebirth triage",
    "都市王 · 七审": "King Dushi · seventh hearing",
    "酆都大帝 · 直审": "Great Emperor of Fengdu · direct hearing",
    "酆都大帝 · 终审": "Great Emperor of Fengdu · final",
    "阎罗王 · 四审": "King Yama · fourth hearing",
    "阿努比斯 · 引导与称量": "Anubis · leads and weighs",
    "阿米特 · 吞噬": "Ammit · devours",
    "阿鼻地狱": "Avici Hell",
    "阿鼻地狱入狱": "Committal to Avici Hell",
    "阿鼻地狱流程": "Avici Hell flow",
    "魏征 · 察查司": "Wei Zheng · Bureau of Inquiry",
}

#: `apps/soul_accounts/rebirth.py` builds these names from the soul's code.
PREFIXES = (("转生申请申诉: ", "Rebirth application appeal: "), ("转生申请: ", "Rebirth application: "))
GENERIC_SUFFIX = (" 审批流程", " approval flow")  # `WorkflowService._generic_template`


def english(name):
    if name in NAME_EN:
        return NAME_EN[name]
    for source, target in PREFIXES:
        if name.startswith(source):
            return target + name[len(source):]
    if name.endswith(GENERIC_SUFFIX[0]):
        return name[: -len(GENERIC_SUFFIX[0])] + GENERIC_SUFFIX[1]
    return ""


def with_english_nodes(nodes):
    if not isinstance(nodes, list):
        return nodes
    result = []
    for node in nodes:
        if isinstance(node, dict) and not node.get("name_en"):
            found = english(node.get("node_name") or node.get("name") or "")
            if found:
                node = {**node, "name_en": found}
        result.append(node)
    return result


def without_english_nodes(nodes):
    if not isinstance(nodes, list):
        return nodes
    return [{k: v for k, v in n.items() if k != "name_en"} if isinstance(n, dict) else n for n in nodes]


def _rewrite_nodes(model, rewrite):
    for pk, nodes in model._base_manager.values_list("pk", "nodes_json").iterator():
        rewritten = rewrite(nodes)
        if rewritten != nodes:
            model._base_manager.filter(pk=pk).update(nodes_json=rewritten)


def forwards(apps, schema_editor):
    Template = apps.get_model("workflow", "WorkflowTemplate")
    Version = apps.get_model("workflow", "WorkflowTemplateVersion")
    Workflow = apps.get_model("workflow", "ApprovalWorkflow")
    Node = apps.get_model("workflow", "ApprovalNode")
    Segment = apps.get_model("workflow", "WorkflowSegment")
    # Soft-deleted rows too: the recycle bin can bring them back. `_base_manager` is the plain one on a historical model.
    for pk, name, description in Template._base_manager.values_list("pk", "name", "description").iterator():
        Template._base_manager.filter(pk=pk).update(name_en=english(name), description_en=english(description))
    _rewrite_nodes(Template, with_english_nodes)
    _rewrite_nodes(Version, with_english_nodes)
    for model, source, target in ((Workflow, "workflow_name", "workflow_name_en"), (Node, "node_name", "node_name_en"),
                                  (Segment, "name", "name_en")):
        for name in model._base_manager.filter(**{target: ""}).values_list(source, flat=True).distinct().iterator():
            found = english(name)
            if found:
                model._base_manager.filter(**{source: name, target: ""}).update(**{target: found})


def backwards(apps, schema_editor):
    _rewrite_nodes(apps.get_model("workflow", "WorkflowTemplate"), without_english_nodes)
    _rewrite_nodes(apps.get_model("workflow", "WorkflowTemplateVersion"), without_english_nodes)


class Migration(migrations.Migration):
    dependencies = [("workflow", "0029_english_columns")]
    operations = [migrations.RunPython(forwards, backwards)]
