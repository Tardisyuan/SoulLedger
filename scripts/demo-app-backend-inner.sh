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
# A recording moves a finished life into its own century as it writes the JSON (scripts/demo-record.mjs). Here nothing
# writes JSON, so the soul on camera is moved in the database. Its own birth and death are already in their century.
"$PY" manage.py shell <<'PYEOF'
import datetime, os
from django.apps import apps
from django.db import models
from apps.souls.models import Soul
soul = Soul.all_objects.filter(name=os.environ.get("DEMO_CAMERA_SOUL", "曹操")).first()
shift = datetime.timedelta(days=365.2425 * 1806)
for model in apps.get_models():
    names = {f.name for f in model._meta.get_fields()}
    if model is Soul:
        continue
    rows = model._base_manager.filter(soul=soul) if "soul" in names else model._base_manager.filter(plan__soul=soul) if "plan" in names else None
    if rows is None:
        continue
    try:
        dates = [f for f in model._meta.concrete_fields if isinstance(f, (models.DateField, models.DateTimeField))]
        for row in rows:
            model._base_manager.filter(pk=row.pk).update(**{f.name: getattr(row, f.name) - shift for f in dates if getattr(row, f.name)})
    except Exception as exc:
        print("  not moved:", model.__name__, type(exc).__name__)
print("moved:", soul.name)
PYEOF
echo "demo app backend: ready"
exec "$PY" manage.py runserver 0.0.0.0:8000 --noreload
