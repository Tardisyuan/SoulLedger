# Sourced by backup-db.sh and restore-drill.sh: `ops_alert "<one line>"`.
#
# OPS_ALERT_WEBHOOK_URL set: POST {"text": …, "content": …} there (Slack / Mattermost
# read `text`, Discord reads `content`; a generic receiver gets both). curl if the
# image has it, else wget (busybox wget in postgres:16-alpine does --post-data).
#
# Not set, or the POST fails: a loud multi-line block on stderr and return 1, so
# the alert that reached nobody stands out in the container log / cron mail and
# the caller can tell. Callers only alert on a path that already exits non-zero
# and call it as `ops_alert … || true`: their own exit code is what the
# healthcheck and the log carry. A dev run with no webhook therefore still works;
# it just says, loudly, that nobody was told.
ops_alert() {
    _msg="[SoulLedger $(hostname 2>/dev/null || echo '?')] $1"
    if [ -z "${OPS_ALERT_WEBHOOK_URL:-}" ]; then
        _why="OPS_ALERT_WEBHOOK_URL not set; nobody was notified"
    else
        _esc=$(printf '%s' "$_msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\t' '  ')
        _body="{\"text\":\"$_esc\",\"content\":\"$_esc\"}"
        if command -v curl >/dev/null 2>&1; then
            curl -fsS -m 10 -H 'Content-Type: application/json' --data "$_body" "$OPS_ALERT_WEBHOOK_URL" >/dev/null && _sent=1
        elif command -v wget >/dev/null 2>&1; then
            wget -q -T 10 -O /dev/null --header 'Content-Type: application/json' --post-data "$_body" "$OPS_ALERT_WEBHOOK_URL" && _sent=1
        fi
        if [ "${_sent:-}" = 1 ]; then
            unset _sent
            echo "Alert sent: $_msg" >&2
            return 0
        fi
        _why="webhook POST failed or no curl/wget; nobody was notified"
    fi
    {
        echo "################################################################"
        echo "ALERT NOT DELIVERED ($_why):"
        echo "  $_msg"
        echo "################################################################"
    } >&2
    return 1
}
