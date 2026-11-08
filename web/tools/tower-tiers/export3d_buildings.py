"""Exports the 3D yard buildings (owner, 31 Oct 2026: "All approved", "Add 3d buildings into game") into the game.

    python -I web/tools/tower-tiers/export3d_buildings.py <building>[:damaged|:destroyed] <render folder> [more pairs ...]

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
| planner | 10 Yard Planner | art/buildings-3d-planner | planner-v1 | one look, still |
| juicer | 9 Monster Juicer | art/buildings-3d-juicer | juicer-v1 | one look; 51 cells of its crusher and juice |
| cage | 114 Champion Cage | art/buildings-3d-cage | cage-v1 | one look, still |
| catapult | 51 Catapult | art/buildings-3d-catapult | catapult-v1 | levels 1, 2, 3 (3 also level 4), still |
| baiter | 19 Wild Monster Baiter | art/buildings-3d-baiter | baiter-v1 | one look; 41 cells of its lure |
| flinger | 5 Flinger | art/buildings-3d-flinger | flinger-v1 | levels 1, 2, 3, 4 (4 also level 5), still |
| store | 12 General Store | art/buildings-3d-store | store-v1 | one look, still |
| maproom | 11 Map Room | art/buildings-3d-maproom | maproom-v1 | one look, still |
| block | 17 Block | art/buildings-3d-walls | walls-v1 | levels 1-5, still (8 render px a 1x px) |
| stone | 18 Stone Block | art/buildings-3d-walls | walls-v1 | one look, still |
| iblock | 17 Block in an Inferno yard | art/buildings-3d-walls | walls-v1 | levels 1-3, still |
| academy | 26 Monster Academy | art/buildings-3d-academy | academy-v1 | levels 1-4 (4 also level 5); 21 cells of its cogs |
| lab | 116 Monster Lab | art/buildings-3d-lab | lab-v1 | one look; 32 cells of its brew, 5 of each side door's cogs |
| chamber | 119 Champion Chamber | art/buildings-3d-chamber | chamber-v1 | one look, still |
| booby | 24 Booby Trap | art/traps-3d | traps-3d (traps.py) | one look, still; destroyed = fired |
| heavy | 117 Heavy Trap | art/traps-3d | traps-3d (traps.py) | one look, still; destroyed = fired |
| icc | 16 Incubator Control Centre in an Inferno yard | art/icc-inferno-looks | icc-looks (look C) | one look; 32 idle and 64 working cells, each the whole building |
| bone | 1 Bone Cruncher in an Inferno yard | art/buildings-3d-inferno | inferno/bone-clean2 (crusher.py) | levels 1, 3, 7; 36 cells of its loop |

The Inferno's Bone Cruncher (`bone`, owner 6 Nov 2026: "3d bone crusher has been approved") is the clean-room model
(`crusher.py`): three tiers, levels 1-2, 3-6 and 7-10 as the model's own script splits them. Its renders are the loop
renders, `inferno/bone-clean2/anim/render/` (6 render px a 1x px, `k`, on the canvas x -60..60, y -70..70), frames 0-35
only: `L<tier>-parts-36.png` is frame 0 again, rendered for the loop check, and must be left out. Its files are `*.3d1*`,
`*.3d3*` and `*.3d7*` in the Inferno's own folder, `iboneharvester/`. It has no damaged or destroyed renders: the game
tints the whole look when damaged and shows Flash's rubble when destroyed, as the Incubator Control Centre's.

The model came out smaller than Flash's Bone Cruncher in the same spot (9 Nov 2026: about 76 x 72 1x px at level 1
against Flash's 86 x 84, and 76 x 78 at levels 3 and 7 against Flash's 90 x 95), so it is exported grown (`grow`, 1.2)
about its middle on the ground (`ground`, the model's `kit.ORIGIN`, (0, 35)): every render is first enlarged that much
into a scratch folder (`grown()`), the canvas with it, and the export reads that, on a canvas whose top-left moves to
keep the ground point where it was. The renders are 3 render px a 2x px, so the grown pictures are still made smaller
from them, not blown up. Grown, it is 91 x 86 and 91 x 94: Flash's size at each tier.

The Inferno's Incubator Control Centre (`icc`, moves "loops") is look C (owner, 2 Nov 2026: "I want to see it in the
inferno + the soft animated glow of the lava"). Its glows are made after Blender (`icc-looks/anim.py game`), so its
renders are `render/game/`: `idle-NN.png` and `active-NN.png`, the building and its glows with no ground shadow, and
`shadow.png`, the ground shadow alone as alpha, all on the whole render canvas. Every cell is the whole building
(`whole`): the first `rest` cells are its idle loop, the lava breathing, the rest its working loop, the crystal pulsing
too (`TierAnim.rest`). Its files are `*.i3d1*` in the HCC's folder, which the Inferno's row 16 shares.

The damaged and destroyed looks (`<building>:damaged`, `<building>:destroyed`) are stills, rendered the same way into
`L<n>-damaged-base.png` and `-alone.png` (a wall's `block<n>-damaged-...`): the first eight's from
art/buildings-3d-damage (`art-samples/buildings-b6/damage/<building>/render`), the others' from their own folder's
`render/`. A look with no render of that state is skipped: Flash shares one destroyed picture across a building's
levels, and so does the 3D (`buildingArtTiers.ts` names it in every look).

A look's renders (`render/`): `L<n>-base.png` (`base.png`), every still part with the ground shadow (a shadow
catcher: black, the shade as alpha) and the moving parts hidden from the camera; `L<n>-alone.png`, the building with
no ground shadow; and `L<n>-parts-NN.png`, one per Flash cell, only the moving parts, every still part held out. The
silo's `cell-NN.png` are instead the whole scene for each fill level (`post.py cells`), changed only in the sack. The
Lab's `anim/<layer>-NN.png` (`dome`, `doorL`, `doorR`, as Flash's three strips) are the whole scene too, rendered only
in a border round that layer's moving part (`lab.py anim`), the rest of the canvas empty; its base shows them at rest.

Writes into `server/public/assets/buildings/<folder>/` (the Flash building's own folder), per look `<n>`:

- `body.3d<n>@2x.webp`: the still parts, the ground shadow taken off: what the strip's cells go over.
- `anim.3d<n>@2x.webp`: the strip, as Flash's `anim` layer, its cells in Flash's order and number. A moving-parts
  building's cell is only its moving parts (cut to what any cell covers); the silo's is the box round all that the sack
  ever changes, every pixel in it, with that box cut out of its body. The Lab's, one strip per layer
  (`anim.3d<n>.<layer>@2x.webp`), are the whole scene only round what moves, which is cut out of the body, fading out
  past it over the body, with a clear margin round each cell (`boxed()`): a hard box edge showed as a line in the game.
- `top.3d<n>@2x.webp`: the whole building at rest (body and cell 0), for the icons and the placing ghost; a still
  building's only picture.
- `shadow.3d<n>.jpg`: the 3D ground shadow, 1x, white where there is none, as Flash's shadows (drawn multiplied).
- `top.3d<n>.damaged@2x.webp` and `shadow.3d<n>.damaged.jpg` (and `.destroyed`): a state's still and its shadow.

The shadow comes off the base this way: outside the building (`alone.png`, grown a little) a base pixel is all shadow;
under it the shadow is the nearest shadow outside, and the still parts' own alpha is what the base's is over that
shadow, `(a - s) / (1 - s)`. A part that moves over open ground leaves nothing behind in the body, since the base never
saw it.

A shadow the canvas cuts off is carried on past the edge by `tail()`. The housing's is not cut: it fades out over its
last ~20 px inside the canvas on its own (the flats' soft sun). A render 40 px wider on the right (31 Oct 2026) gave
the same shadow, 1 px wider, so housing-v1's own canvas stays.

A parts cell with a line of solid pixels on its outer edge was cut by its render and is warned about (`clipped()`). Goo
levels 6 and 10 warn for cells 3-6: the bulge in their pipes touches the canvas's bottom, under one game px of its
rounded tip lost, which the game does not show (checked 31 Oct 2026).

It prints one line of JSON per look with the row `buildingArtTiers.ts` holds (`top`, `shadow`, and `anim` as
`[file, x, y, width, height, cells]` with `body` and `columns` when the strip wraps, and the Lab's further strips as
`more`), in 1x px from the origin.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "server" / "public" / "assets" / "buildings"
K = 12                         # render px a 1x px (a building's own `k` where it differs: the walls' 8)
MAX_W = 4096                   # the widest a strip's file may be; wider, it wraps into rows (`columns`)
RESOURCE = [(1, "L1"), (3, "L3"), (6, "L6"), (10, "L10")]
# Each building: its type, its Flash folder, its canvas's top-left in 1x px, its looks (first level, render prefix)
# and how it moves: "parts" (a layer of moving parts per cell), "cells" (the silo's whole cells), "boxes" (the Lab's
# `layers`, each a strip of its own of the whole scene in a box) or None. `states` gives a damaged or destroyed
# render's own canvas top-left where it is wider than the whole look's.
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
    "planner": dict(type=10, folder="yardplanner", frame=(-62, -34), looks=[(1, "L1")], moves=None),
    "juicer": dict(type=9, folder="monsterjuiceloosener", frame=(-50, -22), looks=[(1, "L1")], moves="parts",
                   states={"damaged": (-64, -14), "destroyed": (-64, -14)}),
    "cage": dict(type=114, folder="monstercage", frame=(-140, -24), looks=[(1, "L1")], moves=None),
    "catapult": dict(type=51, folder="catapult", frame=(-64, -40), looks=[(1, "L1"), (2, "L2"), (3, "L3")],
                     moves=None),
    "baiter": dict(type=19, folder="monsterbaiter", frame=(-50, -36), looks=[(1, "L1")], moves="parts"),
    "flinger": dict(type=5, folder="flinger", frame=(-80, -72), looks=[(1, "L1"), (2, "L2"), (3, "L3"), (4, "L4")],
                    moves=None),
    "store": dict(type=12, folder="generalstore", frame=(-50, -44), looks=[(1, "L1")], moves=None),
    "maproom": dict(type=11, folder="maproom", frame=(-70, -72), looks=[(1, "L1")], moves=None,
                    states={"damaged": (-78, -72), "destroyed": (-78, -72)}),
    "block": dict(type=17, folder="walls", frame=(-30, -30), k=8, moves=None,
                  looks=[(n, f"block{n}-whole") for n in range(1, 6)]),
    "stone": dict(type=18, folder="walls/stone", frame=(-30, -30), k=8, looks=[(1, "stone-whole")], moves=None),
    "iblock": dict(type=17, folder="iwalls", frame=(-30, -30), k=8, moves=None,
                   looks=[(n, f"inferno{n}-whole") for n in range(1, 4)]),
    "academy": dict(type=26, folder="academy", frame=(-76, -44), looks=[(n, f"L{n}") for n in range(1, 5)],
                    moves="parts"),
    "lab": dict(type=116, folder="monsterlab", frame=(-86, -104), looks=[(1, "L1")], moves="boxes",
                layers=("dome", "doorL", "doorR")),
    "chamber": dict(type=119, folder="champchamber", frame=(-78, -66), looks=[(1, "L1")], moves=None),
    "icc": dict(type=16, folder="hatcherycontrolcenter", frame=(-80, -84), looks=[(1, "")], moves="loops"),
    "bone": dict(type=1, folder="iboneharvester", frame=(-60, -70), k=6, looks=[(1, "L1"), (3, "L2"), (7, "L3")],
                 moves="parts", grow=1.2, ground=(0, 35)),
    "booby": dict(type=24, folder="boobytrap", frame=(-24, -14), looks=[(1, "booby-whole")], moves=None),
    "heavy": dict(type=117, folder="heavytrap", frame=(-24, -14), looks=[(1, "heavy-whole")], moves=None),
}
# Flash's cells per look (`buildingArtData.ts`): the 3D strip must hold as many.
CELLS = {"twig": {1: 34, 3: 34, 6: 34, 10: 34}, "pebble": {1: 26, 3: 26, 6: 26, 10: 24},
         "putty": {1: 26, 3: 26, 6: 26, 10: 25}, "goo": {1: 26, 3: 26, 6: 26, 10: 26}, "silo": {1: 26},
         "hatchery": {1: 31, 2: 31, 3: 31}, "juicer": {1: 51}, "baiter": {1: 41},
         "academy": {1: 21, 2: 21, 3: 21, 4: 21}, "lab": {1: (32, 5, 5)}, "bone": {1: 36, 3: 36, 7: 36}}
TAIL = 16                      # 1x px a shadow cut by the render's canvas is carried on past it, fading out
NOISE = 0.07                   # the shadow catcher's faint wash over all the ground (sky occlusion), taken off every shade
MOVED = 8                      # levels (of 255) a Lab cell must differ from the first to count as moving, past the noise
SPECK = 2                      # 1x px² of change below which it is the render's noise, not a moving part


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


def whole(box, k=K):
    """A render box grown to whole 1x px."""
    x0, y0, x1, y1 = box
    return x0 // k * k, y0 // k * k, -(-x1 // k) * k, -(-y1 // k) * k


def bbox(alpha, floor=2 / 255, k=K):
    ys, xs = np.nonzero(alpha > floor)
    return whole((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1), k)


def clipped(alpha, box, run=15):
    """The edges ("left", "top", ...) of a parts cell where a line of solid pixels stops dead: a soft edge fades out over
    a pixel or two, so `run` solid pixels on the cell's outermost line mean the render cut it there (31 Oct 2026: the
    Hatchery's renders were cut to a region round its crank at rest, and lost the handle wherever it swung past)."""
    x0, y0, x1, y1 = box
    lines = {"left": alpha[y0:y1, x0], "top": alpha[y0, x0:x1], "right": alpha[y0:y1, x1 - 1],
             "bottom": alpha[y1 - 1, x0:x1]}
    return ", ".join(k for k, v in lines.items() if (v > 200).sum() > run)


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


