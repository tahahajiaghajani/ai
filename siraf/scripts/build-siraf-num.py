#!/usr/bin/env python3
"""Build «Siraf Num»: the digit-only companion font of Siraf (docs/BRAND_FA.md §5).

Every digit in the app is drawn by it (Arad, the text face, never draws a number). It is a subset of Vazirmatn
33.003 (SIL OFL 1.1, no Reserved Font Name, so subsetting and renaming are allowed; its copyright and licence
fields are kept and OFL-Vazirmatn.txt ships beside it). Its cmap maps ASCII 0-9 to the Persian digit glyphs, so
digits are Persian without any OpenType feature. tnum keeps the Arabic thousands and decimal separators narrow.

Sources (pinned):
  variable: https://raw.githubusercontent.com/google/fonts/main/ofl/vazirmatn/Vazirmatn[wght].ttf
  static:   https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn-{Regular,Medium,Bold}.woff2

Usage (needs `pip install fonttools brotli`):
  python3 scripts/build-siraf-num.py VAZIRMATN_VF.ttf REGULAR.woff2 MEDIUM.woff2 BOLD.woff2 src/ui/static/fonts/siraf
writes SirafNum.woff2 and print/SirafNum-{Regular,Medium,Bold}.woff2 into the output folder.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

# digits (ASCII, Persian, Arabic-Indic), ٪ ٫ ٬, % , - . / and the real minus
UNI = list(range(0x30, 0x3A)) + list(range(0x6F0, 0x6FA)) + list(range(0x660, 0x66D)) + [0x25, 0x2C, 0x2D, 0x2E, 0x2F, 0x2212]


def build(src: str, dst: str, family: str, style: str) -> None:
    font = TTFont(src)
    font.flavor = None
    opts = subset.Options()
    opts.layout_features = ["tnum", "pnum", "locl", "kern", "ss01"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[u for u in UNI if u in font.getBestCmap()])
    sub.subset(font)
    cmap = font.getBestCmap()
    for table in font["cmap"].tables:
        if table.isUnicode():
            for i in range(10):
                table.cmap[0x30 + i] = cmap[0x6F0 + i]  # ASCII digits draw the Persian glyphs
    full = family if style == "Regular" else f"{family} {style}"
    ps = family.replace(" ", "") + "-" + style
    for rec in font["name"].names:
        if rec.nameID == 1:
            rec.string = family if style in ("Regular", "Bold") else full
        elif rec.nameID == 2:
            rec.string = style if style in ("Regular", "Bold") else "Regular"
        elif rec.nameID == 3:
            rec.string = "33.003;" + ps
        elif rec.nameID == 4:
            rec.string = f"{family} {style}"
        elif rec.nameID == 5:
            rec.string = "Version 33.003; digit-only subset of Vazirmatn for Siraf"
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID == 16 or rec.nameID in (20, 21):
            rec.string = family
        elif rec.nameID == 17:
            rec.string = style
        elif rec.nameID == 25:
            rec.string = family.replace(" ", "")
    font.flavor = "woff2"
    font.save(dst)
    check = TTFont(dst)
    cm = check.getBestCmap()
    assert cm[0x31] == cm[0x6F1], "ASCII digits must draw the Persian glyphs"
    print(os.path.basename(dst), len(cm), "code points", "variable" if "fvar" in check else "static", os.path.getsize(dst), "bytes")


def main() -> None:
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    vf, regular, medium, bold, out = sys.argv[1:]
    os.makedirs(os.path.join(out, "print"), exist_ok=True)
    build(vf, os.path.join(out, "SirafNum.woff2"), "Siraf Num", "Regular")
    for style, src in (("Regular", regular), ("Medium", medium), ("Bold", bold)):
        build(src, os.path.join(out, "print", f"SirafNum-{style}.woff2"), "Siraf Num Print", style)


if __name__ == "__main__":
    main()
