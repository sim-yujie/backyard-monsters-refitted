"""prep_b.py <sheet> <col>... : key the A call's idle cell into A<col>/idle.png and set up the B call of that column with it as the extra view."""
import subprocess
import sys
import numpy as np
from PIL import Image
from spec import SPECS, key_cell, tight
n = sys.argv[1]
for col in sys.argv[2:]:
    d = SPECS[n]["sample"] / "full"
    if not (d / f"A{col}" / "frames-new.png").exists():
        print("MISSING", n, col); continue
    rows = SPECS[n]["calls"]["A"]; gc = 4 if len(rows) <= 8 else 5
    im = Image.open(d / f"A{col}" / "frames-new.png").convert("RGB"); w, h = im.size
    tight(key_cell(np.asarray(im.crop((0, 0, w // gc, h // 2))))).save(d / f"A{col}" / "idle.png")
    subprocess.run([sys.executable, "make_batch.py", n, "B", col, str(d / f"A{col}" / "idle.png")], check=True)
