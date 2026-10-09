"""Every `RunPython` migration must work on the database being migrated.

Symptom this guards: `migrate --database tenant_shadow` ran each data migration against
`default` -- `apps.get_model(...).objects` goes through the router, and with no hint
the router answers `default`. On a second database that means reading the wrong rows
(or, in `souls.0020`, selecting a column a later migration had already dropped there)
and writing into a database that was not being migrated. With one database nothing
shows, so nothing fails: this is a static check, like the other guards of
docs/ARCHITECTURE-tenant-sharding.md 4.1.

The rule, per module with a `RunPython`:

* each function handed to `RunPython` reads `<schema_editor>.connection.alias` or passes
  `<schema_editor>` on to a helper (a function that only delegates must be in `NO_ORM_TARGETS` with its reason);
* in every function of that module, a model manager (`objects`, `all_objects`,
  `_base_manager`, `_default_manager`) is followed by `.using(` / `.db_manager(`;
* `.save(` carries `using=`; an instance `.delete()` carries `using=`;
* `connection` / `connections` are not imported from `django.db`.

`ALLOW` lists the few places where the rule does not apply, each with the reason.
"""
import ast
from pathlib import Path

import pytest

APPS = Path(__file__).resolve().parents[1] / "apps"
MANAGERS = {"objects", "all_objects", "_base_manager", "_default_manager"}
ROUTED = {"using", "db_manager"}

#: (file name, function) -> reason. The function is a RunPython target that touches no
#: model and no cursor of its own.
NO_ORM_TARGETS = {
    ("0006_rag.py", "create_vector_extension"): "runs one statement through schema_editor.execute, which is already bound to the migrated database",
    ("0009_drop_dead_cross_tenant_permission_table.py", "noop_reverse"): "does nothing",
}

#: (file name, function, kind) -> reason.
ALLOW = {}


def _migration_files():
    return sorted(p for p in APPS.glob("*/migrations/[0-9]*.py") if "RunPython" in p.read_text(encoding="utf-8"))


def _targets(tree):
    funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", "")) == "RunPython":
            for arg in [*node.args, *(k.value for k in node.keywords)]:
                if isinstance(arg, ast.Name) and arg.id in funcs:
                    names.append(arg.id)
    return funcs, list(dict.fromkeys(names))


def _reads_alias(func):
    schema_editor = func.args.args[1].arg
    # Handing the whole schema_editor to a helper counts: the helper's own managers are
    # checked below like any other function's.
    delegates = any(
        isinstance(a, ast.Name) and a.id == schema_editor
        for n in ast.walk(func)
        if isinstance(n, ast.Call)
        for a in n.args
    )
    return delegates or any(
        isinstance(n, ast.Attribute)
        and n.attr == "alias"
        and isinstance(n.value, ast.Attribute)
        and n.value.attr == "connection"
        and isinstance(n.value.value, ast.Name)
        and n.value.value.id == schema_editor
        for n in ast.walk(func)
    )


def _routed(expr):
    return any(isinstance(n, ast.Attribute) and n.attr in ROUTED for n in ast.walk(expr))


def _delete_is_unrouted(func, call):
    """`x.delete()` where `x` is a bare name that was not built from `.using()`/`.db_manager()`.

    `Queryset.delete()` takes no `using=`, so a queryset variable is accepted only when
    it was assigned from a routed chain in the same function; an instance must pass `using=`.
    """
    node = call.func.value
    while isinstance(node, ast.Attribute):
        node = node.value
    if not isinstance(node, ast.Name):
        return False
    return not any(
        isinstance(a, ast.Assign) and _routed(a.value) and any(isinstance(t, ast.Name) and t.id == node.id for t in a.targets)
        for a in ast.walk(func)
    )


def violations(path):
    """(function, kind, line) for every breach in one migration file."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    funcs, targets = _targets(tree)
    found = []
    for name in targets:
        if not _reads_alias(funcs[name]) and (path.name, name) not in NO_ORM_TARGETS:
            found.append((name, "does not read schema_editor.connection.alias", funcs[name].lineno))
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    for func in (n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)):
        for node in ast.walk(func):
            kind = None
            if isinstance(node, ast.Attribute) and node.attr in MANAGERS:
                up = parents.get(node)
                if not (isinstance(up, ast.Attribute) and up.attr in ROUTED):
                    kind = f".{node.attr} without .using()/.db_manager()"
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                has_using = any(k.arg == "using" for k in node.keywords)
                if node.func.attr == "save" and not has_using:
                    kind = ".save() without using="
                elif node.func.attr == "delete" and not has_using and _delete_is_unrouted(func, node):
                    kind = ".delete() on a name not built from .using()"
            elif isinstance(node, ast.ImportFrom) and node.module == "django.db":
                if any(a.name in {"connection", "connections"} for a in node.names):
                    kind = "imports django.db.connection(s)"
            if kind and (path.name, func.name, kind) not in ALLOW:
                found.append((func.name, kind, node.lineno))
    return found


@pytest.mark.parametrize("path", _migration_files(), ids=lambda p: f"{p.parts[-3]}/{p.name}")
def test_runpython_uses_the_alias_being_migrated(path):
    found = violations(path)
    assert not found, "\n".join(f"{path.name}:{line} {fn}: {kind}" for fn, kind, line in found)


def test_the_guard_sees_the_migrations():
    # A glob that matches nothing makes every parametrized case vanish and the file pass.
    assert len(_migration_files()) >= 70


def test_the_allow_lists_name_things_that_exist():
    existing = {p.name for p in _migration_files()}
    for key in [*NO_ORM_TARGETS, *ALLOW]:
        assert key[0] in existing, key
