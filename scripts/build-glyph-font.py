"""Build the status-glyph font (Design E 组: 「迷失」◌ must come from the same font as ✓✕◇↺).

    uvx --from "fonttools[woff]" python scripts/build-glyph-font.py <path/to/DejaVuSans.ttf>

Source: DejaVu Sans 2.35 (the copy matplotlib ships) (Bitstream Vera license + public-domain DejaVu changes; the
full text ships beside each copy as SoulLedgerGlyphs-LICENSE.txt). The Vera license
lets a modified font be redistributed only under a name without "Bitstream" or "Vera",
so the subset is renamed "SoulLedger Glyphs".

Why a bundled font at all. Measured 2026-09-30: IBM Plex Mono's `latin` subset (what
next/font serves) has none of these; Noto Sans SC Variable carries ✓✕○▣◇◎↺↻ but not
◌ (U+25CC), so on the web ◌ fell through to whatever the OS has (Segoe UI Symbol on
Windows, Roboto/Noto Symbols on Android) while its neighbours came from Noto Sans SC.
In the App, Archivo has none of them either, so all fell back to the OS per glyph.
One small font, first in every stack for exactly these code points, ends that.

Writes the same bytes to frontend/public/fonts/ and mobile/assets/fonts/;
`frontend/src/__tests__/statusGlyphFont.test.ts` checks the two are identical and that
each covers every glyph the status tables use.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
# Status / verdict / application badge glyphs, plus ≡ (App: 已终结) and ? (the unknown badge, App),
# and the App's tag glyphs ◐ (朋友圈 审核中) and ⇄ (书信 互关) — v3, 2026-10-02.
GLYPHS = "✓✕◇↺◌○▣↻◎≡?◐⇄"
FAMILY = "SoulLedger Glyphs"
PS_NAME = "SoulLedgerGlyphs-Regular"
OUT = [ROOT / "frontend/public/fonts/SoulLedgerGlyphs.ttf", ROOT / "mobile/assets/fonts/SoulLedgerGlyphs.ttf"]


def main(src: str) -> None:
    font = TTFont(src)
    opts = subset.Options()
    opts.name_IDs = []  # rewritten below
    opts.layout_features = []
    opts.hinting = True
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[ord(c) for c in GLYPHS])
    sub.subset(font)
    name = font["name"]
    name.names = []
    for nid, value in {1: FAMILY, 2: "Regular", 3: PS_NAME, 4: FAMILY, 6: PS_NAME,
                       13: "Derived from DejaVu Sans. See SoulLedgerGlyphs-LICENSE.txt."}.items():
        name.setName(value, nid, 3, 1, 0x409)
        name.setName(value, nid, 1, 0, 0)
    for out in OUT:
        out.parent.mkdir(parents=True, exist_ok=True)
        font.save(out)
        print(out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main(sys.argv[1])
