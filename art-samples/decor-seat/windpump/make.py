"""The windpump (213) at 1.25x (owner 24 Nov: "bigger"), rebuilt with the decor-new build (art/decor-new,
art-samples/decor-new/build.py) from its FULL-size cut pieces (pump-b-body, pump-b-wheel .full.png), never by
enlarging the game picture: each piece is brought to 1.25x its old @2x size straight from the full cut-out,
and the hub point scales with it. Writes game/<look>/ files + rows.txt here.

    python make.py
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/decor-new/art-samples/decor-new"
K = 1.25
sys.path.insert(0, SRC)
import build  # noqa: E402

old_load = build.load


def load(look, name, full=False):
    if name in ("pump-b-body", "pump-b-wheel"):
        two = old_load(look, name)  # only for its size
        big = old_load(look, name, full=True)
        w, h = round(two.width * K), round(two.height * K)
        return big.resize((w, h), Image.LANCZOS) if not full else big
    return old_load(look, name, full)


build.load = load
spec = build.WINDMILLS["windmill-b"]
spec["hub"] = {look: (x * K, y * K) for look, (x, y) in spec["hub"].items()}
rows = []
for look in build.LOOKS:
    out = os.path.join(HERE, "game", look)
    os.makedirs(out, exist_ok=True)
    still, frames = build.build_item("windmill-b", look)
    r, _, _ = build.write_item("windmill-b", look, still, frames, out)
    rows += r
open(os.path.join(HERE, "game", "rows.txt"), "w").write("\n".join(rows) + "\n")
print("\n".join(rows))
