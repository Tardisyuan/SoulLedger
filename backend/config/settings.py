"""
Django settings for SoulLedger project.
"""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable must be set in production")


def _env_bool(name, default):
    return os.getenv(name, default).lower() in ("true", "1", "yes")


DEBUG = _env_bool("DEBUG", "False")

if DEBUG:
    # In DEBUG mode, allow localhost by default
    ALLOWED_HOSTS = os.getenv(
        "ALLOWED_HOSTS",
        "localhost,127.0.0.1,[::1]",
    ).split(",")
else:
    # In production, ALLOWED_HOSTS must be explicitly configured
    _hosts = os.getenv("ALLOWED_HOSTS", "")
    if not _hosts:
        raise ValueError(
            "ALLOWED_HOSTS environment variable must be set in production (DEBUG=False). "
            "Example: ALLOWED_HOSTS=example.com,www.example.com"
        )
    ALLOWED_HOSTS = [h.strip() for h in _hosts.split(",") if h.strip()]

# How many proxies sit in front of this application.
#
# 0 means `X-Forwarded-For` is ignored entirely and REMOTE_ADDR is the client
# address -- correct for a directly-exposed service, and the safe default for
# one whose deployment shape is not written down anywhere. The header is
# client-supplied; honouring it without knowing the chain is what let a
# restricted API key be used from any address and let a login brute-force
# limiter be reset at will. See apps/core/client_ip.py.
TRUSTED_PROXY_COUNT = int(os.environ.get("TRUSTED_PROXY_COUNT", "0"))

INSTALLED_APPS = [
    "daphne",
    "channels",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "django_celery_beat",
    "drf_spectacular",
    # Local apps
    "apps.tenants",
    "apps.authentication",
    "apps.souls",
    "apps.judgment",
    "apps.disposition",
    "apps.ledger",
    "apps.reincarnation",
    "apps.workflow",
    "apps.actors",
    "apps.realms",
    "apps.events",
    "apps.audit",
    "apps.menus",
    "apps.perm",
    "apps.notifications",
    "apps.dispatch",
    "apps.org",
    "apps.death_sync",
    "apps.social",
    "apps.scheduler",
    "apps.soul_accounts",
    "apps.soul_push",
    "apps.chat",
    "apps.sentence_plan",
    "apps.soul_assist",
    "apps.officer_app",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # 只有这一个 request-context 中间件。`apps.core.middleware` 曾经并排挂在下面
    # 一行,做的事是这一个的严格子集(它的 __call__ 少一次 set_current_request,
    # process_view 完全相同且同样从不触发),2026-08-28 整个模块删除。
    "apps.core.request_local.RequestContextMiddleware",
    "apps.tenants.middleware.TenantMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Channel Layers (for WebSocket real-time events)
import urllib.parse as _urlparse

_redis_parsed = _urlparse.urlparse(REDIS_URL)
CHANNEL_LAYER_SOCKET_TIMEOUT = 15  # seconds; must exceed channels_redis's brpop_timeout (5)
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [
                {
                    "host": _redis_parsed.hostname or "localhost",
                    "port": _redis_parsed.port or 6379,
                    "db": int(_redis_parsed.path.lstrip("/") or "0"),
                    **({"password": _redis_parsed.password} if _redis_parsed.password else {}),
                    # redis-py 8 defaults socket_timeout to 5 s, and channels_redis waits on
                    # BZPOPMIN for up to 5 s (its brpop_timeout) when no message is queued: every
                    # idle socket read then times out, the consumer dies and the web shows
                    # "reconnecting" every few seconds. redis-py 6.4 defaulted to no timeout; the
                    # lock has carried redis 8.x since a4d6ce79 (2026-09-14). Seen 2026-09-30:
                    # 280 TimeoutErrors in one local session. The read must outlast the pop.
                    "socket_timeout": CHANNEL_LAYER_SOCKET_TIMEOUT,
                }
            ],
            "capacity": 1500,
            "expiry": 10,
        },
    },
}

# Database
import dj_database_url

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}")
if not DEBUG and "sqlite" in DATABASE_URL.lower():
    raise ValueError(
        "SQLite must not be used in production (DEBUG=False). "
        "Set DATABASE_URL to a PostgreSQL connection string."
    )
DATABASES = {
    "default": dj_database_url.parse(
        DATABASE_URL, conn_max_age=600, conn_health_checks=True
    )
}
# pgbouncer in transaction pool mode cannot hold a server-side cursor across
# statements, and every `.iterator()` in apps/ opens one. The production
# compose sets this; it is off by default because without a server-side cursor
# `.iterator()` loads the whole result set client-side (IS-13).
DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = _env_bool(
    "DISABLE_SERVER_SIDE_CURSORS", "false"
)

AUTH_USER_MODEL = "authentication.User"

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = []

# Uploaded files (user avatars). Both are set explicitly because Django's
# defaults — MEDIA_URL "/" and MEDIA_ROOT "" (the working directory) — are
# exactly what served `backend/` itself under DEBUG (BP-05). MEDIA_ROOT is a
# directory of its own: never the checkout, never `backend/`
# (tests/test_debug_does_not_serve_the_source_tree.py). Locally that is
# `<repo>/media` (gitignored); the compose stack sets MEDIA_ROOT to the
# `media_files` volume, which nginx serves at /media/ in production.
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT") or BASE_DIR.parent / "media")

