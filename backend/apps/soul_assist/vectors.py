"""向量检索(docs/ARCHITECTURE-soul-assist.md §7):Ollama 取向量、语料 → `HelpChunk` 同步、提问时取最近的 k 条。

- **出网只有 `_post` 一处。** 测试里根 conftest 的 autouse fixture 把它换成直接失败;要向量的测试自己装假的。
- **检索失败不是错误。** 向量服务不通、超时、库里没有向量 → `fallback`(整份语料);最近一条的相似度低于
  下限 → `fallback_low_similarity`(同样整份语料)。助手不能因为向量服务挂了而答不了(§7.5)。
- **PostgreSQL 上排序在库里做**(pgvector 的 `<=>`,按行数自动建 HNSW 表达式索引);SQLite 上同一列存
  `[x,y,…]` 文本,余弦在 Python 里算。两者给同一个排序,由 PG-only 测试钉住。
"""
import hashlib
import logging
import threading
from dataclasses import dataclass

import numpy as np
import requests
from django.conf import settings
from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone

from apps.soul_assist import config, corpus

logger = logging.getLogger(__name__)

#: 连通测试嵌入的固定句子。
TEST_SENTENCE = "被驳回了还能申诉吗?"
#: qwen3-embedding 的查询要带指令前缀(文档侧不带)。§7.5 的相似度下限是在这个前缀下量的:改了它要重量。
QUERY_INSTRUCTION = ("Instruct: Given a question asked in the SoulLedger help desk, "
                     "retrieve the help entry that answers it\nQuery: ")
#: 管理页「测试」按钮的超时:不在回答的 22 秒预算里,冷模型首次加载(实测约 8 秒)也测得通。
TEST_TIMEOUT_SECONDS = 10
#: 重建时的超时:冷模型首次加载实测约 8 秒(§7.1),提问时的 3 秒不够。
SYNC_TIMEOUT_SECONDS = 60
BATCH = 16
#: 当前模型的行数到了这个数才建 HNSW 索引;少于它时精确扫描更快且不漏(§7.3)。
INDEX_THRESHOLD = 5000
INDEX_PREFIX = "helpchunk_hnsw_"
TABLE = "soul_assist_helpchunk"
REBUILD_LOCK = "soul_assist:vectors_rebuild"
ERROR_KINDS = ("timeout", "connection", "model_not_found", "dims_mismatch", "bad_response", "other")
#: Ollama unloads an idle model after 5 minutes; keep it while questions keep coming (then it goes).
KEEP_ALIVE = "30m"
#: One background warm-up at a time. A cold load takes ~5 s (measured 2026-09-30) and a request that
#: gives up at 3 s makes Ollama abort the load, so without this every question timed out (24 of 24).
WARM_KEY = "soul_assist:vectors_warming"


class EmbeddingError(Exception):
    def __init__(self, kind, detail=""):
        super().__init__(f"{kind}: {detail}" if detail else kind)
        self.kind = kind


class RebuildRunningError(Exception):
    pass


def _post(url, payload, timeout):
    """唯一出网的地方。不重试:提问时的 3 秒已经在 22 秒的总预算里。"""
    try:
        resp = requests.post(url, json=payload, timeout=timeout)
    except requests.Timeout as exc:
        raise EmbeddingError("timeout") from exc
    except requests.RequestException as exc:
        raise EmbeddingError("connection", type(exc).__name__) from exc
    if resp.status_code == 404:  # Ollama:模型没拉下来
        raise EmbeddingError("model_not_found")
    if resp.status_code != 200:
        raise EmbeddingError("other", f"HTTP {resp.status_code}")
    try:
        return resp.json()
    except ValueError as exc:
        raise EmbeddingError("bad_response") from exc


