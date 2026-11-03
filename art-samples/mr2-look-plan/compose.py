"""MR2 Modern-new look, art test: a 7-hex patch of continuous painted ground.

How it works (the same rules the plan proposes for the game's ground shader):
- Four seamless painted textures from Codex (grass, sand, turquoise shallows, deep sea),
  sampled in WORLD coordinates, so two neighbouring cells of the same ground join with no seam.
- Which ground a pixel shows: the cell under a noise-warped position, so biome edges wander
  across the hex lines like the mock-up's beach does, then softened.
- Water depth from the distance to land: turquoise shallows near the beach, deep blue further out,
  a foam line on the shore (mr2-live's painted foam).
- Thin hex lines drawn over the ground; trees, rocks, the hill plateau as sprites on top, sorted by foot.

Each of the 7 cells is cut out as its own hex tile (tiles/), and the tiles are pasted back
together: the check prints the largest pixel difference against the one-piece render (0 = seamless).

Run: python -I compose.py   (from anywhere; paths are absolute)
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
PROPS = "C:/Coding/BYMR/worktrees/mr2-land/web/public/maproom/land/land-props@2x.webp"
FOAM = "C:/Coding/BYMR/worktrees/mr2-live/web/public/maproom/live/foam@2x.webp"
MOCKUP = "C:/Coding/BYMR/worktrees/mr2-civ-study/shots/mr2-civ-study/codex/codex-1.png"
TODAY = "C:/Coding/BYMR/review-desk/img/mr2p-near.jpg"

SCALE = 2  # pixels per world point (the game's @2x)
CELL_W = 150
SQ3 = math.sqrt(3)

# Ground of every cell within 2 of the centre, axial (q, r). Centre 7 are the test tiles.
GRASS, SAND, SEA, FOREST, HILL = "grass", "sand", "sea", "forest", "hill"
CELLS = {
    (0, 0): GRASS, (0, -1): HILL, (1, -1): FOREST, (1, 0): GRASS,
    (0, 1): SAND, (-1, 1): SEA, (-1, 0): SAND,
}
RING2 = {
    (-2, 0): SEA, (-2, 1): SEA, (-2, 2): SEA, (-1, 2): SEA, (-1, -1): SAND,
    (0, 2): SEA, (1, 1): SAND, (2, 0): GRASS, (2, -1): FOREST, (2, -2): FOREST,
    (1, -2): FOREST, (0, -2): GRASS,
}
INNER = list(CELLS)


def biome(q, r):
    return CELLS.get((q, r)) or RING2.get((q, r)) or GRASS


def load_tex(name, target_median=None, strength=0.7, size=512):
    """A Codex texture at 512 px per 256 world points, colour-shifted toward the mock-up's median."""
    a = np.asarray(Image.open(os.path.join(WORK, name, "art.png")).convert("RGB")).astype(np.float32)
    if target_median is not None:
        med = np.median(a.reshape(-1, 3), 0)
        a = a + strength * (np.array(target_median, np.float32) - med)
    a = np.clip(a, 0, 255)
    return np.asarray(Image.fromarray(a.astype(np.uint8)).resize((size, size), Image.LANCZOS)).astype(np.float32)


def sample(tex, X, Y, period=256.0):
    """Texture sampled in world space, wrapping (seamless)."""
    n = tex.shape[0]
    u = ((X / period) % 1.0 * n).astype(np.int32) % n
    v = ((Y / period) % 1.0 * n).astype(np.int32) % n
    return tex[v, u]


def value_noise(X, Y, freq, seed):
    """Smooth world-space noise in [-1, 1] (bilinear value noise, a few octaves)."""
    out = np.zeros_like(X)
    amp, total = 1.0, 0.0
    rng = np.random.default_rng(seed)
    for octave in range(3):
        f = freq * (2 ** octave)
        grid = rng.uniform(-1, 1, (64, 64)).astype(np.float32)
        gx, gy = X * f + 32, Y * f + 32
        x0, y0 = np.floor(gx).astype(int), np.floor(gy).astype(int)
        tx, ty = gx - x0, gy - y0
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        g = lambda i, j: grid[(j) % 64, (i) % 64]
        v = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty
        out += amp * v
        total += amp
        amp *= 0.5
    return out / total


