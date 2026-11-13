"""判决文书的真 PDF(用户 2026-11-07):无头 Chromium(Gotenberg)打开前端的只读打印页,拿回 PDF。

为什么不在后端排版:地府文书竖排(`writing-mode: vertical-rl`),WeasyPrint、jsPDF 都排不对;
而且后端另写一份模板,就有两份文书会走样。所以 PDF 出自**网页那一份**渲染:
`VerdictDocument` 的 `VerdictPaper`、`app/verdict-doc.css`、`print.css` 的 `@page verdict`、同一批自托管字体。

一次下载的路径(都在 compose 网络里,不经 nginx):

1. `GET /judgment/{id}/verdict-document.pdf/`(`JudgmentViewSet.verdict_document_pdf`):与详情同一个
   `get_object`(租户划界、暂居只读、`judgment.read`),用**详情的序列化器**序列化这件案子,放进缓存,
   键是 256 位随机串,`VERDICT_PDF_TOKEN_TTL_SECONDS` 过期。
2. 把 `{VERDICT_PDF_FRONTEND_URL}/verdict-print?key=<键>` 交给 Gotenberg 的 Chromium。
3. 前端那页(`frontend/app/verdict-print/page.tsx`,服务端组件)拿键向
   `GET /judgment/verdict-print/<键>/`(`VerdictPrintDataView`)取回第 1 步那份数据 —— 那个接口不认登录,
   **键就是凭据**,它也不查库,所以没有一条不按租户过滤的查询。
4. 页面挂好文书、字体加载完,在 `<body data-verdict-ready="1">` 上打勾;Gotenberg 等到它再出 PDF。
5. 不论成败,缓存里的那份数据都删掉。

服务没配或不在:`RendererUnavailableError`,视图答 503 带 `code`,前端提示后退回浏览器打印。
"""
import json
import re
import secrets
from urllib.parse import urlsplit

import requests
from django.conf import settings
from django.core.cache import cache

#: 有文书的裁决与文明,与 `packages/core/src/domain/verdictDocument.ts` 的 `FINAL` / `CIV` 同一张表。
DOCUMENT_VERDICTS = frozenset({"PASSED", "FAILED", "PURGATORY"})
DOCUMENT_CIVILIZATIONS = frozenset({"CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"})
#: 在上面两张表里、网页却不出文书的组合(`verdictDocument.ts` 开头的 `return null`):地府的存疑不是终判。
#: 希腊的「普通」(阿斯福得草原)第三十四批有了判语,照出。
NO_DOCUMENT = frozenset({("CHINESE", "PURGATORY")})
#: 文书的三种语言;别的值按默认(中文)出。
LOCALES = ("zh-Hans", "en", "egy")
#: 与 `packages/core/src/config/locale.ts` 的 `LOCALE_COOKIE` 同名:前端的根布局按它定语言。
LOCALE_COOKIE = "soulledger-locale"
#: 前端打印页在文书挂好、字体到齐后写的标记。
READY_EXPRESSION = "document.body.dataset.verdictReady === '1'"

_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{32,64}$")
_CACHE_KEY = "verdict-print:{}"


class RendererUnavailableError(Exception):
    """渲染服务没配、连不上、超时或没给回 PDF。`code` 是给前端的错误码。"""

    code = "verdict_pdf_unavailable"


class RendererNotConfiguredError(RendererUnavailableError):
    code = "verdict_pdf_not_configured"


def has_document(judgment) -> bool:
    """这件案子有没有文书:已结,且裁决是通过 / 不过 / 炼狱,且是四文明之一(网页上不渲染的,这里也不出)。"""
    return (
        judgment.is_final
        and judgment.verdict in DOCUMENT_VERDICTS
        and judgment.civilization in DOCUMENT_CIVILIZATIONS
        and (judgment.civilization, judgment.verdict) not in NO_DOCUMENT
    )


def locale_of(value) -> str:
    return value if value in LOCALES else LOCALES[0]


def print_data(key: str):
    """打印页取数据。键不合形状、过期或不存在都是 None。"""
    if not isinstance(key, str) or not _KEY_RE.match(key):
        return None
    return cache.get(_CACHE_KEY.format(key))


def _post(url, fields):
    # multipart/form-data:Gotenberg 只收表单。`(None, value)` 让 requests 发成普通表单字段而不是文件。
    # `allow_redirects=False` like every other outbound call (audit 2026-11-11): the renderer is an operator-set
    # internal address, so no public-only guard — but a redirect from it is not followed anywhere else.
    return requests.post(url, files={k: (None, v) for k, v in fields.items()},
                         timeout=settings.VERDICT_PDF_TIMEOUT_SECONDS, allow_redirects=False)


def render(payload: dict, locale: str) -> bytes:
    """出一份 PDF。`payload` 是打印页要的数据(`{"judgment": …, "soul": …}`)。"""
    renderer = settings.VERDICT_PDF_RENDERER_URL.rstrip("/")
    frontend = settings.VERDICT_PDF_FRONTEND_URL.rstrip("/")
    if not renderer or not frontend:
        raise RendererNotConfiguredError("VERDICT_PDF_RENDERER_URL / VERDICT_PDF_FRONTEND_URL not set")
    key = secrets.token_urlsafe(32)
    cache.set(_CACHE_KEY.format(key), payload, timeout=settings.VERDICT_PDF_TOKEN_TTL_SECONDS)
    try:
        response = _post(f"{renderer}/forms/chromium/convert/url", {
            "url": f"{frontend}/verdict-print?key={key}",
            # `@page verdict` 定 A4 与边距;不设就是 Gotenberg 默认的 Letter。
            "preferCssPageSize": "true",
            # 与浏览器打印同一个媒体类型(print.css 只在 print 下收掉页面其余部分)。
            "emulatedMediaType": "print",
            # 纸张底色照印(用户 2026-11-07)。Chromium 默认不印背景;verdict-doc.css 打印时放回纸色并标 exact。
            "printBackground": "true",
            "waitForExpression": READY_EXPRESSION,
            # 不等网络空闲:根布局里的实时连接等可能一直不「空闲」。等的是上面那个标记,它在字体到齐之后才打上。
            "skipNetworkIdleEvent": "true",
            # 根布局按这个 cookie 定语言,与下载的人此刻的界面语言一致。
            "cookies": json.dumps([{"name": LOCALE_COOKIE, "value": locale_of(locale), "domain": urlsplit(frontend).hostname}]),
        })
    except requests.RequestException as exc:
        raise RendererUnavailableError(str(exc)) from exc
    finally:
        cache.delete(_CACHE_KEY.format(key))
    if response.status_code != 200 or not response.content.startswith(b"%PDF"):
        raise RendererUnavailableError(f"renderer answered {response.status_code}")
    return response.content
