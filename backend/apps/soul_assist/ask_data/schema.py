"""问数的表结构与召回(docs/ARCHITECTURE-ask-data.md §5)。

`schema.yaml` 是唯一来源:这里读它,给出白名单表、授权列、每张表给模型看的说明(只含授权列),
以及按问题召回最近的 k 张表。

**向量不落库。** 只有四张表:四段说明的向量放在 Django cache 里,键是模型 / 维度 / 说明全文的哈希
(说明或模型一变就换键,不用重建命令);没命中时与问题同一次 `vectors.embed` 请求一起取。
不复用 `HelpChunk`:`vectors.sync` 会删掉帮助语料里没有的行,`status()` 也会把它们算成「要重建」。

**降级照 `vectors.retrieve` 的规矩**:向量服务不通、超时、维度对不上 → `fallback`;最近一张的相似度低于
下限 → `fallback_low_similarity`。两种都返回全部白名单表(只有四张,整份不长)。召回失败不是错误。
"""
import hashlib
import logging
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import yaml
from django.conf import settings
from django.core.cache import cache as django_cache

from apps.soul_assist import config, vectors

logger = logging.getLogger(__name__)

PATH = Path(__file__).with_name("schema.yaml")
#: 召回几张表(§5)。
K = 3
#: 查询侧的指令前缀(qwen3-embedding 的用法,文档侧不带)。相似度下限沿用帮助台的设置项,
#: 那是在帮助台的前缀下量的 —— 用在这里未核实。
QUERY_INSTRUCTION = ("Instruct: Given a question about SoulLedger case data, "
                     "retrieve the database table that answers it\nQuery: ")
CACHE_PREFIX = "ask_data:schema_vectors:"


@cache
def load() -> dict:
    """`tables` 一段:{db_table: {model, soft_delete, description, columns: [...]}}。"""
    return yaml.safe_load(PATH.read_text(encoding="utf-8"))["tables"]


def tables() -> tuple:
    """白名单表名,排好序。"""
    return tuple(sorted(load()))


def granted_columns(table) -> list:
    return [c["name"] for c in load()[table]["columns"] if c["granted"]]


def table_text(table) -> str:
    """一张表的说明:召回语料与给模型的表结构是同一段。未授权的列不出现。"""
    spec = load()[table]
    lines = [f"表 {table}:{spec['description']}"]
    for c in spec["columns"]:
        if not c["granted"]:
            continue
        line = f"- {c['name']} ({c['type']}):{c['label']}"
        if c.get("synonyms"):
            line += f";又叫:{'、'.join(c['synonyms'])}"
        if c.get("values"):
            line += ";取值:" + ",".join(f"{k}={v}" for k, v in c["values"].items())
        lines.append(line)
    return "\n".join(lines)


def describe(names) -> str:
    return "\n\n".join(table_text(t) for t in names)


@dataclass(frozen=True)
class Recall:
    mode: str  # "vector" / "fallback" / "fallback_low_similarity"(与 AssistUsage.RETRIEVALS 同名)
    tables: tuple  # 近的在前;降级时是全部白名单表
    top_similarity: float | None = None


def recall(question, k=K) -> Recall:
    eff = config.effective()
    emb = eff.embedding
    names = tables()
    texts = [table_text(t) for t in names]
    key = CACHE_PREFIX + hashlib.sha256(
        repr((vectors.model_label(emb), names, texts)).encode()).hexdigest()
    docs = django_cache.get(key)
    try:
        out = vectors.embed([QUERY_INSTRUCTION + question] + ([] if docs else texts), emb,
                            settings.ASSISTANT_EMBEDDING_TIMEOUT_SECONDS)
    except vectors.EmbeddingError as exc:
        logger.warning("ask_data schema recall fell back: embedding %s", exc.kind)
        if exc.kind == "timeout":
            vectors.warm_up(emb)
        return Recall("fallback", names)
    query = out[0]
    if not docs:
        docs = out[1:]
        django_cache.set(key, docs, None)
    if any(len(d) != len(query) for d in docs):  # 缓存里是别的维度(按原生维度时模型换了输出)
        django_cache.delete(key)
        return Recall("fallback", names)
    ranked = sorted(((vectors.cosine(d, query), t) for t, d in zip(names, docs, strict=True)),
                    key=lambda st: (-st[0], st[1]))
    top = ranked[0][0]
    if top < eff.retrieval_min_similarity:
        return Recall("fallback_low_similarity", names, top)
    return Recall("vector", tuple(t for _, t in ranked[:k]), top)
