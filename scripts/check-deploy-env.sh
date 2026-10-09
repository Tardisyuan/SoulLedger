#!/usr/bin/env bash
# Validate the production environment BEFORE `docker compose up`.
#
#   scripts/check-deploy-env.sh [ENV_FILE]
#
# With ENV_FILE, only that file's KEY=VALUE lines are read (never sourced, so
# nothing in it is executed); without, the current process environment is used.
# One line per check: PASS / FAIL / WARN. Exit 1 if any FAIL (WARN never fails).
# Secret values are never printed -- only names and lengths.
# Why each variable matters, and what breaks without it: docs/DEPLOY.md.
set -u

FILE="${1:-}"
if [ -n "$FILE" ] && [ ! -f "$FILE" ]; then
  echo "FAIL  env file not found: $FILE"
  exit 2
fi

get() {
  if [ -n "$FILE" ]; then
    local line v
    line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$FILE" | tail -n 1)
    v=${line#*=}
    # strip one pair of surrounding quotes
    case "$v" in \"*\") v=${v#\"}; v=${v%\"};; \'*\') v=${v#\'}; v=${v%\'};; esac
    printf '%s' "$v"
  else
    printf '%s' "${!1:-}"
  fi
}

FAILS=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
warn() { echo "WARN  $1"; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
is_true() { case "$(lower "$1")" in true|1|yes) return 0;; esac; return 1; }

present() { # name
  if [ -n "$(get "$1")" ]; then pass "$1 is set"; return 0; fi
  fail "$1 is missing or empty"; return 1
}

# --- backend core -----------------------------------------------------------
if present SECRET_KEY; then
  n=$(get SECRET_KEY | wc -c | tr -d ' ')
  if [ "$n" -ge 32 ]; then pass "SECRET_KEY length >= 32 bytes ($n)"
  else fail "SECRET_KEY is $n bytes; PyJWT HS256 needs >= 32"; fi
fi

dbg=$(get DEBUG)
if is_true "$dbg"; then fail "DEBUG is true (must be unset or false)"; else pass "DEBUG is not true"; fi

if present ALLOWED_HOSTS; then
  case "$(get ALLOWED_HOSTS)" in
    *'*'*) fail "ALLOWED_HOSTS contains a wildcard";;
    *) pass "ALLOWED_HOSTS has no wildcard";;
  esac
fi

if present DESK_URL; then
  d=$(lower "$(get DESK_URL)")
  case "$d" in
    https://*) pass "DESK_URL is https";;
    *) fail "DESK_URL must start with https://";;
  esac
  case "$d" in
    *localhost*|*127.0.0.1*|*'[::1]'*|*0.0.0.0*) fail "DESK_URL points at localhost";;
    *) pass "DESK_URL is not localhost";;
  esac
fi

if present ENCRYPTION_KEY; then
  # Fernet key = urlsafe base64 of 32 bytes = 43 chars + one '='.
  if printf '%s' "$(get ENCRYPTION_KEY)" | grep -Eq '^[A-Za-z0-9_-]{43}=$'; then
    pass "ENCRYPTION_KEY has Fernet format"
  else
    fail "ENCRYPTION_KEY is not a Fernet key (44 urlsafe-base64 chars ending in '=')"
  fi
fi

# --- databases (compose builds the URLs from the passwords) -----------------
if [ -n "$(get DATABASE_URL)" ]; then
  case "$(lower "$(get DATABASE_URL)")" in
    *sqlite*) fail "DATABASE_URL is SQLite (refused when DEBUG=false)";;
    *) pass "DATABASE_URL is set and not SQLite";;
  esac
else
  present DB_PASSWORD
fi
if [ -z "$(get REDIS_URL)" ]; then present REDIS_PASSWORD; else pass "REDIS_URL is set"; fi

# --- web build --------------------------------------------------------------
if present NEXT_PUBLIC_API_URL; then
  case "$(lower "$(get NEXT_PUBLIC_API_URL)")" in
    https://*) pass "NEXT_PUBLIC_API_URL is https";;
    *) fail "NEXT_PUBLIC_API_URL must start with https://";;
  esac
fi

# --- CORS -------------------------------------------------------------------
cors=$(get CORS_ALLOWED_ORIGINS)
if [ -z "$cors" ]; then
  pass "CORS_ALLOWED_ORIGINS unset (single-origin behind nginx)"
else
  case "$(lower "$cors")" in
    *'*'*|*localhost*) fail "CORS_ALLOWED_ORIGINS has a wildcard or localhost";;
    *) pass "CORS_ALLOWED_ORIGINS has no wildcard or localhost";;
  esac
fi

# --- chat: only when switched on -------------------------------------------
if is_true "$(get MATRIX_ENABLED)"; then
  for v in MATRIX_PUBLIC_BASEURL MATRIX_SERVER_NAME MATRIX_REGISTRATION_SHARED_SECRET MATRIX_USER_SALT SYNAPSE_DB_PASSWORD; do
    present "$v"
  done
  if present MATRIX_JWT_SECRET; then
    n=$(get MATRIX_JWT_SECRET | wc -c | tr -d ' ')
    if [ "$n" -ge 32 ]; then pass "MATRIX_JWT_SECRET length >= 32 bytes"; else fail "MATRIX_JWT_SECRET is $n bytes; needs >= 32"; fi
  fi
else
  pass "MATRIX_ENABLED is off (chat checks skipped)"
fi

# --- recommended, never fatal ----------------------------------------------
[ -n "$(get SENTRY_DSN)" ] && pass "SENTRY_DSN is set" || warn "SENTRY_DSN is empty: no error tracking, no beat monitoring"
[ -n "$(get EMAIL_HOST)" ] && pass "EMAIL_HOST is set" || warn "EMAIL_HOST is empty: password-reset codes will not arrive"

echo "---"
if [ "$FAILS" -gt 0 ]; then echo "$FAILS check(s) FAILED"; exit 1; fi
echo "all required checks passed"
