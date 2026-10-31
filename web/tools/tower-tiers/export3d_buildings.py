"""Exports the 3D yard buildings (owner, 31 Oct 2026: "All approved", "Add 3d buildings into game") into the game.

    python -I web/tools/tower-tiers/export3d_buildings.py <building> <render folder> [more pairs ...]

    e.g. export3d_buildings.py twig D:/Coding/BYMR/worktrees/buildings-3d-b6/art-samples/buildings-b6/twig-v3/render

Each building was modelled in Blender on its own art branch, in the game's own pixel frame (`FRAME`: the canvas in 1x
px around the building's origin, 12 render px a 1x px), with the same camera as the 3D towers and no outline:

| building | type | branch | folder | looks |
| --- | --- | --- | --- | --- |
| twig | 1 Twig Snapper | art/buildings-3d-b6 | twig-v3 (twig2.py) | levels 1, 3, 6, 10; the saw and gears turn |
| pebble | 2 Pebble Shiner | art/buildings-3d-b6 | pebble-v2 | levels 1, 3, 6, 10; animated |
| putty | 3 Putty Squisher | art/buildings-3d-b6 | putty-v3 | levels 1, 3, 6, 10; animated |
| goo | 4 Goo Factory | art/buildings-3d-b6 | goo-v2 | levels 1, 3, 6, 10; the pump's globs |
| silo | 6 Storage Silo | art/buildings-3d-silo | silo-v1 | one look; 26 cells of the sack filling |
| hatchery | 13 Hatchery | art/buildings-3d-hatchery | hatchery-v1 | levels 1, 2, 3; the crank turns |
| housing | 15 Monster Housing | art/buildings-3d-housing | housing-v1 | one look, still |
| hcc | 16 Hatchery Control Center | art/buildings-3d-hcc | hcc-v1 | one look, still |

A look's renders (`render/`): `L<n>-base.png` (`base.png`), every still part with the ground shadow (a shadow
catcher: black, the shade as alpha) and the moving parts hidden from the camera; `L<n>-alone.png`, the building with
no ground shadow; and `L<n>-parts-NN.png`, one per Flash cell, only the moving parts, every still part held out. The
silo's `cell-NN.png` are instead the whole scene for each fill level (`post.py cells`), changed only in the sack.

Writes into `server/public/assets/buildings/<folder>/` (the Flash building's own folder), per look `<n>`:

- `body.3d<n>@2x.webp`: the still parts, the ground shadow taken off: what the strip's cells go over.
- `anim.3d<n>@2x.webp`: the strip, as Flash's `anim` layer, its cells in Flash's order and number. A moving-parts
  building's cell is only its moving parts (cut to what any cell covers); the silo's is the box round all that the sack
  ever changes, every pixel in it, with that box cut out of its body.
- `top.3d<n>@2x.webp`: the whole building at rest (body and cell 0), for the icons and the placing ghost; a still
  building's only picture.
- `shadow.3d<n>.jpg`: the 3D ground shadow, 1x, white where there is none, as Flash's shadows (drawn multiplied).

The shadow comes off the base this way: outside the building (`alone.png`, grown a little) a base pixel is all shadow;
under it the shadow is the nearest shadow outside, and the still parts' own alpha is what the base's is over that
shadow, `(a - s) / (1 - s)`. A part that moves over open ground leaves nothing behind in the body, since the base never
saw it.

It prints one line of JSON per look with the row `buildingArtTiers.ts` holds (`top`, `shadow`, and `anim` as
`[file, x, y, width, height, cells]` with `body` and `columns` when the strip wraps), in 1x px from the origin.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "server" / "public" / "assets" / "buildings"
K = 12                         # render px a 1x px
HALF = K // 2                  # render px a @2x px
MAX_W = 4096                   # the widest a strip's file may be; wider, it wraps into rows (`columns`)
RESOURCE = [(1, "L1"), (3, "L3"), (6, "L6"), (10, "L10")]
# Each building: its type, its Flash folder, its canvas's top-left in 1x px, its looks (first level, render prefix)
# and how it moves: "parts" (a layer of moving parts per cell), "cells" (the silo's whole cells) or None.
BUILDINGS = {
    "twig": dict(type=1, folder="twigsnapper.v2", frame=(-44, -64), looks=RESOURCE, moves="parts"),
    "pebble": dict(type=2, folder="pebbleshiner.v2", frame=(-44, -64), looks=RESOURCE, moves="parts"),
    "putty": dict(type=3, folder="puttysquisher.v2", frame=(-44, -64), looks=RESOURCE, moves="parts"),
    "goo": dict(type=4, folder="goofactory.v2", frame=(-44, -64), looks=RESOURCE, moves="parts"),
    "silo": dict(type=6, folder="storagesilo", frame=(-44, -60), looks=[(1, "")], moves="cells"),
    "hatchery": dict(type=13, folder="hatchery", frame=(-58, -128), looks=[(1, "L1"), (2, "L2"), (3, "L3")],
                     moves="parts"),
    "housing": dict(type=15, folder="monsterhousing", frame=(-122, 0), looks=[(1, "")], moves=None),
    "hcc": dict(type=16, folder="hatcherycontrolcenter", frame=(-56, -66), looks=[(1, "L1")], moves=None),
}
# Flash's cells per look (`buildingArtData.ts`): the 3D strip must hold as many.
CELLS = {"twig": {1: 34, 3: 34, 6: 34, 10: 34}, "pebble": {1: 26, 3: 26, 6: 26, 10: 24},
         "putty": {1: 26, 3: 26, 6: 26, 10: 25}, "goo": {1: 26, 3: 26, 6: 26, 10: 26}, "silo": {1: 26},
         "hatchery": {1: 31, 2: 31, 3: 31}}
TAIL = 16                      # 1x px a shadow cut by the render's canvas is carried on past it, fading out
NOISE = 0.07                   # the shadow catcher's faint wash over all the ground (sky occlusion), taken off every shade


def load(path):
    return np.asarray(Image.open(path).convert("RGBA")).astype("float32") / 255


def resize_pm(a, size):
    """Lanczos resize of a float RGBA array with premultiplied alpha (no dark fringes), as export3d.py's."""
    p = a.copy()
    p[..., :3] *= p[..., 3:]
    ch = [np.asarray(Image.fromarray(p[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 1)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-4), 0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), al]) * 255 + 0.5).astype("uint8"), "RGBA")


