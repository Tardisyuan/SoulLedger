"""The committed OpenAPI document must equal what this backend generates.

WHY THIS IS THE LOAD-BEARING CHECK OF THE WHOLE GENERATION IDEA.
`packages/core/openapi/schema.yml` is committed, and
`packages/core/src/api/generated/schema.ts` is generated from it. Neither is
produced during a build — the frontend compiles the committed TypeScript, and
nothing in the frontend can tell whether it still describes this backend.

So the failure mode is silent and slow: a serializer gains a field, or a
`CharField` becomes an FK, and the committed document goes on describing the
API as it was. The generated types stay green, `tsc` stays green, and the
frontend is confidently wrong — which is worse than the hand-written types it
replaced, because a hand-written type at least gets read by whoever changes the
endpoint.

`test_schema_has_no_warnings.py` next door checks that the schema is *truthful
about the code it was generated from*. This one checks that it was generated
from **this** code.

WHEN IT GOES RED, that is the intended workflow, not a fault:

    cd backend && DATABASE_URL="sqlite:///:memory:" python manage.py spectacular \\
      --file ../packages/core/openapi/schema.yml
    npm run schema:generate --workspace @soulledger/core

and commit both. Two commands, and the second one's output is reviewable — a
field appearing in the diff is the point.
"""
from pathlib import Path

import yaml
from drf_spectacular.generators import SchemaGenerator

REPO_ROOT = Path(__file__).resolve().parents[2]
COMMITTED = REPO_ROOT / "packages" / "core" / "openapi" / "schema.yml"
GENERATED_TS = REPO_ROOT / "packages" / "core" / "src" / "api" / "generated" / "schema.ts"


def test_the_committed_schema_exists_and_is_not_a_stub():
    """A floor, so every comparison below has a real subject.

    Without it, an empty or truncated file would make the equality assertion
    compare two nothings in the failure case where the file was clobbered.
    """
    assert COMMITTED.exists(), f"{COMMITTED} is missing — regenerate it (see the module docstring)."
    doc = yaml.safe_load(COMMITTED.read_text(encoding="utf-8"))
    assert len(doc["paths"]) > 100, f"only {len(doc['paths'])} paths in the committed schema"
    assert len(doc["components"]["schemas"]) > 80, (
        f"only {len(doc['components']['schemas'])} components in the committed schema"
    )


def test_the_generated_typescript_exists_and_covers_the_components():
    """The .ts is the artifact the frontend actually compiles.

    Checked by component count rather than by re-running openapi-typescript,
    which would put a node toolchain in the middle of a Python test. Counting
    catches the case this is really guarding: someone regenerates the YAML and
    forgets the second command.
    """
    assert GENERATED_TS.exists(), f"{GENERATED_TS} is missing — run `npm run schema:generate`."
    ts = GENERATED_TS.read_text(encoding="utf-8")
    doc = yaml.safe_load(COMMITTED.read_text(encoding="utf-8"))
    missing = [
        name for name in doc["components"]["schemas"]
        if f"        {name}: " not in ts and f"        {name}: {{" not in ts
    ]
    assert missing == [], (
        f"{len(missing)} component(s) are in the committed schema but not in the "
        f"generated TypeScript, so it was generated from an older document. "
        f"Run `npm run schema:generate --workspace @soulledger/core`.\n"
        f"  {missing[:10]}"
    )


def test_the_committed_schema_equals_what_this_backend_generates():
    """The whole point. Compared as parsed YAML, not as text.

    Text comparison would go red on a `yaml.dump` version bump or a line-width
    change, which is the kind of false red that gets a check deleted. The
    structures are what has to agree.
    """
    live = SchemaGenerator().get_schema(request=None, public=True)
    committed = yaml.safe_load(COMMITTED.read_text(encoding="utf-8"))

    live_paths, committed_paths = set(live["paths"]), set(committed["paths"])
    assert live_paths == committed_paths, (
        "the committed schema's path set does not match this backend.\n"
        f"  only in backend : {sorted(live_paths - committed_paths)}\n"
        f"  only in committed: {sorted(committed_paths - live_paths)}\n"
        "Regenerate — see the module docstring."
    )

    live_comp = live["components"]["schemas"]
    committed_comp = committed["components"]["schemas"]
    assert set(live_comp) == set(committed_comp), (
        "the committed schema's component set does not match this backend.\n"
        f"  only in backend : {sorted(set(live_comp) - set(committed_comp))}\n"
        f"  only in committed: {sorted(set(committed_comp) - set(live_comp))}"
    )

    drifted = [name for name in sorted(live_comp) if live_comp[name] != committed_comp[name]]
    assert drifted == [], (
        f"{len(drifted)} component(s) differ between this backend and the "
        f"committed schema: {drifted[:10]}\n"
        "The frontend's generated types describe the committed version, so they "
        "are describing an API this backend no longer serves. Regenerate."
    )
