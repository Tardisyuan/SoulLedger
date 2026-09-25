"""结案时引用条文的快照:一条律条「当时说了什么」。

律条会被改(`seed_mythology --update` 就地改写;埃及四十二条的正文读自
`Actor.powers_json`,改神祇就改条文),而一件已结的案子引用的是**当时**的文字。
所以结案那一刻把每条引用渲染后的标题 / 正文 / 出处连同内容哈希写进
`JudgmentCitation`;审判台对已结案子读快照,再拿哈希与今天的渲染比,告诉读者
「现行文本已修订」。

这里是纯函数,只读属性,不调模型方法:数据迁移里拿到的是历史模型(没有方法),
回填与结案必须走同一条渲染路径,否则回填写下的哈希与结案写下的哈希不可比。
`Statute.get_localized_*` 也委托到这里,于是「序列化器显示的正文」与「快照的正文」
只有一个定义。
"""
import hashlib
import json

# 快照按这三种语言各存一份 —— 与 `get_localized_*` 认得的三种一致。
LOCALES = ("zh", "en", "egy")


def locale_key(locale: str) -> str:
    """请求语言 → 快照键。与 `get_localized_*` 的分支同一口径。"""
    if locale.startswith("zh"):
        return "zh"
    if locale == "egy":
        return "egy"
    return "en"


def derived_text(statute) -> str:
    if statute.source_actor_id is None or not statute.source_actor_field:
        return ""
    payload = statute.source_actor.powers_json or {}
    return payload.get(statute.source_actor_field) or ""


def localized_title(statute, locale: str) -> str:
    key = locale_key(locale)
    if key == "zh":
        return statute.title_zh or statute.title_en or statute.code
    if key == "egy":
        return statute.title_egy or statute.title_en or statute.code
    return statute.title_en or statute.title_zh or statute.code


def localized_text(statute, locale: str) -> str:
    key = locale_key(locale)
    if key == "zh":
        return statute.text_zh or statute.text_en or derived_text(statute)
    if key == "egy":
        return statute.text_egy or statute.text_en or derived_text(statute)
    return statute.text_en or statute.text_zh or derived_text(statute)


def render(statute) -> dict:
    """今天这条律条渲染出来的样子:三种语言的标题与正文,加出处。"""
    return {
        "title": {loc: localized_title(statute, loc) for loc in LOCALES},
        "text": {loc: localized_text(statute, loc) for loc in LOCALES},
        "source": statute.source or "",
    }


def content_hash(content: dict) -> str:
    blob = json.dumps(content, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def fill(citation, statute, kind: str, at) -> None:
    """把 `statute` 今天的渲染写进 `citation` 的快照列(不保存)。"""
    content = render(statute)
    citation.snapshot_title = content["title"]
    citation.snapshot_text = content["text"]
    citation.snapshot_source = content["source"]
    citation.snapshot_hash = content_hash(content)
    citation.snapshot_at = at
    citation.snapshot_kind = kind


SNAPSHOT_FIELDS = [
    "snapshot_title", "snapshot_text", "snapshot_source",
    "snapshot_hash", "snapshot_at", "snapshot_kind",
]
