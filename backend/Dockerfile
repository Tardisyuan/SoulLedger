# ---- Base stage ----
FROM python:3.11-slim as base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# ---- Dependencies stage ----
FROM base as deps
RUN pip install --no-cache-dir pip==24.0
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- Build stage ----
FROM base as builder
COPY --from=deps /install /usr/local
COPY backend/ .
RUN python manage.py collectstatic --noinput || true

# ---- Production stage ----
FROM base as production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DJANGO_SETTINGS_MODULE=config.settings
COPY --from=builder /app /app
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["gunicorn", "--bind", ":8000", "--workers", "4", "--threads", "2", "config.wsgi:application"]
