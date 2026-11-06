#!/usr/bin/env python3
"""Builds the Chinese faces the App carries (v4: 界面 Geist + Noto Sans SC, 标题与引文 Noto Serif SC).

    python3 mobile/scripts/build-cjk-fonts.py      # needs fonttools and npm

Writes to mobile/assets/fonts/:

  SoulLedgerSans-{400,500,600}.ttf   Geist with Noto Sans SC's Han merged in behind it — the App's
                                     `ui` face. React Native has no font-fallback list, so the web's
                                     `Geist, "Noto Sans SC"` is made into ONE file: every glyph Geist
                                     has is Geist's (it goes first; a duplicate code point keeps the
                                     first font's glyph), the rest (Han, CJK punctuation, fullwidth
                                     forms, Greek — Geist has no Greek) is Noto Sans SC's. Vertical
                                     metrics are Geist's, so a line box is what it was with Geist alone.
  NotoSerifSC-Subset-{500,600}.ttf   quoted words (500) and titles / display text (600). v4 loads Noto
                                     Serif SC at 500 and 600 only (V4Batch07 `@import`); a serif with no
                                     weight there resolves to 500.
  OFL.txt                            Noto's licence (SIL OFL 1.1, Reserved Font Name 'Source' — not used).
  Geist-OFL.txt                      Geist's licence (SIL OFL 1.1, no Reserved Font Name).

Charset for every CJK face: 《通用规范汉字表》一级 3500 字 (table-of-general-standard-chinese-characters,
key `tier1`, refused unless exactly 3500 distinct) + ASCII, Latin-1 punctuation, × ÷, general and CJK
punctuation, fullwidth forms; the sans also takes Greek (U+0370–03FF). A rarer character falls back to
the system font, glyph by glyph. Until 2026-11-06 this was subset-serif-sc.sh (400 / 600, serif only).

SOURCES, pinned, from the npm registry: @expo-google-fonts/geist@0.4.2, noto-sans-sc@0.4.4,
noto-serif-sc@0.4.3, table-of-general-standard-chinese-characters@0.0.0.
"""
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

PKGS = {
    "geist": "@expo-google-fonts/geist@0.4.2",
    "sans": "@expo-google-fonts/noto-sans-sc@0.4.4",
    "serif": "@expo-google-fonts/noto-serif-sc@0.4.3",
    "table": "table-of-general-standard-chinese-characters@0.0.0",
}
BASE = "U+0020-007E,U+00A0-00BF,U+00D7,U+00F7,U+2010-2027,U+2030-203B,U+2E3A-2E3B,U+3000-303F,U+FF00-FFEF"
GREEK = "U+0370-03FF"
WEIGHTS = {400: "400Regular", 500: "500Medium", 600: "600SemiBold"}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "fonts")


def fetch(work: str) -> dict:
    dirs = {}
    for key, spec in PKGS.items():
        tgz = subprocess.run(["npm", "pack", "--silent", spec], cwd=work, check=True, capture_output=True, text=True).stdout.split()[-1]
        dirs[key] = os.path.join(work, key)
        with tarfile.open(os.path.join(work, tgz)) as t:
            t.extractall(dirs[key], filter="data")
        dirs[key] = os.path.join(dirs[key], "package")
    return dirs


def cut(src: str, text: str, unicodes: str) -> TTFont:
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "locl", "ccmp", "halt", "palt"]
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = [1, 2, 3, 4, 5, 6]
    opts.drop_tables += ["DSIG", "vhea", "vmtx", "VORG"]
    font = TTFont(src)
    s = subset.Subsetter(opts)
    s.populate(text=text, unicodes=subset.parse_unicodes(unicodes))
    s.subset(font)
    return font


def rename(font: TTFont, family: str, style: str) -> None:
    ps = f"{family.replace(' ', '')}-{style}"
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 3:
            rec.string = f"{ps};SoulLedger"
        elif rec.nameID == 4:
            rec.string = f"{family} {style}"
        elif rec.nameID == 6:
            rec.string = ps


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        d = fetch(work)
        tier1 = json.load(open(os.path.join(d["table"], "table-of-general-standard-chinese-characters.json"), encoding="utf-8"))["tier1"]
        if len(tier1) != 3500 or len(set(tier1)) != 3500:
            sys.exit("tier1 is not 3500 distinct characters")
        han = "".join(tier1)

        for weight, name in WEIGHTS.items():
            geist = os.path.join(d["geist"], name, f"Geist_{name}.ttf")
            sc = os.path.join(work, f"sc{weight}.ttf")
            cut(os.path.join(d["sans"], name, f"NotoSansSC_{name}.ttf"), han, f"{BASE},{GREEK}").save(sc)
            merged = Merger().merge([geist, sc])
            g = TTFont(geist)
            for table, fields in {"hhea": ("ascent", "descent", "lineGap"), "OS/2": ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent")}.items():
                for f in fields:
                    setattr(merged[table], f, getattr(g[table], f))
            rename(merged, "SoulLedger Sans", name[3:])
            merged.save(os.path.join(OUT, f"SoulLedgerSans-{weight}.ttf"))

        for weight in (500, 600):
            name = WEIGHTS[weight]
            cut(os.path.join(d["serif"], name, f"NotoSerifSC_{name}.ttf"), han, BASE).save(os.path.join(OUT, f"NotoSerifSC-Subset-{weight}.ttf"))

        shutil.copy(os.path.join(d["serif"], "LICENSE_FONT"), os.path.join(OUT, "OFL.txt"))
        shutil.copy(os.path.join(d["geist"], "LICENSE_FONT"), os.path.join(OUT, "Geist-OFL.txt"))

    for f in sorted(os.listdir(OUT)):
        if f.endswith(".ttf"):
            print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == "__main__":
    main()
