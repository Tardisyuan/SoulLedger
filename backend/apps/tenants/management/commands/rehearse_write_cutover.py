"""The 4.0 rehearsal of a civilization's write cut-over (docs/audit/2026-11-15-sharding/PLAN.md 阶段 4 §4.0, §7.8),
in this process only -- the settings of the running services are not touched. For ONE civilization:

  1. precondition: its shard reconciles clean control-to-shard (stage 3's state); its id ranges are assigned;
  2. its writes are cut over in-process (SHARD_READ_CIVS / SHARD_WRITE_CIVS gain it) and scripted random writes run
     through the real services inside its halls: create a soul, edit one, open a case, conclude it (the disposition
     it writes), dispatch a soul to another hall of the same civilization (propose, approve, execute);
  3. `reconcile_shards --civ X --fix --direction shard-to-control` brings the writes back to control;
  4. the reconcile shard-to-control is 0, the writes are taken back off (stage 3 again) and the reconcile
     control-to-shard is 0 -- rolling back is lossless while the reverse sync runs.

Prints a report with each step's time and counts; exits 1 when a reconcile is not clean, a write landed on the wrong
database, or a service failed with a routing error (NoShardContext, CrossShardJoin, a missing table).

    manage.py rehearse_write_cutover --civ GREEK [--writes 30] [--seed 1]

ONLY on a throwaway copy of the databases: the writes are real and committed (a rehearsal soul is named
`rehearsal-<seed>-<n>`). DISPATCH_FROZEN and open joint judgments are the operator's (PLAN §4.0): this command does
not dispatch across civilizations.
"""
import random
import time

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings

ROUTING = ("NoShardContext", "CrossShardJoin", "ProgrammingError", "OperationalError", "ImproperlyConfigured")


class Command(BaseCommand):
    help = "Rehearse one civilization's write cut-over on a throwaway copy: scripted writes, reverse sync, reconcile."

    def add_arguments(self, parser):
        parser.add_argument("--civ", required=True, help="e.g. GREEK")
        parser.add_argument("--writes", type=int, default=30, help="How many scripted business writes")
        parser.add_argument("--seed", type=int, default=None)

    def handle(self, *args, civ, writes, seed, **options):
        from django.conf import settings

        from apps.core.shard_sync import shard_aliases
        from apps.core.sharding import alias_for_civilization

        civ = civ.upper()
        alias = alias_for_civilization(civ)
        if alias not in shard_aliases():
            raise CommandError(f"no shard database {alias!r} is configured")
        seed = random.SystemRandom().randrange(10 ** 6) if seed is None else seed
        failed = []
        reads = sorted({*settings.SHARD_READ_CIVS, civ})
        before = sorted(settings.SHARD_WRITE_CIVS)
        self._say(f"rehearsal of {civ} ({alias}), seed {seed}; writes cut over in this process only")
        with override_settings(SHARD_READ_CIVS=reads, SHARD_WRITE_CIVS=before):
            failed += self._step("reconcile control-to-shard before (stage 3's state)",
                                 lambda: self._reconcile(civ))
        failed += self._step("assign id ranges", lambda: call_command("assign_shard_id_ranges", "--civ", civ, stdout=self.stdout))
        from unittest import mock

        from apps.core import shard_sync

        # No debounced sync from here: a worker would run it with ITS settings (this civilization's writes not cut
        # over there) and copy control over the shard's new rows. Stop beat and the workers on the copy too.
        with override_settings(SHARD_READ_CIVS=reads, SHARD_WRITE_CIVS=sorted({*before, civ})), \
                mock.patch.object(shard_sync, "_enqueue", lambda: None):
            report = {}
            failed += self._step(f"{writes} scripted writes", lambda: report.update(
                _writes(civ, writes, random.Random(seed), alias, seed)))
            for kind, n in sorted(report.items()):
                self._say(f"    {kind}: {n}")
            failed += [k for k in report if k.startswith(ROUTING) or k.startswith("wrong database")]
            failed += self._step("reverse sync: reconcile --fix shard-to-control",
                                 lambda: self._reconcile(civ, "--fix", "--direction", "shard-to-control"))
            failed += self._step("reconcile shard-to-control after", lambda: self._reconcile(
                civ, "--direction", "shard-to-control"))
        with override_settings(SHARD_READ_CIVS=reads, SHARD_WRITE_CIVS=before):
            failed += self._step("writes taken back: reconcile control-to-shard", lambda: self._reconcile(civ))
        self._say("rehearsal: " + ("FAILED " + "; ".join(map(str, failed)) if failed else "clean"))
        if failed:
            raise CommandError(f"rehearsal of {civ} failed: {failed}")

    def _say(self, line):
        self.stdout.write(line)

    def _step(self, name, fn):
        start = time.monotonic()
        try:
            out = fn()
        except CommandError as e:
            self._say(f"  {name}: FAILED in {time.monotonic() - start:.1f}s: {e}")
            return [name]
        self._say(f"  {name}: ok in {time.monotonic() - start:.1f}s" + (f" ({out})" if out else ""))
        return []

    def _reconcile(self, civ, *args):
        import io

        buf = io.StringIO()
        try:
            call_command("reconcile_shards", "--civ", civ, *args, stdout=buf)
        finally:
            for line in buf.getvalue().splitlines()[-12:]:
                self._say(f"    {line}")