def embed(texts, emb: config.Embedding, timeout) -> list:
    """Ollama `/api/embed`。要了截断维度而返回的不是它,或一批里维度不一 → `dims_mismatch`。"""
    payload = {"model": emb.model, "input": list(texts), "keep_alive": KEEP_ALIVE}
    if emb.dims:
        payload["dimensions"] = emb.dims
    data = _post(emb.url.rstrip("/") + "/api/embed", payload, timeout)
    vectors = data.get("embeddings") if isinstance(data, dict) else None
    if not isinstance(vectors, list) or len(vectors) != len(texts) or not all(
            isinstance(v, list) and v for v in vectors):
        raise EmbeddingError("bad_response")
    dims = {len(v) for v in vectors}
    if len(dims) != 1 or (emb.dims and dims != {emb.dims}):
        raise EmbeddingError("dims_mismatch", f"asked {emb.dims or 'native'}, got {sorted(dims)}")
    return vectors


def entry_text(e) -> str:
    return "\n".join(e["questions"]) + "\n\n" + e["body"]


def content_hash(e, emb: config.Embedding) -> str:
    """嵌入的文本连同截断维度:截断维度变了,同一模型的向量也要重嵌。模型名另列一列(`HelpChunk.model`)。"""
    return hashlib.sha256(f"dims={emb.dims or 'native'}\n{entry_text(e)}".encode()).hexdigest()


def model_label(emb: config.Embedding) -> str:
    return f"{emb.model}@{emb.dims}" if emb.dims else emb.model


def _corpus():
    return {(locale, e["id"]): (audience, e) for locale in corpus.LOCALES for audience in corpus.AUDIENCES
            for e in corpus.entries(locale, audience)}


# ── 同步:语料 → 向量(§7.4)────────────────────────────────────────────────


def sync(emb=None, *, index_threshold=INDEX_THRESHOLD, timeout=SYNC_TIMEOUT_SECONDS) -> dict:
    """幂等:只嵌入新增或变了的条目(`content_hash` + `model`),删掉语料里已没有的。

    **全有或全无**:这一次要的向量全部取到,才在一个事务里换进去;任何一批失败(`EmbeddingError`)就丢掉
    这一次,库里仍是上一套完整的向量,失败原因与时间记在配置行上(`status()` 报出,下次成功时清掉)。
    同一时间只跑一个(`RebuildRunningError`)。**测试通过不会自动重建**:换模型或维度保存后
    `status()["needs_rebuild"]` 为真,重建完成前检索只找得到别的模型 / 维度的行,于是退回整份语料。"""
    from apps.soul_assist.models import AssistConfig

    if not cache.add(REBUILD_LOCK, 1, 10 * 60):
        raise RebuildRunningError
    try:
        return _sync(emb or config.effective().embedding, index_threshold, timeout)
    except EmbeddingError as exc:
        AssistConfig.objects.get_or_create(pk=1)
        AssistConfig.objects.filter(pk=1).update(vectors_error=exc.kind, vectors_error_at=timezone.now())
        raise
    finally:
        cache.delete(REBUILD_LOCK)


def _sync(emb, index_threshold, timeout):
    from apps.soul_assist.models import AssistConfig, HelpChunk

    want = _corpus()
    have = {(r.locale, r.entry_id): r for r in HelpChunk.objects.only("locale", "entry_id", "content_hash", "model")}
    todo = [k for k, (_, e) in want.items()
            if k not in have or have[k].content_hash != content_hash(e, emb) or have[k].model != emb.model]
    vectors = []
    for i in range(0, len(todo), BATCH):
        vectors += embed([entry_text(want[k][1]) for k in todo[i:i + BATCH]], emb, timeout)
    with transaction.atomic():
        gone = [have[k].pk for k in have if k not in want]
        deleted = HelpChunk.objects.filter(pk__in=gone).delete()[0] if gone else 0
        for (locale, entry_id), vector in zip(todo, vectors, strict=True):
            audience, e = want[(locale, entry_id)]
            HelpChunk.objects.update_or_create(locale=locale, entry_id=entry_id, defaults={
                "audience": audience, "screens": e["screens"], "civilizations": e["civilizations"],
                "content": e["body"], "content_hash": content_hash(e, emb), "model": emb.model,
                "dims": len(vector), "embedding": vector})
        dims = len(vectors[0]) if vectors else (
            HelpChunk.objects.filter(model=emb.model).values_list("dims", flat=True).first())
        index = _maintain_index(emb.model, dims, index_threshold)
        AssistConfig.objects.get_or_create(pk=1)
        AssistConfig.objects.filter(pk=1).update(vectors_synced_at=timezone.now(),
                                                 vectors_synced_model=model_label(emb), vectors_error="",
                                                 vectors_error_at=None)
    return {"embedded": len(todo), "unchanged": len(want) - len(todo), "deleted": deleted,
            "model": emb.model, "dims": dims, **index}


