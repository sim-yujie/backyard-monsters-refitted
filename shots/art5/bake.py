# Bake the 12 ability paintings into the cushion-cut gem (owner's pick C, 28 Nov 2026):
#   uv run --with numpy --with scipy --with pillow python bake.py
# The gem is cell 1 of the Codex sheet g2/sheet.png (3x1 cells: magenta outside, flat green window); the
# locked stone's cloud is cell 5 of g1/sheet.png. Writes web/public/ui/abilities/gem-c/<name>.webp (lit)
# and <name>.locked.webp (dull stone), 192 px.
import sys, os
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageChops, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
ART4 = os.path.join(HERE, "..", "art4")
OUT_ROOT = os.path.join(HERE, "..", "..", "web", "public", "ui", "abilities")
SIZE = 192
WORK = 768  # composite at 4x, then shrink

# name -> the full-size painting the game's 96 px square was made from (checked by diff against final/*.png)
SRC = {
    "stone-skin": "cut/stone-skin.full.png", "chest-pound": "cut/chest-pound-v2.full.png",
    "ground-slam": "cut/ground-slam.full.png", "bloodthirst": "cut/bloodthirst-v2a.full.png",
    "twin-bite": "cut/twin-bite.full.png", "obsidian-hide": "refs/style-C1.png",
    "healing-mist": "cut/healing-mist.full.png", "bubble": "cut/bubble.full.png",
    "acid-spit": "cut/acid-spit.full.png", "burn": "cut/burn.full.png",
    "breath-of-fire": "cut/breath-of-fire.full.png", "fists-of-doom": "cut/fists-of-doom.full.png",
}

GEM_SHEET, GEM_CELL = "g2", 1  # the picture inside a cut gem, seen through its facets


def cells(sheet, rows=2):
    """The cells of a 3-column sheet as RGB arrays (3x2, or 3x1 for a single row)."""
    im = np.asarray(Image.open(sheet).convert("RGB")).astype(int)
    h, w, _ = im.shape
    cw, ch = w // 3, h // rows
    return [im[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] for r in range(rows) for c in range(3)]


