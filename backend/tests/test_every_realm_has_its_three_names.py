"""Every seeded realm must be nameable in all three bundles, and no bundle may
name a realm that is no longer seeded.

Why this file exists
--------------------
`app/realms/page.tsx` renders each realm as::

    t(`realms.names.${realm.realm_code}`) || realm.name_en

The `|| realm.name_en` reads like a fallback. It is not one. `t()` returns the
*key itself* when the key is missing (`I18nContext.tsx`), and a non-empty string
is never falsy — so the right-hand side is unreachable code, and a missing key
renders the literal text ``realms.names.EU_PURGATORY_T3_WRATH`` into an ``<h3>``
on the page. The same line shape is repeated for the subtitle with
``realms.codes.*``.

Measured 2026-09-06, before this file existed: 43 realm codes were seeded and
each bundle held 32 keys per namespace. **Fifteen realms rendered their own
i18n key as their name in all three locales** — the entire seven-terrace
Purgatory, three Greek realms, three European ones, two Egyptian ones. The
bundles also carried four keys (`DY_07_JIAN`, `DY_08_HAN`, `DY_09_YANG`,
`EG_AM_TYAT`) for realm codes that no longer exist, left over from the eleven-
Chinese-realm arrangement that `realms.py` describes replacing.

Nothing caught either half. `civilizationCopyCoverage.test.ts` checks
`realms.civilizations`, not `realms.names`; no test in `frontend/src/__tests__`
mentions `realms.names` at all. A Jest test cannot import `realms.py`, so the
assertion had nowhere to live — the same gap, and the same remedy, as
`test_annihilation_realm_code.py`.

Dead keys are asserted as well as missing ones, deliberately. A bundle key for
a realm that is not seeded is invisible in the UI, so it never gets removed by
being noticed; it just accumulates. The four found here dated from a rename.

What "would really fail" means here
-----------------------------------
Each assertion below was checked by breaking it, before being trusted green:

* deleting ``realms.names.GR_TARTARUS`` from ``en.json`` reddens
  ``test_every_seeded_realm_is_nameable_in_every_bundle``, naming the locale,
  the namespace and the code;
* adding ``realms.codes.CN_NOT_A_REALM`` to ``zh-Hans.json`` reddens
  ``test_no_bundle_names_a_realm_that_is_not_seeded``;
* setting ``realms.names.GR_TARTARUS`` to ``"realms.names.GR_TARTARUS"``
  reddens ``test_no_realm_name_is_its_own_key`` — that is the exact string the
  page renders today when a key is missing, so a "fix" that pasted the key in
  as its own value would satisfy the first test and still ship the bug;
* renaming ``CHINESE_REALMS`` in ``realms.py`` reddens
  ``test_the_seed_still_has_realms_to_check``, which is the non-vacuity guard:
  every other assertion in this file passes trivially over an empty seed.
"""

import ast
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED = REPO_ROOT / "backend" / "apps" / "actors" / "mythology" / "realms.py"
MESSAGES = REPO_ROOT / "packages" / "core" / "messages"
LOCALES = ("zh-Hans", "en", "egy")
NAMESPACES = ("names", "codes")


def _seeded_realm_codes() -> set[str]:
    """First element of every tuple in every ``*_REALMS`` list.

    Parsed rather than imported: importing pulls in Django settings for a fact
    that is a literal in the file. The shape is fixed by ``realms.py``'s own
    header comment -- ``realm_code`` is field 0 of an 11-field row.
    """
    tree = ast.parse(SEED.read_text(encoding="utf-8"))
    codes: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if not (isinstance(target, ast.Name) and target.id.endswith("_REALMS")):
                continue
            if not isinstance(node.value, ast.List | ast.Tuple):
                continue
            for row in node.value.elts:
                first = row.elts[0]
                if not isinstance(first, ast.Constant) or not isinstance(first.value, str):
                    raise AssertionError(
                        f"{target.id} holds a row whose first field is not a string "
                        f"literal; this parser reads realm_code positionally and can "
                        f"no longer do so."
                    )
                codes.add(first.value)
    return codes


def _bundle(locale: str) -> dict:
    return json.loads((MESSAGES / f"{locale}.json").read_text(encoding="utf-8"))["realms"]


def test_the_seed_still_has_realms_to_check():
    """Non-vacuity. Every other test here is trivially green over an empty set."""
    codes = _seeded_realm_codes()
    assert len(codes) >= 40, f"only {len(codes)} realm codes parsed out of {SEED}"


def test_every_bundle_still_has_the_two_namespaces():
    """Non-vacuity for the other side."""
    for locale in LOCALES:
        realms = _bundle(locale)
        for namespace in NAMESPACES:
            assert realms.get(namespace), f"{locale}.json has no realms.{namespace}"


@pytest.mark.parametrize("locale", LOCALES)
@pytest.mark.parametrize("namespace", NAMESPACES)
def test_every_seeded_realm_is_nameable_in_every_bundle(locale, namespace):
    missing = sorted(c for c in _seeded_realm_codes() if c not in _bundle(locale)[namespace])
    assert not missing, (
        f"{locale}.json is missing realms.{namespace} for {len(missing)} seeded "
        f"realm(s): {missing}. The page renders the key itself for these."
    )


@pytest.mark.parametrize("locale", LOCALES)
@pytest.mark.parametrize("namespace", NAMESPACES)
def test_no_bundle_names_a_realm_that_is_not_seeded(locale, namespace):
    codes = _seeded_realm_codes()
    dead = sorted(k for k in _bundle(locale)[namespace] if k not in codes)
    assert not dead, (
        f"{locale}.json has realms.{namespace} entries for {len(dead)} realm(s) "
        f"that are not seeded: {dead}. Nothing renders these."
    )


@pytest.mark.parametrize("locale", LOCALES)
@pytest.mark.parametrize("namespace", NAMESPACES)
def test_no_realm_name_is_its_own_key(locale, namespace):
    """A value equal to its own key is what a *missing* key already renders."""
    offenders = sorted(
        code
        for code, value in _bundle(locale)[namespace].items()
        if not value.strip() or value.strip() in (code, f"realms.{namespace}.{code}")
    )
    assert not offenders, (
        f"{locale}.json realms.{namespace} carries {len(offenders)} value(s) that "
        f"are empty or equal to their own key: {offenders}"
    )
