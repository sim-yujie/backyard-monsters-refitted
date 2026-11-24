"""Windpump (213) squared to the yard grid (owner 24 Nov 2026: its platform was turned ~10 deg off the grid).
The body is a Codex paint-over of the exact block-out (blockout.py windpump: platform edges at 2:1); the wheel
is the decor-new face-on wheel (windpump/wheel-<look>.full.png) laid into the plane y = const of the block-out,
i.e. parallel to the yard's left-front faces (phi 45, elevation 30: its horizontal diameter runs at slope 0.5),
turned a full circle in 48 frames about the block-out's hub point (the shaft's end, projected by Blender).

    python windpump.py        writes windpump/game/<look>/ files, rows.txt, a key-line spec (spec-wp.json)
"""
import json
import math
import os
import sys

from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
S = "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts"
sys.path.insert(0, S)
import artlib  # noqa: E402
from make_game_files import YARD_BLUR, YARD_DARK, YARD_FLOOR, shadow_mask  # noqa: E402

BODY_H2 = 140            # the body's 2x height (the old windpump@2x.png's)
WHEEL_D2 = 96            # the wheel's face-on 2x diameter (the old strip's was ~106; a little smaller now the wheel faces the camera more)
BOTTOM2 = 60             # the picture's bottom 30 px below the origin at 1x (size 40, like Flash's)
FRAMES = 48
C = 400
OX, OY = C // 2, int(C * 0.7)
PHI, ELEV = 45, 30
CAM = json.load(open(os.path.join(HERE, "bo", "windpump.json")))
R2 = math.sqrt(0.5)
RIGHT, UP = (R2, R2, 0.0), (-0.5 * R2, 0.5 * R2, math.sqrt(3) / 2)


def render_px(p):
    """3D point -> pixel of the 1024 block-out render (same camera as blockout.py)"""
    c = CAM["centre"]; k = 1024 / CAM["span"]
    d = lambda a, b: sum(x * y for x, y in zip(a, b))
    return c[0] + d(p, RIGHT) * k, c[1] - d(p, UP) * k


def project(img):
    p = math.cos(math.radians(PHI)); q = math.sin(math.radians(PHI)) * math.sin(math.radians(ELEV))
    r = math.cos(math.radians(ELEV))
    w, h = img.size; cx, cy = w / 2, h / 2
    a, d, e = 1 / p, -q / (p * r), 1 / r
    return img.transform((w, h), Image.AFFINE, (a, 0, cx - a * cx, d, e, cy - d * cx - e * cy), resample=Image.BICUBIC)


def bbox(ims, thr=4):
    box = None
    for im in ims:
        b = im.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox()
        if b: box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def even(b):
    x0 = OX + 2 * math.floor((b[0] - OX) / 2); y0 = OY + 2 * math.floor((b[1] - OY) / 2)
    x1 = OX + 2 * math.ceil((b[2] - OX) / 2); y1 = OY + 2 * math.ceil((b[3] - OY) / 2)
    return x0, y0, x1, y1


def build(look):
    sheet = Image.open(os.path.join(HERE, f"{look[0]}-windpump", f"windpump-{look}.png"))
    keyed = artlib.key(sheet)
    full = Image.open(os.path.join(HERE, look, "windpump.full.png")).convert("RGBA")
    sb = keyed.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    assert abs((sb[2] - sb[0]) - full.width) <= 3 and abs((sb[3] - sb[1]) - full.height) <= 3, (sb, full.size)
    sx = sheet.width / 1024
    k = BODY_H2 / full.height
    body = full.resize((round(full.width * k), BODY_H2), Image.LANCZOS)
    # where the tower's ground centre and the hub land in the body picture
    def to_body(p):
        x, y = render_px(p)
        return (x * sx - sb[0]) * k, (y * sx - sb[1]) * k
    gx, gy = to_body((0, 0, 0))
    hx, hy = to_body(tuple(CAM["hub3"]))
    # place: ground centre on x = OX, the lowest pixel on OY + BOTTOM2
    bx = OX - gx
    by = OY + BOTTOM2 - body.height
    still = Image.new("RGBA", (C, C)); still.alpha_composite(body, (round(bx), round(by)))
    hub = (bx + hx, by + hy)
    # the wheel frames
    wheel = Image.open(os.path.join(HERE, "windpump", f"wheel-{look}.full.png")).convert("RGBA")
    wb = wheel.getchannel("A").getbbox()
    kw = WHEEL_D2 / (wb[2] - wb[0])
    size = int(max(wheel.size) * 1.1)
    sq = Image.new("RGBA", (size, size))
    sq.alpha_composite(wheel, (int(size / 2 - (wb[0] + wb[2]) / 2), int(size / 2 - (wb[1] + wb[3]) / 2)))
    frames = []
    for i in range(FRAMES):
        r = sq.rotate(-360 * i / FRAMES, Image.BICUBIC, center=(size / 2, size / 2))
        p = project(r)
        p = p.resize((round(p.width * kw), round(p.height * kw)), Image.LANCZOS)
        fr = Image.new("RGBA", (C, C)); fr.alpha_composite(p, (round(hub[0] - p.width / 2), round(hub[1] - p.height / 2)))
        frames.append(fr)
    return still, frames, hub, (bx, by, k, sb, sx)


