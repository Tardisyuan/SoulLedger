"""Global uniqueness once rows are written to four civilization databases (sharding stage 4,
docs/audit/2026-11-15-sharding/PLAN.md "全局唯一" and gap 4b; tests/tenancy_global_uniqueness.py STRATEGY).

A UNIQUE index covers one database. A key whose rows move to the shards (SHARD placement) needs something in
the control database that every shard asks first:

  REGISTRY codes   `souls.Soul.soul_code`, `org.Organization.code`: a `GlobalCode(kind, value)` row, claimed
                   by `claim` BEFORE the row is written.
  WF numbers       `workflow.ApprovalWorkflow.number`: the `WF` row of `JudgmentCaseCounter`, a CONTROL table,
                   bumped by `next_workflow_number` BEFORE the row is written. The format is unchanged.

Where the row goes decides the transaction, and the alias is the one `Model.save` would pick
(`row_alias`), so the call sites follow the router (settings.SHARDED) without changing:

  row on control   (the one database, and a row with no hall) the claim / bump runs inside the
                   row's own transaction (a savepoint). The row's rollback undoes it: no gap, nothing kept --
                   exactly the behaviour before the registry existed (tests/test_global_codes.py proves it).
  row on a shard   the claim / bump runs on the control connection, which is a different connection from the
                   shard's, so the shard's rollback cannot undo it. Called while the control connection is in
                   autocommit (no control transaction open) it commits at once: a shard transaction that fails
                   afterwards leaves the code claimed / the number spent, a gap, never a reuse. Called inside a
                   business `atomic()` -- control's transaction is open there in every context once anything is
                   write-cut (`shard_reads._install_atomic`) -- it commits or rolls back with that transaction, which
                   commits AFTER the shard's: a failed shard write takes the claim back with it (nothing used it);
                   only a control commit failing after the shard's committed loses a claim whose row stands, and
                   `check_global_codes` fails on that row ("unregistered"). It lists unused claims, without failing.

One open case per soul (stage 4 part C): an `OpenCaseClaim(soul_id)` row, UNIQUE, claimed by `claim_open_case`
before a case row is written while any civilization writes to its shard -- the soul's home hall (a REOPEN) and the
hall it resides in write cases on two databases, and no row lock spans both. Released when the case closes
(`_release_on_close`) or its write fails (`JudgmentService.open_case`); a stale one is taken over (its docstring).

Release (rows deleted or renamed; no reclaim of unused claims):
  soul_code   never released. It is a login name and the key of cross-hall chat lookup; a purged soul's code
              is retired (the generator draws from 31^10 values, so nobody waits for one).
  org code    released when the row is hard-deleted or its code changes: an administrator's name goes back
              to the pool exactly as the UNIQUE index let it before. A soft-deleted unit keeps its code (the
              index did too). On a shard the release waits for the shard's commit. An unused claim left by a
              failed shard write is NOT reclaimed automatically -- a claim younger than the write in flight is
              indistinguishable from a gap -- so retrying the same code after such a failure is refused until
              the claim is deleted by hand (`check_global_codes` names it).
"""
from django.db import IntegrityError, router, transaction
from django.db.models import F

from apps.core.shard_reads import CONTROL_ALIAS

SOUL_CODE = "soul_code"
ORG_CODE = "org_code"

#: kind -> (model label, column, columns that identify one row across databases). A soul's copies share its
#: pk (D6); an organization is also told apart by its hall, since its BigAutoField pk is per database (gap 4a).
KINDS = {
    SOUL_CODE: ("souls.Soul", "soul_code", ("pk",)),
    ORG_CODE: ("org.Organization", "code", ("pk", "tenant_id")),
}

#: Every REGISTRY key of tests/tenancy_global_uniqueness.py and what serves it (that file's test derives the set).
SERVED_KEYS = {
    **{f"{label}:{column}": kind for kind, (label, column, _) in KINDS.items()},
    "workflow.ApprovalWorkflow:number": "the WF row of JudgmentCaseCounter (next_workflow_number)",
}


