"""peek.py : contact sheets of the current painted Krallen sheets (one heading's 16 rows), to see what the puppet must match."""
import sys
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / "server/public/assets/monsters"
CELL = {1: (130, 80), 2: (131, 90), 3: (142, 100)}

def cells(look, col, scale=4):
    sh = Image.open(ASSETS / f"krallen_{look}_rev_65-repaint@4x.png").convert("RGBA")
    w, h = CELL[look][0] * 4, CELL[look][1] * 4
    return [sh.crop((col * w, r * h, (col + 1) * w, (r + 1) * h)) for r in range(16)]

if __name__ == "__main__":
    look, col = int(sys.argv[1]), int(sys.argv[2])
    cs = cells(look, col)
    w, h = cs[0].size
    out = Image.new("RGBA", (w * 4, h * 4), (86, 92, 74, 255))
    for i, c in enumerate(cs):
        out.alpha_composite(c, ((i % 4) * w, (i // 4) * h))
    out.save(HERE / f"_peek_{look}_{col}.png")
    print(out.size)
