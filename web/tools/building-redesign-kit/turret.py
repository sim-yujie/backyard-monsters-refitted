"""turret.py : a tower's turning part painted apart from its body, so it turns in fights (owner, 26 Oct: option A, "smoother").

  python turret.py setup <tower> <T1|T2|T3> <body|turret|turret2>   inputs + prompt.txt for one Codex call in
                                                                     art-samples/redesign/<tower>/turret/<tier>/<job>/
  python turret.py cut <tower> <T1|T2|T3> <body|turret|turret2>     cut the painting out (body: fitted onto the approved tier
                                                                     picture; turret sheets: nine frames, pivot in the middle)
  python turret.py sheet <tower>                                    the game's strips, strip.json, the still sheet and the GIF

Towers: sniper, laser, aerial, railgun. Painted per tier: the body WITHOUT its turning part (an edit of the approved tier
picture), and the turning part at 32 headings, one per 11.25 degrees of ground bearing (the cartesian bearing of BTOWER.Rotate:
heading 0 points down-right on screen, 4 at the viewer, 12 left, 20 away, 28 right). Two 3x3 sheets per tier paint the right
half: `turret` = headings 20, 22 ... 30, 0, 2, 4 and `turret2` = 21, 23 ... 31, 1, 3 plus a second try at 20. The rest is
mirrored: a left-right flip turns bearing b into 90 - b, so heading j is heading (8 - j) flipped.

Each game cell then gets the nearest of the 32 headings to the bearing the game means by that cell (TOWER[...]["heading"]):
the Sniper 11.25 a cell, the Aerial 12 a cell, the Railgun 12 a cell less 30 (towerFx.ts facingCell), the Laser its beam's
screen angle, 25 + 6.66 a cell (laserCell), turned back into a ground bearing.
"""
import json
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
from common import REPO, ASSETS, key, resize_pm, grass  # noqa: E402

RED = REPO / "art-samples" / "redesign"
TIER = {"T1": "R2A", "T2": "TALL2", "T3": "TALL3"}
NAME = {"T1": "TIER 1 (the normal tower)", "T2": "TIER 2 (the gold tower)", "T3": "TIER 3 (the black-and-gold tower)"}
SHEET = {"turret": [20, 22, 24, 26, 28, 30, 0, 2, 4],          # the 3x3 sheets, row by row
         "turret2": [21, 23, 25, 27, 29, 31, 1, 3, 20]}
UP = 4


def _laser_bearing(k):
    """The ground bearing the Laser's cell k stands for: the middle of its screen-angle band (y down), un-squashed."""
    a = math.radians(25 + 6.66 * (k + 0.5))
    sx, sy = math.cos(a), math.sin(a)
    return math.degrees(math.atan2((2 * sy - sx) / 2, (sx + 2 * sy) / 2)) % 360