def row_alias(instance, using=None):
    """The alias `Model.save(using=...)` writes `instance` to."""
    return using or router.db_for_write(type(instance), instance=instance)


def _model():
    from apps.tenants.models import GlobalCode

    return GlobalCode


def claim(kind, value, tenant_id, *, using):
    """Claim `value` for a row about to be written to `using`. Raises IntegrityError if it is taken."""
    if kind not in KINDS:
        raise ValueError(f"unknown code kind {kind!r}")
    # A savepoint either way: on control it rolls back with the row; on a shard it is the control connection's
    # own (auto)commit, and a refusal does not poison a control transaction the caller may hold.
    with transaction.atomic(using=CONTROL_ALIAS):
        _model().objects.using(CONTROL_ALIAS).create(kind=kind, value=value, tenant_id=tenant_id)


def release(kind, value, *, using):
    """Give `value` back once the row that held it on `using` is gone (or renamed): at once on control, the row's
    own transaction; after the shard's commit on a shard (a rolled-back delete keeps its code)."""
    def drop():
        _model().objects.using(CONTROL_ALIAS).filter(kind=kind, value=value).delete()

    if using == CONTROL_ALIAS:
        drop()
    else:
        transaction.on_commit(drop, using=using)


def next_workflow_number(*, using):
    """The next `WF` sequence number for an approval workflow about to be written to `using`. `using` decides
    nothing here -- the counter is always control's -- it is the caller saying where its row goes."""
    from apps.judgment.models import JudgmentCaseCounter
    from apps.workflow.models import WORKFLOW_NUMBER_KEY

    counters = JudgmentCaseCounter.objects.using(CONTROL_ALIAS)
    with transaction.atomic(using=CONTROL_ALIAS):
        counters.get_or_create(key=WORKFLOW_NUMBER_KEY)
        counters.filter(key=WORKFLOW_NUMBER_KEY).update(last=F("last") + 1)
        return counters.get(key=WORKFLOW_NUMBER_KEY).last


class OpenCaseTaken(Exception):  # noqa: N818 -- an answer, not a failure
    """Another case of the soul holds the claim. `open_ids`: that case, when it is on a master already."""

    def __init__(self, open_ids):
        super().__init__("This soul already has an open case.")
        self.open_ids = list(open_ids)


def _case_txn(alias):
    """`<alias>:<xid>`: the database a case is about to be written on and the transaction writing it there -- known
    on PostgreSQL inside a transaction (`pg_current_xact_id`), else `<alias>:` (unknown)."""
    from django.db import connections

    conn = connections[alias]
    if conn.vendor != "postgresql" or not conn.in_atomic_block:
        return f"{alias}:"
    with conn.cursor() as cursor:
        cursor.execute("SELECT pg_current_xact_id()::text")
        return f"{alias}:{cursor.fetchone()[0]}"


def _writer_finished(case_txn):
    """Whether the transaction that took a claim has ended (committed or rolled back). Unknown -- not PostgreSQL, a
    claim from before `case_txn` existed -- is "not finished": a claim is never taken over on a guess."""
    from django.db import connections

    alias, _, xid = case_txn.partition(":")
    if not xid or alias not in connections or connections[alias].vendor != "postgresql":
        return False
    with connections[alias].cursor() as cursor:
        cursor.execute("SELECT pg_xact_status(%s::xid8)", [xid])
        status = cursor.fetchone()[0]
    return status != "in progress"  # committed, aborted, or NULL: too old to be in progress


def _claim_lock(soul_pk):
    """Take the soul's claim lock on control without waiting: a transaction-scoped advisory lock, held until the
    control transaction that takes it ends. False: another transaction is claiming this soul's case right now.

    Inside a business transaction the claim row stays uncommitted until that transaction ends (control commits after
    the shards, `shard_reads._install_atomic`), and PostgreSQL makes a second INSERT of the same soul WAIT on the
    UNIQUE index until then -- across two databases, where a wait no deadlock detector sees can hang (it holds a
    shard row lock the first may want next). So the second opener is refused at once instead; the first one's
    rollback frees the lock and the row together. Not PostgreSQL (SQLite serializes writers): True."""
    from django.db import connections

    conn = connections[CONTROL_ALIAS]
    if conn.vendor != "postgresql":
        return True
    with conn.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0))", [f"open-case:{soul_pk}"])
        return cursor.fetchone()[0]


