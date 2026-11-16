"""Guard G1 (docs/ARCHITECTURE-tenant-sharding.md 4.1): every foreign key that
touches tenancy is pinned in `tests/tenancy_fk_inventory.py`, with a reason.

Why. The sharding plan (target: one database per tenant) cannot have a foreign
key that crosses databases. Today the database never checks that the two rows of
a tenant-scoped FK carry the same tenant, and 57 models point at the global
`User`. A new FK of either kind is cheap to add and expensive to find later, so
a new one fails here and names itself; the author adds a row WITH a reason, which
is when somebody reads section 3.4.

Everything is derived from `apps.get_models()`; the file pins the result, it does
not declare the categories.

Stage 1B adds each edge's constraint (DB | BARE) and the rule behind it: exactly the edges whose two
ends live in different databases are bare (`test_exactly_the_edges_across_databases_are_bare`,
derived from the placements, not from the pinned column). Proven red 2026-11-15: AuditUserFields'
create_user back to db_constraint=True -> the per-model test names every one of the 46 models, and
the rule test lists every crossing create_user.
"""
import pytest
from django.apps import apps
from django.db import models

from apps.core.models import AuditUserFields
from tests.tenancy_fk_inventory import AUDIT_USER_CONSTRAINT, AUDIT_USER_MODELS, EDGES

# Built-in apps whose tables are not ours (same exclusion as the plan's 1.2).
SKIP = {"auth", "contenttypes", "sessions", "admin", "django_celery_beat", "token_blacklist"}
AUDIT_FIELDS = {"create_user", "update_user", "deleted_by"}


def _our_models():
    return [m for m in apps.get_models() if m._meta.app_label not in SKIP]


def derive_edges():
    """{"app.Model.field->app.Target": category} for every FK / O2O / M2M."""
    Tenant = apps.get_model("tenants", "Tenant")
    User = apps.get_model("authentication", "User")
    ours = _our_models()
    scoped = {
        m for m in ours
        if any(isinstance(f, models.ForeignKey) and f.related_model is Tenant for f in m._meta.concrete_fields)
    }
    out = {}
    for m in ours:
        for f in m._meta.concrete_fields:
            if not isinstance(f, models.ForeignKey):
                continue
            t = f.related_model
            if t is Tenant:
                cat = "tenantcol"
            elif t is User and issubclass(m, AuditUserFields) and f.name in AUDIT_FIELDS:
                continue  # pinned as AUDIT_USER_MODELS
            elif t is User:
                cat = "user-other"
            elif m in scoped and t in scoped:
                cat = "S->S"
            elif m in scoped:
                cat = "S->U"
            elif t in scoped:
                cat = "U->S"
            else:
                cat = "U->U"
            out[f"{m._meta.label}.{f.name}->{t._meta.label}"] = cat
        for f in m._meta.local_many_to_many:
            out[f"{m._meta.label}.{f.name}->{f.related_model._meta.label}"] = "m2m"
    return out


def test_every_tenancy_foreign_key_is_pinned_with_a_reason():
    derived = derive_edges()
    pinned = {k: v[0] for k, v in EDGES.items()}
    new = sorted(set(derived) - set(pinned))
    gone = sorted(set(pinned) - set(derived))
    moved = sorted(f"{k}: pinned {pinned[k]}, now {derived[k]}" for k in set(derived) & set(pinned) if derived[k] != pinned[k])
    msg = []
    if new:
        msg.append("NEW foreign keys (add to EDGES in tests/tenancy_fk_inventory.py with a reason; "
                   "read ARCHITECTURE-tenant-sharding 3.4 -- a cross-database FK does not exist):\n  " + "\n  ".join(f"{k}  [{derived[k]}]" for k in new))
    if gone:
        msg.append("PINNED but no longer in the models (delete the row):\n  " + "\n  ".join(gone))
    if moved:
        msg.append("CATEGORY changed (a model gained or lost a tenant column; re-read the reason):\n  " + "\n  ".join(moved))
    assert not msg, "\n".join(msg)


def test_every_pinned_edge_has_a_real_reason():
    blank = [k for k, (_, _c, why) in EDGES.items() if len(why.strip()) < 12]
    assert not blank, f"edges without a reason: {blank}"


# --- stage 1B: DB | BARE (D3) ------------------------------------------------

def _field(edge):
    label, name = edge.split("->")[0].rsplit(".", 1)
    return apps.get_model(label)._meta.get_field(name)


