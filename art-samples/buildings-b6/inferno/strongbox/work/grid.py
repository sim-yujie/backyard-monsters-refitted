"""grid.py : Flash cell k (and optionally a render) enlarged with a Flash-pixel grid, for measuring."""
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
import numpy as np
from PIL import Image, ImageDraw
import post
Z = int(__import__("os").environ.get("GZ", 10))
def grid(im, out, box=None):
    box = box or post.FRAME
    k = im.width / post.W
    c = tuple(round((v - o) * k) for v, o in zip(box, (post.FRAME[0], post.FRAME[1]) * 2))
    im = post.on(im).crop(c)
    w, h = box[2] - box[0], box[3] - box[1]
    im = im.resize((w * Z, h * Z), Image.NEAREST if k == 1 else Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for x in range(box[0], box[2] + 1):
        if x % 10 == 0:
            d.line([((x - box[0]) * Z, 0), ((x - box[0]) * Z, h * Z)], fill=(0, 255, 255, 255) if x else (255, 0, 255, 255))
            d.text(((x - box[0]) * Z + 2, 2), str(x), fill=(255, 255, 0, 255))
    for y in range(box[1], box[3] + 1):
        if y % 10 == 0:
            d.line([(0, (y - box[1]) * Z), (w * Z, (y - box[1]) * Z)], fill=(0, 255, 255, 255) if y else (255, 0, 255, 255))
            d.text((2, (y - box[1]) * Z + 2), str(y), fill=(255, 255, 0, 255))
    im.save(out)
def bbox(im):
    a = np.array(im)[..., 3] > 40
    ys, xs = np.where(a); k = im.width / post.W
    return [round(v, 1) for v in (xs.min() / k + post.FRAME[0], ys.min() / k + post.FRAME[1], (xs.max() + 1) / k + post.FRAME[0], (ys.max() + 1) / k + post.FRAME[1])]
if __name__ == "__main__":
    k = int(sys.argv[1]); src = sys.argv[2] if len(sys.argv) > 2 else None
    im = post.flash(k) if not src else Image.open(src).convert("RGBA")
    print("bbox", bbox(im))
    box = tuple(int(v) for v in sys.argv[4].split(",")) if len(sys.argv) > 4 else None
    grid(im, sys.argv[3] if len(sys.argv) > 3 else post.D / "work" / f"grid-flash-{k}.png", box)
