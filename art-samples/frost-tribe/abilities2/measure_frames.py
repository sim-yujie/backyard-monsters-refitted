"""Each Krampus attack and stomp frame's body height and width against its heading's idle (walk frame 0), in %.

Run from the worktree root:  python art-samples/frost-tribe/abilities2/measure_frames.py [level] [modern|classic]
Columns are the 8 sheet headings (0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE). Body = alpha > 128, shadow excluded.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

level = sys.argv[1] if len(sys.argv) > 1 else "6"
look = sys.argv[2] if len(sys.argv) > 2 else "modern"
row = json.load(open("web/tools/frost-kit/krampus-frames.json"))[level]
M = Path("server/public/assets/monsters")
im = np.asarray(Image.open(M / (f"krampus_{level}-anim@2x.png" if look == "modern" else f"krampus_{level}.png")).convert("RGBA"))
s = 2 if look == "modern" else 1
fw, fh = row["frameWidth"] * s, row["frameHeight"] * s
NAMES = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]


def box(r, c):
    a = im[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw, 3]
    ys, xs = np.where(a > 128)
    return ys.max() - ys.min() + 1, xs.max() - xs.min() + 1


worst = 0.0
for name, first, count in (("attack", 4, 10), ("stomp", 14, 9)):
    print(f"{look} L{level} {name}: height % / width % of idle, frames 0-{count - 1}")
    for c in range(8):
        h0, w0 = box(0, c)
        hs, ws = [], []
        for f in range(count):
            h, w = box(first + f, c)
            hs.append(100 * h / h0)
            ws.append(100 * w / w0)
            worst = min(worst, 100 * h / h0 - 100)
        print(f"  {NAMES[c]:>2} H " + " ".join(f"{v:4.0f}" for v in hs) + "  | W " + " ".join(f"{v:4.0f}" for v in ws))
print(f"largest height loss vs idle: {-worst:.1f}%")
