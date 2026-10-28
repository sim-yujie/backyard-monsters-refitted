"""post.py : turn the Blender renders (cannonflash3d.py -- all) into the game's pieces and the owner's pictures.

  python post.py

Pieces, in t1/ (and the same files in t2/ and t3/: the Flash Cannon has one picture for every level), laid out as
../cannon-3d/t1/ so export3d.py (feat/tower-3d, web/tools/tower-tiers) reads them unchanged:
  body/body-4x.png        the tower without its tube on the tier 1 4x canvas (the building's origin at 292, 364)
  strip@2x.png            the tube at the 32 headings, one row, square cells with the turning point in the middle of each
                          (body parts in front of the tube already cut out, so no front layer)
  strip.json              the cells, the pivot, and per heading the aim fields (aim_deg, muzzle, ground_deg, aim_len);
                          muzzle = game px from the pivot to the middle of the tube's mouth on screen, where the shot starts
Pictures for the owner, next to this file:
  flash-vs-3d.png         the Flash picture, the 3D model drawn upright as Flash draws it, and the 3D model as the game
                          shows it (the tube leaning at its resting heading); large, game size underneath
  headings-32.png         all 32 headings, the mouth (the shot's start, from strip.json) marked with a red dot
  turning-3x.gif          the tower turning through the 32 headings, 3x
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-3d"))
import aim_fields  # noqa: E402

HERE = Path(__file__).resolve().parent
R = HERE / "render"
FLASH = HERE.parents[1] / "server/public/assets/buildings/cannontower/top.3.png"
ORIGIN = (292, 364)          # the building's origin on the 4x canvas (export3d.py: 73 px from the left, 69 above the bottom)
FLASH_AT = (-33, -25)        # top.3.png's place from the origin, 1x (YARD_PROPS.as)
REST = 11                    # the heading shown as the game's still (the tube leaning up and to the left, about aim 120)
FONT = "arialbd.ttf"
GRASS = (118, 150, 84, 255)


def resize_pm(im, size):
    """Resize with premultiplied alpha (no dark fringes)."""
    a = np.asarray(im, np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    big = [Image.fromarray(a[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    b = np.stack([np.asarray(c) for c in big], -1).clip(0, 1)
    b[..., :3] /= np.maximum(b[..., 3:4], 1e-6)
    return Image.fromarray((b.clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def font(n):
    try:
        return ImageFont.truetype(FONT, n)
    except OSError:
        return ImageFont.load_default()


def pieces():
    cam = json.loads((R / "camera.json").read_text())
    px, py = cam["pivot_4x"]
    body = Image.open(R / "body-4x.png").convert("RGBA")
    tubes = [Image.open(R / "tube-4x" / f"h{k:02d}.png").convert("RGBA") for k in range(32)]
    out = HERE / "t1"
    (out / "body").mkdir(parents=True, exist_ok=True)
    shutil.copy(R / "body-4x.png", out / "body" / "body-4x.png")
    # each heading cropped round the turning point and halved; the cell a multiple of 8 at 4x, big enough for every heading
    reach = max(max(abs(b.getbbox()[0] - px), abs(b.getbbox()[2] - px), abs(b.getbbox()[1] - py), abs(b.getbbox()[3] - py))
                for b in tubes)
    c4 = int(-(-(2 * reach + 8) // 8) * 8)
    cell = c4 // 2
    x0, y0 = round(px - c4 / 2), round(py - c4 / 2)
    strip = Image.new("RGBA", (cell * 32, cell), (0, 0, 0, 0))
    for k, b in enumerate(tubes):
        c = Image.new("RGBA", (c4, c4), (0, 0, 0, 0))
        c.alpha_composite(b, (-x0, -y0))
        strip.alpha_composite(resize_pm(c, (cell, cell)), (k * cell, 0))
    strip.save(out / "strip@2x.png", optimize=True)
    aim = json.loads((R / "aim.json").read_text())
    (out / "strip.json").write_text(json.dumps(dict(
        cells=32, cell_w=cell, cell_h=cell, pivot_in_body_4x=[round(px, 2), round(py, 2)],
        body_4x_size=[body.width, body.height],
        rule="cell k = trunc(bearing / 11.25); cell k shows heading 11.25k. One row: the tube never tilts up or down.",
        note="The original Flash Cannon (top.3.png, one picture for all ten levels) in 3D, from cannonflash3d.py. pivot = "
             "middle of each cell (the tube's turning point, in its collar on the drum's top); heading = ground bearing "
             "in degrees (0 down-right on screen, 45 at the viewer). The body's parts in front of the tube are cut out of "
             "each cell, so no front layer is needed. The tube leans barrel_tilt_deg off upright toward its heading, "
             "always: the shot starts at `muzzle` (the middle of the tube's mouth) and the game works out the lob.",
        barrel_tilt_deg=aim["barrel_tilt_deg"], barrel_elevation_deg=aim["barrel_elevation_deg"],
        muzzle_height_px=aim["muzzle_height_px"], muzzle_height_screen_px=aim["muzzle_height_screen_px"],
        ground_below_pivot_px=aim["ground_below_pivot_px"],
        heights_note="muzzle_height_px: the mouth above the ground, game px measured like a ground distance (same at "
                     "every heading); muzzle_height_screen_px: the same seen on screen; ground_below_pivot_px: screen px "
                     "from the pivot down to the ground under it.")))
    aim_fields.merge(out / "strip.json", aim, dict(camera_elevation_deg=cam["elevation"]))
    for t in ("t2", "t3"):          # the Flash Cannon looks the same at every level
        d = HERE / t
        if d.exists():
            shutil.rmtree(d)
        shutil.copytree(out, d)
    full = []
    for b in tubes:
        f = body.copy()
        f.alpha_composite(b)
        full.append(f)
    return cam, aim, full


def flash_canvas():
    fl = Image.open(FLASH).convert("RGBA")
    big = fl.resize((fl.width * 4, fl.height * 4), Image.LANCZOS)
    cv = Image.new("RGBA", (620, 640))
    cv.alpha_composite(big, (ORIGIN[0] + FLASH_AT[0] * 4, ORIGIN[1] + FLASH_AT[1] * 4))
    return cv


def union(ims, pad=12):
    bs = [im.getbbox() for im in ims]
    return (min(b[0] for b in bs) - pad, min(b[1] for b in bs) - pad, max(b[2] for b in bs) + pad, max(b[3] for b in bs) + pad)


def compare(full):
    """Flash | 3D upright | 3D in game, at 4x (2x of the game's 2x pictures), cropped together; game size underneath."""
    ims = [flash_canvas(), Image.open(R / "upright.png").convert("RGBA"), full[REST]]
    labels = ["Flash (all 10 levels)", "3D, tube upright", "3D, as the game turns it"]
    crop = union(ims, 20)
    S = 1.5
    w, h = round((crop[2] - crop[0]) * S), round((crop[3] - crop[1]) * S)
    gap, top, low = 24, 54, 150
    sheet = Image.new("RGBA", (3 * w + 4 * gap, top + h + low), GRASS)
    d = ImageDraw.Draw(sheet)
    for i, (im, lab) in enumerate(zip(ims, labels)):
        x = gap + i * (w + gap)
        sheet.alpha_composite(resize_pm(im.crop(crop), (w, h)), (x, top))
        d.text((x + w // 2, 14), lab, font=font(30), fill=(255, 255, 255), anchor="mt", stroke_width=3,
               stroke_fill=(30, 40, 20))
        small = resize_pm(im.crop(crop), (round((crop[2] - crop[0]) / 4), round((crop[3] - crop[1]) / 4)))
        sheet.alpha_composite(small, (x + w // 2 - small.width // 2, top + h + 20))
    d.text((sheet.width // 2, top + h + low - 18), "under each: game size", font=font(20), fill=(235, 240, 225), anchor="mb")
    sheet.convert("RGB").save(HERE / "flash-vs-3d.png", optimize=True)


def headings(full, cam, aim):
    """All 32 headings, 8 to a row, each with the mouth (strip.json muzzle) marked."""
    crop = union(full, 10)
    px, py = cam["pivot_4x"]
    S = 0.75
    w, h = round((crop[2] - crop[0]) * S), round((crop[3] - crop[1]) * S)
    lab = 34
    sheet = Image.new("RGBA", (8 * w, 4 * (h + lab)), GRASS)
    d = ImageDraw.Draw(sheet)
    for k, f in enumerate(full):
        x, y = (k % 8) * w, (k // 8) * (h + lab)
        sheet.alpha_composite(resize_pm(f.crop(crop), (w, h)), (x, y + lab))
        mx, my = aim["muzzle"][k]
        cx, cy = x + (px + 4 * mx - crop[0]) * S, y + lab + (py + 4 * my - crop[1]) * S
        d.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=(230, 20, 20), outline=(255, 255, 255), width=2)
        d.text((x + w // 2, y + 6), f"{k}  ({k * 11.25:g} deg)", font=font(20), fill=(255, 255, 255), anchor="mt",
               stroke_width=2, stroke_fill=(30, 40, 20))
    sheet.convert("RGB").save(HERE / "headings-32.png", optimize=True)


def turning(full):
    crop = union(full, 10)
    w, h = crop[2] - crop[0], crop[3] - crop[1]
    frames = []
    for f in full:
        g = Image.new("RGBA", (w, h), GRASS)
        g.alpha_composite(f.crop(crop))
        frames.append(g.resize((w * 3 // 4, h * 3 // 4), Image.LANCZOS).convert("RGB")
                      .quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    frames[0].save(HERE / "turning-3x.gif", save_all=True, append_images=frames[1:], duration=110, loop=0, optimize=True)


def main():
    cam, aim, full = pieces()
    compare(full)
    headings(full, cam, aim)
    turning(full)
    print("done", json.loads((HERE / "t1" / "strip.json").read_text())["cell_w"])


if __name__ == "__main__":
    main()