# 帖子图片(MEDIA_ROOT/private/)的出口 `/api/v1/social-media/<id>/`:验完签名与可见性之后,
# 打开 = 回一个空响应带 `X-Accel-Redirect`,由 nginx 的 internal location 发文件(nginx.conf
# `/protected-media/`);关着 = Django 自己 `FileResponse` 流出去。**只在前面真有那个 nginx 时打开**
# (docker-compose.production.yml 打开;DEBUG、staging 没有 nginx,开了图片就全是空的)。
POST_MEDIA_X_ACCEL = _env_bool("POST_MEDIA_X_ACCEL", "False")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS
CORS_ALLOW_ALL_ORIGINS = DEBUG
# The default is localhost only. It used to name `http://192.168.2.115:3333`,
# one particular machine on one particular LAN — a default that ships a
# specific host's address to every checkout and every deployment that does not
# override it (BP-18). That box is reachable via `CORS_ALLOWED_ORIGINS` in its
# own environment, and under DEBUG `CORS_ALLOW_ALL_ORIGINS` above makes the
# list moot anyway.
# 两步验证的「不再询问」设备 cookie 由 API 源下发(httpOnly),前端带 withCredentials 调登录与验码;
# 允许的源是上面的显式清单,不是 *,所以可以带凭据。
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = os.getenv(
    "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3333"
).split(",")
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "origin",
    "user-agent",
    "x-requested-with",
]

# REST Framework
REST_FRAMEWORK = {
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # 只认官员令牌;灵魂令牌与 SOUL 角色一律 403。见该模块文档。
        "apps.soul_accounts.authentication.OfficerJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # NOT `rest_framework.throttling.AnonRateThrottle`. DRF's keys on the
    # client's own `X-Forwarded-For` whenever `NUM_PROXIES` is unset — which it
    # is here — so one extra header reset the only default rate limit in the
    # project. The subclass keys on `apps/core/client_ip.py`, the same answer
    # the audit log, `ExternalApiKey.allowed_ips` and the login limiter use
    # (IS-01). `NUM_PROXIES` is deliberately still unset: `TRUSTED_PROXY_COUNT`
    # is the one setting that says how many proxies are in front of us.
    "DEFAULT_THROTTLE_CLASSES": [
        "apps.core.throttling.AnonRateThrottle",
    ],
    # `login` (10/minute) is gone with `LoginThrottle`: nothing referenced
    # either, and `LoginView.post` enforces a stricter counter of its own.
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/minute",
        "register": "5/hour",
        "password_reset": "3/5minute",
        # 「忘记密码」→ 通知本殿管理员(apps/authentication/views.py::password_help_request)。
        "password_help": "5/hour",
        # 官员邮箱重置密码的申请(apps/authentication/officer_reset_views.py),按 IP 计。
        "officer_password_reset": "5/hour",
        # 聊天按编号查人(apps/chat/views.py::MeChatLookupView),按灵魂账号计。编号空间
        # 31^10,穷举本来就不可行;这个数限制的是「拿一份收集来的编号表逐个验证」。
        "chat_lookup": "20/hour",
        # 朋友圈帖子图片的文件出口(apps/social/media_views.py),按签名里的查看者计。
        # 一屏动态流 20 条 × 9 张 = 180 张图;匿名的 60/minute 会把它掐断。
        "post_media": "600/minute",
        # 助手提问(apps/soul_assist/views.py::MeAssistView 按灵魂账号计;OfficerAssistView 按官员计,
        # 读的也是这一个速率 —— docs/ARCHITECTURE-officer-assist.md §6 Q3 = A)。
        "assist": "30/hour",
    },
}

# App 版本检查(GET /api/v1/app-version/)。后端只给数字,比较在 App 里做。
# 默认全空 = 不限制;具体版本号由发布时设环境变量决定:
#   APP_VERSION_<APP>_<PLATFORM>_{MIN,LATEST,STORE_URL},APP ∈ SOUL/OFFICER,PLATFORM ∈ IOS/ANDROID。
APP_VERSION_POLICY = {
    app: {
        platform: {
            "min_supported": os.getenv(f"APP_VERSION_{app.upper()}_{platform.upper()}_MIN", ""),
            "latest": os.getenv(f"APP_VERSION_{app.upper()}_{platform.upper()}_LATEST", ""),
            "store_url": os.getenv(f"APP_VERSION_{app.upper()}_{platform.upper()}_STORE_URL", ""),
        }
        for platform in ("ios", "android")
    }
    for app in ("soul", "officer")
}

# JWT Settings
# 官员端 App 的刷新令牌有效期(小时):A13 规格「会话更短」。默认 24 小时 —— 滑动的:App 每次刷新
# 都从当下重新计 24 小时,所以每天用的人不会被踢,闲置一天就要重新登录(带两步验证)。
# 官员台(Web)与灵魂端不受影响,仍是下面的 JWT_REFRESH_LIFETIME(默认 7 天)。
OFFICER_APP_REFRESH_LIFETIME_HOURS = int(os.getenv("JWT_OFFICER_APP_REFRESH_LIFETIME_HOURS", "24"))

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_LIFETIME", "30"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_REFRESH_LIFETIME", "10080"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    # Without this, SimpleJWT never writes `last_login` -- it defaults to False
    # and nothing else in `apps/authentication/` touches the column. Measured on
    # the shared box 2026-08-31: **0 of 100 users** had a non-null `last_login`,
    # including the account that owns 22 audit rows.
    #
    # That is worse than a missing feature, because the column reads like an
    # answer. Two separate investigations on this repo cited "从未登录" as
    # evidence about an account -- once about the orphaned `Pluto` account, once
    # about four Norse-bound admins -- and in both cases the field was empty for
    # everybody, so it distinguished nothing. A column that is null for every
    # row cannot be used to tell rows apart, and it takes reading the settings
    # to find that out.
    "UPDATE_LAST_LOGIN": True,
}

