"""idlecmp.py <champ dir> <out> : row 1 = A idle cell, row 2 = B idle cell, for headings 0-15 (spots a pose jump between walk and attack)."""
import sys
from pathlib import Path
from PIL import Image
d = Path(sys.argv[1]); cells = []
for c in range(16):
    pair = []
    for call, gc in (("A", None), ("B", 4)):
        f = d / f"{call}{c}" / "frames-new.png"
        if not f.exists(): pair.append(Image.new("RGB", (200, 200), (60, 60, 60))); continue
        im = Image.open(f).convert("RGB"); w, h = im.size
        g = gc or (4 if w / h < 3.2 else 5)
        pair.append(im.crop((0, 0, w // g, h // 2)).resize((200, 200)))
    cells.append(pair)
o = Image.new("RGB", (16 * 205, 405), (30, 30, 30))
for c, (a, b) in enumerate(cells):
    o.paste(a, (c * 205, 0)); o.paste(b, (c * 205, 205))
o.save(sys.argv[2])
