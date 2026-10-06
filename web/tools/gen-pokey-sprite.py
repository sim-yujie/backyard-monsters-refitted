"""
Build the repainted Pokey (C1) sprite sheet from Gemini-painted parts.
Art trial, Pokey only. Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-pokey-sprite.py <source folder>

The source folder holds two Gemini paintings on a flat #00FF00 ground:

    body.png   the Pokey's body with no face: the spiky ball
    face.png   the face parts side by side: the pair of eyes, then the mouth

Gemini cannot draw the same creature from 30 directions, so it paints the
parts once and this script turns them: the eyes and mouth are placed on the
ball as if it were a sphere seen from 30 degrees above, the eyes stay round
and their pupils look along the heading, the mouth is foreshortened and hides
round the back, and the eyes peek over the top from behind. The ground shadow
the original bakes in is redrawn under every cell, so nothing is mirrored and
the light stays upper left.

Output, in the original sheet's layout (30 headings in one row, 0 = east,
clockwise, 12 degrees apart; anchor 8,14; see docs/art/monster-sprites.md):

    server/public/assets/monsters/pokey-repaint.png      720x21, 24x21 cells
    server/public/assets/monsters/pokey-repaint@4x.png   2880x84, the same at 4x

The game draws the @4x sheet (REPAINTED_SHEETS in
web/src/game/attack/monsterSprites.ts); Pixi reads the resolution from the
name, so the 1x cell rectangles still frame it.
"""
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage

W = 8                      # working scale (x the 1x sheet)
CELL = (24, 21)
DIRS = 30
PITCH = math.radians(30)   # camera looks down this much
CENTRE = (8.0, 7.6)        # ball core centre in 1x cell pixels
BODY_WIDTH = 15.0          # body incl. spikes, 1x pixels
EYE_LAT = math.radians(34)
EYE_SIZE = 0.50            # one eye's width / core diameter
MOUTH_LAT = math.radians(-22)
MOUTH_SIZE = 0.50          # mouth width / core diameter
HUE_SHIFT = -22.0           # Gemini's crimson-magenta to the original's pure magenta

if len(sys.argv) != 2:
    sys.exit(__doc__)
SOURCE = Path(sys.argv[1])
OUT_DIR = Path(__file__).resolve().parents[2] / "server" / "public" / "assets" / "monsters"