# Permission Cache TTL (seconds)
CACHE_PERMISSION_TTL = int(os.getenv("CACHE_PERMISSION_TTL", "300"))  # 5 minutes

# How long the PROCESS-LOCAL fallback may hold a grant when Redis is down.
#
# **Zero by default: while Redis is down, do not cache permission answers.**
#
# The Redis entry is shared, so a revocation clears it for everyone at once
# (`invalidate_role` SCANs and deletes, and every write endpoint in
# apps/perm/views.py calls it). The fallback dict is per process: worker A's
# revocation cannot reach worker B's memory, so B keeps answering from a copy
# nobody can invalidate until the entry expires on its own.
#
# MEASURED, two real processes, Redis pointed at a closed port, SQLite scratch
# DB shared between them. A reads the grant, B reads the grant, A deletes the
# RolePermission row and calls `invalidate_all_permissions()`, then B asks
# again:
#
#     fallback TTL   B right after A's revocation   B at +20s   B goes False at
#     300 (was)      True   (DB already says False) True        +301.5s
#      15            True   (DB already says False) —           +16.5s
#       0            False                          False       immediately
#
# So a bounded TTL only narrows the window; **only 0 closes it**. On an
# authorization decision, during an outage, answering from a copy that cannot
# be invalidated is the wrong trade.
#
# The cost, measured on the same setup: 200 `check_permission` calls take
# 0 queries / 0.3 µs each when the fallback serves, and 2 queries / 217 µs each
# when it does not. Two indexed `.exists()` lookups per check, only while Redis
# is down. Raise this if that is the wrong trade for a given deployment — the
# number above is what it buys back.
CACHE_PERMISSION_FALLBACK_TTL = int(
    os.getenv("CACHE_PERMISSION_FALLBACK_TTL", "0")
)

# Namespace for the shared permission keys.
#
# `perm:{role}:{codename}` carried no deployment prefix, so two deployments
# pointed at one Redis share each other's grants — and CLAUDE.md already
# records test runs writing `perm:*` into the shared box. Defaults to the empty
# string so an existing deployment's keys are not orphaned by an upgrade; set
# it per environment.
CACHE_PERMISSION_KEY_PREFIX = os.getenv("CACHE_PERMISSION_KEY_PREFIX", "")

# How long PermissionCache waits after a failed Redis connect attempt before
# retrying, instead of reconnecting on every cache miss. See apps/perm/cache.py.
CACHE_REDIS_RETRY_COOLDOWN = int(os.getenv("CACHE_REDIS_RETRY_COOLDOWN", "5"))  # seconds

# Cache (Redis)
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

# Celery
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/1")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/2")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"

# apps.scheduler — TaskRun history and the "did it run" detection.
# Retention: delete finished runs older than this many days ...
SCHEDULER_RUN_RETENTION_DAYS = int(os.getenv("SCHEDULER_RUN_RETENTION_DAYS", "30"))
# ... except FAILURE and LOST runs, which are kept this long: they are the rows
# someone comes back to look for, and a small fraction of the table.
SCHEDULER_FAILED_RUN_RETENTION_DAYS = int(os.getenv("SCHEDULER_FAILED_RUN_RETENTION_DAYS", "365"))
# ... but always keep the newest N per job, so a monthly job's history is not
# emptied by a daily sweep.
SCHEDULER_RUN_KEEP_MIN = int(os.getenv("SCHEDULER_RUN_KEEP_MIN", "20"))
# A PENDING run not picked up by a worker within this many seconds is LOST
# (the broker dropped it, or no worker is consuming). 15 minutes: long enough
# for a real backlog, short enough that the next daily job is not blamed.
SCHEDULER_PENDING_GRACE_SECONDS = int(os.getenv("SCHEDULER_PENDING_GRACE_SECONDS", "900"))
# A job whose schedule should have fired this many seconds ago with no run
# recorded is "overdue". 10 minutes = two missed ticks of the 5-minutely job.
SCHEDULER_OVERDUE_GRACE_SECONDS = int(os.getenv("SCHEDULER_OVERDUE_GRACE_SECONDS", "600"))

# apps.soul_push — 灵魂端推送(Expo Push Service)。见 docs/DEPLOYMENT.md「灵魂端推送」。
# 默认关:没打开时事件照常记录成投递行,状态标 DISABLED(「未启用」),不访问 Expo、不报错。
SOUL_PUSH_ENABLED = _env_bool("SOUL_PUSH_ENABLED", "False")
# 可选。只有在 Expo 控制台开启「增强推送安全」后才必需;设置了就随每个请求带上。
EXPO_ACCESS_TOKEN = os.getenv("EXPO_ACCESS_TOKEN", "")
# 发送端口的类路径(apps/soul_push/expo.py 文件头)。测试换成假实现。
SOUL_PUSH_SENDER = os.getenv("SOUL_PUSH_SENDER", "apps.soul_push.expo.ExpoPushSender")

