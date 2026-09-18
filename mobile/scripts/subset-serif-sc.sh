#!/usr/bin/env bash
# Builds the Chinese serif used ONLY for quoted words (statements, appeals,
# rejection reasons) — iOS ships no CJK serif, so the app carries its own.
#
#   bash mobile/scripts/subset-serif-sc.sh
#
# Writes mobile/assets/fonts/NotoSerifSC-Subset-400.ttf and OFL.txt. Regular
# only: the 600 SemiBold subset had no caller in the app and was dropped
# 2026-09-18 (it was another 1.49 MB in every build).
# Characters outside the subset fall back to the system font on the device.
#
# SOURCES (pinned, both from the npm registry):
#   Font     @expo-google-fonts/noto-serif-sc@0.4.3 — Noto Serif SC 400Regular,
#            SIL Open Font License 1.1 (LICENSE_FONT in the package,
#            copied to OFL.txt). Redistribution of a modified (subset) version is
#            allowed; the Reserved Font Name clause does not apply to "Noto".
#   Charset  table-of-general-standard-chinese-characters@0.0.0 (MIT) — a JSON
#            transcription of《通用规范汉字表》(国务院 2013 年发布), key `tier1`
#            = 一级字表 3500 字, in the table's own order (一 乙 二 … 罐 矗).
#            The script refuses to run unless tier1 has exactly 3500 characters.
#
# PLUS: ASCII printable (digits, Latin letters, ASCII punctuation), Latin-1
# punctuation and middle dot, general punctuation (— – … ‘ ’ “ ” ‧ ※),
# CJK symbols and punctuation (U+3000–303F), fullwidth forms (U+FF00–FFEF).
#
# TOOL: fonttools' pyftsubset (via `uvx --from fonttools` when not installed).
#
# SIZE: target ≤ 1.5 MB; ~96% of it is glyph outlines (glyf), so
# the savings come from what is NOT needed for horizontal quoted text: hinting,
# vertical metrics (vhea/vmtx/VORG) and the glyph variants that only the
# vertical and stylistic OpenType features pull in. Keeping every feature
# (`--layout-features='*'`) measured 1.60 MB; this set measured 1.49 MB.
set -euo pipefail

FONT_PKG="@expo-google-fonts/noto-serif-sc@0.4.3"
TABLE_PKG="table-of-general-standard-chinese-characters@0.0.0"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../assets/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$OUT"
(cd "$WORK" && npm pack --silent "$FONT_PKG" "$TABLE_PKG" >/dev/null)
mkdir -p "$WORK/font" "$WORK/table"
tar xzf "$WORK"/expo-google-fonts-noto-serif-sc-*.tgz -C "$WORK/font"
tar xzf "$WORK"/table-of-general-standard-chinese-characters-*.tgz -C "$WORK/table"

node -e '
const fs = require("fs");
const t = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).tier1;
if (t.length !== 3500 || new Set(t).size !== 3500) { console.error("tier1 is not 3500 distinct characters"); process.exit(1); }
fs.writeFileSync(process.argv[2], t.join(""));
' "$WORK/table/package/table-of-general-standard-chinese-characters.json" "$WORK/tier1.txt"

UNICODES="U+0020-007E,U+00A0-00BF,U+00D7,U+00F7,U+2010-2027,U+2030-203B,U+2E3A-2E3B,U+3000-303F,U+FF00-FFEF"

if command -v pyftsubset >/dev/null 2>&1; then SUBSET=(pyftsubset); else SUBSET=(uvx --from fonttools pyftsubset); fi

"${SUBSET[@]}" "$WORK/font/package/400Regular/NotoSerifSC_400Regular.ttf" \
  --text-file="$WORK/tier1.txt" \
  --unicodes="$UNICODES" \
  --layout-features='kern,liga,locl,ccmp,halt,palt' \
  --no-hinting \
  --desubroutinize \
  --name-IDs='1,2,3,4,5,6' \
  --drop-tables+=DSIG,vhea,vmtx,VORG \
  --output-file="$OUT/NotoSerifSC-Subset-400.ttf"
cp "$WORK/font/package/LICENSE_FONT" "$OUT/OFL.txt"

ls -l "$OUT"/NotoSerifSC-Subset-400.ttf
