#!/bin/sh
# nginx in the production stack (docker-compose.production.yml runs this as the
# container command). HTTPS when the certificate is there, plain HTTP when not —
# so a missing certificate never keeps nginx from starting (IS-09) and the ACME
# challenge for the first issuance is always served.
#
# The certificate is the Let's Encrypt layout certbot writes:
#   $LETSENCRYPT_DIR/live/$TLS_DOMAIN/fullchain.pem and privkey.pem
# (LETSENCRYPT_DIR defaults to /etc/letsencrypt, mounted read-only from the host).
# Any other CA works: put the two files at those paths.
#
# nginx.conf includes two files this script writes into $NGINX_TLS_DIR:
#   listen.conf    inside the app's server block:
#                  certificate present -> `listen 443 ssl` + the certificate lines
#                  absent              -> `listen 80`
#   redirect.conf  at http level:
#                  certificate present -> a port-80 server: ACME challenge, else 301 to https
#                  absent              -> empty
# One app server block either way, so the routes cannot drift between an http
# and an https copy; the same origin serves the web app, /api/, /ws/ and /_matrix.
#
# Every NGINX_WATCH_SECONDS (300) it renders again and reloads nginx when the
# result changed (the first certificate appeared, or it vanished) or certbot's
# deploy-hook touched $LETSENCRYPT_DIR/.deployed (a renewal). A rendered config
# that fails `nginx -t` is put back and the running one stays.
#
# NGINX_RENDER_ONLY=1: render and exit (tests).
set -eu

LE="${LETSENCRYPT_DIR:-/etc/letsencrypt}"
OUT="${NGINX_TLS_DIR:-/etc/nginx/tls}"
DOMAIN="${TLS_DOMAIN:-}"

render() { # <dir>: write listen.conf + redirect.conf there, print the mode
    mkdir -p "$1"
    cert="$LE/live/$DOMAIN/fullchain.pem"
    key="$LE/live/$DOMAIN/privkey.pem"
    if [ -n "$DOMAIN" ] && [ -s "$cert" ] && [ -s "$key" ]; then
        cat > "$1/listen.conf" <<EOF
listen 443 ssl;
http2 on;
ssl_certificate     $cert;
ssl_certificate_key $key;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
EOF
        cat > "$1/redirect.conf" <<'EOF'
server {
    listen 80;
    server_name _;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}
EOF
        echo https
    else
        echo 'listen 80;' > "$1/listen.conf"
        : > "$1/redirect.conf"
        if [ -n "$DOMAIN" ]; then
            echo "WARNING: TLS_DOMAIN=$DOMAIN but no certificate at $cert; serving plain HTTP only" \
                 "(issue it per docs/DEPLOYMENT.md; nginx switches to HTTPS within ${NGINX_WATCH_SECONDS:-300}s)" >&2
        else
            echo "WARNING: TLS_DOMAIN is not set; serving plain HTTP only" >&2
        fi
        echo http
    fi
}

echo "nginx: $(render "$OUT")"
[ "${NGINX_RENDER_ONLY:-}" = 1 ] && exit 0

touch /tmp/.reloaded
(
    NEXT=/tmp/nginx-tls.next
    OLD=/tmp/nginx-tls.old
    while :; do
        sleep "${NGINX_WATCH_SECONDS:-300}"
        mode=$(render "$NEXT" 2>/dev/null)
        if cmp -s "$NEXT/listen.conf" "$OUT/listen.conf" && cmp -s "$NEXT/redirect.conf" "$OUT/redirect.conf" \
            && ! [ "$LE/.deployed" -nt /tmp/.reloaded ]; then
            continue
        fi
        mkdir -p "$OLD" && cp "$OUT"/*.conf "$OLD"/ && cp "$NEXT"/*.conf "$OUT"/
        if nginx -t -q; then
            echo "certificate state changed or renewed; reloading nginx ($mode)"
            nginx -s reload && touch /tmp/.reloaded
        else
            echo "ERROR: new TLS config fails nginx -t; keeping the running one" >&2
            cp "$OLD"/*.conf "$OUT"/
            touch /tmp/.reloaded
        fi
    done
) &
exec nginx -g 'daemon off;'