def _constraint(f):
    # An M2M: the key of its through table to the other end (explicit or auto-created alike).
    has = (f.remote_field.through._meta.get_field(f.m2m_reverse_field_name()).db_constraint if f.many_to_many
           else f.db_constraint)
    return "DB" if has else "BARE"


def _crosses(f):
    """The two ends live in different databases (placements, plan D1/D4/D5): a CONTROL table is only
    in the control database, a SHARD row moves to its civilization's, a REFERENCE row is in all."""
    from apps.core.sharding import CONTROL, SHARD, placement

    src, dst = placement(f.model), placement(f.related_model)
    return (dst == CONTROL and src != CONTROL) or (dst == SHARD and src != SHARD)


def test_each_pinned_constraint_is_the_fields_db_constraint():
    wrong = sorted(f"{k}: pinned {c}, field says {_constraint(_field(k))}"
                   for k, (_, c, _w) in EDGES.items() if c != _constraint(_field(k)))
    assert not wrong, "constraint column out of date:\n  " + "\n  ".join(wrong)


#: Stage 2: reasons that say the two rows of a SHARD -> SHARD edge can belong to halls of different
#: civilizations, i.e. sit in different shards. Which edges those are is the inventory's classification
#: (a decision about the product, not derivable from the schema); the tests below make it binding and
#: check it against what the schema does say.
CROSSING = ("crosses by design", "may cross")


def _edge(f):
    return f"{f.model._meta.label}.{f.name}->{f.related_model._meta.label}"


def _crosses_civilizations(f):
    return EDGES.get(_edge(f), ("", "", ""))[2].startswith(CROSSING)


def test_exactly_the_edges_across_databases_are_bare():
    """The rule, from the placements, over every FK / M2M of our models (the audit columns included):
    an edge across databases must be BARE -- across the control / shard boundary (placements) or across
    civilizations (CROSSING); any other must keep its constraint, except the audit trio, which is bare
    everywhere from its one declaration, and the owner side of an M2M's through table, bare like its other end
    since 1B (stage 4 gap 4c made the table explicit without adding a constraint to it)."""
    throughs = {f.remote_field.through for m in apps.get_models() for f in m._meta.local_many_to_many}
    must_be_bare, needlessly_bare = [], []
    for m in _our_models():
        for f in [*m._meta.concrete_fields, *m._meta.local_many_to_many]:
            if not isinstance(f, (models.ForeignKey, models.ManyToManyField)):
                continue
            edge = _edge(f)
            audit = (f.name in AUDIT_FIELDS and issubclass(m, AuditUserFields)) or m in throughs
            crosses = _crosses(f) or _crosses_civilizations(f)
            if crosses and _constraint(f) != "BARE":
                must_be_bare.append(edge)
            if not crosses and not audit and _constraint(f) == "BARE":
                needlessly_bare.append(edge)
    assert not must_be_bare, ("Across databases but still a constraint (D3: db_constraint=False, "
                              "on_delete=DO_NOTHING):\n  " + "\n  ".join(sorted(must_be_bare)))
    assert not needlessly_bare, ("Bare though both ends share a database (the constraint was dropped "
                                 "for nothing):\n  " + "\n  ".join(sorted(needlessly_bare)))


def test_an_edge_classified_crossing_is_one_the_schema_lets_cross():
    """A CROSSING reason only makes sense on a key between two SHARD models that is not the hop the source
    row reaches its own hall through (that hop drags the row along: it cannot point out of its shard)."""
    from apps.core.sharding import SHARD, placement, tenant_path

    wrong = []
    for edge, (_c, _k, why) in EDGES.items():
        if not why.startswith(CROSSING):
            continue
        f = _field(edge)
        path = tenant_path(f.model) or ""
        if placement(f.model) != SHARD or placement(f.related_model) != SHARD or path.split("__")[0] == f.name:
            wrong.append(f"{edge} (path {path or None})")
    assert not wrong, "classified crossing but cannot cross:\n  " + "\n  ".join(wrong)


