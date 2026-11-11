r"""注释不能再用现在时说 MODERATOR 持有它 2026-11-07 被收回的码(审计 2026-11-11 C-08)。

2026-11-07 起 MODERATOR 只管朋友圈审核(`apps/perm/models.py::ROLE_PERMISSIONS`,perm/0035、0036
收回其余全部)。此后九处注释仍写着「Needs `judgment.assign` (ADMIN, MODERATOR)」「MODERATOR 持有
`workflow.escalate`」之类 —— 读代码的人会据此以为殿里还有第二个人能改派、越级、读审计。

这里列的是当时那几种**现在时**写法的原文形状;过去时的说法(「当时」「until 2026-11-07」)
不含这些字面,不受影响。迁移文件是历史记录,不扫。

什么改动会让它红:在 `frontend/` `packages/core/src` `mobile*/src` `backend/apps`(迁移除外)的任一
`.py` / `.ts` / `.tsx` 里写回其中任一句,例如把 `useJudgments.ts` 的注释改回
`/** Needs \`judgment.assign\` (ADMIN, MODERATOR). */`。
"""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOTS = [
    REPO / "frontend" / "app",
    REPO / "frontend" / "src",
    REPO / "packages" / "core" / "src",
    REPO / "mobile" / "src",
    REPO / "mobile-officer" / "src",
    REPO / "backend" / "apps",
]
STALE = re.compile(
    r"ADMIN,\s*MODERATOR\)"
    r"|ADMIN or MODERATOR may"
    r"|a MODERATOR or an ADMIN"
    r"|MODERATOR 持有 `"
    r"|what a MODERATOR has"
    r"|to ADMIN \*\*and MODERATOR\*\*"
)


def _files():
    for root in ROOTS:
        for path in root.rglob("*"):
            if path.suffix not in {".py", ".ts", ".tsx"} or "node_modules" in path.parts:
                continue
            if "migrations" in path.parts:
                continue
            yield path


def test_the_scan_sees_files():
    assert sum(1 for _ in _files()) > 500


def test_no_comment_says_moderator_still_holds_a_revoked_codename():
    hits = [
        f"{path.relative_to(REPO)}:{n}: {line.strip()}"
        for path in _files()
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if STALE.search(line)
    ]
    assert not hits, "\n".join(hits)


def test_the_pattern_catches_the_shapes_it_was_written_for():
    for stale in [
        "/** Needs `judgment.assign` (ADMIN, MODERATOR). */",
        " * claimed by another officer; only they, ADMIN or MODERATOR may conclude it).",
        " *    has claimed the case, and only they, a MODERATOR or an ADMIN may conclude",
        "{/* 越级推进。MODERATOR 持有 `workflow.escalate` 而**不**持有",
        " * — which is what a MODERATOR has and `/users/` (`user.manage`) is not.",
        "  // The backend grants `audit.read` to ADMIN **and MODERATOR**",
    ]:
        assert STALE.search(stale), stale
