"""peek.py : a quick check picture: each render cropped, on grass green, beside the Flash tower and the painted tier at
the same scale (4x). python peek.py <tower folder> <out.png> <render png> [...]"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "server" / "public" / "assets" / "buildings"
BG = (88, 134, 64, 255)


def crop(im, m=12):
    x0, y0, x1, y1 = im.getbbox()
    return im.crop((x0 - m, y0 - m, x1 + m, y1 + m))


def main():
    folder, out, renders = sys.argv[1], sys.argv[2], sys.argv[3:]
    flash = sorted((ROOT / folder).glob("top.[0-9].png"))
    ims = []
    if flash:
        f = Image.open(flash[0]).convert("RGBA")
        ims.append(f.resize((f.width * 4, f.height * 4), Image.LANCZOS))
    ims += [crop(Image.open(r).convert("RGBA")) for r in renders]
    for t in (1, 2, 3):
        p = Image.open(ROOT / folder / f"top.t{t}@2x.webp").convert("RGBA")
        ims.append(p.resize((p.width * 2, p.height * 2), Image.LANCZOS))
    w = sum(i.width for i in ims) + 20 * (len(ims) + 1)
    h = max(i.height for i in ims) + 40
    g = Image.new("RGBA", (w, h), BG)
    x = 20
    for i in ims:
        g.alpha_composite(i, (x, h - 20 - i.height))
        x += i.width + 20
    g.convert("RGB").save(out)
    print(out, g.size)


if __name__ == "__main__":
    main()