# per tower: the Flash strip (file, cell w, h, count, guide scale, Flash cell for a bearing), the approved turret's box on each
# tier's sample-cut.png, the words, how wide a brush strips the barrel off for the pivot, and the game's cells.
TOWER = {
    "sniper": dict(
        flash=("snipertower/anim.3.png", 55, 47, 30, 5, lambda b: round(b / 11.25) % 32),
        look={"T1": (400, 120, 850, 500), "T2": (300, 100, 770, 440), "T3": (300, 10, 770, 350)},
        what="the SNIPER TOWER's gun turret",
        parts=("the turret as painted on the approved tower: the domed head, its two side brackets, the barrel with its muzzle "
               "ring, and the small scope with the red light on top. Ignore the deck and plate under it."),
        points="the barrel points", turns="Only the head, the brackets, the barrel and the scope turn.",
        foot="At the foot of the turret there is a short round collar",
        size="about half the width of its cell",
        extra="",
        away="(the barrel foreshortened; the scope's red lens faces away too, so no red light shows)",
        toward="(the muzzle facing us, the barrel foreshortened)",
        remove=("REMOVE THE DOMED CAP from the top deck: the round dome, its two side brackets, the short tube sticking out of "
                "it, and the small lamp with the red light on top"),
        hold="", plate="set into the top deck, centred where the cap was",
        brush=None, cells=32, heading=lambda k: 11.25 * k,
        rule="cell k = trunc(bearing / 11.25) (towerFx.ts facingCell, BUILDING21.as); cell k shows heading 11.25k"),
    "laser": dict(
        flash=("lasertower/anim.1.png", 29, 32, 54, 8, lambda b: round((b + 5) / 6.66) % 54),
        look={"T1": (340, 290, 740, 650), "T2": (330, 100, 720, 470), "T3": (340, 55, 740, 420)},
        what="a tower's turning lamp head",
        parts=("the turning head as painted on the approved tower: the box-shaped metal head with the big glowing blue glass lens "
               "on its front, the fork that holds it by two round side pivots, and the short round swivel foot under the fork. "
               "Ignore the column, the hose and everything below the swivel foot."),
        points="the head faces (the way its blue lens looks)", turns="Only the head, the fork and the swivel foot turn.",
        foot="At the bottom there is the short round swivel foot",
        size="about half the width of its cell",
        extra="The head keeps the same slight upward tilt in every cell.",
        away="(we see the back of the head; the blue lens is hidden)",
        toward="(the round blue lens facing us full on)",
        remove=("REMOVE THE TURNING HEAD from the top of the column: the box-shaped head with the big blue glass lens, the fork "
                "that holds it and its short swivel foot"),
        hold=" The red and blue hose on the right side stays, but now ends in a small round socket on the side of the column top.",
        plate="on the top of the column, centred where the swivel foot was",
        brush=0.0, cells=54, heading=_laser_bearing,
        rule="cell k = trunc((beam screen angle - 25) / 6.66) (towerFx.ts laserCell, BUILDING23.as); cell k shows the heading "
             "nearest the middle of its screen-angle band turned into a ground bearing"),
    "aerial": dict(
        flash=("flaktower/anim.3.png", 62, 52, 32, 5, lambda b: round(b / 12) % 30),
        look={"T1": (420, 230, 1030, 740), "T2": (250, 210, 930, 720), "T3": (210, 210, 930, 720)},
        what="a tower's turning top with two raised tubes",
        parts=("the turning top as painted on the approved tower: the armoured many-sided dome with the round porthole on its "
               "front, and the two long parallel tubes with ringed ends sticking out of its front, raised into the sky. Ignore "
               "the deck, the box and hoses beside the dome, and everything below the dome."),
        points="the two tubes point", turns="Only the dome and its two tubes turn.",
        foot="The dome sits on a short round collar",
        size="about two thirds of the width of its cell, tubes included",
        extra=("The two tubes are ALWAYS raised into the sky at the same steep angle as in look.png, in every cell; only which way "
               "round they point changes, so on the picture they always also rise."),
        away="(seen from behind, the raised tubes rising straight up the picture)",
        toward="(the tube ends facing us, foreshortened, rising a little above the dome)",
        remove=("REMOVE THE ROUND DOMED TOP from the top deck: the many-sided metal dome with its round porthole and the two long "
                "thin poles on it"),
        hold=" The small box with the red and blue hoses at the back corner of the deck stays.",
        plate="set into the top deck, centred where the dome was",
        brush=0.09, fit=1, cells=32, heading=lambda k: 12 * k + 6,
        rule="cell k = trunc(bearing / 12) (towerFx.ts facingCell, BUILDING115.as): only cells 0-29 are reached; cell k shows "
             "the heading nearest 12k + 6"),
    "railgun": dict(
        flash=("railguntower/anim.3.loaded.png", 96, 56, 32, 3, lambda b: round(b / 11.25) % 32),
        look={"T1": (240, 310, 1185, 910), "T2": (170, 410, 1000, 920), "T3": (170, 300, 1000, 800)},
        what="a tower's long turning top",
        parts=("the turning top as painted on the approved tower: the round housing, the two gold coil posts with the blue "
               "caps standing on it, the two long square rails with the glowing blue cores lying side by side and sticking out of "
               "its front, and the short grey pipe sticking out of its back. Ignore the stand and everything below the housing."),
        points="the two rails point (the short grey pipe always points the opposite way)",
        turns="The housing, the coil posts, the rails and the pipe turn together.",
        foot="The housing sits on a short round collar",
        size="about two thirds of the width of its cell when the rails point sideways (it is long: leave room)",
        extra="The coil posts always stand straight up.",
        away="(the rails foreshortened, going up the picture, the grey pipe toward us)",
        toward="(the rail ends facing us, foreshortened, the grey pipe behind)",
        remove=("REMOVE THE TURNING TOP: the round housing with the two gold coil posts, the two long square rails with the "
                "glowing blue cores, and the short grey pipe at its back"),
        hold="", plate="on the top of the stand, centred where the housing was",
        brush=0.13, fit=1, cells=32, heading=lambda k: 12 * k - 24,
        rule="cell k = trunc(((bearing + 30) mod 360) / 12) (towerFx.ts facingCell, BUILDING118.as): only cells 0-29 are "
             "reached; cell k shows the heading nearest 12k - 24"),
}
PLATE = {"T1": "a flat round dark steel plate",
         "T2": "a flat round dark steel plate with a polished gold rim",
         "T3": "a flat round black steel plate with a polished gold rim"}