def key(path):
    """Chroma-key the green ground: greenness = G - max(R, B), alpha ramps 40..140, despilled."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = g - np.maximum(r, b)
    a = np.clip((140 - green) / 100, 0, 1)
    g = np.where(green > 0, np.maximum(r, b), g)
    return Image.fromarray(np.dstack([r, g, b, a * 255]).astype(np.uint8), "RGBA")


def bbox_crop(im):
    return im.crop(im.getchannel("A").point(lambda v: 255 if v > 30 else 0).getbbox())


def hue_shift(im, deg, sat=1.0, val=1.0):
    rgb = im.convert("RGB").convert("HSV")
    h, s, v = [np.asarray(c, dtype=float) for c in rgb.split()]
    h = (h + deg / 360 * 255) % 255
    s = np.clip(s * sat, 0, 255)
    v = np.clip(v * val, 0, 255)
    out = Image.merge("HSV", [Image.fromarray(x.astype(np.uint8)) for x in (h, s, v)]).convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


# ---- body
body = bbox_crop(key(SOURCE / "body.png"))
arr = np.asarray(body).astype(int)
core = (arr[..., 3] > 200) & (arr[..., 0] - arr[..., 2] > 15)
ys, xs = np.nonzero(core)
core_cx, core_cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
core_d = ((xs.max() - xs.min()) + (ys.max() - ys.min())) / 2
s = BODY_WIDTH * W / body.width
body = body.resize((round(body.width * s), round(body.height * s)), Image.LANCZOS)
# the ball moves to the original's pure magenta; the spikes only a little, so they stay violet
spike_mask = Image.fromarray(((arr[..., 0] - arr[..., 2] <= 15) * 255).astype(np.uint8)).resize(body.size, Image.LANCZOS)
body = Image.composite(hue_shift(body, -8, 1.0, 1.04), hue_shift(body, HUE_SHIFT, 1.05, 1.06), spike_mask)
core_cx, core_cy, core_d = core_cx * s, core_cy * s, core_d * s
R = core_d / 2
core_mask = Image.new("L", body.size, 0)
ImageDraw.Draw(core_mask).ellipse((core_cx - R + 1, core_cy - R + 1, core_cx + R - 1, core_cy + R - 1), 255)

# ---- face parts
face = key(SOURCE / "face.png")
fa = np.asarray(face)[..., 3] > 30
cols = np.nonzero(fa.any(0))[0]
gap = next(cols[i] for i in range(len(cols) - 1) if cols[i + 1] - cols[i] > 5)
eyes = bbox_crop(face.crop((0, 0, gap + 1, face.height)))
mouth = bbox_crop(face.crop((gap + 1, 0, face.width, face.height)))

# split the eye pair at the thinnest column near the middle
ea = np.asarray(eyes)[..., 3] > 30
mid = eyes.width // 2
win = range(mid - eyes.width // 8, mid + eyes.width // 8)
cut = min(win, key=lambda x: ea[:, x].sum())


def eye_parts(eye):
    """(blank eye, pupil, inner sclera mask, pupil rest offset, sclera r, pupil r) for one eye."""
    a = np.asarray(eye).astype(int)
    alpha = a[..., 3] > 30
    bright = alpha & (a[..., :3].min(-1) > 150)
    lab, n = ndimage.label(bright)
    big = np.argmax(ndimage.sum(bright, lab, range(1, n + 1))) + 1
    white = lab == big
    sclera = ndimage.binary_fill_holes(white)
    pupil = sclera & ~white
    pupil = ndimage.binary_fill_holes(pupil)
    blank = a.copy()
    fill = np.median(a[white][:, :3], axis=0)
    blank[ndimage.binary_dilation(pupil, iterations=1) & sclera, :3] = fill
    pup = a.copy()
    pup[~ndimage.binary_dilation(pupil, iterations=1), 3] = 0
    pcy, pcx = ndimage.center_of_mass(pupil)
    scy, scx = ndimage.center_of_mass(sclera)
    inner = ndimage.binary_erosion(sclera, iterations=1)
    return (Image.fromarray(blank.astype(np.uint8)), Image.fromarray(pup.astype(np.uint8)),
            Image.fromarray((inner * 255).astype(np.uint8)), (pcx - scx, pcy - scy),
            math.sqrt(sclera.sum() / math.pi), math.sqrt(max(pupil.sum(), 1) / math.pi))


left_eye = bbox_crop(eyes.crop((0, 0, cut, eyes.height)))
right_eye = bbox_crop(eyes.crop((cut, 0, eyes.width, eyes.height)))
eye_w = EYE_SIZE * core_d


def scaled(im, w):
    f = w / im.width
    return im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS), f


EYES = []
for e in (left_eye, right_eye):
    e, f = scaled(e, eye_w)
    blank, pup, inner, rest, sr, pr = eye_parts(e)
    EYES.append(dict(blank=blank, pupil=pup, inner=inner, rest=rest, travel=max(0.0, sr - pr - 1)))
mouth, _ = scaled(mouth, MOUTH_SIZE * core_d)

# ---- projection helpers (x right, y up, z towards the camera before pitch)
VIEW = (0.0, math.sin(PITCH), math.cos(PITCH))


def project(p):
    x, y, z = p
    up = y * math.cos(PITCH) - z * math.sin(PITCH)
    depth = x * VIEW[0] + y * VIEW[1] + z * VIEW[2]
    return x, -up, depth          # screen x, screen y (down), depth


def on_sphere(lat, lon, r):
    return (-r * math.cos(lat) * math.sin(lon), r * math.sin(lat), r * math.cos(lat) * math.cos(lon))


def paste_centered(dst, im, cx, cy):
    dst.alpha_composite(im, (round(cx - im.width / 2), round(cy - im.height / 2)))


def frame(col):
    theta = math.radians(col * 360 / DIRS)          # 0 = east, clockwise on screen
    phi = theta - math.pi / 2                       # 0 = facing the camera
    size = (CELL[0] * W, CELL[1] * W)
    ox, oy = CENTRE[0] * W - core_cx, CENTRE[1] * W - core_cy   # body offset in the cell
    cx, cy = CENTRE[0] * W, CENTRE[1] * W
    behind, front = [], []

    # eyes: unsquashed balls sitting on the head, pupils look along the heading
    sep = math.asin(min(0.95, (eye_w * 0.47) / (R * math.cos(EYE_LAT))))
    look = (-math.sin(phi), math.cos(phi) * math.sin(PITCH))
    facing = math.cos(phi)
    for i, e in enumerate(EYES):
        lon = phi + (sep if i == 0 else -sep)
        sx, sy, d = project(on_sphere(EYE_LAT, lon, R * 1.02))
        layer = Image.new("RGBA", size, (0, 0, 0, 0))
        ex, ey = cx + sx, cy + sy
        blank = e["blank"]
        if facing < 0:
            # the back of the eyeball: shaded so it reads as a ball, not a white disc
            shade = Image.new("RGBA", blank.size, (186, 170, 205, 255))
            blank = Image.blend(blank, shade, min(0.45, -facing * 0.5))
            blank.putalpha(e["blank"].getchannel("A"))
        paste_centered(layer, blank, ex, ey)
        if facing > -0.25:
            pl = Image.new("RGBA", e["blank"].size, (0, 0, 0, 0))
            dx = look[0] * e["travel"] - e["rest"][0]
            dy = look[1] * e["travel"] - e["rest"][1]
            pl.alpha_composite(e["pupil"], (0, 0))
            pl = pl.transform(pl.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy), Image.BICUBIC)
            a = np.asarray(pl.getchannel("A"), dtype=float) * (np.asarray(e["inner"], dtype=float) / 255)
            a *= min(1.0, (facing + 0.25) / 0.35)
            pl.putalpha(Image.fromarray(a.astype(np.uint8)))
            paste_centered(layer, pl, ex, ey)
        (behind if d < -0.15 * R else front).append((d, layer))

    # mouth: a decal on the sphere, foreshortened, clipped to the ball
    p = on_sphere(MOUTH_LAT, phi, R)
    sx, sy, d = project(p)
    if d > 0.08 * R:
        lat = MOUTH_LAT
        tx = (math.cos(phi), math.sin(phi) * math.sin(PITCH))              # screen x, y(down)
        ty = (math.sin(lat) * math.sin(phi), -(math.cos(lat) * math.cos(PITCH) + math.sin(lat) * math.cos(phi) * math.sin(PITCH)))
        # decal x maps to tx, decal y (down) maps to -ty (ty points up the surface)
        a11, a21 = tx
        a12, a22 = -ty[0], -ty[1]
        det = a11 * a22 - a12 * a21
        if abs(det) > 0.05:
            ia, ib, ic, idd = a22 / det, -a12 / det, -a21 / det, a11 / det
            mx, my = cx + sx, cy + sy
            mw, mh = mouth.size
            c0 = mw / 2 - (ia * mx + ib * my)
            c1 = mh / 2 - (ic * mx + idd * my)
            layer = mouth.transform(size, Image.AFFINE, (ia, ib, c0, ic, idd, c1), Image.BICUBIC)
            clip = Image.new("L", size, 0)
            clip.paste(core_mask, (round(ox), round(oy)))
            a = np.asarray(layer.getchannel("A"), dtype=float) * np.asarray(clip, dtype=float) / 255
            a *= min(1.0, (d / R - 0.08) / 0.25)
            layer.putalpha(Image.fromarray(a.astype(np.uint8)))
            front.append((d, layer))

    out = Image.new("RGBA", size, (0, 0, 0, 0))
    for _, l in sorted(behind, key=lambda t: t[0]):
        out.alpha_composite(l)
    out.alpha_composite(body, (round(ox), round(oy)))
    for _, l in sorted(front, key=lambda t: t[0]):
        out.alpha_composite(l)
    return out


def shadow(scale):
    """The ground shadow the original sheet bakes in, below and right of the ball."""
    w, h = CELL[0] * scale, CELL[1] * scale
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    m = Image.new("L", (w, h), 0)
    cx, cy, rx, ry = 12.3 * scale, 16.4 * scale, 8.6 * scale, 3.6 * scale
    ImageDraw.Draw(m).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), 128)
    m = m.filter(ImageFilter.GaussianBlur(0.6 * scale))
    im.paste((8, 26, 0, 255), (0, 0, w, h), m)
    return im


def build():
    frames = [frame(c) for c in range(DIRS)]
    sheets = {}
    for scale in (4, 1):
        sh = shadow(scale)
        sheet = Image.new("RGBA", (CELL[0] * scale * DIRS, CELL[1] * scale), (0, 0, 0, 0))
        for c, f in enumerate(frames):
            small = f.resize((CELL[0] * scale, CELL[1] * scale), Image.LANCZOS)
            if scale == 1:
                small = small.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=0))
            cell = sh.copy()
            cell.alpha_composite(small)
            sheet.alpha_composite(cell, (c * CELL[0] * scale, 0))
        sheets[scale] = sheet
    return frames, sheets


if __name__ == "__main__":
    frames, sheets = build()
    for scale, name in ((1, "pokey-repaint.png"), (4, "pokey-repaint@4x.png")):
        sheets[scale].save(OUT_DIR / name, optimize=True)
        print(f"wrote {OUT_DIR / name} {sheets[scale].size}")
