"""Fountain (105), owner's option A (10 Nov 2026): keep Flash's moving water, redraw only the stone.
Flash's strip (fountain/anim.png, 42 frames of 89x114 at -47,-51) is the whole fountain. Per pixel, the median
of the frames is the stone (fountain/stone-median.png here, the Codex reference); the water strip
(server .../fountain/water.png) is each frame's pixels that differ from it, alpha by how much they differ.
Also appends the stone's anchor (height, bottom, centre) to anchors.txt for batches.py.
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
F = os.path.abspath(os.path.join(HERE, "../../../../server/public/assets/buildings/decorations/fountain"))
W, H, N, X, Y = 89, 114, 42, -47, -51
T = 30.0  # a difference of this much (0-255, colour and alpha) counts as fully water (70 left the spray too faint)

strip = np.asarray(Image.open(os.path.join(F, "anim.png")).convert("RGBA")).astype(np.float32)
frames = np.stack([strip[:, i * W:(i + 1) * W] for i in range(N)])
med = np.median(frames, axis=0)
diff = np.abs(frames - med[None]).max(axis=3)
alpha = np.clip(diff / T, 0, 1) * frames[..., 3]
water = frames.copy()
water[..., 3] = alpha
out = np.concatenate(list(water), axis=1).clip(0, 255).astype(np.uint8)
Image.fromarray(out, "RGBA").save(os.path.join(F, "water.png"), optimize=True)
stone = Image.fromarray(med.clip(0, 255).astype(np.uint8), "RGBA")
os.makedirs(os.path.join(HERE, "fountain"), exist_ok=True)
path = os.path.join(HERE, "fountain", "stone-median.png")
stone.save(path)
b = stone.getchannel("A").point(lambda p: 255 if p > 40 else 0).getbbox()
h, bottom, centre = b[3] - b[1], Y + b[3], X + (b[0] + b[2]) / 2
line = (f" 105 Fountain (stone)                size 70  height {h}  bottom {bottom}  centre {centre:g}   "
        f"-> --item 105:<name>:70:{bottom}:{centre:g}   ({path.replace(os.sep, '/')})")
lines = [ln for ln in open(os.path.join(HERE, "anchors.txt"), encoding="utf-8") if not ln.startswith(" 105 ")]
open(os.path.join(HERE, "anchors.txt"), "w", encoding="utf-8").write("".join(lines) + line + "\n")
print(line, "water alpha mean", round(float(alpha.mean()), 1))
