"""Print the distributions installed in this interpreter that none of the given requirement files names.

scripts/run-gates.sh keeps backend/.venv on the gate box between dependency changes instead of rebuilding
it, so a package dropped from requirements.lock would stay importable and a test could pass on it. The
gate pipes this into `pip uninstall`. pip / setuptools / wheel belong to the venv itself and are kept.

    .venv/bin/python scripts/venv-extras.py requirements.lock requirements-dev.txt
"""
import re
import sys
from importlib import metadata

KEEP = {"pip", "setuptools", "wheel"}


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def required(paths) -> set:
    out = set()
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        for line in lines:
            m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", line.split("#", 1)[0])
            if m:
                out.add(norm(m.group(1)))
    return out


def extras(installed, wanted) -> list:
    return sorted({norm(n) for n in installed} - wanted - KEEP)


if __name__ == "__main__":
    for name in extras((d.metadata["Name"] for d in metadata.distributions() if d.metadata["Name"]),
                       required(sys.argv[1:])):
        print(name)
