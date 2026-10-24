"""tile.py <out.png> <dir> [<dir>...] : the cmp.png of several batch folders side by side (re-made by check_grid first)."""
import subprocess, sys
from pathlib import Path
from PIL import Image
ims = []
for d in sys.argv[2:]:
    d = Path(d); sheet = {"gorgo": "ape_2", "drull": "dragon_2", "fomor": "fly_2", "krallen": "krallen_1"}[d.parts[-4]]
    subprocess.run([sys.executable, str(Path(__file__).parent / "check_grid.py"), sheet, d.name[0], d.name[1:], "700"], check=True, capture_output=True)
    ims.append(Image.open(d / "cmp.png"))
w = max(i.width for i in ims); h = max(i.height for i in ims)
out = Image.new("RGB", (w * len(ims) + 10 * (len(ims) - 1), h), (255, 255, 255))
for i, im in enumerate(ims): out.paste(im, (i * (w + 10), 0))
out.thumbnail((2000, 2000)); out.save(sys.argv[1]); print(sys.argv[1], out.size)
