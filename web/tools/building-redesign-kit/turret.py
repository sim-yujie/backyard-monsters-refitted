"""turret.py : the Sniper Tower's turret painted apart from its body, so it can turn in fights (owner, 26 Oct, option A).

  python turret.py setup <T1|T2|T3> <body|turret>   inputs + prompt.txt for one Codex call in art-samples/redesign/sniper/turret/<tier>/<job>/
  python turret.py cut <T1|T2|T3> <body|turret>     cut the painting out (body: fitted onto the approved tier picture; turret: 9 frames)
  python turret.py sheet                            32-cell strips per tier, the preview sheet and the turning GIFs

Painted per tier: the body WITHOUT its turret (an edit of the approved tier picture), and one 3x3 sheet of the turret at nine
headings, cells 20, 22, ... 30, 0, 2, 4 of the game's strip (cell = cartesian bearing / 11.25, BUILDING21.as). The rest is
mirrored: a left-right flip turns bearing b into 90 - b, so cell k is cell (8 - k) flipped. Odd cells repeat a neighbour.
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
from common import REPO, ASSETS, key, resize_pm, grass  # noqa: E402

SN = REPO / "art-samples" / "redesign" / "sniper"
OUT = SN / "turret"
TIER = {"T1": "R2A", "T2": "TALL2", "T3": "TALL3"}
NAME = {"T1": "TIER 1 (the normal tower)", "T2": "TIER 2 (the gold tower)", "T3": "TIER 3 (the black-and-gold tower)"}
# the turret on the approved tier picture (box in that tier's sample-cut.png) and the words for its plate
LOOK = {"T1": (400, 120, 850, 500), "T2": (300, 100, 770, 440), "T3": (300, 10, 770, 350)}
PLATE = {"T1": "a flat round dark steel plate",
         "T2": "a flat round dark steel plate with a polished gold rim",
         "T3": "a flat round black steel plate with a polished gold rim"}
PAINTED = [20, 22, 24, 26, 28, 30, 0, 2, 4]     # the 3x3 sheet, row by row
WAY = ["straight AWAY from the viewer (up the picture, the barrel foreshortened)", "up and to the right, steeply",
       "to the right and up (along the back-right edge of the ground diamond)",
       "to the right, a little up", "straight to the RIGHT (the barrel seen side-on, at its longest)", "to the right, a little down",
       "to the right and down (along the front-right edge of the ground diamond)", "down and to the right, steeply",
       "straight TOWARD the viewer (down the picture, the muzzle facing us, the barrel foreshortened)"]
FW, FH, FN = 55, 47, 30                          # the Flash strip anim.3.png
UP = 4

HEAD = ("Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. "
        "Do not write code and do not copy or composite pixels from the inputs.\n\n")
GAME = ("It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed "
        "isometric camera (from the front, looking down at about 30 degrees, the ground diamond's corners pointing left, right, up and down).\n\n")
GREEN = "Background everywhere: flat pure green #00FF00. No ground, no grass, no shadow on the ground, no text, no labels. The painting itself must contain no bright pure green."


def flash_cell(k):
    """Cell k of the Flash strip; 30 and 31 are missing there, so they are cells 10 and 9 flipped."""
    s = Image.open(ASSETS / "buildings" / "snipertower" / "anim.3.png").convert("RGBA")
    if k >= FN:
        return flash_cell((8 - k) % 32).transpose(Image.FLIP_LEFT_RIGHT)
    return s.crop((k * FW, 0, (k + 1) * FW, FH))


def setup(t, job):
    d = OUT / t / job
    d.mkdir(parents=True, exist_ok=True)
    src = SN / TIER[t]
    if job == "body":
        base = Image.open(src / "sample-new.png").convert("RGB")
        base.save(d / "base.png")
        w, h = base.size
        prompt = HEAD + f"""base.png is the approved {NAME[t]} picture of a tower from a cartoon building game. Make ONE change to it and keep everything else exactly the same.

The change: REMOVE THE DOMED CAP from the top deck: the round dome, its two side brackets, the short tube sticking out of it, and the small lamp with the red light on top. Nothing of it may remain, not even its shadow or reflection. In its place show the EMPTY round turntable the cap stands on: {PLATE[t]} set into the top deck, centred where the cap was, with a small round pivot hub and a ring of bolts in its middle. The cap will be drawn on top of it later, so the plate must be flat and empty.

Everything else stays exactly as in base.png: the body and its storeys, the striped corners, the panels, the wires, the legs and ball feet, the top deck and its rim, the colours and materials, the camera, the size and position of the tower in the picture, and the painting finish.