# apps.chat — 灵魂端聊天(Matrix / Synapse)。见 docs/DEPLOYMENT.md「灵魂聊天」。
# 默认关:没打开时 /me/chat/ 一律 503,不访问 Synapse、不建任何行。与 SOUL_PUSH_ENABLED
# 同一形状,理由也同一条:未部署 Synapse 的环境(本地、CI)照常跑全量测试。
MATRIX_ENABLED = _env_bool("MATRIX_ENABLED", "False")
# 后端→Synapse 走 compose 网络;灵魂的客户端走 nginx 反代的公开地址。两者不同,
# 且**只有后者**会出现在发给 App 的会话响应里。
MATRIX_INTERNAL_URL = os.getenv("MATRIX_INTERNAL_URL", "http://synapse:8008")
MATRIX_PUBLIC_BASEURL = os.getenv("MATRIX_PUBLIC_BASEURL", "")
MATRIX_SERVER_NAME = os.getenv("MATRIX_SERVER_NAME", "")
# 与 Synapse 的 jwt_config.secret 是同一个值。后端用它签两种东西:发给 App 的
# 短时效登录凭据,以及后端自己代灵魂发言时换取的 access token。
MATRIX_JWT_SECRET = os.getenv("MATRIX_JWT_SECRET", "")
# 与 Synapse 的 registration_shared_secret 同一个值。**只用一次**:把服务账号
# 注册成 admin(`/_synapse/admin/v1/register`)。之后一律走 JWT 登录。
MATRIX_REGISTRATION_SHARED_SECRET = os.getenv("MATRIX_REGISTRATION_SHARED_SECRET", "")
# 服务账号:每个房间都由它创建,官员收件箱的官员一侧也是它。
MATRIX_SERVICE_LOCALPART = os.getenv("MATRIX_SERVICE_LOCALPART", "soulledger")
# 灵魂的 Matrix localpart 由账号 id 经 HMAC 派生(apps/chat/identity.py)。这个盐
# 单独一份:泄漏 SECRET_KEY 不等于能把 mxid 反推回账号,反之亦然。**不设则拒绝启用聊天**。
MATRIX_USER_SALT = os.getenv("MATRIX_USER_SALT", "")
# 发给 App 的登录凭据有效期。够一次登录往返,不够转手给别人用。
MATRIX_LOGIN_TOKEN_TTL_SECONDS = int(os.getenv("MATRIX_LOGIN_TOKEN_TTL_SECONDS", "120"))
# 非互关私聊请求的间隔(2026-09-17 用户决定:每 24 小时一条)。
CHAT_REQUEST_INTERVAL_SECONDS = int(os.getenv("CHAT_REQUEST_INTERVAL_SECONDS", str(24 * 3600)))
# 客户端的类路径。测试换成假实现(tests/chat_support.py),于是单元测试一条 HTTP 都不发。
MATRIX_CLIENT = os.getenv("MATRIX_CLIENT", "apps.chat.matrix.SynapseClient")

