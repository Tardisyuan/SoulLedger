"""镜像装的是锁定版本,而锁定文件覆盖 requirements.txt 的每一条意图(IS-17)。

`requirements.txt` 全是 `>=`:同一个 Dockerfile 今天和下个月构建出不同的镜像,
`pip-audit -r requirements.txt` 审的是「此刻能解析到的最新版」而不是已部署的版本。
`requirements.txt` 保留为顶层意图,`requirements.lock` 是全部传递依赖的 `==`
钉死集合,镜像与 CI 都从它安装。

锁定文件与意图之间没有工具强制同步,所以这里断两件事:意图里的每个包都在锁里、
且锁定版本满足意图的区间;每一行锁都是 `==`。
"""
import re
from pathlib import Path

from packaging.requirements import Requirement

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND.parent


def _norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def _lines(path):
    return [
        line.split("#")[0].strip()
        for line in path.read_text().splitlines()
        if line.split("#")[0].strip()
    ]


def _locked():
    return {_norm(Requirement(line).name): Requirement(line) for line in _lines(BACKEND / "requirements.lock")}


def test_every_lock_line_is_an_exact_pin():
    for req in _locked().values():
        specs = list(req.specifier)
        assert len(specs) == 1 and specs[0].operator == "==", f"not pinned: {req}"


def test_every_declared_requirement_is_locked_within_its_range():
    locked = _locked()
    for line in _lines(BACKEND / "requirements.txt"):
        want = Requirement(line)
        assert _norm(want.name) in locked, f"{want.name} is in requirements.txt but not in requirements.lock"
        version = next(iter(locked[_norm(want.name)].specifier)).version
        assert want.specifier.contains(version, prereleases=True), (
            f"requirements.lock pins {want.name}=={version}, outside {want.specifier}"
        )


def test_the_dockerfile_and_ci_install_from_the_lock():
    dockerfile = (BACKEND / "Dockerfile").read_text()
    assert "-r requirements.lock" in dockerfile
    assert "-r requirements.txt" not in dockerfile
    for workflow in ("ci.yml", "security.yml"):
        text = (REPO_ROOT / ".github" / "workflows" / workflow).read_text()
        assert "pip install -r requirements.txt" not in text, workflow
        assert "-r requirements.lock" in text, workflow


def test_ruff_has_one_pin_and_ci_installs_it():
    """Local gates run ruff from `backend/.venv`, installed from
    requirements-dev.txt; CI installed an unpinned `pip install ruff`. Two
    sources for one linter drift silently — the same shape as IS-17."""
    (ruff,) = [Requirement(line) for line in _lines(BACKEND / "requirements-dev.txt") if _norm(Requirement(line).name) == "ruff"]
    (spec,) = list(ruff.specifier)
    assert spec.operator == "==", f"ruff is not pinned: {ruff}"
    ci = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert "-r requirements-dev.txt" in ci
    assert not re.search(r"pip install ruff\b", ci), "ci.yml installs its own, unpinned ruff"


def test_the_local_venv_never_reaches_the_image():
    """`backend/.venv` sits inside the build context, and `COPY backend/ .`
    would carry a macOS interpreter into a Linux image."""
    patterns = _lines(REPO_ROOT / ".dockerignore")
    assert "**/.venv" in patterns
