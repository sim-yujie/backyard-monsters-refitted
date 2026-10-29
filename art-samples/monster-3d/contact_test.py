"""contact_test.py: the test cells (render/c??_r??.png) next to the painted ones, enlarged 2x, on the game's grass tone."""
import sys
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
PAINT = Image.open(HERE.parents[1] / "server/public/assets/monsters/octo-anim@4x.png").convert("RGBA")
CW, CH, BG = 220, 144, (86, 92, 74, 255)
cols, rows = (0, 8, 15, 22), (0, 3, 9)
out = Image.new("RGBA", (len(cols) * CW * 2, len(rows) * CH * 2), BG)
for j, r in enumerate(rows):
    for i, c in enumerate(cols):
        p = PAINT.crop((c * CW, r * CH, (c + 1) * CW, (r + 1) * CH))
        n = Image.open(HERE / f"render/c{c:02d}_r{r:02d}.png").convert("RGBA")
        out.alpha_composite(p, (i * CW * 2, j * CH * 2))
        out.alpha_composite(n, (i * CW * 2 + CW, j * CH * 2))
out.save(sys.argv[1] if len(sys.argv) > 1 else HERE / "render/_contact.png")
