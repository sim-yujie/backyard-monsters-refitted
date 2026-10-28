"""peek.py : quick check, the Flash picture beside the 3D renders on the same canvas (python peek.py out.png render...)."""
import sys
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
FLASH = HERE.parents[1] / "server/public/assets/buildings/cannontower/top.3.png"
ox, oy = 292, 364                      # the building's origin on the 4x canvas
fl = Image.open(FLASH).convert("RGBA")
fl = fl.resize((fl.width * 4, fl.height * 4), Image.LANCZOS)
cv = Image.new("RGBA", (620, 640))
cv.alpha_composite(fl, (ox - 132, oy - 100))
ims = [cv] + [Image.open(HERE / "render" / f).convert("RGBA") for f in sys.argv[2:]]
crop = (130, 180, 460, 600)
W = (crop[2] - crop[0])
sheet = Image.new("RGBA", (W * len(ims), crop[3] - crop[1]), (118, 150, 84, 255))
for i, im in enumerate(ims):
    sheet.alpha_composite(im.crop(crop), (i * W, 0))
sheet.save(sys.argv[1])
