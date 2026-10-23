# contact sheet of rendered stills (run from the teaser folder): python3 tools/sheet.py out/sheet.png t1 t2 ...
import sys, os
from PIL import Image, ImageDraw
out, ts = sys.argv[1], sys.argv[2:]
fs = [f"out/stills/t{float(t):07.2f}.png" for t in ts]
th = [Image.open(f).resize((640, 360)) for f in fs]
cols = 4; rows = (len(th) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 640, rows * 380), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, (f, t) in enumerate(zip(fs, th)):
    x = (i % cols) * 640; y = (i // cols) * 380
    sheet.paste(t, (x, y + 20)); d.text((x + 6, y + 3), os.path.basename(f), fill=(255, 255, 0))
sheet.save(out)
