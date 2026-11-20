"""check.py <run>... : the base check before a shop is shown (lead, 20 Nov 2026): each fitted picture (new-4x.png) at
4x on grey with the Store's 70 footprint diamond (white, its top corner at the building's origin) and the base diamond
the guide asked for (orange, 80 x 40 world px, its front corner at y 56 where Flash's store stands) drawn over it, plus angle.py's numbers.
Writes art-samples/store-inferno/check-<run>.png."""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import CANVAS, OUT, UP  # noqa: E402

CW, CH, OX, OY = CANVAS
for run in sys.argv[1:]:
    im = Image.open(OUT / "runs" / run / "new-4x.png").convert("RGBA")
    bg = Image.new("RGBA", im.size, (110, 110, 110, 255))
    bg.alpha_composite(im)
    over = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    P = lambda x, y: ((OX + x) * UP, (OY + y) * UP)  # noqa: E731
    d.polygon([P(0, 0), P(70, 35), P(0, 70), P(-70, 35)], outline=(255, 255, 255, 255), width=3)
    d.polygon([P(0, 16), P(40, 36), P(0, 56), P(-40, 36)], outline=(255, 150, 0, 255), width=3)
    bg.alpha_composite(over)
    bg.convert("RGB").save(OUT / f"check-{run}.png")
    cut = OUT / "runs" / run / "sample-cut.png"
    print(run, subprocess.run([sys.executable, "-I", str(Path(__file__).parent / "angle.py"), str(cut)],
                              capture_output=True, text=True).stdout.strip())