class Grid:
    def __init__(self, cell_h):
        self.cell_h = cell_h
        self.col = CELL_W * 0.75
        self.row = cell_h

    def centre(self, q, r):
        return self.col * q, self.row * (r + q / 2)

    def corners(self, q, r):
        cx, cy = self.centre(q, r)
        hw, hh = CELL_W / 2, self.cell_h / 2
        return [(cx - hw, cy), (cx - hw / 2, cy - hh), (cx + hw / 2, cy - hh), (cx + hw, cy), (cx + hw / 2, cy + hh), (cx - hw / 2, cy + hh)]

    def pick(self, X, Y):
        """World point -> axial cell (HexGrid.pixelToCell)."""
        size = self.col / 1.5
        ry = Y * (SQ3 * size / self.row)
        qf = (2 / 3) * X / size
        rf = (-1 / 3 * X + SQ3 / 3 * ry) / size
        sf = -qf - rf
        q, r, s = np.round(qf), np.round(rf), np.round(sf)
        dq, dr, ds = abs(q - qf), abs(r - rf), abs(s - sf)
        fix_q = (dq > dr) & (dq > ds)
        fix_r = ~fix_q & (dr > ds)
        q = np.where(fix_q, -r - s, q)
        r = np.where(fix_r, -q - s, r)
        return q.astype(int), r.astype(int)


