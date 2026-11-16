"""Global uniqueness once rows are written to four civilization databases (sharding stage 4,
docs/audit/2026-11-15-sharding/PLAN.md "全局唯一" and gap 4b; tests/tenancy_global_uniqueness.py STRATEGY).

A UNIQUE index covers one database. A key whose rows move to the shards (SHARD placement) needs something in
the control database that every shard asks first:

  REGISTRY codes   `souls.Soul.soul_code`, `org.Organization.code`: a `GlobalCode(kind, value)` row, claimed
                   by `claim` BEFORE the row is written.
  WF numbers       `workflow.ApprovalWorkflow.number`: the `WF` row of `JudgmentCaseCounter`, a CONTROL table,
                   bumped by `next_workflow_number` BEFORE the row is written. The format is unchanged.

Where the row goes decides the transaction, and the alias is the one `Model.save` would pick
(`row_alias`), so the call sites follow stage 4's router (SHARD_WRITE_CIVS) without changing:

  row on control   (today, and any civilization not in SHARD_WRITE_CIVS) the claim / bump runs inside the
                   row's own transaction (a savepoint). The row's rollback undoes it: no gap, nothing kept --
                   exactly the behaviour before the registry existed (tests/test_global_codes.py proves it).
  row on a shard   the claim / bump runs on the control connection, which is a different connection from the
                   shard's, so the shard's rollback cannot undo it. Called while the control connection is in
                   autocommit (no control transaction open) it commits at once; called inside a control
                   transaction it commits with that transaction. Either way it is written before the shard row.
                   A shard transaction that fails afterwards leaves the code claimed / the number spent: a gap,
                   never a reuse. `check_global_codes` lists such unused claims; it does not fail on them.

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
        # The same code already claimed: refuse like the UNIQUE index did, whatever database holds the row.
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