# apps.soul_assist — 灵魂端助手(docs/ARCHITECTURE-soul-assist.md)。
# 默认关:关着时 /me/assist/ 一律 503 `assistant_not_configured`,不访问任何供应商。
# 打开之后还要每殿打开:Tenant.settings["assistant_enabled"] = true(灵魂读原属殿;官员读请求所在殿,
# 与灵魂端共用这一个开关;令牌不带殿的 ADMIN 只看全局开关)。
ASSISTANT_ENABLED = _env_bool("ASSISTANT_ENABLED", "False")
# 供应商的类路径:apps.soul_assist.providers.OpenAICompatibleProvider(OpenAI / Azure /
# Ollama / DeepSeek 等,配 BASE_URL)或 ...AnthropicProvider。测试换成 FakeProvider。
ASSISTANT_PROVIDER = os.getenv("ASSISTANT_PROVIDER", "apps.soul_assist.providers.AnthropicProvider")
ASSISTANT_BASE_URL = os.getenv("ASSISTANT_BASE_URL", "")
ASSISTANT_API_KEY = os.getenv("ASSISTANT_API_KEY", "")
ASSISTANT_MODEL = os.getenv("ASSISTANT_MODEL", "claude-opus-5")
# Anthropic 的 output_config.effort;帮助台不需要深推理。模型不支持 effort 时设成空串。
ASSISTANT_EFFORT = os.getenv("ASSISTANT_EFFORT", "low")
# Anthropic 服务端拒答回退(beta server-side-fallback-2026-07-01);空串即关。
ASSISTANT_ANTHROPIC_FALLBACKS = os.getenv("ASSISTANT_ANTHROPIC_FALLBACKS", "default")
# 非流式:整次回答的上限。流式:第一段文本的上限(首字截止)。App 在 25 秒时按超时处理
# (设计稿「问一问」1e),服务端必须先放弃。取问题向量(至多 3 秒)也算在里面。
ASSISTANT_TIMEOUT_SECONDS = float(os.getenv("ASSISTANT_TIMEOUT_SECONDS", "22"))
# 流式的总上限(从收到提问算起;docs/ARCHITECTURE-soul-assist.md §13)。出过字以后到这里还没答完 →
# 按「中断」收尾,已生成的部分照存。必须小于并发名额键的 TTL(service._Slot.TTL = 120)。
ASSISTANT_STREAM_TOTAL_SECONDS = float(os.getenv("ASSISTANT_STREAM_TOTAL_SECONDS", "60"))
# 配了备用供应商时,主用最多等这么久出第一段文本,剩下的首字预算(22 − 12)留给备用(§13)。
ASSISTANT_PRIMARY_FIRST_TOKEN_SECONDS = float(os.getenv("ASSISTANT_PRIMARY_FIRST_TOKEN_SECONDS", "12"))
# 全局同时进行的问答数。一次回答最长占一个线程约 22 秒(流式至多 60 秒);真正的上限是 PG 连接。
ASSISTANT_MAX_CONCURRENT = int(os.getenv("ASSISTANT_MAX_CONCURRENT", "8"))
# 每次送给模型的历史条数(user + assistant 各算一条)。
ASSISTANT_HISTORY_TURNS = int(os.getenv("ASSISTANT_HISTORY_TURNS", "20"))
# 向量检索(docs/ARCHITECTURE-soul-assist.md §7)。管理页可覆盖这几项(库优先,env 是初始值)。
# 地址是局域网里的 Ollama;上线前要换成部署内可达的服务(§7.8)。
ASSISTANT_EMBEDDING_URL = os.getenv("ASSISTANT_EMBEDDING_URL", "http://192.168.2.2:11434")
ASSISTANT_EMBEDDING_MODEL = os.getenv("ASSISTANT_EMBEDDING_MODEL", "qwen3-embedding:4b-q4_K_M")
# 截断维度(Ollama 的 `dimensions`);空 = 模型原生维度(qwen3-embedding 为 2560)。
ASSISTANT_EMBEDDING_DIMS = int(os.getenv("ASSISTANT_EMBEDDING_DIMS") or 0) or None
ASSISTANT_RETRIEVAL_K = int(os.getenv("ASSISTANT_RETRIEVAL_K", "5"))
# 最近一条的余弦相似度低于它 → 这一问退回整份语料(retrieval=fallback_low_similarity)。取值依据见 docs/ARCHITECTURE-soul-assist.md §7.9。
ASSISTANT_RETRIEVAL_MIN_SIMILARITY = float(os.getenv("ASSISTANT_RETRIEVAL_MIN_SIMILARITY", "0.56"))
# 提问时取问题向量的超时(在 ASSISTANT_TIMEOUT_SECONDS 之内,不重试);重建向量用更长的超时。
ASSISTANT_EMBEDDING_TIMEOUT_SECONDS = float(os.getenv("ASSISTANT_EMBEDDING_TIMEOUT_SECONDS", "3"))

# Logging
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {"format": "{levelname} {asctime} {module} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "apps": {"handlers": ["console"], "level": "DEBUG", "propagate": False},
    },
}

# Production settings
if not DEBUG:
    # Security
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    # On by default. Staging runs DEBUG=False with nothing terminating TLS in
    # front of it, and a redirect to an https nobody answers is a dead stack;
    # its compose file sets this to false. The production compose passed
    # this variable for months while nothing read it (IS-04).
    SECURE_SSL_REDIRECT = _env_bool("SECURE_SSL_REDIRECT", "true")
    # `/health/` answers load balancers and uptime probes, which speak plain http
    # to port 80 and read a 301 as "down". It returns only {"status": "ok"}.
    # `/health/detailed/` is deliberately NOT exempt: it needs an ADMIN session,
    # and a session over plain http is what this redirect exists to prevent.
    # `/api/v1/chat/hooks/new-message/` is Synapse calling the backend over the compose network
    # (plain http to backend:8000, no nginx in between). The policy module cannot add an
    # X-Forwarded-Proto header, so a 301 here makes every chat push fail silently while messages
    # still flow. The endpoint accepts no session or token — only a body signed with the shared
    # grant secret inside a 5-minute window (apps/chat/hook.py) — so plain http leaks nothing.
    SECURE_REDIRECT_EXEMPT = [r"^health/$", r"^api/v1/chat/hooks/new-message/$"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    # Logging - JSON format for production
    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            # A real encoder, not a JSON-shaped `%` template: that one broke
            # on any quote or newline in a message (IS-22).
            "json": {"()": "config.json_logging.JsonFormatter"},
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "json",
            },
        },
        "root": {
            "handlers": ["console"],
            "level": "INFO",
        },
    }

