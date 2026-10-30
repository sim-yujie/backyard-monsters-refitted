"""look.py : quick side-by-side checks (approved painting | 3D render), on flat green, enlarged. Not a deliverable."""
import sys
from pathlib import Path
from PIL import Image
APP = Path("D:/Coding/BYMR/worktrees/codex-art/art-samples/redesign/cannon")
def onbg(im, c=(90, 140, 70)):
    bg = Image.new("RGBA", im.size, c + (255,)); bg.alpha_composite(im.convert("RGBA")); return bg
out = sys.argv[1]
pairs = [(APP / a, Path(b)) for a, b in zip(sys.argv[2::2], sys.argv[3::2])]
crop = (140, 270, 440, 600)
ims = []
for a, b in pairs:
    A, B = onbg(Image.open(a)).crop(crop), onbg(Image.open(b)).crop(crop)
    row = Image.new("RGBA", (610, 330), (0, 0, 0, 255)); row.paste(A, (0, 0)); row.paste(B, (310, 0)); ims.append(row)
g = Image.new("RGBA", (610, 330 * len(ims)))
for i, r in enumerate(ims): g.paste(r, (0, 330 * i))
g.resize((g.width * 2, g.height * 2), Image.LANCZOS).save(out)