def _writes(civ, n, rng, alias, seed_tag):
    """{what happened: count}. Each write runs in its hall's context, like a per-hall request or task."""
    from collections import Counter

    from apps.authentication.models import User, UserRole
    from apps.core.tenant import civilization_halls
    from apps.souls.models import Soul
    from apps.tenants.managers import clear_current_tenant, set_current_tenant

    halls = list(civilization_halls(civ).using("default").order_by("code"))
    if not halls:
        raise CommandError(f"{civ} has no hall")
    done = Counter()
    officer = {}
    for hall in halls:
        officer[hall.pk] = User.objects.filter(tenant=hall, role=UserRole.ADMIN, is_active=True).first() or \
            User.objects.create_user(username=f"rehearsal-admin-{hall.code}".lower()[:150], password=None,
                                     role=UserRole.ADMIN, tenant=hall)
    for i in range(n):
        hall = rng.choice(halls)
        kind = rng.choice(["soul", "edit", "case", "case", "dispatch"] if len(halls) > 1 else ["soul", "edit", "case"])
        set_current_tenant(hall)
        try:
            done[_one(kind, hall, halls, officer[hall.pk], rng, f"rehearsal-{seed_tag}-{i}")] += 1
        except Exception as e:  # noqa: BLE001 -- reported: a business refusal is fine, a routing error is not
            done[f"{type(e).__name__}: {str(e)[:120]}"] += 1
        finally:
            clear_current_tenant()
    on_control = Soul._base_manager.using("default").filter(name__startswith=f"rehearsal-{seed_tag}-").count()
    on_shard = Soul._base_manager.using(alias).filter(name__startswith=f"rehearsal-{seed_tag}-").count()
    done[f"rehearsal souls on {alias}: {on_shard}"] += 1
    if on_control:
        done[f"wrong database: {on_control} rehearsal soul(s) on control before the reverse sync"] += 1
    return done


def _one(kind, hall, halls, officer, rng, name):
    from apps.dispatch.services import DispatchService
    from apps.judgment.models import Judgment, Verdict
    from apps.judgment.services import JudgmentConclusionService, JudgmentService
    from apps.souls.models import Soul, SoulState

    mine = Soul.objects.filter(tenant=hall, name__startswith="rehearsal-", is_deleted=False)
    if kind == "soul" or not mine.exists():
        Soul.objects.create(name=name, tenant=hall, current_state=SoulState.JUDGING,
                            merit_score=rng.randint(0, 50))
        return "ok soul created"
    soul = rng.choice(list(mine[:20]))
    if kind == "edit":
        soul.merit_score = rng.randint(0, 99)
        soul.save()
        return "ok soul edited"
    if kind == "case":
        case = Judgment.objects.filter(soul_id=soul.pk, is_final=False).first()
        if case is None:
            JudgmentService.open_case(soul, actor=officer, tenant=hall)
            return "ok case opened"
        JudgmentConclusionService.conclude_judgment(case, rng.choice([Verdict.PASSED, Verdict.FAILED]), notes="rehearsal",
                                                    by=officer)
        return "ok case concluded (with its disposition)"
    target = rng.choice([h for h in halls if h.pk != hall.pk])
    record = DispatchService.propose(hall, target, soul, officer, "rehearsal")
    DispatchService.approve(record, officer)
    DispatchService.execute(record, officer)
    return "ok dispatched within the civilization"
