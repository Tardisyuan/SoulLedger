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

DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "yes")

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

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS
CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = os.getenv(
    "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3333,http://192.168.2.115:3333"
).split(",")
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "origin",
    "user-agent",
    "x-tenant-id",
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
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/minute",
        "register": "5/hour",
        "login": "10/minute",
        "password_reset": "3/5minute",
    },
}

# JWT Settings
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
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    # Logging - JSON format for production
    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "format": '{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
            },
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
        # Reached from both `apps.disposition` and `apps.realms`, which is the
        # "multiple names for the same choice set" warning. `apps.realms.Realm`
        # imports the class rather than restating the four values — the comment
        # there says why — so there is exactly one set with two routes to it.
        "MemoryResetMechanismEnum": "apps.disposition.models.MemoryResetMechanism.choices",
    },
}

# Encryption key for Fernet (death sync webhook secrets)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")

# Sentry integration
import sentry_sdk
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
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[DjangoIntegration()],
        traces_sample_rate=0.1,
        send_default_pii=False,
    )