def test_a_row_that_follows_a_soul_is_crossing_where_it_points_into_a_hall():
    """Derived, not classified: a model whose hall is reached through the soul (`soul__tenant`, ...) moves
    with the soul when it resides elsewhere (D6), so a key from it to a hall-owned row that does not itself
    follow a soul (RebirthApplication.workflow) can point into another civilization."""
    from apps.core.sharding import SHARD, placement, tenant_path

    def follows_a_soul(model):
        return "soul__" in (tenant_path(model) or "")

    missing = []
    for m in _our_models():
        if placement(m) != SHARD or not follows_a_soul(m):
            continue
        first = tenant_path(m).split("__")[0]
        for f in m._meta.concrete_fields:
            if (isinstance(f, models.ForeignKey) and f.name != first and placement(f.related_model) == SHARD
                    and not follows_a_soul(f.related_model) and not _crosses_civilizations(f)):
                missing.append(_edge(f))
    assert not missing, "follows a soul, points into a hall, not classified crossing:\n  " + "\n  ".join(missing)


def test_a_bare_foreign_key_has_no_orm_on_delete():
    """D3: Django's delete collector looks only in the deleted row's database, so a bare FK's rule is
    applied by apps.core.bare_ids on every alias instead -- CASCADE / SET_NULL here would apply it twice
    on control and never on a shard."""
    wrong = sorted(f"{m._meta.label}.{f.name}: {f.remote_field.on_delete.__name__}"
                   for m in _our_models() for f in m._meta.concrete_fields
                   if isinstance(f, models.ForeignKey) and not f.db_constraint
                   and f.remote_field.on_delete is not models.DO_NOTHING)
    assert not wrong, "bare but still has an ORM on_delete:\n  " + "\n  ".join(wrong)


@pytest.mark.parametrize("label", AUDIT_USER_MODELS)
def test_each_audit_models_user_columns_are_bare(label):
    model = apps.get_model(label)
    wrong = [f"{n}: {_constraint(model._meta.get_field(n))}" for n in sorted(AUDIT_FIELDS)
             if _constraint(model._meta.get_field(n)) != AUDIT_USER_CONSTRAINT]
    assert not wrong, f"{label}: audit columns must be {AUDIT_USER_CONSTRAINT}: {wrong}"


def test_the_audit_user_columns_sit_on_exactly_the_pinned_models():
    derived = sorted(m._meta.label for m in _our_models() if issubclass(m, AuditUserFields))
    assert derived == sorted(AUDIT_USER_MODELS), (
        "AuditUserFields (create_user / update_user / deleted_by -> User) changed. "
        f"added: {sorted(set(derived) - set(AUDIT_USER_MODELS))}; removed: {sorted(set(AUDIT_USER_MODELS) - set(derived))}"
    )


@pytest.mark.parametrize("label", AUDIT_USER_MODELS)
def test_each_audit_model_really_has_the_three_columns(label):
    model = apps.get_model(label)
    names = {f.name for f in model._meta.concrete_fields}
    assert names >= AUDIT_FIELDS, f"{label} inherits AuditUserFields but lacks {AUDIT_FIELDS - names}"


# --- stage 2 review: Meta.ordering never joins through a bare id ----------------

def _ordering_through_bare_ids(model, depth=0):
    """Meta.ordering terms of `model` that JOIN through a bare id: a relation named by its field name (Django
    then orders by the target's own ordering, i.e. a JOIN), or a `rel__col` lookup. `rel_id` is the column."""
    from django.core.exceptions import FieldDoesNotExist

    found = []
    for term in model._meta.ordering or []:
        name = getattr(getattr(term, "expression", term), "name", term)
        if not isinstance(name, str) or name == "?":
            continue
        opts, parts = model._meta, name.lstrip("-").split("__")
        for i, part in enumerate(parts):
            try:
                f = opts.get_field(part)
            except FieldDoesNotExist:
                break
            if not f.is_relation or not f.concrete or part == f.attname != f.name:
                break  # a column of this table: no join
            if not getattr(f, "db_constraint", True):
                found.append(f"{model._meta.label} ordering {model._meta.ordering}: {name} joins through bare id {f.name}")
                break
            opts = f.related_model._meta
            if i == len(parts) - 1 and depth < 3:  # ordered by the target's own ordering
                found += [f"{model._meta.label} -> {x}" for x in _ordering_through_bare_ids(f.related_model, depth + 1)]
    return found


def test_no_default_ordering_joins_through_a_bare_id():
    """A bare id's target may be in another database (a crossing key, or a control row read on a shard), and
    an INNER JOIN there drops the row from every default read (VERIFY-stage2 item 3: WorkflowSegment,
    SoulPathEntry, SoulAccount ordered by `workflow` / `soul`). Order by the `*_id` column instead."""
    found = [x for m in apps.get_models(include_auto_created=True) for x in _ordering_through_bare_ids(m)]
    assert not found, "\n  ".join(found)
