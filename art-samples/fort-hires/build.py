"""build.py : cuts the Codex remaster sheets, lays every piece exactly over Flash's piece and writes the game files.

For each piece: key the magenta out, then find the scale (x and y, never above 1) and shift that make its
silhouette cover Flash's silhouette best (Flash's canvas at 2x is the target, so Flash's own offsets place it).
Colours are pulled to Flash's (per-channel mean and spread), and Flash's own soft ground shadow (it is only a blur,
so enlarging it loses nothing) is laid under the new sharp vines.

Writes  server/public/assets/buildings/fortifications/fort{70,130}_{B,F}{1..4}.modern@2x.webp
        out/*.png (the same pieces as PNG), out/report.json (how closely each matches Flash)
Run: ~/.cache/bymr-art-venv/bin/python build.py [--no-game-files] [job ...]
"""
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

import fh
sys.path.insert(0, str(fh.HERE.parent / "b8"))
from b8lib import artlib  # noqa: E402

OUT = fh.HERE / "out"
SHADOW_RGB = (15, 12, 8)
# job folder used for each (size, tier); a later redo replaces an entry
SOURCE = {(70, 1): "s70_12", (70, 2): "s70_12", (70, 3): "s70_34", (70, 4): "s70_34",
          (130, 1): "s130_12", (130, 2): "s130_12", (130, 3): "s130_34", (130, 4): "s130_34"}