def _cast_type(dims):
    """HNSW 的维度上限:vector 2000、halfvec 4000;再大就不建索引,也不转型。"""
    if dims is None:
        return None
    return "vector" if dims <= 2000 else "halfvec" if dims <= 4000 else None


def index_name(model, dims) -> str:
    """带模型与维度,可重复执行;模型名取哈希,标识符才不超过 63 字节、不含冒号。"""
    return f"{INDEX_PREFIX}{hashlib.sha1(model.encode()).hexdigest()[:10]}_{dims}"


def _maintain_index(model, dims, threshold) -> dict:
    """只在 PostgreSQL 上:删掉别的模型 / 维度的索引;当前模型的行数到阈值时建部分 HNSW 表达式索引。"""
    from apps.soul_assist.models import HelpChunk

    if connection.vendor != "postgresql":
        return {"index": None, "dropped": []}
    name = index_name(model, dims) if dims else None
    with connection.cursor() as cursor:
        cursor.execute("SELECT indexname FROM pg_indexes WHERE tablename = %s", [TABLE])
        existing = {row[0] for row in cursor.fetchall() if row[0].startswith(INDEX_PREFIX)}
        dropped = sorted(existing - {name})
        for old in dropped:
            cursor.execute(f'DROP INDEX IF EXISTS "{old}"')
        cast = _cast_type(dims)
        if (name and cast and name not in existing
                and HelpChunk.objects.filter(model=model, dims=dims).count() >= threshold):
            cursor.execute(
                f'CREATE INDEX IF NOT EXISTS "{name}" ON {TABLE} USING hnsw '
                f"((embedding::{cast}({dims})) {cast}_cosine_ops) WHERE model = %s AND dims = %s", [model, dims])
            existing.add(name)
    return {"index": name if name in existing else None, "dropped": dropped}


def status() -> dict:
    """管理页的「重建向量」区块:条目数、按当前配置已嵌入的条数、上次重建。"""
    from apps.soul_assist.models import AssistConfig, HelpChunk

    emb = config.effective().embedding
    want = {k: content_hash(e, emb) for k, (_, e) in _corpus().items()}
    rows = list(HelpChunk.objects.values_list("locale", "entry_id", "content_hash", "model"))
    embedded = sum(1 for locale, entry_id, h, m in rows if m == emb.model and want.get((locale, entry_id)) == h)
    row = AssistConfig.objects.filter(pk=1).values("vectors_synced_at", "vectors_synced_model", "vectors_error",
                                                   "vectors_error_at").first() or {}
    return {"entries": len(want), "embedded": embedded,
            "needs_rebuild": embedded < len(want) or len(rows) > len(want),
            "model": model_label(emb), "last_rebuild_at": row.get("vectors_synced_at"),
            "last_rebuild_model": row.get("vectors_synced_model") or None,
            "last_error": row.get("vectors_error") or None, "last_error_at": row.get("vectors_error_at"),
            "rebuild_running": cache.get(REBUILD_LOCK) is not None}


def probe(emb: config.Embedding) -> dict:
    """连通测试:嵌入一句固定问题,报延迟与返回的维度。通过的候选记下来,15 分钟内可以保存。"""
    import time

    start = time.monotonic()
    try:
        vector = embed([QUERY_INSTRUCTION + TEST_SENTENCE], emb, TEST_TIMEOUT_SECONDS)[0]
    except EmbeddingError as exc:
        return {"ok": False, "error_kind": exc.kind, "latency_ms": int((time.monotonic() - start) * 1000),
                "dims": None}
    config.remember_tested(emb)
    return {"ok": True, "error_kind": None, "latency_ms": int((time.monotonic() - start) * 1000),
            "dims": len(vector)}


# ── 提问时(§7.5)──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Retrieval:
    mode: str  # AssistUsage.RETRIEVALS
    entries: tuple = ()  # 进了上下文的条目 id,近的在前;只在 mode == "vector" 时有
    top_similarity: float | None = None


