# Sourced by backup-db.sh and restore-drill.sh: `ops_alert "<one line>"`.
#
# OPS_ALERT_WEBHOOK_URL set: POST {"text": …, "content": …} there (Slack / Mattermost
# read `text`, Discord reads `content`; a generic receiver gets both). curl if the
# image has it, else wget (busybox wget in postgres:16-alpine does --post-data).
# Not set, or the POST fails: say so on stderr. Never silent, never fatal — the
# caller's own exit code is what the healthcheck and the log already carry.
ops_alert() {
    _msg="[SoulLedger $(hostname 2>/dev/null || echo '?')] $1"
    if [ -z "${OPS_ALERT_WEBHOOK_URL:-}" ]; then
        echo "ALERT (OPS_ALERT_WEBHOOK_URL not set; nobody was notified): $_msg" >&2
        return 0
    fi
    _esc=$(printf '%s' "$_msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\t' '  ')
    _body="{\"text\":\"$_esc\",\"content\":\"$_esc\"}"
    if command -v curl >/dev/null 2>&1; then
        curl -fsS -m 10 -H 'Content-Type: application/json' --data "$_body" "$OPS_ALERT_WEBHOOK_URL" >/dev/null && _sent=1
    elif command -v wget >/dev/null 2>&1; then
        wget -q -T 10 -O /dev/null --header 'Content-Type: application/json' --post-data "$_body" "$OPS_ALERT_WEBHOOK_URL" && _sent=1
    fi
    if [ "${_sent:-}" = 1 ]; then
        echo "Alert sent: $_msg" >&2
    else
        echo "ALERT (webhook POST failed or no curl/wget; nobody was notified): $_msg" >&2
    fi
    unset _sent
}