def claim_open_case(soul_pk, judgment_pk, tenant_id):
    """Claim the soul's one open case for `judgment_pk`, on control, before the case row is written (stage 4 part C).
    Control in autocommit (the case goes to a shard): committed at once, so a second opener on another database is
    refused however its transaction interleaves -- and the caller must `release_open_case` if its write then fails.
    Inside a control transaction: committed or rolled back with it. Returns whether it committed at once.

    A claim held by a case that is closed (a release missed: a bulk update closed it) is stale and taken over. So is
    one whose case is not on its database once the transaction that took it has ended (`case_txn`): that write rolled
    back -- including a caller's transaction failing after `open_case` returned. While that transaction is in progress,
    or when it cannot be known (not PostgreSQL), the claim stands: OpenCaseTaken, never two open cases. No clock.
    A claim another transaction is taking at this moment -- in autocommit, or uncommitted inside its business
    transaction -- is refused at once, not waited for (`_claim_lock`)."""
    from django.db import connections

    from apps.core.shard_reads import write_alias_of
    from apps.judgment.models import Judgment
    from apps.tenants.models import OpenCaseClaim

    claims = OpenCaseClaim.objects.using(CONTROL_ALIAS)
    # A test case's own wrapping transaction is not the code's (`shard_reads._code_transaction_open` reads them alike).
    autocommit = all(b._from_testcase for b in connections[CONTROL_ALIAS].atomic_blocks)
    case_txn = _case_txn(write_alias_of(Judgment(tenant_id=tenant_id)))
    for _ in range(2):
        try:
            with transaction.atomic(using=CONTROL_ALIAS):
                if not _claim_lock(soul_pk):
                    raise OpenCaseTaken([])
                claims.create(soul_id=soul_pk, judgment_id=judgment_pk, tenant_id=tenant_id, case_txn=case_txn)
            return autocommit
        except IntegrityError:
            held = claims.filter(soul_id=soul_pk).first()
            if held is None:
                continue  # released meanwhile
            alias = held.case_txn.partition(":")[0]
            cases = Judgment._base_manager.using(alias) if alias in connections else Judgment.all_objects
            case = cases.filter(pk=held.judgment_id).values_list("verdict", "is_final", "is_deleted").first()
            if case is not None and case == (None, False, False):
                raise OpenCaseTaken([held.judgment_id]) from None
            if case is None and not _writer_finished(held.case_txn):
                raise OpenCaseTaken([]) from None
            claims.filter(pk=held.pk, judgment_id=held.judgment_id).delete()
    raise OpenCaseTaken([])


def unknown_claims(aliases):
    """[(claim, "open" | "closed" | "missing")]: the open-case claims whose writer cannot be known (`case_txn` names
    no transaction: taken on SQLite, or before tenants/0027 added it). `claim_open_case` never takes one over on a
    guess, so one whose case rolled back keeps the soul from opening a case for good (VERIFY-stage4-r2 低). The
    case is looked for on every alias in `aliases`; "open" on any of them wins."""
    from apps.judgment.models import Judgment
    from apps.tenants.models import OpenCaseClaim

    out = []
    for claim in OpenCaseClaim.objects.using(CONTROL_ALIAS).order_by("pk"):
        if claim.case_txn.partition(":")[2]:
            continue
        found = [Judgment._base_manager.using(a).filter(pk=claim.judgment_id)
                 .values_list("verdict", "is_final", "is_deleted").first() for a in aliases]
        found = [f for f in found if f is not None]
        out.append((claim, "open" if (None, False, False) in found else "closed" if found else "missing"))
    return out


def release_open_case(judgment_pk):
    """Give the soul's claim back: the case `judgment_pk` closed, or its write rolled back."""
    from apps.tenants.models import OpenCaseClaim

    OpenCaseClaim.objects.using(CONTROL_ALIAS).filter(judgment_id=judgment_pk).delete()