HEAD = ("Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. "
        "Do not write code and do not copy or composite pixels from the inputs.\n\n")
GAME = ("It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed "
        "isometric camera (from the front, looking down at about 30 degrees, the ground diamond's corners pointing left, right, up and down).\n\n")
GREEN = "Background everywhere: flat pure green #00FF00. No ground, no grass, no shadow on the ground, no text, no labels. The painting itself must contain no bright pure green."
GROUND = {20: "straight AWAY from the viewer", 24: "to the back right, along the back-right edge of the ground diamond",
          28: "straight to the RIGHT", 32: "to the front right, along the front-right edge of the ground diamond",
          36: "straight TOWARD the viewer"}


def clock(j):
    """Where heading j points on the picture, as a clock face over it (12 = up the picture): flat ground directions only."""
    b = math.radians(11.25 * j)
    sx, sy = math.cos(b) - math.sin(b), (math.cos(b) + math.sin(b)) / 2
    m = round((math.degrees(math.atan2(sx, -sy)) % 360) * 2) % 720     # minutes on a 12-hour face
    return f"{(m // 60) or 12}:{m % 60:02d}"


def way(T, j):
    j = j if j >= 20 else j + 32
    g = GROUND.get(j)
    if g is None:
        lo, hi = max(k for k in GROUND if k < j), min(k for k in GROUND if k > j)
        near = "nearer the first" if j - lo < hi - j else "nearer the second" if j - lo > hi - j else "half way"
        g = f"between {GROUND[lo].split(',')[0]} and {GROUND[hi].split(',')[0]}, {near}"
    note = f" {T['away']}" if j == 20 else f" {T['toward']}" if j == 36 else ""
    return f"{T['points']} {g}; on flat ground that is toward {clock(j)} on a clock face laid over the picture{note}"


def flash_cell(tw, b):
    """The Flash strip's cell nearest bearing b; the Sniper's missing cells 30 and 31 are cells 10 and 9 flipped."""
    f, fw, fh, fn, _, pick = TOWER[tw]["flash"]
    s = Image.open(ASSETS / "buildings" / f).convert("RGBA")
    k = pick(b)
    if k >= fn:
        return flash_cell(tw, (90 - b) % 360).transpose(Image.FLIP_LEFT_RIGHT)
    return s.crop((k * fw, 0, (k + 1) * fw, fh))


def out(tw):
    return RED / tw / "turret"