def retrieve(question, locale, audience, civilization=None, *, screen=None, release=lambda: None) -> Retrieval:
    """按语言、受众、文明(条目的 `civilizations` 为空或含 `civilization`;官员不按文明过滤)过滤,
    取余弦最近的 k 条;`screen`(提问来自哪一页)只改这 k 条的次序 —— 头里列了这一页的条目排到前面,
    各组内仍按余弦 —— 不改 k,不改入选。`release` 在出网前调:取向量的这几秒不占着数据库连接。"""
    from apps.soul_assist.models import HelpChunk

    eff = config.effective()
    emb = eff.embedding
    allowed = [e["id"] for e in corpus.entries(locale, audience) if e["id"] not in corpus.PINNED
               and (civilization is None or not e["civilizations"] or civilization in e["civilizations"])]
    rows = HelpChunk.objects.filter(model=emb.model, locale=locale, audience=audience, entry_id__in=allowed)
    if not rows.exists():
        return Retrieval("fallback")
    release()
    try:
        query = embed([QUERY_INSTRUCTION + question], emb, settings.ASSISTANT_EMBEDDING_TIMEOUT_SECONDS)[0]
    except EmbeddingError as exc:
        logger.warning("assistant retrieval fell back: embedding %s", exc.kind)
        if exc.kind == "timeout":
            warm_up(emb)
        return Retrieval("fallback")
    ranked = nearest(rows.filter(dims=len(query)), query, eff.retrieval_k)
    if not ranked:  # 库里的向量是别的维度(换了截断维度还没重建)
        return Retrieval("fallback")
    if ranked[0][0] < eff.retrieval_min_similarity:
        return Retrieval("fallback_low_similarity", top_similarity=ranked[0][0])
    ids = [entry_id for _, entry_id in ranked]
    if screen:
        on_screen = {e["id"] for e in corpus.entries(locale, audience) if screen in e["screens"]}
        ids.sort(key=lambda i: i not in on_screen)  # 稳定排序:同页在前,组内保持余弦次序
    return Retrieval("vector", tuple(ids), ranked[0][0])


def warm_up(emb):
    """Load the model in the background with the rebuild's long timeout, so the next question finds it
    warm. The question that timed out has already fallen back; this one is not waited for."""
    if not cache.add(WARM_KEY, 1, SYNC_TIMEOUT_SECONDS):
        return

    def run():
        try:
            embed(["warm up"], emb, SYNC_TIMEOUT_SECONDS)
        except EmbeddingError as exc:
            logger.warning("assistant embedding warm-up failed: %s", exc.kind)
        finally:
            cache.delete(WARM_KEY)

    threading.Thread(target=run, name="assist-embed-warm-up", daemon=True).start()


def nearest(rows, query, k) -> list:
    """[(余弦相似度, 条目 id)],近的在前;并列按 id。"""
    if connection.vendor == "postgresql":
        from django.db.models.functions import Cast
        from pgvector import HalfVector
        from pgvector.django import CosineDistance, HalfVectorField, VectorField

        # 与 `_maintain_index` 的索引表达式同形,索引才用得上。
        cast = _cast_type(len(query))
        column, value = "embedding", query
        if cast == "vector":
            column = Cast("embedding", VectorField(dimensions=len(query)))
        elif cast == "halfvec":
            column, value = Cast("embedding", HalfVectorField(dimensions=len(query))), HalfVector(query)
        # 只按距离排:HNSW 索引只能给出 `ORDER BY <=> LIMIT`,加一个次序键它就用不上(PG-only 测试看 EXPLAIN)。
        # 并列时的次序因此不定;SQLite 路径按 id 断开并列。
        found = (rows.annotate(distance=CosineDistance(column, value)).order_by("distance")
                 .values_list("distance", "entry_id")[:k])
        return [(1 - distance, entry_id) for distance, entry_id in found]
    q = np.asarray(query, dtype=np.float64)
    scored = sorted((-cosine(r.embedding, q), r.entry_id) for r in rows.only("entry_id", "embedding"))
    return [(-negative, entry_id) for negative, entry_id in scored[:k]]


def cosine(a, b) -> float:
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
