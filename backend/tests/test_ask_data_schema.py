"""问数的 schema.yaml 与召回(docs/ARCHITECTURE-ask-data.md §5)。

全部离线。向量服务的替身 `BigramEmbed` 按文本内容出向量(汉字 / 字母的二元组哈希到固定维度后计数),
所以「哪张表最近」由 schema.yaml 的说明文字决定,不由替身写死。根 conftest 默认让 `_post` 像主机不通一样失败,
那就是降级路径。

第 2 步(§10)补上:「闸门白名单 == yaml == 授权表集合」的三方相等,与「同义词覆盖评测集」(用评测集反查)。
"""
import hashlib
import re

import pytest
import sqlglot
from django.apps import apps
from django.core.cache import cache
from sqlglot import exp

from apps.soul_assist import features, vectors
from apps.soul_assist.ask_data import gate, schema, setup

pytestmark = pytest.mark.django_db

TABLES = schema.load()

#: §6 的「不授的列(至少)」,加 souls_soul 实现时逐列定下的身份信息与自由文本。
MUST_NOT_GRANT = {
    "judgment_judgment": {"confession", "notes", "summary", "grievance_plea", "grievance_note", "evidence_json",
                          "fail_reason_note"},
    "souls_soul": {"name", "birth_name", "description", "soul_code", "contact_email", "contact_phone",
                   "origin_location"},
    "disposition_disposition": {"notes"},
    "sentence_plan_sentenceplan": {"cancel_reason"},
}


def _model(table):
    return apps.get_model(TABLES[table]["model"])


# ── schema.yaml 对模型 ───────────────────────────────────────────────────


def test_the_whitelist_is_the_four_tables_of_section_6():
    assert schema.tables() == tuple(sorted(MUST_NOT_GRANT))


@pytest.mark.parametrize("table", sorted(TABLES))
def test_each_table_is_its_models_table(table):
    assert _model(table)._meta.db_table == table


@pytest.mark.parametrize("table", sorted(TABLES))
def test_the_columns_are_exactly_the_models_concrete_columns_in_order(table):
    """yaml 写的是「全部具体列,按模型字段顺序」:多一列(模型里没有)、少一列(新加的列没定授不授)都红。"""
    yaml_columns = [c["name"] for c in TABLES[table]["columns"]]
    assert yaml_columns == [f.column for f in _model(table)._meta.concrete_fields]


@pytest.mark.parametrize("table", sorted(TABLES))
def test_every_column_says_whether_it_is_granted_and_what_it_is(table):
    for c in TABLES[table]["columns"]:
        assert isinstance(c["granted"], bool), c["name"]
        assert c["type"] and c["label"], c["name"]


@pytest.mark.parametrize("table", sorted(TABLES))
def test_the_listed_private_columns_are_not_granted(table):
    granted = set(schema.granted_columns(table))
    assert MUST_NOT_GRANT[table] <= {c["name"] for c in TABLES[table]["columns"]}
    assert not MUST_NOT_GRANT[table] & granted


@pytest.mark.parametrize("table", sorted(TABLES))
def test_no_free_text_column_is_granted(table):
    """`text` 列全是自由文本(供述、备注、生平、理由)。"""
    text = {c["name"] for c in TABLES[table]["columns"] if c["type"] == "text"}
    assert text and not text & set(schema.granted_columns(table))


@pytest.mark.parametrize("table", sorted(TABLES))
def test_the_policy_columns_are_granted_and_soft_delete_matches_the_model(table):
    granted = set(schema.granted_columns(table))
    assert "tenant_id" in granted
    has_is_deleted = any(f.column == "is_deleted" for f in _model(table)._meta.concrete_fields)
    assert TABLES[table]["soft_delete"] is has_is_deleted
    assert ("is_deleted" in granted) is has_is_deleted


def test_the_text_given_to_the_model_holds_granted_columns_only():
    text = schema.table_text("judgment_judgment")
    assert "grievance_status" in text and "申诉" in text and "FILED=" in text
    for name in MUST_NOT_GRANT["judgment_judgment"]:
        assert f"- {name} " not in text


def test_the_gate_the_yaml_and_the_grants_name_the_same_tables():
    """§5:四处读同一份 schema.yaml。三者相等,且每张授权的表至少授出一列(GRANT SELECT () 是语法错)。"""
    assert gate.allowed_tables() == set(schema.tables()) == set(setup.tables())
    assert all(spec["columns"] for spec in setup.tables().values())


#: 只是连接用的键,不是业务叫法。
_KEYS = {"id", "soul_id", "judgment_id", "origin_judgment_id"}


def _vocabulary(table, column):
    """一列在 yaml 里的全部叫法:同义词、说明(去掉括号里的补充)、枚举值的每个含义。"""
    spec = next(c for c in TABLES[table]["columns"] if c["name"] == column)
    words = [*(spec.get("synonyms") or []), re.split(r"[(（]", spec["label"])[0]]
    for meaning in (spec.get("values") or {}).values():
        words += [w.strip() for w in re.split(r"[/·]", meaning)]
    return [w for w in words if w]


def _gold_columns(case):
    tree = sqlglot.parse_one(case["gold_sql"], read="postgres")
    aliases = {t.alias_or_name: t.name for t in tree.find_all(exp.Table)}
    for col in tree.find_all(exp.Column):
        if col.name in _KEYS:
            continue
        owners = [aliases[col.table]] if col.table else [
            t for t in set(aliases.values()) if any(c["name"] == col.name for c in TABLES[t]["columns"])]
        if owners:  # 没有主人的是 SELECT 里起的别名(`AS n`)
            yield owners[0], col.name


