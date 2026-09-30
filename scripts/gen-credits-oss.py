#!/usr/bin/env python3
"""生成「关于 / 致谢」页的开源软件清单:packages/core/src/config/creditsOss.json。

    backend/.venv/bin/python scripts/gen-credits-oss.py        # 在仓库根,装完依赖之后

直接依赖从哪里来:
  server  backend/requirements.txt 列出的每个包(锁文件里的传递依赖不列)
  web     frontend/package.json 的 dependencies
  app     mobile/package.json 的 dependencies
  shared  packages/core/package.json 与根 package.json 的 dependencies
工作区自己的包(@soulledger/*)不算依赖。

许可证只读**已安装包**的元数据,不猜:
  npm     node_modules/<name>/package.json 的 `license`(旧式 `licenses[].type` 也认),
          先找工作区自己的 node_modules,再找根的
  Python  backend/.venv 里 importlib.metadata:License-Expression → 单行且短的 License
          字段 → `License ::` classifier 的最后一段(原样,不换算成 SPDX)
都读不到就写 null,页面显示「未声明」。

`frontend/src/__tests__/creditsOssDrift.test.ts` 比对这份文件与各清单的包名集合:
依赖增删了而没重跑本脚本,那条测试红。
"""
import json
import re
import sys
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "packages/core/src/config/creditsOss.json"
NPM_GROUPS = {"web": ["frontend"], "app": ["mobile"], "shared": ["packages/core", "."]}


def workspace_names():
    names = set()
    for pattern in json.loads((ROOT / "package.json").read_text())["workspaces"]:
        for pkg in ROOT.glob(f"{pattern}/package.json"):
            names.add(json.loads(pkg.read_text())["name"])
    return names


def npm_licence(ws, name):
    for base in (ROOT / ws / "node_modules", ROOT / "node_modules"):
        manifest = base / name / "package.json"
        if manifest.is_file():
            data = json.loads(manifest.read_text())
            lic = data.get("license")
            if isinstance(lic, dict):
                lic = lic.get("type")
            if not lic and isinstance(data.get("licenses"), list):
                lic = " OR ".join(x["type"] for x in data["licenses"] if isinstance(x, dict) and x.get("type"))
            return lic or None
    sys.exit(f"{name} (from {ws}/package.json) is not installed — run npm ci first")


def py_licence(name):
    try:
        meta = metadata.metadata(name)
    except metadata.PackageNotFoundError:
        sys.exit(f"{name} (from backend/requirements.txt) is not installed in this interpreter — use backend/.venv/bin/python")
    if meta.get("License-Expression"):
        return meta["License-Expression"].strip()
    lic = (meta.get("License") or "").strip()
    if lic and "\n" not in lic and len(lic) <= 40 and lic.upper() != "UNKNOWN":
        return lic
    classifiers = [c.split("::")[-1].strip() for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    return " / ".join(classifiers) or None


def requirement_names():
    names = []
    for line in (ROOT / "backend/requirements.txt").read_text().splitlines():
        m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", line.split("#")[0])
        if m:
            names.append(m.group(1))
    return names


def main():
    internal = workspace_names()
    out = {"server": [{"name": n, "licence": py_licence(n), "url": f"https://pypi.org/project/{n}/"} for n in requirement_names()]}
    for group, dirs in NPM_GROUPS.items():
        rows = {}
        for ws in dirs:
            deps = json.loads((ROOT / ws / "package.json").read_text()).get("dependencies") or {}
            for name in deps:
                if name not in internal:
                    rows[name] = {"name": name, "licence": npm_licence(ws, name), "url": f"https://www.npmjs.com/package/{name}"}
        out[group] = [rows[k] for k in sorted(rows)]
    out["server"].sort(key=lambda r: r["name"].lower())
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(f"{OUT.relative_to(ROOT)}: " + ", ".join(f"{k} {len(v)}" for k, v in out.items()))


if __name__ == "__main__":
    main()
