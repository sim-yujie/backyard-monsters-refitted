"""Yard ground previews: bakes a ground block the way YardGround.ts does (first image tiled, each later
image tiled and blended over it through a soft tileable noise mask), then draws a yard scene on it
(plot edge, buildings as the yard draws them, walls, green/red build squares, a range ring) for
comparison sheets. Pictures only; the game does the real bake.

    python ground.py block <out.png> --tile W H --scale S <img1> <img2> ...
    python ground.py scene <block.png> --scale S --look modern|classic --out <png> [--zoom Z]
"""
import argparse
import os
import random

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BLD = os.path.join(HERE, "..", "bld")
BLOCK_W, BLOCK_H = 1000, 500


def octave(w, h, cw, ch, seed):
    cols, rows = max(2, round(w / cw)), max(2, round(h / ch))
    rng = np.random.default_rng(seed)
    lat = rng.random((rows + 1, cols + 1))
    lat[rows, :] = lat[0, :]
    lat[:, cols] = lat[:, 0]
    fx = np.arange(w) / w * cols
    fy = np.arange(h) / h * rows
    c0, r0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - c0, fy - r0
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = lat[np.ix_(r0, c0)]
    b = lat[np.ix_(r0, c0 + 1)]
    c = lat[np.ix_(r0 + 1, c0)]
    d = lat[np.ix_(r0 + 1, c0 + 1)]
    top = a * (1 - tx) + b * tx
    bot = c * (1 - tx) + d * tx
    return top * (1 - ty[:, None]) + bot * ty[:, None]


def noise(w, h, cw, ch, seed):
    return np.clip(octave(w, h, cw, ch, seed) * 2 / 3 + octave(w, h, cw / 2, ch / 2, seed * 7 + 13) / 3, 0, 1)


def bake(files, tile_w, tile_h, scale, seed=7, block=(BLOCK_W, BLOCK_H), masks=None):
    W, H = int(block[0] * scale), int(block[1] * scale)
    tw, th = int(tile_w * scale), int(tile_h * scale)
    layers = []
    for f in files:
        im = Image.open(f).convert("RGBA").resize((tw, th), Image.LANCZOS)
        canvas = Image.new("RGBA", (W, H))
        for y in range(0, H, th):
            for x in range(0, W, tw):
                canvas.paste(im, (x, y))
        layers.append(np.asarray(canvas).astype(np.float32))
    out = layers[0].copy()
    for n, lay in enumerate(layers[1:], start=1):
        m = noise(W, H, 50 * (n + 1) * scale, 25 * (n + 1) * scale, seed + 1 + n)
        if masks and masks[n]:
            lo, hi = masks[n]
            m = np.clip((m - lo) / (hi - lo), 0, 1)
            m = m * m * (3 - 2 * m)
        m = m[..., None]
        a = m * lay[..., 3:4] / 255
        out[..., :3] = out[..., :3] * (1 - a) + lay[..., :3] * a
    out[..., 3] = 255
    return Image.fromarray(out.astype(np.uint8))


def iso(x, y):
    return (x - y, (x + y) / 2)


def scene(block, scale, look, zoom=1.0, world=(900, 520), seed=3, ring=(255, 255, 255)):
    """A crop of yard at `zoom` screen px per world px (2 = the game zoomed in on a 2x screen)."""
    W, H = int(world[0] * zoom), int(world[1] * zoom)
    tile = block.resize((int(block.width / scale * zoom), int(block.height / scale * zoom)), Image.LANCZOS)
    img = Image.new("RGBA", (W, H))
    for y in range(0, H, tile.height):
        for x in range(0, W, tile.width):
            img.paste(tile, (x, y))
    over = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(over)
    ox, oy = W * 0.5, H * 0.12

    def P(x, y):
        a, b = iso(x, y)
        return (ox + a * zoom, oy + b * zoom)

    # plot edge (YardGround EDGE_SHADE + EDGE_LIGHT)
    edge = [P(0, 0), P(560, 0), P(560, 560), P(0, 560)]
    d.line(edge + [edge[0]], fill=(27, 36, 24, 128), width=max(1, int(4 * zoom)))
    d.line(edge + [edge[0]], fill=(242, 247, 216, 77), width=max(1, int(2 * zoom)))

    # build squares: a green (free) and a red (blocked) footprint, as placement draws them
    for (x, y, col) in [(380, 60, (92, 194, 106, 77)), (440, 60, (224, 82, 82, 77))]:
        d.polygon([P(x, y), P(x + 40, y), P(x + 40, y + 40), P(x, y + 40)], fill=col, outline=col[:3] + (242,), width=max(1, int(2 * zoom)))
    # a range ring (white, as a tower's range)
    cx, cy = P(160, 330)
    r = 150 * zoom
    d.ellipse([cx - r, cy - r / 2, cx + r, cy + r / 2], outline=ring + (64,), width=max(1, int(zoom)),
              fill=ring + (26,))

    img.alpha_composite(over)
    place = [(14, 200, 200), (1, 80, 60), (3, 300, 80), (13, 60, 220), (15, 320, 260), (6, 200, 380),
             (20, 160, 330), (23, 420, 420), (21, 80, 440), (25, 460, 200)]
    walls = [(x, 160) for x in range(100, 340, 20)]
    items = [(17, x, y) for x, y in walls] + place
    items.sort(key=lambda t: t[1] + t[2])
    for t, x, y in items:
        f = os.path.join(BLD, f"{t}-{look}@2x.png")
        if not os.path.exists(f):
            continue
        b = Image.open(f)
        k = zoom / 2
        b = b.resize((max(1, int(b.width * k)), max(1, int(b.height * k))), Image.LANCZOS)
        fx, fy = P(x + 20, y + 20) if t != 17 else P(x + 10, y + 10)
        img.alpha_composite(b, (int(fx - b.width / 2), int(fy - b.height * 0.8)))
    return img


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    b = sub.add_parser("block")
    b.add_argument("out")
    b.add_argument("--tile", nargs=2, type=int, default=[200, 100])
    b.add_argument("--scale", type=float, default=1)
    b.add_argument("--seed", type=int, default=7)
    b.add_argument("--block", nargs=2, type=int, default=[BLOCK_W, BLOCK_H])
    b.add_argument("--masks", default="", help="per later layer lo:hi, comma separated ('' = soft)")
    b.add_argument("files", nargs="+")
    s = sub.add_parser("scene")
    s.add_argument("block")
    s.add_argument("--scale", type=float, default=1)
    s.add_argument("--look", default="modern")
    s.add_argument("--zoom", type=float, default=1)
    s.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "block":
        bake(a.files, *a.tile, a.scale, a.seed, tuple(a.block), [None] + [tuple(map(float, m.split(':'))) if m else None for m in a.masks.split(',')] if a.masks else None).convert("RGB").save(a.out)
    else:
        scene(Image.open(a.block).convert("RGBA"), a.scale, a.look, a.zoom).convert("RGB").save(a.out)


if __name__ == "__main__":
    main()
