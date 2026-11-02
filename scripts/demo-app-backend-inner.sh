#!/usr/bin/env bash
# Inside the demo container: the demo's seeded world with the phone able to reach it, to record the apps by hand.
#   DEMO_PUBLISH="-p 8011:8000" scripts/demo-remote.sh scripts/demo-app-backend-inner.sh
# A throwaway database with a throwaway password; every soul account is listed in /sl-tmp/demo-app-accounts.tsv.
. /app/scripts/demo-backend-up.sh || exit 1
export ALLOWED_HOSTS='*'
"$PY" manage.py shell <<'PYEOF'
from django.utils import timezone
from apps.soul_accounts.models import SoulAccount
from apps.souls.models import Soul
with open("/sl-tmp/demo-app-accounts.tsv", "w") as out:
    for a in SoulAccount.objects.select_related("user", "soul"):
        a.user.set_password("demo-only-not-a-secret"); a.user.save()
        a.must_change_password = False; a.initial_password_expires_at = None; a.save()
        out.write("\t".join([a.soul.name, a.soul.current_state, a.soul.home_civilization, a.user.username]) + "\n")
PYEOF
echo "demo app backend: ready"
exec "$PY" manage.py runserver 0.0.0.0:8000 --noreload
