# Build context is the REPOSITORY ROOT (root docker-compose.yml: `context: .`;
# infrastructure/docker-compose.prod.yml: `context: ..`), so every COPY is
# `backend/...`. The root `Dockerfile` copied the same paths from a `./backend`
# context, which is outside that context and could never build (IS-08); it is
# gone, this is the one backend image. What the context leaves out is in
# `/.dockerignore` — `backend/.env`, `test.db`, `coverage*.json` (IS-07).
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings
WORKDIR /app

# ---- Dependencies: compilers stay in this stage only ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- Runtime ----
FROM base AS production
COPY --from=deps /install /usr/local
RUN useradd --create-home --shell /bin/bash appuser
COPY --chown=appuser:appuser backend/ .
# `collectstatic` runs at container start (compose `command`), not here: it
# imports settings, which refuse to load without SECRET_KEY, so the old
# `RUN collectstatic || true` collected nothing and hid that. The directory
# is a volume nginx serves as /static/ (IS-14).
RUN mkdir -p /app/staticfiles && chown appuser:appuser /app/staticfiles
USER appuser
EXPOSE 8000
# ASGI, not `gunicorn config.wsgi`: WSGI never serves the channels WebSocket
# routes (IS-06). daphne is the ASGI server requirements.txt already pins.
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