def key(cell):
    """Magenta out by un-mixing: a pixel is the object over flat magenta (255, 0, 255). Vines and bone always have
    blue well below green, so blue above 0.85 x green is background showing through (the small holes between vines
    too); that share is taken out of alpha and out of the colour (no rim is cut away: the vines are thin)."""
    a = np.asarray(cell.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    seen = np.clip((b - 0.85 * g - 6) / 12, 0, 1)             # 0 = clean object pixel, 1 = magenta is in it
    bgs = seen * np.clip((b - 0.68 * g) / 255, 0, 1)          # its share (the object's own blue is ~0.68 x green)
    al = 1 - bgs
    safe = np.maximum(al, 0.05)
    g2 = g / safe
    r2 = np.minimum((r - bgs * 255) / safe, 1.32 * g2 + 8)    # no vine or bone is redder or bluer than this:
    b2 = np.minimum((b - bgs * 255) / safe, 0.85 * g2 + 6)    # whatever is left of the pink goes
    out = np.dstack([r2, g2, b2, np.clip((al - 0.12) / 0.76, 0, 1) * 255])
    im = Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA").copy()
    return im


def cut(job, half, row):
    sheet = Image.open(fh.HERE / job / "sheet.png").convert("RGB")
    if sheet.size != fh.SHEET:
        sheet = sheet.resize(fh.SHEET, Image.LANCZOS)
    x, y, w, h = fh.cell_box("BF".index(half), row)
    return artlib.largest_blob_only(artlib.clean(key(sheet.crop((x, y, x + w, y + h))), despill=False), 0.004)


def blur(a, r):
    return np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255


def best_shift(t, a):
    """Shift (dx, dy) of array a (placed at 0,0 on t's canvas, both padded) that maximises overlap with t."""
    H, W = t.shape[0] + a.shape[0], t.shape[1] + a.shape[1]
    ft = np.fft.rfft2(t, (H, W))
    fa = np.fft.rfft2(a, (H, W))
    c = np.fft.irfft2(ft * np.conj(fa), (H, W))
    i = np.unravel_index(np.argmax(c), c.shape)
    dy, dx = i
    if dy > H // 2: dy -= H
    if dx > W // 2: dx -= W
    return int(dx), int(dy), float(c[i])


def placed(im, sx, sy, dx, dy, size):
    """The cut cell resized by (sx, sy) and pasted at (dx, dy) on a transparent canvas of `size`."""
    w, h = max(1, round(im.width * sx)), max(1, round(im.height * sy))
    small = im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
    c = Image.new("RGBA", size, (0, 0, 0, 0))
    c.alpha_composite(small, (dx, dy)) if dx >= 0 and dy >= 0 else c.paste(small, (dx, dy))
    return c


def fit(cell, target, s0):
    """(sx, sy, dx, dy, soft IoU) laying the cut cell over target (float alpha, 2x Flash canvas)."""
    bb = cell.getbbox()
    piece = cell.crop(bb)
    a_full = np.asarray(piece.getchannel("A"), np.float32) / 255
    tb = blur(target, 2.0)
    best = None
    for step, span in ((0.02, 0.12), (0.005, 0.02)):
        c0 = (best[1], best[2]) if best else (s0, s0)
        for sx in np.arange(c0[0] - span, c0[0] + span + 1e-6, step):
            for sy in np.arange(c0[1] - span, c0[1] + span + 1e-6, step):
                if sx > 1 or sy > 1:
                    continue
                w, h = round(piece.width * sx), round(piece.height * sy)
                a = np.asarray(Image.fromarray((a_full * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), np.float32) / 255
                ab = blur(a, 2.0)
                dx, dy, score = best_shift(tb, ab)
                iou = score / (float((tb * tb).sum() + (ab * ab).sum()) - score)
                if not best or iou > best[0]:
                    best = (iou, float(sx), float(sy), dx, dy)
    iou, sx, sy, dx, dy = best
    out = placed(piece, sx, sy, dx, dy, (target.shape[1], target.shape[0]))
    lost = 1 - np.asarray(out.getchannel("A"), np.float32).sum() / 255 / max(1.0, a_full.sum() * sx * sy)
    return out, {"sx": round(sx, 3), "sy": round(sy, 3), "softIoU": round(iou, 3), "clipped": round(float(lost), 4)}


def tone(new, ref):
    """Per-channel mean and (partly) spread of the opaque pixels pulled to Flash's."""
    n = np.asarray(new).astype(np.float32)
    r = np.asarray(ref).astype(np.float32)
    mn, mr = n[..., 3] > 200, r[..., 3] > 200
    for c in range(3):
        m1, s1, m2, s2 = n[..., c][mn].mean(), n[..., c][mn].std(), r[..., c][mr].mean(), r[..., c][mr].std()
        k = 0.5 + 0.5 * (s2 / s1)                       # half way to Flash's contrast: Flash's is flattened by its blur
        n[..., c] = (n[..., c] - m1) * k + m2
    return Image.fromarray(np.clip(n, 0, 255).astype(np.uint8), "RGBA")


def shadow_layer(flash_im, size):
    """Flash's baked ground shadow alone, enlarged to `size`; filled in under where Flash's vines hid it."""
    vine, sh = fh.split(flash_im)
    hidden = np.asarray(vine.getchannel("A"), np.float32) / 255 > 0.25
    # thin dark wisps are Flash's blurred twig tips, not shadow: an opening drops them, the broad shadow stays
    op = Image.fromarray((sh * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    s = np.minimum(sh, np.asarray(op.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255)
    for _ in range(6):                                   # the shadow lies to the lower right: carry it in under the vines from there
        p = np.pad(s, 1, mode="edge")
        frm = np.maximum(np.maximum(p[2:, 1:-1], p[1:-1, 2:]), p[2:, 2:])
        s = np.where(hidden, np.maximum(s, frm * 0.85), s)
    a = Image.fromarray((np.clip(s, 0, 1) * 255).astype(np.uint8)).resize(size, Image.BICUBIC)
    lay = Image.new("RGBA", size, SHADOW_RGB + (0,))
    lay.putalpha(a)
    return lay


def dist_to(mask, limit=12):
    """Chebyshev distance (px, capped) of every pixel to the nearest True pixel of mask."""
    d = np.full(mask.shape, limit, np.int32)
    cur = mask.copy()
    d[cur] = 0
    for k in range(1, limit):
        p = np.pad(cur, 1)
        grown = p[:-2, :-2] | p[:-2, 1:-1] | p[:-2, 2:] | p[1:-1, :-2] | p[1:-1, 2:] | p[2:, :-2] | p[2:, 1:-1] | p[2:, 2:] | cur
        d[grown & ~cur] = k
        cur = grown
    return d


def edge(mask):
    p = np.pad(mask, 1)
    inner = p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return mask & ~inner


def measure(new2x, flash_im):
    """How closely the new piece (vines only, reduced to game size) lies over Flash's vines."""
    vine, _ = fh.split(flash_im)
    f = np.asarray(vine.getchannel("A")) > 128
    small = new2x.convert("RGBa").resize(flash_im.size, Image.LANCZOS).convert("RGBA")
    n = np.asarray(small.getchannel("A")) > 128
    dn, df = dist_to(n), dist_to(f)
    ef, en = edge(f), edge(n)
    return {
        "flash_covered": round(float((f & n).sum() / f.sum()), 3),
        "flash_within_1px": round(float((dn[f] <= 1).mean()), 3),
        "new_within_1px_of_flash": round(float((df[n] <= 1).mean()), 3),
        "iou": round(float((f & n).sum() / (f | n).sum()), 3),
        "outline_px_flash_to_new": round(float(dn[ef].mean()), 2),
        "outline_px_new_to_flash": round(float(df[en].mean()), 2),
        "outline_p95": int(np.percentile(np.concatenate([dn[ef], df[en]]), 95)),
    }


def build(size, half, tier):
    job = SOURCE[(size, tier)]
    row = fh.JOBS[job][1].index(tier)
    fl = fh.flash(size, half, tier)
    vine, _ = fh.split(fl)
    tsize = (fl.width * 2, fl.height * 2)
    target = np.asarray(vine.getchannel("A").resize(tsize, Image.BICUBIC), np.float32) / 255
    new, rep = fit(cut(job, half, row), target, 2 / fh.SCALE[size])
    new = tone(new, vine)
    rep.update(measure(new, fl))
    out = shadow_layer(fl, tsize)
    out.alpha_composite(new)
    return out, new, rep


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    jobs = [a for a in sys.argv[1:] if not a.startswith("--")]
    report = json.loads((OUT / "report.json").read_text()) if (OUT / "report.json").exists() else {}
    for (size, tier), job in SOURCE.items():
        if jobs and job not in jobs:
            continue
        if not (fh.HERE / job / "sheet.png").exists():
            continue
        for half in "BF":
            name = f"fort{size}_{half}{tier}"
            out, new, rep = build(size, half, tier)
            out.save(OUT / f"{name}.modern@2x.png")
            new.save(OUT / f"{name}.vines@2x.png")
            if "--no-game-files" not in sys.argv:
                out.save(fh.FORT / f"{name}.modern@2x.webp", quality=92, method=6, exact=False)
            report[name] = dict(job=job, **rep)
            print(name, json.dumps(rep))
    (OUT / "report.json").write_text(json.dumps(report, indent=1, sort_keys=True))