@pytest.mark.parametrize("case", [c for c in features.evalset("ask_data")["cases"] if c["category"] != "adversarial"],
                         ids=lambda c: c["id"])
def test_every_column_a_question_needs_is_named_in_the_question_by_one_of_its_words(case):
    """§5:用评测集反查。gold_sql 用到的每一列,问题里都要出现它在 yaml 里的某个叫法 —— 不然召回与模型看到的
    表说明里没有官员的这句话。缺了就往那一列的 synonyms 里补。"""
    missing = [(t, c) for t, c in _gold_columns(case) if not any(w in case["question"] for w in _vocabulary(t, c))]
    assert missing == [], (case["question"], missing)


# ── 召回 ────────────────────────────────────────────────────────────────


class BigramEmbed:
    """`/api/embed` 的替身:每段文本按相邻两字(只取汉字与字母数字)哈希到 `DIMS` 维再计数。
    查询去掉指令前缀(真模型也不把前缀当内容)。确定性,不出网。"""

    DIMS = 512

    def __init__(self):
        self.inputs = []
        self.fail = None

    def vector(self, text):
        if text.startswith(schema.QUERY_INSTRUCTION):
            text = text[len(schema.QUERY_INSTRUCTION):]
        chars = [ch for ch in text.lower() if ch.isalnum()]
        v = [0.0] * self.DIMS
        for a, b in zip(chars, chars[1:], strict=False):
            v[int(hashlib.md5((a + b).encode()).hexdigest(), 16) % self.DIMS] += 1.0
        return v

    def __call__(self, url, payload, timeout):
        self.inputs.append(list(payload["input"]))
        if self.fail:
            raise vectors.EmbeddingError(self.fail)
        return {"model": payload["model"], "embeddings": [self.vector(t) for t in payload["input"]]}


@pytest.fixture
def embed(monkeypatch, settings):
    settings.ASSISTANT_EMBEDDING_URL = "http://ollama.test:11434"
    settings.ASSISTANT_EMBEDDING_MODEL = "fake-embed"
    settings.ASSISTANT_EMBEDDING_DIMS = None
    settings.ASSISTANT_RETRIEVAL_MIN_SIMILARITY = 0.0
    cache.clear()
    fake = BigramEmbed()
    monkeypatch.setattr(vectors, "_post", fake)
    return fake


@pytest.mark.parametrize("question, first", [
    ("冤魂申诉还有几件没判", "judgment_judgment"),
    ("今年第一殿结了多少案", "judgment_judgment"),
    ("受刑计划已完成的有几个", "sentence_plan_sentenceplan"),
    ("永久刑和刑期超过一百年的各有多少", "disposition_disposition"),
    # 没有 souls_soul 的一格:二元组替身是字面重合,灵魂类问题的字面在四段说明里都有(「灵魂」「功过」),
    # 实测最好的一题领先也不到 0.02。那是替身的上限,不是召回的;真模型上的排序未核实。
])
def test_recall_puts_the_table_that_answers_first(embed, question, first):
    got = schema.recall(question)
    assert got.mode == "vector" and got.tables[0] == first
    assert len(got.tables) == schema.K == 3 and len(set(got.tables)) == 3
    assert set(got.tables) < set(schema.tables())


def test_the_table_vectors_are_cached_and_only_the_question_is_embedded_again(embed):
    schema.recall("冤魂申诉还有几件没判")
    schema.recall("受刑计划已完成的有几个")
    assert [len(i) for i in embed.inputs] == [1 + len(schema.tables()), 1]
    assert embed.inputs[1] == [schema.QUERY_INSTRUCTION + "受刑计划已完成的有几个"]


def test_a_changed_description_is_embedded_again(embed, monkeypatch):
    schema.recall("冤魂申诉还有几件没判")
    original = schema.table_text
    monkeypatch.setattr(schema, "table_text", lambda t: original(t) + ("!" if t == "souls_soul" else ""))
    schema.recall("冤魂申诉还有几件没判")
    assert [len(i) for i in embed.inputs] == [5, 5]


def test_the_blocked_service_falls_back_to_every_table():
    """根 conftest 的默认:`_post` 像主机不通一样失败。"""
    cache.clear()
    got = schema.recall("冤魂申诉还有几件没判")
    assert got == schema.Recall("fallback", schema.tables())
    assert len(got.tables) == 4


@pytest.mark.parametrize("kind", ["timeout", "connection", "model_not_found", "bad_response"])
def test_any_embedding_failure_falls_back_to_every_table(embed, kind, monkeypatch):
    warmed = []
    monkeypatch.setattr(vectors, "warm_up", warmed.append)
    embed.fail = kind
    assert schema.recall("冤魂申诉还有几件没判") == schema.Recall("fallback", schema.tables())
    assert len(warmed) == (kind == "timeout")


def test_low_similarity_falls_back_to_every_table(embed, settings):
    settings.ASSISTANT_RETRIEVAL_MIN_SIMILARITY = 0.99
    got = schema.recall("冤魂申诉还有几件没判")
    assert got.mode == "fallback_low_similarity" and got.tables == schema.tables()
    assert 0 < got.top_similarity < 0.99


def test_cached_vectors_of_another_dimension_fall_back_and_are_dropped(embed, monkeypatch):
    schema.recall("冤魂申诉还有几件没判")
    monkeypatch.setattr(BigramEmbed, "DIMS", 256)
    assert schema.recall("冤魂申诉还有几件没判").mode == "fallback"
    assert schema.recall("冤魂申诉还有几件没判").mode == "vector"  # 缓存已丢,这次连同四张表重嵌
    assert [len(i) for i in embed.inputs] == [5, 1, 5]
