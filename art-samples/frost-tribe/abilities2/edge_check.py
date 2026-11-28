"""Every Krampus frame, every level and look: the body's (alpha > 128) closest distance to its frame's edge, in px.

Run from the worktree root:  python art-samples/frost-tribe/abilities2/edge_check.py   (exit 1 if any frame touches)
"""
import json
import sys

import numpy as np
from PIL import Image

rows = json.load(open("web/tools/frost-kit/krampus-frames.json"))
bad = 0
for lv, r in rows.items():
    for look, file, s in (("modern", f"krampus_{lv}-anim@2x.png", 2), ("classic", f"krampus_{lv}.png", 1)):
        a = np.asarray(Image.open("server/public/assets/monsters/" + file).convert("RGBA"))[..., 3]
        fw, fh = r["frameWidth"] * s, r["frameHeight"] * s
        margin, hits = 99, 0
        for row in range(r["rows"]):
            for c in range(8):
                ys, xs = np.where(a[row * fh:(row + 1) * fh, c * fw:(c + 1) * fw] > 128)
                m = min(xs.min(), fw - 1 - xs.max(), ys.min(), fh - 1 - ys.max())
                margin = min(margin, m)
                hits += m <= 0
        bad += hits
        print(f"L{lv} {look:7} closest to the edge {margin} px, frames touching {hits}")
sys.exit(1 if bad else 0)