def whole(box):
    """A render box grown to whole 1x px."""
    x0, y0, x1, y1 = box
    return x0 // K * K, y0 // K * K, -(-x1 // K) * K, -(-y1 // K) * K


def bbox(alpha, floor=2 / 255):
    ys, xs = np.nonzero(alpha > floor)
    return whole((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def split(scene, building):
    """A scene with the ground shadow (base.png) into its still parts with none and the shadow alone, both float."""
    a = scene[..., 3]
    near = ndimage.binary_dilation(building, iterations=3)
    shade = np.clip((a - NOISE) / (1 - NOISE), 0, 1)
    # Under the building, the nearest shade outside it.
    idx = ndimage.distance_transform_edt(near, return_distances=False, return_indices=True)
    s = np.where(near, shade[idx[0], idx[1]], shade)
    body_a = np.where(near, np.clip((a - s) / np.maximum(1 - s, 1e-3), 0, 1), 0)
    body_a[body_a < 0.04] = 0
    body = np.zeros_like(scene)
    body[..., :3] = np.where(body_a[..., None] > 0,
                             np.clip(scene[..., :3] * a[..., None] / np.maximum(body_a[..., None], 1e-3), 0, 1), 0)
    body[..., 3] = body_a
    return body, s


def ramp(n, px=8):
    """1 inside, falling to 0 over the last `px` of either end of a run of `n`."""
    return np.clip((np.minimum(np.arange(n), np.arange(n)[::-1]) + 0.5) / px, 0, 1)


def tail(sh, px=TAIL):
    """A 1x shadow the render's canvas cut off, carried on `px` past each edge it touches and faded out there (a
    smooth fall, softened), with where its top-left moved to. One that touches no edge just fades over its last 8 px."""
    cut = [sh[:, 0].max() > 0.02, sh[0].max() > 0.02, sh[:, -1].max() > 0.02, sh[-1].max() > 0.02]
    if not any(cut):
        return sh * ramp(sh.shape[0])[:, None] * ramp(sh.shape[1])[None, :], 0, 0
    left, top, right, bottom = (px if c else 0 for c in cut)
    out = np.pad(sh, ((top, bottom), (left, right)), mode="edge")

    def fall(n, before, after):
        f = np.ones(n)
        t = (np.arange(px) + 1) / (px + 1)
        if before:
            f[:before] = (0.5 + 0.5 * np.cos(np.pi * t))[::-1]
        if after:
            f[n - after:] = 0.5 + 0.5 * np.cos(np.pi * t)
        return f

    out = out * fall(out.shape[0], top, bottom)[:, None] * fall(out.shape[1], left, right)[None, :]
    # Rows carried straight on look combed: blur the carried part, the render's own shadow left as it was.
    soft = ndimage.gaussian_filter(out, 2)
    inside = np.zeros(out.shape, bool)
    inside[top:top + sh.shape[0], left:left + sh.shape[1]] = True
    return np.where(inside, out, soft), -left, -top


def over(top, under):
    """`top` over `under`, both float straight RGBA."""
    ta, ua = top[..., 3:], under[..., 3:]
    oa = ta + ua * (1 - ta)
    rgb = np.where(oa > 0, (top[..., :3] * ta + under[..., :3] * ua * (1 - ta)) / np.maximum(oa, 1e-4), 0)
    return np.dstack([rgb, oa])


def save_webp(im, path):
    im.save(path, "WEBP", quality=90, alpha_quality=100, method=6)


def export(name, render):
    cfg = BUILDINGS[name]
    out = ASSETS / cfg["folder"]
    fx, fy = cfg["frame"]
    rows = []

    def game(px, py):
        return fx + px // K, fy + py // K

    def picture(a, box, file):
        x0, y0, x1, y1 = box
        save_webp(resize_pm(a[y0:y1, x0:x1], ((x1 - x0) // HALF, (y1 - y0) // HALF)), out / file)
        return [file, *game(x0, y0)]

    for level, pre in cfg["looks"]:
        stem = f"{pre}-" if pre else ""
        base = load(render / f"{stem}base.png")
        alone = load(render / f"{stem}alone.png")
        assert base.shape[0] % K == 0 and base.shape[1] % K == 0, (name, level, base.shape)
        building = alone[..., 3] > 0.01
        del alone
        # Cells are read one at a time (a strip's renders are a gigabyte as floats) and kept only as cut.
        names = []
        if cfg["moves"] == "parts":
            names = sorted(render.glob(f"{stem}parts-*.png"))
        elif cfg["moves"] == "cells":
            names = sorted(render.glob("cell-*.png"))
        if cfg["moves"]:
            assert len(names) == CELLS[name][level], (name, level, len(names))
        tag = f"3d{level}"

        if cfg["moves"] == "cells":
            # Every pixel any cell changes, grown a 1x px: the sack's box. Each cell is split like the base, the
            # sack counted as building wherever it is.
            first = np.asarray(Image.open(names[0]).convert("RGBA")).astype("int16")
            changed = np.zeros(building.shape, bool)
            for n in names[1:]:
                changed |= np.abs(np.asarray(Image.open(n).convert("RGBA")).astype("int16") - first).max(axis=2) > 2
            del first
            changed = ndimage.binary_dilation(changed, iterations=K)
            box = bbox(changed.astype("float32"), 0.5)
            x0, y0, x1, y1 = box
            layers = []
            for n in names:
                c = load(n)
                layers.append(split(c, building | (c[..., 3] > 0.99) & changed)[0][y0:y1, x0:x1].copy())
            c = load(names[0])
            body, shade = split(c, building | (c[..., 3] > 0.99) & changed)
            del c
            still = body.copy()
            body[y0:y1, x0:x1] = 0
        else:
            body, shade = split(base, building)
            still = body
            layers = []
            if names:
                boxes = [Image.open(n).getchannel("A").point(lambda v: 255 if v > 2 else 0).getbbox() for n in names]
                box = whole((min(b[0] for b in boxes), min(b[1] for b in boxes),
                             max(b[2] for b in boxes), max(b[3] for b in boxes)))
                x0, y0, x1, y1 = box
                layers = [load(n)[y0:y1, x0:x1].copy() for n in names]
                still = body.copy()
                still[y0:y1, x0:x1] = over(layers[0], body[y0:y1, x0:x1])
        del base
        cells = layers

        row = dict(building=name, type=cfg["type"], level=level)
        row["top"] = picture(still, bbox(still[..., 3]), f"top.{tag}@2x.webp")

        # The shadow, 1x, white where there is none: what Flash's shadow pictures are.
        sh = np.asarray(Image.fromarray(shade, "F").resize((shade.shape[1] // K, shade.shape[0] // K), Image.BOX))
        # The render's canvas cuts a long shadow off at its edge: it is carried on past it and fades out there.
        sh, tx, ty = tail(sh)
        ys, xs = np.nonzero(sh > 0.02)
        sx0, sy0 = max(0, int(xs.min()) - 1), max(0, int(ys.min()) - 1)
        sx1, sy1 = min(sh.shape[1], int(xs.max()) + 2), min(sh.shape[0], int(ys.max()) + 2)
        gray = np.clip(255 * (1 - sh[sy0:sy1, sx0:sx1]) + 0.5, 0, 255).astype("uint8")
        Image.fromarray(gray, "L").save(out / f"shadow.{tag}.jpg", "JPEG", quality=90)
        row["shadow"] = [f"shadow.{tag}.jpg", fx + tx + sx0, fy + ty + sy0]

        if cells:
            row["body"] = picture(body, bbox(body[..., 3]), f"body.{tag}@2x.webp")
            w, h = (x1 - x0) // HALF, (y1 - y0) // HALF
            n = len(layers)
            cols = min(n, MAX_W // w)
            nrows = -(-n // cols)
            sheet = Image.new("RGBA", (w * cols, h * nrows), (0, 0, 0, 0))
            for i, layer in enumerate(layers):
                sheet.paste(resize_pm(layer, (w, h)), ((i % cols) * w, (i // cols) * h))
            file = f"anim.{tag}@2x.webp"
            save_webp(sheet, out / file)
            row["anim"] = [file, *game(x0, y0), w // 2, h // 2, n]
            if nrows > 1:
                row["columns"] = cols
        files = [row["top"][0], row["shadow"][0]] + ([row["body"][0], row["anim"][0]] if cells else [])
        row["bytes"] = sum((out / f).stat().st_size for f in files)
        rows.append(row)
        print(json.dumps(row), flush=True)
    return rows


if __name__ == "__main__":
    pairs = sys.argv[1:]
    assert pairs and len(pairs) % 2 == 0, __doc__
    for i in range(0, len(pairs), 2):
        assert pairs[i] in BUILDINGS, pairs[i]
        export(pairs[i], Path(pairs[i + 1]).resolve())