# drf-spectacular (API docs)
SPECTACULAR_SETTINGS = {
    "TITLE": "SoulLedger API",
    # The generated document must not record which database generated it.
    # See apps/core/schema.py::drop_engine_dependent_integer_bounds — Django
    # derives every integer field's min/max from the backend, so a schema
    # generated on SQLite disagreed with CI's PostgreSQL in 32 components.
    "POSTPROCESSING_HOOKS": [
        "drf_spectacular.hooks.postprocess_schema_enums",
        "apps.core.schema.drop_engine_dependent_integer_bounds",
    ],
    "DESCRIPTION": "Cross-civilization soul management system API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # Named choice sets, because the generator's fallback names are hashes.
    #
    # Six choice sets collide on two field names — three `status` and two
    # `role`, plus one set reached under two names. Left alone, the generator
    # resolves each collision by appending a hash of the members:
    # `StatusF3dEnum`, `StatusAa4Enum`, `StatusDd2Enum`, `Role511Enum`,
    # `RoleF35Enum`. Those are the names a client generator turns into
    # TypeScript, so the frontend would import `Role511Enum` and have to guess
    # which of the two roles it is. Worse, the hash is derived from the members:
    # adding one verdict to a choice set RENAMES the generated type, and the
    # diff shows a deletion and an addition rather than an added member.
    #
    # The keys below are the names; the values are the choice sets they name.
    "ENUM_NAME_OVERRIDES": {
        "ApprovalWorkflowStatusEnum": "apps.workflow.models.ApprovalWorkflowStatus.choices",
        "CrossTenantJudgmentStatusEnum": "apps.dispatch.models.JudgmentStatus.choices",
        "DispatchStatusEnum": "apps.dispatch.models.DispatchStatus.choices",
        "ActorRoleEnum": "apps.actors.models.ActorRole.choices",
        "UserRoleEnum": "apps.authentication.models.UserRole.choices",
        "PasswordResetRefusalCodeEnum": "apps.authentication.serializers.PASSWORD_RESET_REFUSAL_CODES",
        # Reached from both `apps.disposition` and `apps.realms`, which is the
        # "multiple names for the same choice set" warning. `apps.realms.Realm`
        # imports the class rather than restating the four values — the comment
        # there says why — so there is exactly one set with two routes to it.
        "MemoryResetMechanismEnum": "apps.disposition.models.MemoryResetMechanism.choices",
        # apps.realms 行程拓扑:`kind` 已被另一个选项集(reference/domain)占用,不钉住
        # 就是带哈希的 `KindD0cEnum`。`region` / `fork` 是太通用的字段名,一并钉住,
        # 免得下一个同名字段把它们改名。
        "RealmKindEnum": "apps.realms.models.RealmKind.choices",
        "CommediaRegionEnum": "apps.realms.models.CommediaRegion.choices",
        "RealmForkEnum": "apps.realms.models.RealmFork.choices",
        # apps.scheduler: `status` and `scope` are both names other components
        # already use for different choice sets. Naming only the new set is not
        # enough — the collision check counts every set under the field name,
        # so Role.scope's until-then-unique `ScopeEnum` would be renamed to a
        # hashed `ScopeE81Enum`. Pinning it under its existing name keeps the
        # generated TypeScript identifier unchanged.
        # `UserPreferencesSerializer.email_locale` 与 `EvalCase.locale` 是同一组 (zh-Hans, en):
        # 不钉住,drf-spectacular 给第二处起名 EmailLocaleEnum,再把另一个 `locale` 字段改成
        # 带哈希的 Locale188Enum。钉在既有的名字下,生成的 TypeScript 标识符不变。
        "EvalCaseLocaleEnum": "apps.authentication.serializers.EMAIL_LOCALES",
        "TaskRunStatusEnum": "apps.scheduler.models.RunStatus.choices",
        "ScheduledJobScopeEnum": "apps.scheduler.models.JobScope.choices",
        # 助手管理「供应商」区块的平台(2026-09-30):`platform` 另有别的选项集用着。
        "AssistPlatformEnum": "apps.soul_assist.platforms.PLATFORM_IDS",
        "ScopeEnum": "apps.perm.models.Role.SCOPE_CHOICES",
        # apps.soul_accounts:`status` 与 `desired_form` 两个字段名在别处已有别的选项集。
        # 灵魂提交时不收 OTHER,于是 desired_form 有两套(完整的与去掉 OTHER 的),各自命名。
        "RebirthApplicationStatusEnum": "apps.soul_accounts.models.RebirthApplicationStatus.choices",
        "CooldownShorteningStatusEnum": "apps.soul_accounts.models.CooldownShorteningStatus.choices",
        "RebirthFormEnum": "apps.reincarnation.models.RebirthForm.choices",
        # apps.soul_assist:两端各有一个 `screen` 选项集。灵魂端的保留原名(mobile 与 core 引用
        # `ScreenEnum`),官员端另起名 —— 不钉住就两个都变成带前缀的名字。
        "ScreenEnum": "apps.soul_assist.models.SCREENS",
        "OfficerScreenEnum": "apps.soul_assist.models.OFFICER_SCREENS",
        # 助手管理页:`side` / `status` 都是别处已占的字段名。
        "AssistSideEnum": "apps.soul_assist.models.AssistUsage.SIDES",
        "AssistEvalRunStatusEnum": "apps.soul_assist.models.AssistEvalRun.STATUSES",
        # 主用 / 备用(用量页的 by_provider.role 与试问结果的 provider_role 同一组)
        "AssistProviderRoleEnum": "apps.soul_assist.models.AssistUsage.PROVIDER_ROLES",
        # 向量检索(§7.6):`error_kind` 在连通测试里已是供应商的那套;向量服务的另起名,供应商的保留原名。
        "ErrorKindEnum": "apps.soul_assist.admin_serializers.ERROR_KINDS",
        # apps.death_sync 管理端 Webhook 的 `events` 是 EventType 的列表,与 SoulEvent.event_type
        # 同一个选项集走两条路(`EventsEnum` / `EventTypeEnum`);钉住原名,TS 标识符不变。
        "EventTypeEnum": "apps.events.models.EventType.choices",
        "EmbeddingErrorKindEnum": "apps.soul_assist.vectors.ERROR_KINDS",
        "AssistRetrievalEnum": "apps.soul_assist.admin_serializers.RETRIEVALS",
        "DesiredRebirthFormEnum": "apps.soul_accounts.serializers.DESIRED_REBIRTH_FORMS",
        # `welcomed_civilizations`(App 欢迎过场)用的是灵魂的 Civilization 选项集;钉在既有的
        # `CivilizationEnum` 上,否则多出一个同值的 `WelcomedCivilizationsEnum` 并报 warning。
        "CivilizationEnum": "apps.souls.models.Civilization.choices",
        # 灵魂端受刑计划(/me/sentence-plan/):`status` / `state` 都是别处已占的字段名。
        "SoulSentenceStationStatusEnum": "apps.sentence_plan.soul_view.STATION_STATUSES",
        "SoulSentencePlanStateEnum": "apps.sentence_plan.soul_view.PLAN_STATES",
        # approve_node 的请求体(WorkflowNodeActionSerializer)写进文档之后,它的 verdict 与
        # judgment 的 Verdict 撞名;不钉住,既有的 `VerdictEnum` 会被改成带哈希的名字,
        # frontend 的 enumsMatchTheSchema 测试按名字找它。
        "VerdictEnum": "apps.judgment.models.Verdict.choices",
        # 处置列表的 `soul_state` 与灵魂的 `current_state` 是同一个选项集;钉在既有的
        # `CurrentStateEnum` 上,客户端类型名不变。
        "CurrentStateEnum": "apps.souls.models.SoulState.choices",
        # 处置列表的三段(`section`)。字段名太通用,带前缀钉住。
        "DispositionSectionEnum": "apps.disposition.models.DispositionSection.choices",
        "NodeDecisionVerdictEnum": "apps.workflow.serializers.NODE_DECISION_VERDICTS",
        # apps.soul_push:`platform` 与 `locale` 是太通用的字段名,不钉住的话,下一个同名字段
        # 进 schema 时这两个会被改成带哈希的名字,客户端的类型名跟着变。
        "PushPlatformEnum": "apps.soul_push.models.PushPlatform.choices",
        "PushLocaleEnum": "apps.soul_push.models.PushLocale.choices",
        # 灵魂朋友圈:`my_reaction`(可空的输出字段)与 `reaction_type` 是同一个选项集,
        # 不钉住就是「multiple names for the same choice set」—— 钉在既有的名字上,
        # 官员侧 social 的 `ReactionTypeEnum` 不变。
        "ReactionTypeEnum": "apps.social.models.ReactionType.choices",
        # 审核后台的五个选项集按字段名会叫 ReasonEnum / TargetTypeEnum / ResolutionEnum /
        # ReportStatusEnum —— 太通用,并行的 feat/soul-chat 或下一个 `reason` 字段一进 schema,
        # 这几个名字就会被改成带哈希的,客户端类型名跟着变。带上 Social 前缀钉住。
        "SocialReportReasonEnum": "apps.social.models.ReportReason.choices",
        "SocialReportTargetEnum": "apps.social.models.ReportTargetType.choices",
        "SocialReportResolutionEnum": "apps.social.models.ReportResolution.choices",
        "SocialReportStatusEnum": "apps.social.models.ReportStatus.choices",
        "SocialModerationStatusEnum": "apps.social.models.ModerationStatus.choices",
        # 敏感词的 `action` / `category` 与「已处理」的 `type` / `handling`:字段名都太通用,
        # `action` 一进 schema,审计的 `ActionEnum` 就被改名成 `Action364Enum`。
        # 新的带 Social 前缀;审计那个钉在既有名字上(见下面权限矩阵那段的 `ActionEnum`)。
        "SocialSensitiveWordActionEnum": "apps.social.models.SensitiveWordAction.choices",
        "SocialSensitiveWordCategoryEnum": "apps.social.models.SensitiveWordCategory.choices",
        "SocialHandledTypeEnum": "apps.social.moderation_serializers.HANDLED_TYPES",
        "SocialHandlingEnum": "apps.social.moderation_serializers.HANDLING_CHOICES",
        # 聊天的 `kind`(DIRECT / OFFICER_INBOX)。按字段名会与别处的 `kind` 撞成带哈希的名字。
        "ConversationKindEnum": "apps.chat.models.ConversationKind.choices",
        # 受刑计划(docs/ARCHITECTURE-sentence-plan.md):`kind` 与 `status` 两个字段名在别处已有
        # 别的选项集。回收站的 `KindEnum` 钉在既有名字上,新增的各自带前缀。
        "KindEnum": "apps.core.recycle_bin_views.RECYCLE_BIN_KINDS",
        "JudgmentKindEnum": "apps.judgment.models.JudgmentKind.choices",
        "SentencePlanRequestKindEnum": "apps.sentence_plan.models.SentenceRequestKind.choices",
        "SentencePlanRequestStatusEnum": "apps.sentence_plan.models.SentenceRequestStatus.choices",
        "SentencePlanStatusEnum": "apps.sentence_plan.models.SentencePlanStatus.choices",
        # 权限矩阵按格保存(apps/perm/matrix.py):`action` 与审计日志的 `action` 撞名,
        # 不钉住,既有的 `ActionEnum` 会被改成带哈希的名字。`status` / `code` 同理,带前缀钉住。
        "ActionEnum": "apps.audit.models.AuditAction.choices",
        "MatrixChangeActionEnum": "apps.perm.matrix.ACTIONS",
        "MatrixChangeStatusEnum": "apps.perm.matrix.STATUSES",
        "MatrixChangeCodeEnum": "apps.perm.matrix.RESULT_CODES",
        "RoleDeleteRefusalCodeEnum": "apps.perm.matrix.ROLE_DELETE_REFUSAL_CODES",
        "SentenceNodeStatusEnum": "apps.sentence_plan.models.SentenceNodeStatus.choices",
        # 灵魂批量移入回收站的拒绝码。字段名 `code` 太通用,不钉住就叫 `CodeEnum`,
        # 下一个 `code` 选项集进 schema 时会被改成带哈希的名字。
        "SoulBatchRecycleErrorCodeEnum": "apps.souls.serializers.SOUL_BATCH_RECYCLE_ERROR_CODES",
    },
}

