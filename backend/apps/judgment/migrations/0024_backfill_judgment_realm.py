"""Backfill `Judgment.realm` from `Judgment.court`, only where the text names a court exactly.

`court` has been free text since judgment/0001 ("Court name, e.g. 第一殿"). The
designer's route topology needs a realm id instead, and judgment/0023 added the
column empty. This fills it in for existing rows, **and only where there is no
guessing to do**.

The rule
--------
A judgment gets a realm when all of these hold:

* its `civilization` is CHINESE. The ten courts are the only realms a court
  string can name; a European judgment whose `court` says 第一殿 is a data
  error, and fixing it is not this migration's job;
* its `realm` is still empty (a value set through the API is never replaced);
* `court.strip()` is **character-for-character** one of a court's own names:
  its `name_local` (第一殿), its `name_zh` (第一殿秦广王) or its `realm_code`
  (DY_COURT_01_QINGUANG). The keys are read off the live court rows, not written
  out here, so the mapping follows whatever the courts are called in this
  database;
* that name belongs to exactly one live court. A name two courts share is
  dropped from the map rather than resolved;
* the court is in the judgment's own tenant. A realm is tenant data; a link
  from one tenant's case to another tenant's court would be a cross-tenant
  reference nothing else in the schema allows.

Everything else stays NULL: 第1殿, 一殿, 秦广王, 秦广王殿, 本殿, an empty string.
Those may well mean a court, and a person can say which; a migration cannot.

Why courts only
---------------
`DY_COURT_` is the namespace realms/0012 reserved for the ten courts precisely
so that "the first court" is unambiguous (DY_01_HEAVEN is the first heaven).
The other three Chinese realms (待审所, 杨柳宫, 天堂) are not courts, and no
other civilization's judgments carry a court string with a meaning to map.

Reverse
-------
Clears `realm` on the rows forward would have set: CHINESE, `realm` equal to
the court this rule resolves `court` to. A realm somebody set through the API
after this ran, *and* that happens to equal what the rule would pick, is
cleared too — indistinguishable from a backfilled one. Reversing further (to
0022) drops the column anyway.

No path entries are written. `SoulPathEntry` records when a soul entered a
realm, and for these rows nobody knows when that was; `created_at` is when the
case was filed, not when the soul stood in the court. See apps/realms/path.py.

No `except` around any query. On PostgreSQL a failed statement aborts the
transaction, and swallowing it would report the failure against whatever
statement ran next (see CLAUDE.md, apps/perm/migrations/0017).
"""
from django.db import migrations

CHINESE = "CHINESE"
COURT_PREFIX = "DY_COURT_"


def court_map(realm_model):
    """{name: court} for every name exactly one live court answers to."""
    seen = {}
    ambiguous = set()
    courts = realm_model._base_manager.filter(
        civilization=CHINESE, realm_code__startswith=COURT_PREFIX, is_deleted=False,
    )
    for court in courts:
        for name in {court.name_local, court.name_zh, court.realm_code}:
            name = (name or "").strip()
            if not name:
                continue
            if name in seen and seen[name].pk != court.pk:
                ambiguous.add(name)
            seen[name] = court
    for name in ambiguous:
        del seen[name]
    return seen


def resolve(judgment, courts):
    """The court `judgment.court` names, or None. The whole rule, in one place."""
    if judgment.civilization != CHINESE:
        return None
    court = courts.get((judgment.court or "").strip())
    if court is None or court.tenant_id != judgment.tenant_id:
        return None
    return court


def forwards(apps, schema_editor):
    judgment_model = apps.get_model("judgment", "Judgment")
    courts = court_map(apps.get_model("realms", "Realm"))
    if not courts:
        return
    candidates = (
        judgment_model._base_manager
        .filter(civilization=CHINESE, realm__isnull=True)
        .exclude(court="")
        .only("pk", "civilization", "court", "tenant")
    )
    for judgment in candidates.iterator():
        court = resolve(judgment, courts)
        if court is not None:
            judgment_model._base_manager.filter(pk=judgment.pk).update(realm=court)


def backwards(apps, schema_editor):
    judgment_model = apps.get_model("judgment", "Judgment")
    courts = court_map(apps.get_model("realms", "Realm"))
    if not courts:
        return
    linked = (
        judgment_model._base_manager
        .filter(civilization=CHINESE, realm__isnull=False)
        .only("pk", "civilization", "court", "tenant", "realm")
    )
    for judgment in linked.iterator():
        court = resolve(judgment, courts)
        if court is not None and court.pk == judgment.realm_id:
            judgment_model._base_manager.filter(pk=judgment.pk).update(realm=None)


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0023_judgment_realm"),
        # The court rows are read here; 0019 is the realms tip at the time of
        # writing, and 0012 (the ten courts) is before it.
        ("realms", "0019_realm_topology_and_soul_path"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