def render(cell_h, tag):
    grid = Grid(cell_h)
    xs = [grid.centre(q, r)[0] for q, r in INNER]
    ys = [grid.centre(q, r)[1] for q, r in INNER]
    pad = 10
    x0, x1 = min(xs) - CELL_W / 2 - pad, max(xs) + CELL_W / 2 + pad
    y0, y1 = min(ys) - cell_h / 2 - 70, max(ys) + cell_h / 2 + pad  # room above for the hill and trees
    Wpx, Hpx = int((x1 - x0) * SCALE), int((y1 - y0) * SCALE)
    px, py = np.meshgrid(np.arange(Wpx, dtype=np.float32), np.arange(Hpx, dtype=np.float32))
    X, Y = x0 + px / SCALE, y0 + py / SCALE

    # Which ground: the cell under a warped position.
    A = 26.0
    wx = X + A * value_noise(X, Y, 1 / 85, 1)
    wy = Y + A * 0.7 * value_noise(X, Y, 1 / 85, 2)
    q, r = grid.pick(wx, wy)
    lut = {}
    kinds = np.empty(q.shape, dtype=object)
    names = np.vectorize(lambda a, b: biome(a, b))(q, r)
    water = names == SEA
    sand = names == SAND
    forest = names == FOREST
    grassy = ~water & ~sand

    tex = {
        GRASS: load_tex("grass", (150, 165, 38), 0.85),
        SAND: load_tex("sand", (240, 204, 128), 0.9),
        "shallow": load_tex("shallows"),
        "deep": load_tex("deep", (8, 84, 150), 0.75),
    }
    # Distance (world points) from water to land and from land to water.
    d_land = ndimage.distance_transform_edt(water) / SCALE
    d_water = ndimage.distance_transform_edt(~water) / SCALE

    g = sample(tex[GRASS], X, Y)
    shade = 1.0 + 0.16 * value_noise(X, Y, 1 / 70, 7) + 0.06 * value_noise(X, Y, 1 / 18, 8)
    g = g * shade[..., None]
    fmask = ndimage.gaussian_filter(forest.astype(np.float32), 6)
    g = g * (1 - 0.35 * fmask[..., None]) + np.array([20, 45, 10], np.float32) * 0.35 * fmask[..., None] * 0  # forest floor darker
    s = sample(tex[SAND], X, Y)
    wet = np.clip(1 - d_water / 6.0, 0, 1)[..., None]
    s = s * (1 - 0.18 * wet)
    sh = sample(tex["shallow"], X, Y, 200.0)
    de = sample(tex["deep"], X, Y, 220.0)
    depth = np.clip((d_land - 18) / 40.0, 0, 1)[..., None]
    w = sh * (1 - depth) + de * depth

    sandw = ndimage.gaussian_filter(sand.astype(np.float32), 3.0)[..., None]
    land = g * (1 - sandw) + s * sandw
    wat = water[..., None].astype(np.float32)
    wat_s = ndimage.gaussian_filter(wat[..., 0], 1.2)[..., None]
    img = land * (1 - wat_s) + w * wat_s

    # Foam: a bright line on the shore and painted foam fading out over the shallows.
    foam = np.asarray(Image.open(FOAM).convert("RGBA")).astype(np.float32)
    fa = sample(foam, X, Y, 64.0)[..., 3] / 255.0 if foam.shape[0] == foam.shape[1] else 0
    band = np.clip(1 - d_land / 14.0, 0, 1) * water
    line = np.clip(1 - np.abs(d_land - 2.0) / 2.6, 0, 1) * water * (0.75 + 0.25 * value_noise(X, Y, 1 / 12, 9))
    fo = np.clip(np.maximum(line, band * fa * 1.6), 0, 1)[..., None]
    img = img * (1 - fo) + np.array([250, 252, 255], np.float32) * fo
    ground = np.clip(img, 0, 255).astype(np.uint8)
    ground_im = Image.fromarray(ground).convert("RGBA")

    to_px = lambda wxp, wyp: ((wxp - x0) * SCALE, (wyp - y0) * SCALE)

    # Cut each cell as its own tile (hex mask grown by one pixel), then paste them back together.
    os.makedirs(os.path.join(HERE, "tiles"), exist_ok=True)
    assembled = Image.new("RGBA", (Wpx, Hpx), (0, 0, 0, 0))
    for (cq, cr) in INNER:
        mask = Image.new("L", (Wpx, Hpx), 0)
        ImageDraw.Draw(mask).polygon([to_px(*c) for c in grid.corners(cq, cr)], fill=255)
        mask = mask.filter(ImageFilter.MaxFilter(3))
        bbox = mask.getbbox()
        tile = ground_im.crop(bbox)
        tile.putalpha(mask.crop(bbox))
        tile.save(os.path.join(HERE, "tiles", f"{tag}-tile_{biome(cq, cr)}_{cq}_{cr}.png"))
        assembled.alpha_composite(tile, (bbox[0], bbox[1]))
    a = np.asarray(assembled).astype(int)
    inside = a[..., 3] == 255
    diff = np.abs(a[..., :3] - ground.astype(int))[inside].max()
    print(f"{tag}: tiles pasted back vs one-piece render, largest difference = {diff}")

    out = Image.new("RGBA", (Wpx, Hpx), (24, 28, 36, 255))
    out.alpha_composite(assembled)
    # Thin hex lines.
    lines = Image.new("RGBA", (Wpx, Hpx), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    for (cq, cr) in INNER:
        cs = [to_px(*c) for c in grid.corners(cq, cr)]
        ld.line(cs + [cs[0]], fill=(30, 40, 20, 95), width=2)
    out.alpha_composite(lines)

    # Sprites: trees, rocks, bushes (mr2-land's painted props), the hill (Codex), sorted by foot.
    props = Image.open(PROPS).convert("RGBA")
    fw, fh = props.width // 8, props.height // 4
    frame = lambda i: props.crop(((i % 8) * fw, (i // 8) * fh, (i % 8 + 1) * fw, (i // 8 + 1) * fh))
    LEAFY, PINES, ROCKS = [0, 1, 2, 3, 8, 9], [4, 5, 6, 7, 11], [12, 13, 14, 15, 16, 17]
    sprites = []  # (foot_y, image, x, y) in pixels, image anchored at foot centre
    rnd = random.Random(4)

    def inside_hex(cq, cr, x, y, margin):
        cx, cy = grid.centre(cq, cr)
        dx, dy = abs(x - cx), abs(y - cy) * (CELL_W / 2) / (grid.cell_h)
        return abs(y - cy) <= grid.cell_h / 2 - margin and dx <= CELL_W / 2 - margin * 1.6 - abs(y - cy) * (CELL_W / 2) / grid.cell_h

    def add_prop(i, x, y, height_world, flip=False):
        im = frame(i)
        bb = im.getbbox()
        im = im.crop(bb)
        sc = height_world * SCALE / im.height
        im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        sprites.append((y, im, x, y))

    for (cq, cr) in INNER:
        kind = biome(cq, cr)
        cx, cy = grid.centre(cq, cr)
        if kind == FOREST:
            placed = 0
            for _ in range(400):
                x = cx + rnd.uniform(-CELL_W / 2, CELL_W / 2)
                y = cy + rnd.uniform(-grid.cell_h / 2, grid.cell_h / 2)
                if not inside_hex(cq, cr, x, y, 4):
                    continue
                if any(s[2] is not None and abs(x - s[2]) < 10 and abs(y - s[3]) < 6 for s in sprites):
                    continue
                add_prop(rnd.choice(PINES + LEAFY), x, y, rnd.uniform(28, 38), rnd.random() < 0.5)
                placed += 1
                if placed >= 22:
                    break
        elif kind == GRASS:
            for _ in range(6):
                for _try in range(50):
                    x = cx + rnd.uniform(-CELL_W / 2, CELL_W / 2)
                    y = cy + rnd.uniform(-grid.cell_h / 2, grid.cell_h / 2)
                    if inside_hex(cq, cr, x, y, 6) and ((x - cx) / 32) ** 2 + ((y - cy) / (grid.cell_h * 0.3)) ** 2 > 1:
                        break
                pick = rnd.random()
                if pick < 0.4:
                    add_prop(rnd.choice(PINES), x, y, rnd.uniform(26, 32))
                elif pick < 0.75:
                    add_prop(rnd.choice(ROCKS[:4]), x, y, rnd.uniform(9, 13))
                else:
                    add_prop(10, x, y, 11)
        elif kind == SAND:
            for _ in range(4):
                x, y = cx + rnd.uniform(-45, 45), cy + rnd.uniform(-grid.cell_h * 0.3, grid.cell_h * 0.3)
                if inside_hex(cq, cr, x, y, 6):
                    add_prop(rnd.choice(ROCKS[:4]), x, y, rnd.uniform(9, 15), rnd.random() < 0.5)
        elif kind == SEA:
            # A sea stack with a foam ring.
            x, y = cx - 10, cy + grid.cell_h * 0.1
            ring = Image.new("L", (int(56 * SCALE), int(24 * SCALE)), 0)
            ImageDraw.Draw(ring).ellipse((8, 8, ring.width - 8, ring.height - 8), outline=255, width=9)
            ring = ring.filter(ImageFilter.GaussianBlur(4))
            ft = Image.open(FOAM).convert("RGBA").resize((ring.width, ring.width)).crop((0, 0, ring.width, ring.height))
            fal = np.asarray(ft)[..., 3].astype(np.float32) / 255
            ral = np.asarray(ring).astype(np.float32) / 255
            al = np.clip(ral * (0.55 + 0.9 * fal), 0, 1)
            ring = Image.fromarray(np.dstack([np.full(al.shape + (3,), 255, np.uint8), (al * 235).astype(np.uint8)]), "RGBA")
            sprites.append((y - 50, ring, x, y + 4))
            add_prop(14, x, y, 30)
        elif kind == HILL:
            hill = np.asarray(Image.open(os.path.join(WORK, "hill", "art.png")).convert("RGB")).astype(np.int32)
            key = (hill[..., 0] > 200) & (hill[..., 1] < 80) & (hill[..., 2] > 200)
            alpha = np.where(key, 0, 255).astype(np.uint8)
            alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)))
            greenish = (hill[..., 1] > hill[..., 2] + 40) & (hill[..., 1] > 120)
            shift = np.array([150, 165, 38]) - np.median(hill[greenish], 0)
            hill = np.where(greenish[..., None], np.clip(hill + 0.6 * shift, 0, 255), hill)
            him = Image.fromarray(np.dstack([hill.astype(np.uint8), alpha]), "RGBA")
            # Template: top face 1200 x 600 centred at (768, 400); cliffs reach about y=860.
            sx = CELL_W * SCALE / 1200
            sy = grid.cell_h * SCALE / 600
            him = him.resize((int(him.width * sx), int(him.height * sy)), Image.LANCZOS)
            lift = 22  # world points the plateau top is raised
            # Anchor so that the template centre lands on the cell centre raised by `lift`.
            ax, ay = 768 * sx, 400 * sy
            pxc, pyc = to_px(cx, cy - lift)
            sprites.append((cy + grid.cell_h / 2 - 1, him, None, (pxc - ax, pyc - ay)))

    # Grey rocks along the waterline, as on the mock-up's beaches.
    patchmask = Image.new("L", (Wpx, Hpx), 0)
    ImageDraw.Draw(patchmask).polygon([to_px(*c) for c in grid.corners(0, 0)], fill=0)
    for (cq, cr) in INNER:
        ImageDraw.Draw(patchmask).polygon([to_px(*c) for c in grid.corners(cq, cr)], fill=255)
    pm = np.asarray(patchmask.filter(ImageFilter.MinFilter(15))) > 0
    cand = np.argwhere(pm & ~water & (d_water > 2) & (d_water < 9))
    for k in rnd.sample(range(len(cand)), min(7, len(cand))):
        yy, xx = cand[k]
        add_prop(rnd.choice(ROCKS[:4]), x0 + xx / SCALE, y0 + yy / SCALE, rnd.uniform(11, 17), rnd.random() < 0.5)

    # Soft shadows (light from the top left), then sprites in foot order.
    shadow = Image.new("RGBA", (Wpx, Hpx), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for foot, im, x, y in sprites:
        if x is None:
            ox, oy = y
            sd.rectangle((ox + im.width * 0.2, oy + im.height * 0.75, ox + im.width * 1.02, oy + im.height * 0.92), fill=(0, 0, 0, 70))
            continue
        fx, fy = to_px(x, y)
        sd.ellipse((fx - im.width * 0.35 + 6, fy - 6, fx + im.width * 0.45 + 6, fy + 6), fill=(0, 20, 0, 90))
    out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5)))
    for foot, im, x, y in sorted(sprites, key=lambda s: s[0]):
        if x is None:
            out.alpha_composite(im, (int(y[0]), int(y[1])))
        else:
            fx, fy = to_px(x, y)
            out.alpha_composite(im, (int(fx - im.width / 2), int(fy - im.height + 2)))
    # Keep only the patch (and what stands up out of it).
    patch = Image.new("L", (Wpx, Hpx), 0)
    pd = ImageDraw.Draw(patch)
    for (cq, cr) in INNER:
        pd.polygon([to_px(*c) for c in grid.corners(cq, cr)], fill=255)
    out.save(os.path.join(HERE, f"{tag}-patch.png"))
    return out, (CELL_W * SCALE)