""" + GAME + f"""Input 1, base.png: the approved picture to edit.

Output: ONE image, {w}x{h}, the tower alone, at the same size and in the same place as in base.png. """ + GREEN
        inputs = ["base.png"]
    else:
        c = 341
        g = Image.new("RGBA", (3 * c, 3 * c), (128, 128, 128, 255))
        for i, k in enumerate(PAINTED):
            f = flash_cell(k).resize((FW * 5, FH * 5), Image.LANCZOS)
            g.alpha_composite(f, ((i % 3) * c + (c - f.width) // 2, (i // 3) * c + (c - f.height) // 2))
        g.convert("RGB").save(d / "guide.png")
        look = Image.open(src / "sample-cut.png").convert("RGBA").crop(LOOK[t])
        Image.alpha_composite(Image.new("RGBA", look.size, (128, 128, 128, 255)), look).convert("RGB").save(d / "look.png")
        inputs = ["look.png", "guide.png"]
        rows = "\n".join(f"- row {i // 3 + 1}, cell {i % 3 + 1}: the barrel points {WAY[i]}" for i in range(9))
        same = ""
        if t != "T1" and (OUT / "T1" / "turret" / "sample-new.png").exists():
            Image.open(OUT / "T1" / "turret" / "sample-new.png").convert("RGB").save(d / "t1sheet.png")
            inputs.append("t1sheet.png")
            same = ("\nInput 3, t1sheet.png: the approved tier 1 sheet of this turret. Copy its layout, the headings, the size and the place of the "
                    "turret in each cell exactly; only the materials change to those of look.png.\n")
        prompt = HEAD + f"""Paint a SPRITE SHEET of the SNIPER TOWER's gun turret turning round, {NAME[t]}.

Input 1, look.png: the turret as painted on the approved tower: the domed head, its two side brackets, the barrel with its muzzle ring, and the small scope with the red light on top. Ignore the deck and plate under it.
Input 2, guide.png: a 3x3 grid of the OLD game's turret at nine headings. From each cell copy ONLY which way the barrel points and how foreshortened it looks. Do not copy its look and ignore its tan deck.{same}
Output: ONE square image, 1024x1024, laid out as a 3x3 grid of nine equal cells, in the same order as guide.png (do not draw the grid lines). In every cell paint the SAME turret as look.png (same parts, shapes, colours, materials, size, painting finish, light from the upper left), turned on its vertical axis so that:
{rows}

Only the head, the brackets, the barrel and the scope turn. The camera never moves: every cell is seen from the same fixed isometric camera, from the front, looking down at about 30 degrees. At the foot of the turret there is a short round collar; it stays the same round shape and size in every cell, CENTRED in its cell and at the same height in every cell, so the turret turns about the centre of its collar. Every turret the same size, about half the width of its cell, nothing touching the cell edges or another cell. No deck, no plate, no tower, no ground.