def boxed(base, building, names, k):
    """One of the Lab's moving layers: its renders (`anim/<layer>-NN.png`) are the whole scene, ground shadow and all,
    in a border round the moving part, the rest of the canvas empty. Each cell is laid into the base there and split
    like it, the moving part counted as building wherever it is, and kept only round what moves: the `core`, every
    pixel some cell changes by more than the render's noise, which comes out of the body; then a band where the cell is
    whole (it covers the body's cut edge, which the game's texture filtering blurs), then a fade to nothing over the
    body, which is the same picture there. The strip's box has a clear margin, so no cell bleeds into the next in the
    game. Returns the box, the cells cut to it and the core."""
    first = np.asarray(Image.open(names[0]).convert("RGBA")).astype("int16")
    changed = np.zeros(building.shape, bool)
    for n in names[1:]:
        changed |= np.abs(np.asarray(Image.open(n).convert("RGBA")).astype("int16") - first).max(axis=2) > MOVED
    rendered = first[..., 3] > 0
    rx0, ry0, rx1, ry1 = Image.fromarray(rendered.astype("uint8") * 255).getbbox()
    del first
    # The render's noise flickers in specks; what moves is in pieces of a few 1x px at least.
    parts, count = ndimage.label(changed)
    sizes = ndimage.sum(changed, parts, range(1, count + 1))
    changed = np.isin(parts, 1 + np.nonzero(sizes >= SPECK * k * k)[0])
    del parts
    # Inside the rendered border, far enough from its edge for the band and the fade.
    inside = np.zeros(building.shape, bool)
    inside[ry0:ry1, rx0:rx1] = True
    edge = ndimage.distance_transform_edt(inside)
    core = ndimage.binary_closing(changed, iterations=k // 2) & (edge > 2 * k)
    near = ndimage.distance_transform_edt(~core)
    weight = np.minimum(np.clip((2 * k - near) / k, 0, 1), np.clip(edge / k, 0, 1))
    x0, y0, x1, y1 = bbox(weight, 0, k)
    x0, y0 = max(0, x0 - k), max(0, y0 - k)
    x1, y1 = min(building.shape[1], x1 + k), min(building.shape[0], y1 + k)
    w = weight[y0:y1, x0:x1, None]
    cells = []
    for n in names:
        c = load(n)
        scene = base.copy()
        scene[ry0:ry1, rx0:rx1] = c[ry0:ry1, rx0:rx1]
        del c
        cell = split(scene, building | (scene[..., 3] > 0.99) & core)[0][y0:y1, x0:x1].copy()
        cell[..., 3:] *= w
        cells.append(cell)
    return (x0, y0, x1, y1), cells, core


def export_loops(name, render):
    """The Inferno ICC (`icc`): a strip of whole cells, its idle loop then its working loop, its top (idle cell 0) and
    its shadow. See the module comment."""
    cfg = BUILDINGS[name]
    out = ASSETS / cfg["folder"]
    fx, fy = cfg["frame"]
    k = cfg.get("k", K)
    names = sorted(render.glob("idle-*.png")) + sorted(render.glob("active-*.png"))
    rest = len(list(render.glob("idle-*.png")))
    assert rest and len(names) > rest, (name, render)
    boxes = [Image.open(n).getchannel("A").point(lambda v: 255 if v > 2 else 0).getbbox() for n in names]
    x0, y0, x1, y1 = whole((min(b[0] for b in boxes), min(b[1] for b in boxes),
                            max(b[2] for b in boxes), max(b[3] for b in boxes)), k)
    w, h = (x1 - x0) * 2 // k, (y1 - y0) * 2 // k
    n = len(names)
    cols = min(n, MAX_W // w)
    nrows = -(-n // cols)
    sheet = Image.new("RGBA", (w * cols, h * nrows), (0, 0, 0, 0))
    first = None
    for j, path in enumerate(names):
        cell = load(path)
        if j == 0:
            first = cell
        sheet.paste(resize_pm(cell[y0:y1, x0:x1], (w, h)), ((j % cols) * w, (j // cols) * h))
    tag = "i3d1"
    save_webp(sheet, out / f"anim.{tag}@2x.webp")
    row = dict(building=name, type=cfg["type"], level=1)
    tx0, ty0, tx1, ty1 = bbox(first[..., 3], k=k)
    save_webp(resize_pm(first[ty0:ty1, tx0:tx1], ((tx1 - tx0) * 2 // k, (ty1 - ty0) * 2 // k)), out / f"top.{tag}@2x.webp")
    row["top"] = [f"top.{tag}@2x.webp", fx + tx0 // k, fy + ty0 // k]
    shade = np.asarray(Image.open(render / "shadow.png").convert("L")).astype("float32") / 255
    sh = np.asarray(Image.fromarray(shade, "F").resize((shade.shape[1] // k, shade.shape[0] // k), Image.BOX))
    sh, sx, sy = tail(sh)
    ys, xs = np.nonzero(sh > 0.02)
    sx0, sy0 = max(0, int(xs.min()) - 1), max(0, int(ys.min()) - 1)
    sx1, sy1 = min(sh.shape[1], int(xs.max()) + 2), min(sh.shape[0], int(ys.max()) + 2)
    gray = np.clip(255 * (1 - sh[sy0:sy1, sx0:sx1]) + 0.5, 0, 255).astype("uint8")
    Image.fromarray(gray, "L").save(out / f"shadow.{tag}.jpg", "JPEG", quality=90)
    row["shadow"] = [f"shadow.{tag}.jpg", fx + sx + sx0, fy + sy + sy0]
    row["anim"] = [f"anim.{tag}@2x.webp", fx + x0 // k, fy + y0 // k, w // 2, h // 2, n]
    row["columns"] = cols
    row["whole"] = True
    row["rest"] = rest
    row["bytes"] = sum((out / f).stat().st_size for f in (row["top"][0], row["shadow"][0], row["anim"][0]))
    print(json.dumps(row), flush=True)
    return [row]


def grown(name, render, frame, k):
    """A building exported larger than it was modelled (`grow`, the Bone Cruncher's): its renders, each look's base,
    alone and first `CELLS` parts cells, enlarged by `grow` into a scratch folder, about the building's middle on the
    ground (`ground`, 1x px from the origin), with the canvas's new top-left. Lanczos, alpha premultiplied (Pillow's
    own for RGBA). The ground point and the canvas must land on whole 1x px."""
    import tempfile
    cfg = BUILDINGS[name]
    g, (gx, gy), (fx, fy) = cfg["grow"], cfg["ground"], frame
    nfx, nfy = gx - (gx - fx) * g, gy - (gy - fy) * g
    assert abs(nfx - round(nfx)) < 1e-6 and abs(nfy - round(nfy)) < 1e-6, (name, g, nfx, nfy)
    tmp = Path(tempfile.mkdtemp(prefix=f"grown-{name}-"))
    for level, pre in cfg["looks"]:
        stem = f"{pre}-" if pre else ""
        files = [f"{stem}base.png", f"{stem}alone.png"]
        if cfg["moves"] == "parts":
            files += [f"{stem}parts-{i:02d}.png" for i in range(CELLS[name][level])]
        for f in files:
            im = Image.open(render / f).convert("RGBA")
            size = (round(im.width * g), round(im.height * g))
            assert size[0] % k == 0 and size[1] % k == 0, (f, size)
            im.resize(size, Image.LANCZOS).save(tmp / f)
    return tmp, (round(nfx), round(nfy))


def export(name, render, state=None):
    """A building's whole looks, or with `state` ("damaged", "destroyed") the stills of that state `render` holds."""
    cfg = BUILDINGS[name]
    out = ASSETS / cfg["folder"]
    fx, fy = cfg.get("states", {}).get(state, cfg["frame"])
    k = cfg.get("k", K)
    if cfg.get("grow"):
        assert not state, (name, "a grown building's states are not wired")
        render, (fx, fy) = grown(name, render, (fx, fy), k)
    moves = None if state else cfg["moves"]
    rows = []

    def game(px, py):
        return fx + px // k, fy + py // k

    def picture(a, box, file):
        x0, y0, x1, y1 = box
        save_webp(resize_pm(a[y0:y1, x0:x1], ((x1 - x0) * 2 // k, (y1 - y0) * 2 // k)), out / file)
        return [file, *game(x0, y0)]

    for level, pre in cfg["looks"]:
        if state:
            # `L<n>-damaged-`, a wall's `block<n>-damaged-`; a look with no render of the state shares another's.
            stem = f"{pre.removesuffix('-whole') or f'L{level}'}-{state}-"
            if not (render / f"{stem}base.png").exists():
                continue
        else:
            stem = f"{pre}-" if pre else ""
        base = load(render / f"{stem}base.png")
        alone = load(render / f"{stem}alone.png")
        assert base.shape[0] % k == 0 and base.shape[1] % k == 0, (name, level, base.shape)
        building = alone[..., 3] > 0.01
        del alone
        # Cells are read one at a time (a strip's renders are a gigabyte as floats) and kept only as cut.
        names = []
        if moves == "parts":
            names = sorted(render.glob(f"{stem}parts-*.png"))
        elif moves == "cells":
            names = sorted(render.glob("cell-*.png"))
        elif moves == "boxes":
            names = [sorted(render.glob(f"anim/{layer}-*.png")) for layer in cfg["layers"]]
        if moves == "boxes":
            assert tuple(map(len, names)) == CELLS[name][level], (name, level, [len(n) for n in names])
        elif moves:
            assert len(names) == CELLS[name][level], (name, level, len(names))
        tag = f"3d{level}.{state}" if state else f"3d{level}"

        if moves == "cells":
            # Every pixel any cell changes, grown a 1x px: the sack's box. Each cell is split like the base, the
            # sack counted as building wherever it is.
            first = np.asarray(Image.open(names[0]).convert("RGBA")).astype("int16")
            changed = np.zeros(building.shape, bool)
            for n in names[1:]:
                changed |= np.abs(np.asarray(Image.open(n).convert("RGBA")).astype("int16") - first).max(axis=2) > 2
            del first
            changed = ndimage.binary_dilation(changed, iterations=k)
            box = bbox(changed.astype("float32"), 0.5, k)
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
            strips = [(f"anim.{tag}@2x.webp", box, layers)]
        elif moves == "boxes":
            body, shade = split(base, building)
            still = body.copy()
            strips = []
            for layer, files in zip(cfg["layers"], names):
                box, cells, core = boxed(base, building, files, k)
                body[core] = 0
                strips.append((f"anim.{tag}.{layer}@2x.webp", box, cells))
        else:
            body, shade = split(base, building)
            still = body
            layers = []
            if names:
                boxes = [Image.open(n).getchannel("A").point(lambda v: 255 if v > 2 else 0).getbbox() for n in names]
                for n, b in zip(names, boxes):
                    cut = clipped(np.asarray(Image.open(n).getchannel("A")), b)
                    if cut:
                        print(f"WARNING {n.name}: solid pixels on its {cut} edge, cut by the render's border or canvas",
                              file=sys.stderr)
                box = whole((min(b[0] for b in boxes), min(b[1] for b in boxes),
                             max(b[2] for b in boxes), max(b[3] for b in boxes)), k)
                x0, y0, x1, y1 = box
                layers = [load(n)[y0:y1, x0:x1].copy() for n in names]
                still = body.copy()
                still[y0:y1, x0:x1] = over(layers[0], body[y0:y1, x0:x1])
            strips = [(f"anim.{tag}@2x.webp", box, layers)] if layers else []
        del base

        row = dict(building=name, type=cfg["type"], level=level, **({"state": state} if state else {}))
        row["top"] = picture(still, bbox(still[..., 3], k=k), f"top.{tag}@2x.webp")

        # The shadow, 1x, white where there is none: what Flash's shadow pictures are.
        sh = np.asarray(Image.fromarray(shade, "F").resize((shade.shape[1] // k, shade.shape[0] // k), Image.BOX))
        # The render's canvas cuts a long shadow off at its edge: it is carried on past it and fades out there.
        sh, tx, ty = tail(sh)
        ys, xs = np.nonzero(sh > 0.02)
        row["shadow"] = None
        # A look that casts none (the Inferno's first wall, a low rim of rock) has no shadow picture.
        if len(xs):
            sx0, sy0 = max(0, int(xs.min()) - 1), max(0, int(ys.min()) - 1)
            sx1, sy1 = min(sh.shape[1], int(xs.max()) + 2), min(sh.shape[0], int(ys.max()) + 2)
            gray = np.clip(255 * (1 - sh[sy0:sy1, sx0:sx1]) + 0.5, 0, 255).astype("uint8")
            Image.fromarray(gray, "L").save(out / f"shadow.{tag}.jpg", "JPEG", quality=90)
            row["shadow"] = [f"shadow.{tag}.jpg", fx + tx + sx0, fy + ty + sy0]

        if strips:
            row["body"] = picture(body, bbox(body[..., 3], k=k), f"body.{tag}@2x.webp")
        for i, (file, (x0, y0, x1, y1), layers) in enumerate(strips):
            w, h = (x1 - x0) * 2 // k, (y1 - y0) * 2 // k
            n = len(layers)
            cols = min(n, MAX_W // w)
            nrows = -(-n // cols)
            sheet = Image.new("RGBA", (w * cols, h * nrows), (0, 0, 0, 0))
            for j, layer in enumerate(layers):
                sheet.paste(resize_pm(layer, (w, h)), ((j % cols) * w, (j // cols) * h))
            save_webp(sheet, out / file)
            strip = [file, *game(x0, y0), w // 2, h // 2, n]
            if i == 0:
                row["anim"] = strip
                if nrows > 1:
                    row["columns"] = cols
            else:
                # The further strips (the Lab's side doors) run beside the first, as Flash's further layers; one row.
                assert nrows == 1, (file, n, w)
                row.setdefault("more", []).append(strip)
        files = [row["top"][0]] + ([row["shadow"][0]] if row["shadow"] else []) + (
            [row["body"][0], *(strip[0] for strip in strips)] if strips else [])
        row["bytes"] = sum((out / f).stat().st_size for f in files)
        rows.append(row)
        print(json.dumps(row), flush=True)
    return rows


if __name__ == "__main__":
    pairs = sys.argv[1:]
    assert pairs and len(pairs) % 2 == 0, __doc__
    for i in range(0, len(pairs), 2):
        building, _, state = pairs[i].partition(":")
        assert building in BUILDINGS and state in ("", "damaged", "destroyed"), pairs[i]
        if BUILDINGS[building]["moves"] == "loops":
            assert not state, pairs[i]
            export_loops(building, Path(pairs[i + 1]).resolve())
            continue
        export(building, Path(pairs[i + 1]).resolve(), state or None)