def _release_on_close(sender, instance, using=None, **kwargs):
    """A saved case that is no longer open gives its claim back once its write commits (only while civilizations
    write to their shards: before that no claim is taken)."""
    from django.conf import settings

    if not settings.SHARDED or (not instance.is_concluded and not instance.is_deleted):
        return
    pk = instance.pk
    transaction.on_commit(lambda: release_open_case(pk), using=using)


def connect_open_case_release():
    from django.db.models.signals import post_save

    from apps.judgment.models import Judgment

    post_save.connect(_release_on_close, sender=Judgment, dispatch_uid="global_codes:open_case_release")


def case_prefix_clash(code, civilization):
    """Codes of halls of ANOTHER civilization whose case-number prefix (`case_number_prefix`: `CN` of `CN_DIYU`)
    a new hall `code` of `civilization` would share. `Judgment.case_number` is PARTITIONED by that prefix
    (tests/tenancy_global_uniqueness.py): two civilizations on one prefix would number cases from one
    counter row while their cases live in two databases. Halls of no known civilization stay in control (D2)
    and are not counted."""
    from apps.judgment.models import case_number_prefix
    from apps.tenants.models import Tenant

    prefix = case_number_prefix(Tenant(code=code))
    return sorted(t.code for t in Tenant.objects.all()
                  if t.known_civilization not in (None, civilization) and case_number_prefix(t) == prefix)


def claim_org_code(org, using=None):
    """`Organization.save`: claim a new code (or a changed one, then release the old) on the way to `using`."""
    alias = row_alias(org, using)
    old = None
    if not org._state.adding:
        old = type(org)._base_manager.using(alias).filter(pk=org.pk).values_list("code", flat=True).first()
        if old == org.code:
            return None
    try:
        claim(ORG_CODE, org.code, org.tenant_id, using=alias)
    except IntegrityError:
        # The same code already claimed: refuse like the UNIQUE index did, whatever database holds the row --
        # unless the claim is this hall's own and no row of its database holds the code (stage 4: a shard
        # transaction that rolled back after its claim committed, e.g. the hall's root unit `tenant_root` made in a
        # request that then failed). One hall's rows are in one database, whose UNIQUE index decides between two
        # writers of it there; without this the hall's deterministic root code could never be written again.
        mine = _model().objects.using(CONTROL_ALIAS).filter(kind=ORG_CODE, value=org.code, tenant_id=org.tenant_id)
        held = type(org)._base_manager.using(alias).filter(code=org.code).exists()
        if alias == CONTROL_ALIAS or held or not mine.exists():
            raise IntegrityError(f"organization code {org.code!r} is already taken") from None
    return old


def check(aliases):
    """{kind: (problems, unused)} comparing the registry with the rows on `aliases` (control first).

    problems  a row whose value has no claim ("unregistered"), or one value held by two different rows
              across the databases ("duplicate") -- each is a failure.
    unused    claims no row holds: gaps from failed shard writes (allowed, listed)."""
    from django.apps import apps

    claimed = {}
    for kind, value in _model().objects.using(CONTROL_ALIAS).values_list("kind", "value"):
        claimed.setdefault(kind, set()).add(value)
    out = {}
    for kind, (label, column, identity) in KINDS.items():
        model = apps.get_model(label)
        holders = {}  # value -> {(alias, identity)}
        for alias in aliases:
            rows = model._base_manager.using(alias).exclude(**{f"{column}__isnull": True}).values_list(column, *identity)
            for value, *ident in rows.iterator():
                holders.setdefault(value, set()).add(tuple(ident))
        mine = claimed.get(kind, set())
        problems = [f"{kind} {v!r}: on a row, not in the registry" for v in sorted(set(holders) - mine)]
        problems += [f"{kind} {v!r}: held by {len(ids)} different rows {sorted(map(str, ids))}"
                     for v, ids in sorted(holders.items()) if len(ids) > 1]
        out[kind] = (problems, sorted(mine - set(holders)))
    return out