# Encryption key for Fernet — `WebhookConfig.signing_secret` (the HMAC secret
# that authenticates our outgoing webhooks) and
# `DeathRegistrationRequest.source_payload` (PII from an external feed).
#
# Empty means those two columns hold PLAINTEXT: `apps/death_sync/fields.py`
# treats a missing key as "encryption is optional" and stores the value as-is.
# That was the default, README and SECURITY both described the columns as
# encrypted, and nothing said otherwise at runtime (IS-02). So: required
# outside DEBUG, warned about inside it, and validated either way — a key that
# is not a real Fernet key would otherwise fail on every write instead of here.
from django.core.exceptions import ImproperlyConfigured  # noqa: E402

_KEY_HELP = (
    'Generate one with: python -c "from cryptography.fernet import Fernet; '
    'print(Fernet.generate_key().decode())"'
)

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
if ENCRYPTION_KEY:
    from cryptography.fernet import Fernet  # noqa: E402

    try:
        Fernet(ENCRYPTION_KEY.encode())
    except (ValueError, TypeError) as exc:
        raise ImproperlyConfigured(
            f"ENCRYPTION_KEY is not a valid Fernet key (32 url-safe base64 bytes). {_KEY_HELP}"
        ) from exc
elif not DEBUG:
    raise ImproperlyConfigured(
        "ENCRYPTION_KEY must be set when DEBUG=False: without it "
        "WebhookConfig.signing_secret and DeathRegistrationRequest.source_payload "
        f"are written to the database in plaintext. {_KEY_HELP}"
    )