def keys(cell):
    """(frame RGBA image, window mask L) from a cell: magenta = outside, green = window."""
    r, g, b = cell[..., 0], cell[..., 1], cell[..., 2]
    magenta = (r > 150) & (b > 150) & (g < 120) & (np.abs(r - b) < 90)
    green = (g > 150) & (r < 140) & (b < 140)
    # the frame: the biggest piece that is not magenta (drops bits of the neighbouring cells)
    from scipy import ndimage
    lab, n = ndimage.label(ndimage.binary_closing(~magenta, iterations=2))
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = lab == (int(np.argmax(sizes)) + 1)
    keep = ndimage.binary_fill_holes(keep)
    magenta = magenta | ~keep
    green = green & keep
    ys, xs = np.nonzero(~magenta)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    side = max(y1 - y0, x1 - x0)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    pad = int(side * 0.02)
    half = side // 2 + pad

    def crop(a, fill=0):
        out = np.full((2 * half, 2 * half) + a.shape[2:], fill, dtype=a.dtype)
        sy0, sx0 = max(cy - half, 0), max(cx - half, 0)
        sy1, sx1 = min(cy + half, a.shape[0]), min(cx + half, a.shape[1])
        out[sy0 - (cy - half):sy1 - (cy - half), sx0 - (cx - half):sx1 - (cx - half)] = a[sy0:sy1, sx0:sx1]
        return out

    rgb = crop(cell).astype(np.uint8)
    mag = crop(magenta.astype(np.uint8), 1)
    grn = crop(green.astype(np.uint8))
    outside = Image.fromarray(((1 - mag) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))
    # alpha: soften the magenta edge a little
    alpha = outside.filter(ImageFilter.GaussianBlur(0.8))
    # window: the biggest green blob, holes filled (closing)
    win = Image.fromarray((grn * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    frame = Image.fromarray(rgb).convert("RGBA")
    # despill: magenta and green fringes toward the frame's own dark edge
    fa = np.asarray(frame).astype(int)
    spill_m = (fa[..., 0] > fa[..., 1] + 60) & (fa[..., 2] > fa[..., 1] + 60)
    spill_g = (fa[..., 1] > fa[..., 0] + 50) & (fa[..., 1] > fa[..., 2] + 50)
    for spill in (spill_m, spill_g):
        m = np.minimum(fa[..., 0], np.minimum(fa[..., 1], fa[..., 2]))
        fa[spill, 0] = fa[spill, 1] = fa[spill, 2] = m[spill]
    frame = Image.fromarray(fa.astype(np.uint8), "RGBA")
    frame.putalpha(ImageChops.multiply(alpha, ImageOps.invert(win)))
    return frame, win


def sheen(win, strength=1.0):
    """Glass over the window: a faint top-left sheen and one small glint, kept off the centre."""
    w, h = win.size
    yy, xx = np.mgrid[0:h, 0:w] / np.array([h, w]).reshape(2, 1, 1)
    band = np.clip(1 - (xx + yy) / 0.9, 0, 1) ** 2.2 * 0.22  # top-left corner glow
    edge = np.asarray(win.filter(ImageFilter.GaussianBlur(w * 0.035))).astype(float) / 255
    inner = np.asarray(win).astype(float) / 255
    rim_dark = np.clip(inner - edge, 0, 1) * 0.0
    a = np.clip(band * inner * strength, 0, 1)
    white = Image.new("RGBA", win.size, (235, 245, 255, 0))
    white.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    # inner recess shadow: dark just inside the bezel
    shadow_a = np.clip((inner - edge) * 2.2, 0, 1) * inner * 0.75
    shadow = Image.new("RGBA", win.size, (0, 0, 0, 0))
    shadow.putalpha(Image.fromarray((shadow_a * 255).astype(np.uint8)))
    return shadow, white


def art_in(win, src, lift):
    """The painting, its bronze border cropped off, covering the window's box."""
    art = Image.open(os.path.join(ART4, src)).convert("RGB")
    w, h = art.size
    cut = int(w * 0.045)
    art = art.crop((cut, cut, w - cut, h - cut))
    bb = win.getbbox()
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    side = int(max(bw, bh) * 1.04)
    art = art.resize((side, side), Image.LANCZOS)
    layer = Image.new("RGBA", win.size, (0, 0, 0, 0))
    ox = bb[0] + (bw - side) // 2
    oy = bb[1] + (bh - side) // 2 - int(bh * lift)
    layer.paste(art, (ox, oy))
    return layer, art


def dull(img, quartz, win):
    """Dormant stone: grey, dark, clouded."""
    g = ImageOps.grayscale(img.convert("RGB"))
    g = ImageEnhance.Brightness(g).enhance(0.72)
    g = ImageEnhance.Contrast(g).enhance(1.1)
    g = g.filter(ImageFilter.GaussianBlur(img.size[0] * 0.006))
    base = Image.merge("RGB", (g, g, g.point(lambda v: min(255, int(v * 1.08)))))
    if quartz is not None:
        q = quartz.resize(img.size, Image.LANCZOS).convert("RGB")
        base = ImageChops.screen(base, ImageEnhance.Brightness(q).enhance(0.4))
    out = base.convert("RGBA")
    out.putalpha(img.getchannel("A"))
    return out


def glass(art_layer, frame, win, sil):
    """The picture seen through a cut gem: clear in the table, refracted and shaded under the crown facets."""
    w, h = win.size
    bb = sil.getbbox()
    # under the crown the picture is pushed outward a little and softened, as through thick glass
    zoom = art_layer.resize((int(w * 1.06), int(h * 1.06)), Image.LANCZOS)
    ox, oy = (zoom.width - w) // 2, (zoom.height - h) // 2
    refr = zoom.crop((ox, oy, ox + w, oy + h)).filter(ImageFilter.GaussianBlur(w * 0.006))
    a = np.asarray(refr.convert("RGB")).astype(float) / 255
    f = np.asarray(frame.convert("RGB")).astype(float).mean(axis=2, keepdims=True) / 255
    over = np.where(a < 0.5, 2 * a * f, 1 - 2 * (1 - a) * (1 - f))  # overlay: facets light and shade it
    mix = np.clip(over * 0.72 + f * 0.28, 0, 1)  # and a little of the glass's own grey
    crown = Image.fromarray((mix * 255).astype(np.uint8)).convert("RGBA")
    out = Image.new("RGBA", win.size, (0, 0, 0, 0))
    out.paste(art_layer, (0, 0), ImageChops.multiply(art_layer.getchannel("A"), sil))
    crown_mask = ImageChops.subtract(frame.getchannel("A"), win)
    out.paste(crown, (0, 0), crown_mask)
    return out


def main():
    all_cells = cells(os.path.join(HERE, GEM_SHEET, "sheet.png"), rows=1)
    frame, win = keys(all_cells[GEM_CELL])
    quartz_cell = cells(os.path.join(HERE, "g1", "sheet.png"))[5].astype(np.uint8)
    qh, qw, _ = quartz_cell.shape
    quartz = Image.fromarray(quartz_cell[qh // 6: -qh // 6, qw // 6: -qw // 6])
    frame = frame.resize((WORK, WORK), Image.LANCZOS)
    win = win.resize((WORK, WORK), Image.LANCZOS)
    sil = ImageChops.lighter(frame.getchannel("A"), win)
    out_dir = os.path.join(OUT_ROOT, "gem-c")
    os.makedirs(out_dir, exist_ok=True)
    _, white = sheen(win)
    for name, src in SRC.items():
        layer, _ = art_in(sil, src, 0.0)
        lit = glass(layer, frame, win, sil)
        lit.alpha_composite(white)
        stone = dull(lit, quartz, win)
        for img, suffix in ((lit, ""), (stone, ".locked")):
            small = img.resize((SIZE, SIZE), Image.LANCZOS)
            small.save(os.path.join(out_dir, f"{name}{suffix}.webp"), quality=90, method=6)
    print("baked", out_dir)


if __name__ == "__main__":
    main()
