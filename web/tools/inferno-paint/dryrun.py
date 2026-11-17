"""dryrun.py <job> : test finish.py without Codex: Flash's own look(s) on #00FF00 at painting scale as a fake
sample-new.png in runs/<job>-DRY/, then finish.py; each new-4x must land back on Flash's box."""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, UP, flash_rgba  # noqa: E402

job = sys.argv[1]
looks = job.split("+")
out = OUT / "runs" / f"{job}-DRY"
out.mkdir(parents=True, exist_ok=True)
crops = [flash_rgba(lk).crop(flash_rgba(lk).getbbox()) for lk in looks]
W, H = 1536, 1024
cell = W // len(looks)
k = min(min(cell * 0.86 / c.width for c in crops), min(H * 0.86 / c.height for c in crops))
im = Image.new("RGBA", (W, H), (0, 255, 0, 255))
for i, c in enumerate(crops):
    big = c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
    im.alpha_composite(big, (i * cell + (cell - big.width) // 2, round(H * 0.85) - big.height))
im.convert("RGB").save(out / "sample-new.png")
print(subprocess.run([sys.executable, "-I", str(Path(__file__).parent / "finish.py"), job, "DRY"], capture_output=True, text=True).stdout)
for lk in looks:
    f = flash_rgba(lk)
    n = Image.open(out / f"new-4x-{lk}.png")
    fb = f.getbbox()
    nb = tuple(v / UP for v in n.getbbox())
    a0 = (np.asarray(f)[..., 3] > 0).sum()
    a1 = (np.asarray(n.resize(f.size, Image.LANCZOS))[..., 3] > 0).sum()
    print(lk, "flash box", fb, "new box", nb, "alpha px flash/new", a0, a1)