else:
    import warnings  # noqa: E402

    warnings.warn(
        "ENCRYPTION_KEY is not set: death-sync webhook secrets and death "
        "registration payloads will be stored UNENCRYPTED. Allowed because "
        f"DEBUG=True; refused when DEBUG=False. {_KEY_HELP}",
        stacklevel=2,
    )

# Email — the password-reset code is the only thing sent today (BP-12).
# DEBUG prints mail to the console; otherwise SMTP from EMAIL_* variables.
# No EMAIL_HOST outside DEBUG is a startup warning, not a refusal: the app
# works without mail except for reset, and the reset endpoint answers the same
# either way so a send failure never becomes a registration oracle.
EMAIL_BACKEND = os.getenv(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend" if DEBUG else "django.core.mail.backends.smtp.EmailBackend",
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "25"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = _env_bool("EMAIL_USE_TLS", "False")
EMAIL_USE_SSL = _env_bool("EMAIL_USE_SSL", "False")
EMAIL_TIMEOUT = int(os.getenv("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "noreply@soulledger.local")
if not DEBUG and not os.getenv("EMAIL_HOST"):
    import warnings  # noqa: E402

    warnings.warn(
        "EMAIL_HOST is not set (DEBUG=False): password-reset codes will be "
        "attempted against SMTP on localhost:25 and, if that fails, never arrive.",
        stacklevel=2,
    )

# 官员邮件里的链接指向的 Web 地址(密码重置 / 邮箱验证),无末尾斜杠。
DESK_URL = os.getenv("DESK_URL", "http://localhost:3000").rstrip("/")
# Django 的一次性令牌(PasswordResetTokenGenerator)的有效期:官员重置密码与邮箱验证链接都是 1 小时。
PASSWORD_RESET_TIMEOUT = 3600

# Sentry integration
import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.django import DjangoIntegration

SENTRY_DSN = os.getenv("SENTRY_DSN", "")
if not SENTRY_DSN and not DEBUG:
    import warnings
    warnings.warn(
        "SENTRY_DSN is not set in production (DEBUG=False). "
        "Error tracking via Sentry will be unavailable.",
        stacklevel=2,
    )
if SENTRY_DSN:
    from apps.soul_assist.sentry import scrub_assist

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[
            DjangoIntegration(),
            # Sentry Crons check-ins for every beat-dispatched task. Verified
            # against the installed sources (sentry-sdk 2.66.1, django-celery-
            # beat 2.9.0): the integration patches `celery.beat.Scheduler.
            # apply_entry`, and DatabaseScheduler subclasses Scheduler without
            # overriding apply_entry, so it is covered; `_get_monitor_config`
            # accepts any `crontab` subclass, which TzAwareCrontab is, and reads
            # its `.tz`. Monitor slug = PeriodicTask.name.
            CeleryIntegration(monitor_beat_tasks=True),
        ],
        traces_sample_rate=0.1,
        send_default_pii=False,
        # 助手接口的请求体与栈帧局部变量是灵魂的原文(apps/soul_assist/sentry.py)。
        before_send=scrub_assist,
    )