""" + GAME + GREEN + " No numbers, arrows or grid lines."
    (d / "prompt.txt").write_text(prompt, encoding="utf-8")
    (d / "inputs.txt").write_text("\n".join(inputs) + "\n")
    print("dir", d.as_posix())


def band(a, thr=128):
    """(left, right, bottom, top) of the alpha shape, left/right over its bottom 30% (as finish.py)."""
    ys, xs = np.where(a >= thr)
    top, bot = ys.min(), ys.max() + 1
    sel = ys >= bot - 0.3 * (bot - top)
    return xs[sel].min(), xs[sel].max() + 1, bot, top


def cut_body(t):
    """The body painting fitted onto the approved tier picture (same canvas as its new-4x.png): same footprint band, same base line."""
    d = OUT / t / "body"
    cut = key(np.asarray(Image.open(d / "sample-new.png").convert("RGB")))
    cut.save(d / "sample-cut.png")
    ref = Image.open(SN / TIER[t] / "new-4x.png")
    l0, r0, b0, _ = band(np.asarray(ref)[..., 3])
    l1, r1, b1, _ = band(np.asarray(cut)[..., 3])
    k = (r0 - l0) / (r1 - l1)
    bb = cut.getbbox()
    crop = resize_pm(cut.crop(bb), (round((bb[2] - bb[0]) * k), round((bb[3] - bb[1]) * k)))
    c = Image.new("RGBA", ref.size, (0, 0, 0, 0))
    c.alpha_composite(crop, (round((l0 + r0) / 2 - ((l1 + r1) / 2 - bb[0]) * k), round(b0 - (b1 - bb[1]) * k)))
    c.save(d / "body-4x.png")
    print("body", t, "scale", round(k, 3))


def head(a):
    """(centre x, bottom y, width) of the turret without its barrel: the alpha opened with a round brush wider than the barrel."""
    m = a >= 128
    r = max(3, int(0.12 * max(np.ptp(np.where(m)[1]), 1)))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    o = ndi.binary_opening(m, structure=(xx * xx + yy * yy) <= r * r)
    lab, n = ndi.label(o)
    if n > 1:
        o = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)
    ys, xs = np.where(o)
    return (xs.min() + xs.max() + 1) / 2, ys.max() + 1, xs.max() + 1 - xs.min()


def cut_turret(t):
    """The nine turrets off the sheet, each with its collar centre (pivot) at the middle of a square frame; scale noted in pivot.json."""
    d = OUT / t / "turret"
    sheet = key(np.asarray(Image.open(d / "sample-new.png").convert("RGB")))
    sheet.save(d / "sample-cut.png")
    a = np.asarray(sheet)
    cw, ch = a.shape[1] / 3, a.shape[0] / 3
    frames, info = [], []
    for i, k in enumerate(PAINTED):
        x0, y0 = round((i % 3) * cw), round((i // 3) * ch)
        cell = sheet.crop((x0, y0, round(x0 + cw), round(y0 + ch)))
        ca = np.asarray(cell)[..., 3]
        lab, n = ndi.label(ca >= 64)
        if n > 1:                                        # keep the biggest piece (the turret), drop specks
            keep = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)
            keep = ndi.binary_dilation(keep, iterations=3)
            cell = Image.fromarray(np.dstack([np.asarray(cell)[..., :3], np.where(keep, ca, 0)]).astype("uint8"), "RGBA")
            ca = np.asarray(cell)[..., 3]
        cx, by, w = head(ca)
        frames.append(cell)
        info.append(dict(cell=k, cx=float(cx), bottom=int(by), head_w=int(w)))
    hw = float(np.median([f["head_w"] for f in info]))
    S = 2 * round(max(cw, ch))                           # square frames, pivot (collar bottom centre) in the middle
    for f, im in zip(info, frames):
        fr = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        fr.alpha_composite(im, (round(S / 2 - f["cx"]), round(S / 2 - f["bottom"])))
        fr.save(d / f"frame-{f['cell']:02d}.png")
    (d / "pivot.json").write_text(json.dumps(dict(frame=S, head_w=hw, cells=info), indent=1))
    print("turret", t, "head width", hw, [f["head_w"] for f in info])


def strip(t):
    """[32 RGBA frames at 4x, pivot in the middle] for one tier, scaled so the head matches the approved picture's turret."""
    d = OUT / t / "turret"
    info = json.loads((d / "pivot.json").read_text())
    k = PIVOT[t][2] / info["head_w"]
    S = round(info["frame"] * k)
    own = {c: resize_pm(Image.open(d / f"frame-{c:02d}.png"), (S, S)) for c in PAINTED}
    even = {c: own[c] if c in own else own[(8 - c) % 32].transpose(Image.FLIP_LEFT_RIGHT) for c in range(0, 32, 2)}
    return [even[c] if c % 2 == 0 else even[(c + 1) % 32] for c in range(32)]   # cell c covers bearings 11.25c .. 11.25(c+1)


def tower(t, cell, frames=None):
    """The body with the turret at one cell, on the body's 4x canvas."""
    b = Image.open(OUT / t / "body" / "body-4x.png").copy()
    f = (frames or strip(t))[cell]
    px, py, _ = PIVOT[t]
    b.alpha_composite(f, (round(px - f.width / 2), round(py - f.height / 2)))
    return b