def label(im, text, h=46):
    out = Image.new("RGB", (im.width, im.height + h), (18, 22, 30))
    out.paste(im.convert("RGB"), (0, h))
    d = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
    d.text((12, 9), text, fill=(240, 240, 240), font=font)
    return out


def sheet(panels, path, gap=14):
    H = max(p.height for p in panels)
    W = sum(p.width for p in panels) + gap * (len(panels) - 1)
    s = Image.new("RGB", (W, H), (18, 22, 30))
    x = 0
    for p in panels:
        s.paste(p, (x, 0))
        x += p.width + gap
    s.save(path, quality=90)
    print("wrote", path, s.size)


if __name__ == "__main__":
    HEX_ON_SHEET = 220  # the mock-up's hexes are about 220 px across at full size
    a, hexpx = render(75, "today-grid")
    b, _ = render(100, "taller-grid")
    k = HEX_ON_SHEET / hexpx
    a2 = a.resize((int(a.width * k), int(a.height * k)), Image.LANCZOS)
    b2 = b.resize((int(b.width * k), int(b.height * k)), Image.LANCZOS)
    mock = Image.open(MOCKUP).convert("RGB").crop((150, 30, 760, 560))
    today = Image.open(TODAY).convert("RGB")
    # Bottom-right panel of the 30 Oct ground study = today's Modern ground (hexes ~204 px across).
    t = today.crop((949, 744, 1549, 1224))
    t = t.resize((int(t.width * 220 / 204), int(t.height * 220 / 204)), Image.LANCZOS)
    sheet([label(t, "Today (Modern)"), label(a2, "Test: today's hex shape"), label(b2, "Test: taller hexes"),
           label(mock, "Codex mock-up")], os.path.join(HERE, "side-by-side.jpg"))
    sheet([label(a2, "Test (today's hex shape)"), label(mock, "Codex mock-up, same scale")],
          os.path.join(HERE, "desk-main.jpg"))
