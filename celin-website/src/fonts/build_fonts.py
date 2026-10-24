"""Build the CELIN web cut of Nazli (Sharif FarsiWeb, GPL-2+) from the Debian fonts-farsiweb 0.4.dfsg-14 TTFs.

Usage: python -I build_fonts.py <src_dir_with_nazli.ttf_and_nazlib.ttf> <out_dir> [scale] [ascent] [descent]

1. scale the outlines and metrics x SCALE inside the same 2048-unit em (like CSS size-adjust, baked in so it
   also works in Safari): Nazli's letters are ~11% smaller on the em than the Latin faces it sits beside;
2. drop the Latin letters and digits (they fall through to Jost / Bodoni Moda) and the hinting;
3. keep every Arabic/Persian glyph + all OpenType layout features (init/medi/fina/isol/liga), ZWNJ/ZWJ, LRM/RLM,
   kashida, Persian digits and punctuation, the space and the ASCII punctuation, « » and a few signs;
3b. redraw the middle dot U+00B7 as a short centred bar: Nazli draws it as a small rhombus at mid-height, the same
   shape as the Persian zero «۰», so «یاس · گردنبند» read as «یاس ۰ گردنبند» (a dot in any font reads as a zero
   beside Persian text). The bar has the hyphen's construction, a little thinner and shorter, centred on the zero;
4. replace the vertical metrics (2048 upm; the originals have ascent 1960 / descent 1114 and different values
   per weight) with one tight, shared set: hhea = typo = win, line gap 0, USE_TYPO_METRICS on;
5. write WOFF2.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools import subset
from fontTools.pens.ttGlyphPen import TTGlyphPen

src, out = sys.argv[1], sys.argv[2]
SCALE = float(sys.argv[3]) if len(sys.argv) > 3 else 1.12
ASC = int(sys.argv[4]) if len(sys.argv) > 4 else 1740
DSC = int(sys.argv[5]) if len(sys.argv) > 5 else 920

UNICODES = (
    [0x20]
    + list(range(0x21, 0x30))  # ! " # $ % & ' ( ) * + , - . /
    + list(range(0x3A, 0x41))  # : ; < = > ? @
    + list(range(0x5B, 0x61))  # [ \ ] ^ _ `
    + list(range(0x7B, 0x7F))  # { | } ~
    + [0xA0, 0xAB, 0xB7, 0xBB, 0xD7]
    + list(range(0x0600, 0x0700))  # Arabic block: letters, harakat, ، ؛ ؟ ـ ٪ ٫ ٬ ۰–۹ …
    + list(range(0x200C, 0x2011))  # ZWNJ ZWJ LRM RLM, hyphen
    + [0x2022, 0x2026]
    + list(range(0xFB50, 0xFE00))  # presentation forms A
    + list(range(0xFE70, 0xFF00))  # presentation forms B
)

for name, weight in (("nazli", 400), ("nazlib", 700)):
    f = TTFont(f"{src}/{name}.ttf")
    upm = f["head"].unitsPerEm
    # 1. enlarge inside the em: scale everything to upm*SCALE, then call that 2048 again
    scale_upem(f, round(upm * SCALE))
    f["head"].unitsPerEm = upm

    # 2./3. subset
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.layout_scripts = ["*"]
    opts.hinting = False
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.name_legacy = True
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.legacy_kern = True
    opts.drop_tables += ["VDMX", "hdmx", "LTSH", "gasp"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(f)

    # 3b. the middle dot becomes a short bar (length, thickness, centre height in font units)
    length, thick, mid, side = (470, 80, 545, 120) if weight == 400 else (490, 112, 540, 120)
    gname = f.getBestCmap()[0xB7]
    pen = TTGlyphPen(None)
    x0, x1, y0, y1 = side, side + length, mid - thick // 2, mid + thick - thick // 2
    pen.moveTo((x1, y0)); pen.lineTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.closePath()
    f["glyf"][gname] = pen.glyph()
    f["glyf"][gname].recalcBounds(f["glyf"])
    f["hmtx"][gname] = (length + 2 * side, side)

    # 4. vertical metrics
    hh, os2 = f["hhea"], f["OS/2"]
    hh.ascent, hh.descent, hh.lineGap = ASC, -DSC, 0
    if os2.version < 4:
        os2.version = 4
        for attr, val in (("sxHeight", 0), ("sCapHeight", 0), ("usDefaultChar", 0), ("usBreakChar", 32), ("usMaxContext", 3)):
            if not hasattr(os2, attr):
                setattr(os2, attr, val)
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ASC, -DSC, 0
    os2.usWinAscent, os2.usWinDescent = ASC, DSC
    os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
    os2.usWeightClass = weight
    # GPL: a prominent notice that this file was changed
    note = f"; CELIN web cut 2026-10 (subset, glyphs x{SCALE}, vertical metrics {ASC}/{DSC}, middle dot redrawn as a bar)"
    for rec in f["name"].names:
        if rec.nameID == 5:
            rec.string = rec.toUnicode() + note

    f.flavor = "woff2"
    f.save(f"{out}/{name}.woff2")
    g = len(f.getGlyphOrder())
    print(name, "glyphs", g, "cmap", len(f.getBestCmap()))