def sheet():
    """preview.png (each tier with its turret at the 16 painted-or-mirrored headings, 1x and 2x on grass), turning GIFs and the strips."""
    tiers = [t for t in TIER if (OUT / t / "body" / "body-4x.png").exists() and (OUT / t / "turret" / "pivot.json").exists()]
    strips = {t: strip(t) for t in tiers}
    bodies = {t: Image.open(OUT / t / "body" / "body-4x.png") for t in tiers}
    W4 = max(b.width for b in bodies.values())
    H4 = max(b.height for b in bodies.values())
    # every tier on the tallest canvas, bottoms lined up (the canvases share the bottom: finish.py), cropped to what any tier covers
    def full(t, cell):
        im = tower(t, cell, strips[t])
        c = Image.new("RGBA", (W4, H4), (0, 0, 0, 0))
        c.alpha_composite(im, ((W4 - im.width) // 2, H4 - im.height))
        return c
    boxes = [full(t, c).getbbox() for t in tiers for c in (4, 20, 28, 12)]
    pad = 16
    bb = (min(b[0] for b in boxes) - pad, min(b[1] for b in boxes) - pad, max(b[2] for b in boxes) + pad, H4)
    bb = (bb[0] - (bb[2] - bb[0]) % UP, bb[1] - (bb[3] - bb[1]) % UP, bb[2], bb[3])

    def placed(t, cell, scale):
        c = full(t, cell).crop(bb)
        return resize_pm(c, (c.width * scale // UP, c.height * scale // UP))
    for t in tiers:                                       # the game's strip at 2x: 32 square cells, pivot in the middle of each
        fr = [resize_pm(f, (f.width // 2, f.height // 2)) for f in strips[t]]
        s = Image.new("RGBA", (fr[0].width * 32, fr[0].height), (0, 0, 0, 0))
        for i, f in enumerate(fr):
            s.alpha_composite(f, (i * f.width, 0))
        s.crop((0, 0, s.width, s.height)).save(OUT / t / f"strip@2x.png")
        px, py, _ = PIVOT[t]
        b = bodies[t]
        (OUT / t / "strip.json").write_text(json.dumps(dict(
            cells=32, cell_w=fr[0].width, cell_h=fr[0].height, degrees_per_cell=11.25,
            pivot_in_body_4x=[px, py], body_4x_size=list(b.size), note="cell c = cartesian bearing / 11.25 (BUILDING21.as); pivot = middle of each cell"), indent=1))
    heads = list(range(0, 32, 2))
    rows = []
    for t in tiers:
        for scale in (1, 2):
            ims = [placed(t, c, scale) for c in heads]
            w, h = ims[0].size
            pad = 6 * scale
            row = Image.new("RGBA", (len(ims) * (w + pad) + pad, h + 2 * pad), (0, 0, 0, 0))
            for i, im in enumerate(ims):
                row.alpha_composite(im, (pad + i * (w + pad), pad))
            rows.append((t, scale, row))
    lab = 30
    font = ImageFont.truetype("arial.ttf", 18)
    W = max(r.width for _, _, r in rows)
    H = sum(r.height + lab for _, _, r in rows) + lab + 10
    g = grass(W, H).convert("RGBA")
    dr = ImageDraw.Draw(g)
    dr.rectangle((0, 0, W, lab + 4), fill=(20, 20, 20, 255))
    dr.text((8, 6), "Sniper Tower, turret painted apart from the body: each tier with its turret at 16 headings (cells 0, 2, ... 30 of 32; "
            "odd cells repeat the next one). Cells 20-30, 0-4 painted, the rest mirrored.", fill=(255, 255, 255, 255), font=font)
    y = lab + 10
    for t, scale, r in rows:
        dr.rectangle((0, y, W, y + lab - 4), fill=(20, 20, 20, 200))
        dr.text((8, y + 4), f"{NAME[t].title()}, {scale}x {'(game size)' if scale == 1 else ''}   turning left to right: "
                f"bearing 0, 22.5, 45 ... 337.5 degrees", fill=(255, 255, 255, 255), font=font)
        y += lab
        g.alpha_composite(r, (0, y))
        y += r.height
    g.convert("RGB").save(OUT / "preview.png", optimize=True)
    # turning GIFs: the three tiers side by side, the turret sweeping round once (32 cells)
    for scale in (1, 2):
        fr = []
        for c in list(range(32)):
            ims = [placed(t, c, scale) for t in tiers]
            w, h = ims[0].size
            bg = grass(len(ims) * w + 20 * scale, h + 10 * scale, seed=5).convert("RGBA")
            for i, im in enumerate(ims):
                bg.alpha_composite(im, (10 * scale + i * w, 5 * scale))
            fr.append(bg.convert("RGB").quantize(colors=255, method=Image.MEDIANCUT, dither=Image.NONE))
        fr[0].save(OUT / f"turning-{scale}x.gif", save_all=True, append_images=fr[1:], duration=110, loop=0, disposal=1)
    print("sheet", (OUT / "preview.png").as_posix(), tiers)


# the turret's pivot on each body (the centre of the collar's foot on the turntable) and the approved turret's head width, at 4x on
# the body's canvas; measured by eye on the approved tier picture
PIVOT = {"T1": (331, 458, 115), "T2": (331, 909, 115), "T3": (332, 840, 115)}

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "setup":
        setup(sys.argv[2], sys.argv[3])
    elif cmd == "cut":
        (cut_body if sys.argv[3] == "body" else cut_turret)(sys.argv[2])
    elif cmd == "sheet":
        sheet()