def write(look, still, frames, out):
    suf = ".modern" if look == "modern" else ""
    ext = "webp" if look == "modern" else "png"
    b = even(bbox([still]))
    half = max(OX - b[0], b[2] - OX)               # pad so the picture is centred on the origin
    b = (OX - half, b[1], OX + half, OY + BOTTOM2)
    s2 = still.crop(b)
    name = f"windpump{suf}@2x.{ext}"
    if ext == "webp": s2.save(os.path.join(out, name), lossless=False, quality=92, method=6)
    else: s2.save(os.path.join(out, name), optimize=True)
    comp = still.copy(); comp.alpha_composite(frames[0])
    cb = even(bbox([comp]))
    two = comp.crop(cb); one = two.resize((two.width // 2, two.height // 2), Image.LANCZOS)
    mask, shx, shy = shadow_mask(one.getchannel("A"), dark=YARD_DARK, blur_px=YARD_BLUR, floor=YARD_FLOOR)
    ImageChops.subtract(Image.new("L", mask.size, 255), mask).convert("RGB").save(
        os.path.join(out, f"windpump{suf}-shadow.jpg"), quality=90)
    shx += (cb[0] - OX) // 2; shy += (cb[3] - OY) // 2
    fb = even(bbox(frames))
    cw, ch = fb[2] - fb[0], fb[3] - fb[1]
    strip = Image.new("RGBA", (cw * len(frames), ch))
    for i, f in enumerate(frames): strip.alpha_composite(f.crop(fb), (i * cw, 0))
    an = f"windpump-anim{suf}@2x.{ext}"
    if ext == "webp": strip.save(os.path.join(out, an), lossless=False, quality=90, method=6)
    else: strip.save(os.path.join(out, an), optimize=True)
    top = (name, (b[0] - OX) // 2, (b[1] - OY) // 2)
    anim = (an, (fb[0] - OX) // 2, (fb[1] - OY) // 2, cw // 2, ch // 2, len(frames))
    sh = (f"windpump{suf}-shadow.jpg", shx, shy)
    return top, sh, anim, b


def main():
    rows = {}; spec = {}
    for look in ("classic", "modern"):
        out = os.path.join(HERE, "windpump", "game", look); os.makedirs(out, exist_ok=True)
        still, frames, hub, (bx, by, k, sb, sx) = build(look)
        top, sh, anim, b = write(look, still, frames, out)
        rows[look] = dict(top=top, shadow=sh, anim=anim, hub=[(hub[0] - OX) / 2, (hub[1] - OY) / 2])
        # frames for the sheet: 0, 16, 32 composed on the still (2x, cropped like the picture)
        for i in (0, 16, 32):
            c = still.copy(); c.alpha_composite(frames[i]); c.crop(even(bbox([c]))).save(os.path.join(out, f"frame{i}.png"))
        # the key lines (platform edges) in the game picture's pixels
        sys.path.insert(0, HERE)
        from keylines import KEY, inset
        lines = []
        for a3, b3, nm in KEY["windpump"]:
            a3, b3 = inset(a3, b3)
            pts = []
            for p in (a3, b3):
                x, y = render_px(p)
                pts += [bx + (x * sx - sb[0]) * k - b[0], by + (y * sx - sb[1]) * k - b[1]]
            lines.append(pts + [nm])
        spec[f"windpump {look}"] = {"pic": os.path.join(out, top[0]), "lines": lines}
    json.dump(rows, open(os.path.join(HERE, "windpump", "game", "rows.json"), "w"), indent=1)
    json.dump(spec, open(os.path.join(HERE, "spec-wp.json"), "w"), indent=1)
    print(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
