"""sheets.py : the Inferno Incubator Control Centre look samples, from icc.py's renders (render/icc-<v>-base.png).

    python sheets.py     icc-a.png, icc-b.png, icc-c.png     each look full size (12 px per game px), cropped, on grass
                         icc-abc-large.png                   the three large in one row, labelled
                         icc-abc-game.png                    the three at game size (1x and 2x) beside the HCC 3D
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
R = HERE / "render"
GRASS = (96, 140, 60)
K = 12                                   # render px per game px (icc.py's still)
NAMES = {"a": "A  Forged Steel", "b": "B  Carved basalt", "c": "C  On a magma pool"}


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def look(v):
    im = Image.open(R / f"icc-{v}-base.png").convert("RGBA")
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return im, out


def union_box(ims, pad=40):
    a = np.zeros(ims[0].size[::-1], bool)
    for im in ims:
        a |= np.array(im.getchannel("A")) > 30
    ys, xs = np.nonzero(a)
    w, h = ims[0].size
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + pad), min(h, ys.max() + pad)


def row(ims, labels, title, gap=16, lab=30):
    w = sum(i.width for i in ims) + gap * (len(ims) + 1)
    h = max(i.height for i in ims) + lab + 70
    out = Image.new("RGB", (w, h), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((gap, 10), title, fill=(255, 255, 255), font=font(lab))
    x = gap
    for im, t in zip(ims, labels):
        d.text((x, 50), t, fill=(255, 210, 120), font=font(lab))
        out.paste(im.convert("RGB"), (x, 60 + lab))
        x += im.width + gap
    return out


def main():
    raw, shown = {}, {}
    for v in "abc":
        raw[v], shown[v] = look(v)
        shown[v].crop(union_box([raw[v]])).convert("RGB").save(HERE / f"icc-{v}.png")
    box = union_box(list(raw.values()))          # one crop for all three: same scale, same framing
    big = [shown[v].crop(box) for v in "abc"]
    row(big, [NAMES[v] for v in "abc"], "Inferno Incubator Control Centre: three looks (full size)", lab=40) \
        .save(HERE / "icc-abc-large.png")
    # game size: 1x and 2x of the same crop, beside the HCC 3D cut from hcc-v1/hcc-game.png (its 1x and 2x 3D panels)
    hg = Image.open(HERE.parent / "hcc-v1" / "hcc-game.png").convert("RGB")
    hcc = {1: hg.crop((178, 76, 336, 229)), 2: hg.crop((683, 76, 1000, 383))}
    rows = []
    for s in (1, 2):
        sz = (big[0].width * s // K, big[0].height * s // K)
        ims = [b.resize(sz, Image.LANCZOS) for b in big] + [hcc[s]]
        rows.append(row(ims, ["A", "B", "C", "HCC"], f"Game size {s}x", gap=12, lab=18))
    w = max(r.width for r in rows)
    out = Image.new("RGB", (w, sum(r.height for r in rows)), (24, 24, 24))
    y = 0
    for r in rows:
        out.paste(r, (0, y))
        y += r.height
    out.save(HERE / "icc-abc-game.png")


if __name__ == "__main__":
    main()
