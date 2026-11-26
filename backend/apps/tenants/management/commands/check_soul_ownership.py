"""Every soul has exactly one primary row, and copies only where they are allowed (sharding stage 4, D6;
the sharding plan (not in this repo) 阶段 4).

    manage.py check_soul_ownership --all

The primary row of a soul is on its owner's database, by the routing of the day: the shard of the
civilization of `soul.tenant` while sharded, else control. A shard row that
names its own shard's civilization as `tenant`, of a civilization whose writes are cut over, claims to be
primary; two such claims is a soul written in two places (a cross-civilization move half done).

Copies allowed besides the primary row:
  control                         the reverse sync's mirror of a cut-over civilization (stage 4, until stage 5)
  the shard of `tenant`'s civ     the stage-2 shadow, while that civilization's writes are not cut over
  the shard of `home_tenant`'s civ  only while the soul resides in another civilization (an executed
                                  cross-civilization dispatch: `tenant` and `home_tenant` of different
                                  civilizations) -- the home shard's rows point at it (D6)
Any other row of the soul is a copy nothing justifies. A saga message that is a dead letter (FAILED: a move, a
seat, a D6 write that will not be delivered on its own) is a problem too. Prints one line per problem, exits 1
when any.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.core.shard_reads import CONTROL_ALIAS
from apps.core.shard_sync import shard_aliases


def ownership_problems(aliases):
    from apps.core.sharding import alias_for_civilization, cut_civilizations
    from apps.souls.models import Civilization, Soul
    from apps.tenants.models import Tenant

    civ_of = {t.pk: t.civilization for t in Tenant._base_manager.using(CONTROL_ALIAS).all()}

    def shard_of(tenant_id):
        civ = civ_of.get(tenant_id)
        return alias_for_civilization(civ) if civ in Civilization.values else None

    cut_over = {alias_for_civilization(c) for c in cut_civilizations()}
    rows = {}  # soul pk -> {alias: (tenant_id, home_tenant_id)}
    for alias in aliases:
        for pk, tenant_id, home_id in Soul._base_manager.using(alias).values_list("pk", "tenant_id", "home_tenant_id").iterator():
            rows.setdefault(pk, {})[alias] = (tenant_id, home_id)

    problems = []
    for pk, held in sorted(rows.items(), key=lambda kv: str(kv[0])):
        claims = sorted(a for a, (t, _) in held.items() if a != CONTROL_ALIAS and a in cut_over and shard_of(t) == a)
        if len(claims) > 1:
            problems.append(f"soul {pk}: {len(claims)} primary rows, on {claims}")
            continue
        if claims:
            primary = claims[0]
        elif CONTROL_ALIAS in held and shard_of(held[CONTROL_ALIAS][0]) not in cut_over:
            primary = CONTROL_ALIAS
        else:
            where = shard_of(held[CONTROL_ALIAS][0]) if CONTROL_ALIAS in held else None
            problems.append(f"soul {pk}: no primary row" + (f" (its civilization's writes are on {where})" if where else "")
                            + f"; rows on {sorted(held)}")
            continue
        tenant_id, home_id = held[primary]
        allowed = {primary, CONTROL_ALIAS, shard_of(tenant_id)}
        if shard_of(home_id) != shard_of(tenant_id):
            allowed.add(shard_of(home_id))
        for alias in sorted(set(held) - allowed):
            problems.append(f"soul {pk}: a copy on {alias} nothing justifies (primary on {primary})")
    return problems


def dead_letters():
    """One line per FAILED saga message (apps/tenants/shard_saga.py): nothing delivers it until an operator does."""
    from apps.tenants import shard_saga

    return [f"saga message {m.message_id} ({m.kind} {m.subject}) on {alias} FAILED after {m.attempts} attempts: "
            f"{m.last_error}" for alias, m in shard_saga.failed()]


class Command(BaseCommand):
    help = "Each soul has one primary row (its owner's database) and copies only where residence justifies them."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", required=True, help="Every soul on every database")

    def handle(self, *args, **options):
        aliases = [CONTROL_ALIAS, *shard_aliases()]
        problems = ownership_problems(aliases) + dead_letters()
        for line in problems:
            self.stdout.write(line)
        self.stdout.write(f"{len(problems)} problem(s) on {aliases}")
        if problems:
            raise CommandError(f"{len(problems)} soul ownership problem(s)")
