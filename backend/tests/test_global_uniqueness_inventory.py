"""Guard G5 (docs/ARCHITECTURE-tenant-sharding.md 4.1): the values that must stay
unique ACROSS tenants are pinned, and each pinned guarantee is checked.

Why. Today one database enforces `Soul.soul_code`, `Judgment.case_number`,
`User.username`, the e-mail index and the rest with a plain UNIQUE. With one
database per tenant a UNIQUE only covers its own database, so each of these
needs a number range, a central registry or a router -- and a sharding change
that simply forgets one keeps every test green until two tenants collide in
production. This file lists every unique key that does not include the tenant,
derived from the models, and fails when one appears, goes, or changes kind.

Kinds (`tests/tenancy_global_uniqueness.py`):
  GLOBAL_VALUE  a value (code, name, token, e-mail...) unique over the whole
                database: the sharding hazard. Each also has a headline test below.
  PER_PARENT    unique inside one parent row (one open entry per soul ...). Holds
                globally only while the parent's key is global and the rows sit in
                the parent's database: a placement rule, not a value to allocate.
  PER_TENANT    unique with the tenant in the key (Statute.code per tenant ...).
                NOT global -- code that looks these up without a tenant is ambiguous.
"""
import inspect

import pytest
from django.apps import apps
from django.db import IntegrityError, models, transaction

from tests.tenancy_global_uniqueness import UNIQUE_KEYS

SKIP = {"auth", "contenttypes", "sessions", "admin", "django_celery_beat", "token_blacklist"}


def _columns_of(model, names):
    out = []
    for n in names:
        try:
            out.append(model._meta.get_field(n))
        except Exception:  # an expression, not a column
            out.append(None)
    return out


def _kind(model, names):
    fields = _columns_of(model, names)
    if "tenant" in names:
        return "PER_TENANT"
    if any(isinstance(f, models.ForeignKey) for f in fields):
        return "PER_PARENT"
    return "GLOBAL_VALUE"


def derive():
    """{"app.Model:key_name": kind} for every unique column / constraint / unique_together."""
    out = {}
    for m in apps.get_models():
        if m._meta.app_label in SKIP:
            continue
        label = m._meta.label
        for f in m._meta.concrete_fields:
            if f.unique and not f.primary_key:
                out[f"{label}:{f.name}"] = _kind(m, [f.name])
        for c in m._meta.constraints:
            if isinstance(c, models.UniqueConstraint):
                names = list(c.fields) or ["<expression>"]
                out[f"{label}:{c.name}"] = _kind(m, names)
        for ut in m._meta.unique_together:
            out[f"{label}:unique_together({','.join(ut)})"] = _kind(m, list(ut))
    return out


def test_every_unique_key_is_pinned_with_its_kind_and_a_reason():
    derived = derive()
    pinned = {k: v[0] for k, v in UNIQUE_KEYS.items()}
    new = sorted(set(derived) - set(pinned))
    gone = sorted(set(pinned) - set(derived))
    moved = sorted(f"{k}: pinned {pinned[k]}, now {derived[k]}" for k in set(derived) & set(pinned) if derived[k] != pinned[k])
    msg = []
    if new:
        msg.append("NEW unique keys (add to UNIQUE_KEYS in tests/tenancy_global_uniqueness.py; a GLOBAL_VALUE "
                   "needs a sharding plan -- number range, registry or router -- and a headline test here):\n  "
                   + "\n  ".join(f"{k}  [{derived[k]}]" for k in new))
    if gone:
        msg.append("PINNED but gone (a uniqueness guarantee was DROPPED, or renamed -- if dropped, say why):\n  " + "\n  ".join(gone))
    if moved:
        msg.append("KIND changed (tenant added to / removed from a key, or a parent FK appeared):\n  " + "\n  ".join(moved))
    assert not msg, "\n".join(msg)


def test_every_pinned_key_has_a_reason():
    blank = [k for k, (_, why) in UNIQUE_KEYS.items() if len(why.strip()) < 12]
    assert not blank, f"unique keys without a reason: {blank}"


# ── Headline guarantees: the ones the plan names, checked beyond "it exists" ─────

def _field(label, name):
    return apps.get_model(label)._meta.get_field(name)


@pytest.mark.parametrize("label,name", [
    ("tenants.Tenant", "code"),
    ("authentication.User", "username"),
    ("souls.Soul", "soul_code"),
    ("judgment.Judgment", "case_number"),
    ("realms.Realm", "realm_code"),
    ("org.Organization", "code"),
])
def test_headline_values_are_unique_columns_without_the_tenant(label, name):
    f = _field(label, name)
    assert f.unique, f"{label}.{name} is no longer UNIQUE; with one database per tenant this key would collide silently"
    assert UNIQUE_KEYS[f"{label}:{name}"][0] == "GLOBAL_VALUE"


def test_email_is_unique_over_live_rows_case_insensitively_and_without_the_tenant():
    User = apps.get_model("authentication", "User")
    (c,) = [c for c in User._meta.constraints if c.name == "unique_user_email_among_live_rows"]
    assert not c.fields, "the e-mail key must be an expression index (Lower(email)), not a column list"
    assert "Lower" in repr(c.expressions) and "email" in repr(c.expressions)
    assert "tenant" not in repr(c.expressions) and "tenant" not in repr(c.condition)
    assert "is_deleted" in repr(c.condition)


@pytest.mark.django_db
def test_two_tenants_cannot_share_a_username_or_an_email():
    Tenant = apps.get_model("tenants", "Tenant")
    User = apps.get_model("authentication", "User")
    a = Tenant.objects.create(code="G5_A", display_name="a")
    b = Tenant.objects.create(code="G5_B", display_name="b")
    User.all_objects.create_user(username="g5-one", password="x", email="Same@Example.com", tenant=a)
    with pytest.raises(IntegrityError), transaction.atomic():
        User.all_objects.create_user(username="g5-one", password="x", tenant=b)
    with pytest.raises(IntegrityError), transaction.atomic():
        User.all_objects.create_user(username="g5-two", password="x", email="same@example.COM", tenant=b)


@pytest.mark.django_db
def test_case_numbers_of_two_tenants_with_the_same_first_segment_still_differ():
    """The generator behind `case_number`: the counter key is `<prefix>-<year>`,
    not the tenant, so CN_DIYU and CN_TEST share a row and cannot issue the same number."""
    from apps.judgment.models import Judgment, JudgmentCaseCounter

    Tenant = apps.get_model("tenants", "Tenant")
    a = Tenant.objects.create(code="CN_G5A", display_name="a")
    b = Tenant.objects.create(code="CN_G5B", display_name="b")
    first, second = JudgmentCaseCounter.next_number(a), JudgmentCaseCounter.next_number(b)
    assert first != second
    assert JudgmentCaseCounter._meta.pk.name == "key", "the counter must stay keyed by prefix-year, not by tenant"
    assert "next_number" in inspect.getsource(Judgment.save), "Judgment.save no longer draws case numbers from the counter"


def test_soul_code_generator_retries_on_collision_and_never_overwrites():
    from apps.soul_accounts import services

    src = inspect.getsource(services._ensure_soul_code)
    assert "IntegrityError" in src and "soul_code__isnull=True" in src
    assert _field("souls.Soul", "soul_code").null, "soul_code must stay nullable until provisioned (unique ignores NULL)"