def setup(tw, t, job):
    T = TOWER[tw]
    d = out(tw) / t / job
    d.mkdir(parents=True, exist_ok=True)
    src = RED / tw / TIER[t]
    if job == "body":
        base = Image.open(src / "sample-new.png").convert("RGB")
        base.save(d / "base.png")
        w, h = base.size
        prompt = HEAD + f"""base.png is the approved {NAME[t]} picture of a tower from a cartoon building game. Make ONE change to it and keep everything else exactly the same.

The change: {T['remove']}. Nothing of it may remain, not even its shadow or reflection. In its place show the EMPTY round turntable it stands on: {PLATE[t]} {T['plate']}, with a small round pivot hub and a ring of bolts in its middle. The moving part will be drawn on top of it later, so the plate must be flat and empty.{T['hold']}

Everything else stays exactly as in base.png: the body and its storeys, the stripes, the panels, the wires, the legs and feet, the top deck and its rim, the colours and materials, the camera, the size and position of the tower in the picture, and the painting finish.

""" + GAME + f"""Input 1, base.png: the approved picture to edit.

Output: ONE image, {w}x{h}, the tower alone, at the same size and in the same place as in base.png. """ + GREEN
        inputs = ["base.png"]
    else:
        heads = SHEET[job]
        _, fw, fh, _, sc, _ = T["flash"]
        c = 341
        g = Image.new("RGBA", (3 * c, 3 * c), (128, 128, 128, 255))
        for i, j in enumerate(heads):
            f = flash_cell(tw, 11.25 * j).resize((round(fw * sc), round(fh * sc)), Image.LANCZOS)
            g.alpha_composite(f, ((i % 3) * c + (c - f.width) // 2, (i // 3) * c + (c - f.height) // 2))
        g.convert("RGB").save(d / "guide.png")
        look = Image.open(src / "sample-cut.png").convert("RGBA").crop(T["look"][t])
        Image.alpha_composite(Image.new("RGBA", look.size, (128, 128, 128, 255)), look).convert("RGB").save(d / "look.png")
        inputs = ["look.png", "guide.png"]
        refs = ""
        n = 3
        if job == "turret2" and (out(tw) / t / "turret" / "sample-new.png").exists():
            Image.open(out(tw) / t / "turret" / "sample-new.png").convert("RGB").save(d / "sheetA.png")
            inputs.append("sheetA.png")
            refs += (f"\nInput {n}, sheetA.png: the approved sheet of THIS turning part at the other nine headings. Paint exactly the "
                     "same object: same parts, shapes, colours, materials, size in its cell and painting finish; only the headings differ.\n")
            n += 1
        if t != "T1" and (out(tw) / "T1" / job / "sample-new.png").exists():
            Image.open(out(tw) / "T1" / job / "sample-new.png").convert("RGB").save(d / "t1sheet.png")
            inputs.append("t1sheet.png")
            refs += (f"\nInput {n}, t1sheet.png: the approved tier 1 sheet at these same nine headings. Copy its layout, the headings, "
                     "the size and the place of the object in each cell exactly; only the materials change to those of look.png.\n")
        rows = "\n".join(f"- row {i // 3 + 1}, cell {i % 3 + 1}: {way(T, j)}" for i, j in enumerate(heads))
        prompt = HEAD + f"""Paint a SPRITE SHEET of {T['what']} turning round, {NAME[t]}.

Input 1, look.png: {T['parts']}
Input 2, guide.png: a 3x3 grid of the OLD game's version at the same nine headings. From each cell copy ONLY which way it points and how foreshortened it looks. Do not copy its look and ignore any deck under it.{refs}
Output: ONE square image, 1024x1024, laid out as a 3x3 grid of nine equal cells, in the same order as guide.png (do not draw the grid lines). In every cell paint the SAME object as look.png (same parts, shapes, colours, materials, size, painting finish, light from the upper left), turned on its vertical axis so that:
{rows}

{T['turns']} {T['extra']} The camera never moves: every cell is seen from the same fixed isometric camera, from the front, looking down at about 30 degrees. {T['foot']}; it stays the same round shape and size in every cell, CENTRED in its cell and at the same height in every cell, so the object turns about the centre of its collar. Every object the same size, {T['size']}, nothing touching the cell edges or another cell. No deck, no plate, no tower, no ground.

""" + GAME + GREEN + " No numbers, arrows or grid lines."
    (d / "prompt.txt").write_text(prompt, encoding="utf-8")
    (d / "inputs.txt").write_text("\n".join(inputs) + "\n")
    print("dir", d.as_posix())


def band(a, thr=128, part=0.3):
    """(left, right, bottom, top) of the alpha shape, left/right over its bottom 30% (as finish.py), or over all of it (part=1)."""
    ys, xs = np.where(a >= thr)
    top, bot = ys.min(), ys.max() + 1
    sel = ys >= bot - part * (bot - top)
    return xs[sel].min(), xs[sel].max() + 1, bot, top


def cut_body(tw, t):
    """The body painting fitted onto the approved tier picture (same canvas as its new-4x.png): same footprint band, same base line."""
    d = out(tw) / t / "body"
    cut = key(np.asarray(Image.open(d / "sample-new.png").convert("RGB")))
    cut.save(d / "sample-cut.png")
    ref = Image.open(RED / tw / TIER[t] / "new-4x.png")
    part = TOWER[tw].get("fit", 0.3)                     # a low, wide stand: its bottom 30% is only the front leg, so fit it whole
    l0, r0, b0, _ = band(np.asarray(ref)[..., 3], part=part)
    l1, r1, b1, _ = band(np.asarray(cut)[..., 3], part=part)
    k = (r0 - l0) / (r1 - l1)
    bb = cut.getbbox()
    crop = resize_pm(cut.crop(bb), (round((bb[2] - bb[0]) * k), round((bb[3] - bb[1]) * k)))
    c = Image.new("RGBA", ref.size, (0, 0, 0, 0))
    c.alpha_composite(crop, (round((l0 + r0) / 2 - ((l1 + r1) / 2 - bb[0]) * k), round(b0 - (b1 - bb[1]) * k)))
    c.save(d / "body-4x.png")
    print("body", tw, t, "scale", round(k, 3))


def head(a, brush):
    """(centre x, bottom y, width) of the turning part without its barrel: the alpha opened with a round brush wider than the
    barrel (Sniper: 12% of the shape's width; others: `brush` x the cell width, 0 = no opening)."""
    m = a >= 128
    r = max(3, int(0.12 * max(np.ptp(np.where(m)[1]), 1))) if brush is None else int(brush * a.shape[1])
    o = m
    if r > 0:
        yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
        o = ndi.binary_opening(m, structure=(xx * xx + yy * yy) <= r * r)
    lab, n = ndi.label(o)
    if n > 1:
        o = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)
    ys, xs = np.where(o)
    return (xs.min() + xs.max() + 1) / 2, ys.max() + 1, xs.max() + 1 - xs.min()


def cut_turret(tw, t, job):
    """The nine paintings off the sheet, each with its collar's foot (pivot) in the middle of a square frame; noted in pivot.json.
    The ninth cell of `turret2` (a second try at heading 20) is saved as frame-20b.png."""
    d = out(tw) / t / job
    sheet = key(np.asarray(Image.open(d / "sample-new.png").convert("RGB")))
    sheet.save(d / "sample-cut.png")
    a = np.asarray(sheet)
    cw, ch = a.shape[1] / 3, a.shape[0] / 3
    frames, info = [], []
    for i, j in enumerate(SHEET[job]):
        x0, y0 = round((i % 3) * cw), round((i // 3) * ch)
        cell = sheet.crop((x0, y0, round(x0 + cw), round(y0 + ch)))
        ca = np.asarray(cell)[..., 3]
        lab, n = ndi.label(ca >= 64)
        if n > 1:                                        # keep the biggest piece (the turret), drop specks
            keep = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)
            keep = ndi.binary_dilation(keep, iterations=3)
            cell = Image.fromarray(np.dstack([np.asarray(cell)[..., :3], np.where(keep, ca, 0)]).astype("uint8"), "RGBA")
            ca = np.asarray(cell)[..., 3]
        cx, by, w = head(ca, TOWER[tw]["brush"])
        frames.append(cell)
        info.append(dict(cell=j, cx=float(cx), bottom=int(by), head_w=int(w)))
    hw = float(np.median([f["head_w"] for f in (info[:8] if job == "turret2" else info)]))
    S = 2 * round(max(cw, ch))                           # square frames, pivot (collar bottom centre) in the middle
    for i, (f, im) in enumerate(zip(info, frames)):
        fr = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        fr.alpha_composite(im, (round(S / 2 - f["cx"]), round(S / 2 - f["bottom"])))
        fr.save(d / ("frame-20b.png" if job == "turret2" and i == 8 else f"frame-{f['cell']:02d}.png"))
    (d / "pivot.json").write_text(json.dumps(dict(frame=S, head_w=hw, cells=info), indent=1))
    print("turret", tw, t, job, "head width", hw, [f["head_w"] for f in info])


def headings(tw, t):
    """The 32 headings of one tier at 4x on the body's scale, [RGBA frame, pivot in the middle], index = heading."""
    px, py, hw, opt = PIVOT[tw][t]
    own = {}
    for job in SHEET:
        d = out(tw) / t / job
        if not (d / "pivot.json").exists():
            continue
        info = json.loads((d / "pivot.json").read_text())
        k = hw / info["head_w"] * opt.get(job, 1.0)
        S = round(info["frame"] * k)
        for j in SHEET[job][:8] if job == "turret2" else SHEET[job]:
            j2 = opt.get("as", {}).get(j, j) if job == "turret2" else j
            if j2 is not None:                           # None: a cell that came out wrong, left out
                own[j2] = resize_pm(Image.open(d / f"frame-{j:02d}.png"), (S, S))
        if job == "turret2" and opt.get("away2"):        # the second try at heading 20 is the better one
            own[20] = resize_pm(Image.open(d / "frame-20b.png"), (S, S))
    hs = {}
    for j in range(32):
        if j in own:
            hs[j] = own[j]
        elif (8 - j) % 32 in own:
            hs[j] = own[(8 - j) % 32].transpose(Image.FLIP_LEFT_RIGHT)
    for j in range(32):                                  # only sheet A so far: the odd headings repeat the next even one
        if j not in hs:
            hs[j] = hs[(j + 1) % 32]
    return [hs[j] for j in range(32)]


def tower(tw, t, frame):
    """The body with one turret frame on it, on the body's 4x canvas."""
    b = Image.open(out(tw) / t / "body" / "body-4x.png").copy()
    px, py = PIVOT[tw][t][:2]
    b.alpha_composite(frame, (round(px - frame.width / 2), round(py - frame.height / 2)))
    return b


def game_cells(tw):
    """For each cell of the game's strip, the nearest of the 32 painted headings (by bearing)."""
    T = TOWER[tw]
    return [round((T["heading"](k) % 360) / 11.25) % 32 for k in range(T["cells"])]


def sheet(tw):
    """Per tier: the game's strip at 2x + strip.json; per tower: the still sheet (each tier at 32 headings, 2x, rows of 8) and the
    turning GIF (three tiers side by side, 3x, one full turn), both cropped tight."""
    o = out(tw)
    tiers = [t for t in TIER if (o / t / "body" / "body-4x.png").exists() and (o / t / "turret" / "pivot.json").exists()
             and t in PIVOT.get(tw, {})]
    hs = {t: headings(tw, t) for t in tiers}
    cells = game_cells(tw)
    for t in tiers:                                      # the game's strip at 2x: square cells, pivot in the middle of each
        fr = [resize_pm(f, (f.width // 2, f.height // 2)) for f in hs[t]]
        s = Image.new("RGBA", (fr[0].width * len(cells), fr[0].height), (0, 0, 0, 0))
        for i, j in enumerate(cells):
            s.alpha_composite(fr[j], (i * fr[0].width, 0))
        s.save(o / t / "strip@2x.png")
        b = Image.open(o / t / "body" / "body-4x.png")
        (o / t / "strip.json").write_text(json.dumps(dict(
            cells=len(cells), cell_w=fr[0].width, cell_h=fr[0].height, pivot_in_body_4x=list(PIVOT[tw][t][:2]),
            body_4x_size=list(b.size), rule=TOWER[tw]["rule"],
            heading_of_cell=[round(11.25 * j, 2) for j in cells],
            note="pivot = middle of each cell; heading = ground bearing in degrees (0 down-right on screen, 45 at the viewer)"),
            indent=1))
    # every tier's 32 headings on its own canvas, cropped to what any heading covers
    full = {t: [tower(tw, t, f) for f in hs[t]] for t in tiers}
    box = {}
    for t in tiers:
        bbs = [im.getbbox() for im in full[t]]
        box[t] = (min(b[0] for b in bbs) - 8, min(b[1] for b in bbs) - 8, max(b[2] for b in bbs) + 8, max(b[3] for b in bbs) + 8)
    font = ImageFont.truetype("arial.ttf", 22)
    lab = 36
    tiles = {t: [resize_pm(im.crop(box[t]), ((box[t][2] - box[t][0]) // 2, (box[t][3] - box[t][1]) // 2)) for im in full[t]]
             for t in tiers}
    cw = max(tiles[t][0].width for t in tiers)
    W = 8 * (cw + 6) + 6
    H = sum(lab + 4 * (tiles[t][0].height + 6) for t in tiers) + 2 * lab
    g = grass(W, H).convert("RGBA")
    dr = ImageDraw.Draw(g)
    dr.rectangle((0, 0, W, 2 * lab), fill=(20, 20, 20, 255))
    dr.text((8, 6), f"{tw.title()}: the turning part at 32 headings per tier, 2x game size.", fill=(255, 255, 255, 255), font=font)
    dr.text((8, 6 + lab), "Left to right, then down: heading 0, 11.25, 22.5 ... 348.75 degrees.", fill=(255, 255, 255, 255), font=font)
    y = 2 * lab
    for t in tiers:
        dr.rectangle((0, y, W, y + lab - 2), fill=(20, 20, 20, 200))
        dr.text((8, y + 6), NAME[t].title(), fill=(255, 255, 255, 255), font=font)
        y += lab
        w_, h_ = tiles[t][0].size
        for j, im in enumerate(tiles[t]):
            g.alpha_composite(im, (6 + (j % 8) * (cw + 6) + (cw - w_) // 2, y + (j // 8) * (h_ + 6)))
        y += 4 * (h_ + 6)
    g.convert("RGB").save(o / "headings-2x.png", optimize=True)
    # the GIF: three tiers side by side at 3x, bottoms lined up, one full turn (32 headings, order 0 .. 31)
    sc = 3
    big = {t: [resize_pm(im.crop(box[t]), ((box[t][2] - box[t][0]) * sc // UP, (box[t][3] - box[t][1]) * sc // UP))
               for im in full[t]] for t in tiers}
    Hm = max(big[t][0].height for t in tiers)
    pad = 10
    W3 = sum(big[t][0].width for t in tiers) + pad * (len(tiers) + 1)
    bg = grass(W3, Hm + 2 * pad, seed=5).convert("RGBA")
    fr = []
    for j in range(32):
        f = bg.copy()
        x = pad
        for t in tiers:
            im = big[t][j]
            f.alpha_composite(im, (x, pad + Hm - im.height))
            x += im.width + pad
        fr.append(f.convert("RGB").quantize(colors=255, method=Image.MEDIANCUT, dither=Image.NONE))
    fr[0].save(o / "turning-3x.gif", save_all=True, append_images=fr[1:], duration=90, loop=0, disposal=1)
    print("sheet", (o / "headings-2x.png").as_posix(), (o / "turning-3x.gif").as_posix(), tiers,
          "distinct game cells", len(set(cells)))


# the turning part's pivot on each body (the foot of its collar on the turntable) and the approved part's width (as `head`
# measures it) at 4x on the body's canvas, measured by eye on the approved tier picture; options: a scale nudge per sheet
# ("turret2": 1.03), "away2": use the second try at heading 20, "as": {painted: shown} for a cell painted at another heading
# (its mirror then fills the heading asked for)
PIVOT = {
    "sniper": {"T1": (331, 458, 115, {"as": {21: 19}, "away2": True}), "T2": (331, 909, 115, {"as": {21: 19}, "away2": True}),
               "T3": (332, 840, 115, {"as": {21: None}, "away2": True})},
    "laser": {"T1": (300, 447, 112, {}), "T2": (300, 902, 106, {}), "T3": (300, 838, 106, {})},
    "aerial": {"T1": (333, 450, 118, {}), "T2": (333, 861, 118, {}), "T3": (333, 813, 118, {})},
    "railgun": {"T1": (361, 382, 128, {}), "T2": (350, 682, 128, {}), "T3": (347, 652, 128, {})},
}

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "setup":
        setup(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "cut":
        cut_body(sys.argv[2], sys.argv[3]) if sys.argv[4] == "body" else cut_turret(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "sheet":
        sheet(sys.argv[2])
