"""把 `service.session` 的事件写成 Server-Sent Events(docs/ARCHITECTURE-soul-assist.md §13)。

**生成器在视图里先走一步**(取出 meta):进门的失败(忙、会话不存在)因此在响应开始之前抛出,仍是 JSON 与状态码;
并发名额也在这一步占下,之后由生成器的 finally 还 —— 响应从没被迭代(客户端在响应头之前就走了)时,
生成器被回收也会关掉它。

**两种服务器,两种迭代器,同一个同步生成器:**

- WSGI(测试客户端):同步迭代器,Django 边迭代边写。
- ASGI(daphne,生产与 `runserver`):Django 会把同步迭代器**整个读完**再发(`StreamingHttpResponse.__aiter__`),
  所以给它一个异步迭代器,每一步用 `sync_to_async(thread_sensitive=True)` 回到这个请求自己的线程 ——
  ORM 调用与视图在同一个线程、同一条连接上。
  **客户端断开**:Django 取消这个任务,CancelledError 从正在等的那一步(或 `yield`)抛进来,走到 finally,
  在同一个请求线程里关掉同步生成器 —— 供应商的流随之关闭,已生成的部分按 stopped 存下。那个线程若正停在
  socket 读上(等供应商的下一段),关闭排在它后面:停止要等那一段到了(或超时)才生效,从外面打断不了。

每一步都在视图当时的 contextvars 里跑(`ctx.run`):中间件在视图返回后就清掉了当前殿,而生成器要到那之后才跑。
"""
import contextvars
import json

from asgiref.sync import sync_to_async
from django.http import StreamingHttpResponse
from rest_framework.utils.encoders import JSONEncoder

CONTENT_TYPE = "text/event-stream; charset=utf-8"
_END = object()


def frame(data: dict) -> bytes:
    body = json.dumps(data, cls=JSONEncoder, ensure_ascii=False)
    return f"event: {data['event']}\ndata: {body}\n\n".encode()


def _pull(events, render):
    event = next(events, _END)
    return _END if event is _END else frame(render(event))


def _sync(first, events, ctx, render):
    try:
        yield first
        while (chunk := ctx.run(_pull, events, render)) is not _END:
            yield chunk
    finally:
        ctx.run(events.close)


async def _async(first, events, ctx, render):
    step = sync_to_async(ctx.run, thread_sensitive=True)
    try:
        yield first
        while (chunk := await step(_pull, events, render)) is not _END:
            yield chunk
    finally:
        await step(events.close)


def response(request, events, render):
    """`events`:`service.session(..., stream=True)`。先取出 meta(失败即抛 `AssistError`),再开始流式响应。
    `render`:事件 → 要发出去的 dict(done 事件里的模型对象在这里序列化,在请求线程里)。"""
    first = frame(render(next(events)))
    ctx = contextvars.copy_context()
    raw = getattr(request, "_request", request)
    body = (_async if hasattr(raw, "scope") else _sync)(first, events, ctx, render)
    resp = StreamingHttpResponse(body, content_type=CONTENT_TYPE)
    resp["Cache-Control"] = "no-cache"
    # nginx 默认缓冲上游响应,SSE 会被攒成一整块才发;这个头让它对这一条响应不缓冲(nginx.conf 另有 location)。
    resp["X-Accel-Buffering"] = "no"
    return resp
