"""puppet.py : the cut-out puppet engine. Plain Python (Pillow, numpy, scipy, OpenCV), no 3D.

One painted cell (a frame of the current Codex-painted sheet, @4x) is cut into parts along hand-placed polygons
(rigs.py). Each part keeps the painted pixels exactly; where a part covered another one (a near leg over the belly,
the jaw over the mouth) the uncovered layer is filled by OpenCV inpainting (Telea) so a moving part shows no hole.
Every part carries a short chain of bones (hip, knee, paw); a pose rotates the bones and the part's pixels follow by
smooth skinning (linear blend over a fine triangle mesh, so a knee bends instead of breaking). The parts are drawn
back to front, the painted ground shadow is replaced by a soft one that follows the body, and the cell comes out at
the sheet's own size and anchor, so a puppet frame drops into the same place in the game's sheet.
"""
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.spatial import Delaunay

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / "server/public/assets/monsters"
CELL = {1: (130, 80), 2: (131, 90), 3: (142, 100)}   # 1x cell sizes of krallen_<look>_rev_65 (monsterSpriteData.ts)
STEP = 4                                               # mesh spacing, @4x pixels


def painted_cell(look, col, row):
    sh = Image.open(ASSETS / f"krallen_{look}_rev_65-repaint@4x.png").convert("RGBA")
    w, h = CELL[look][0] * 4, CELL[look][1] * 4
    return sh.crop((col * w, row * h, (col + 1) * w, (row + 1) * h))


def split_shadow(im):
    """(creature, shadow): the painted ground shadow is near-black and see-through, the creature is not."""
    a = np.asarray(im).astype(np.float32)
    lum = a[..., :3].max(axis=2)
    creature = (a[..., 3] > 0) & ((lum > 34) | (a[..., 3] > 235))
    creature = cv2.morphologyEx(creature.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    c = a.copy()
    c[..., 3] = np.where(creature, a[..., 3], 0)
    s = a.copy()
    s[..., 3] = np.where(creature, 0, a[..., 3])
    return c, s


def poly_mask(shape, poly, feather=0.0):
    m = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    if feather:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(m).astype(np.float32) / 255


def inpaint(rgba, hole, radius=6):
    """Fill `hole` (bool) inside the creature with painted-looking fur: Telea inpainting from the rim, a light blur
    of the result and the original's own grain added back, so the fill is not a flat smear."""
    rgb = np.ascontiguousarray(rgba[..., :3].clip(0, 255).astype(np.uint8))
    # see-through pixels keep the ground colour in their RGB; bleed the creature's own colours over them first so
    # the fill never pulls in grey-green from outside the outline
    clear = ((rgba[..., 3] < 8) & ~hole).astype(np.uint8) * 255
    rgb = cv2.inpaint(rgb, clear, 3, cv2.INPAINT_TELEA)
    m = (hole * 255).astype(np.uint8)
    out = cv2.inpaint(rgb, m, radius, cv2.INPAINT_TELEA).astype(np.float32)
    grain = rgb.astype(np.float32) - cv2.GaussianBlur(rgb, (0, 0), 2).astype(np.float32)
    shift = np.roll(grain, (7, 11), axis=(0, 1))
    out = np.where(hole[..., None], out + 0.8 * shift, rgb)
    res = rgba.copy()
    res[..., :3] = out.clip(0, 255)
    return res


# ---------------------------------------------------------------- skinning

def chain_fk(rest, angles, root_shift=(0, 0)):
    """Joint positions of a bone chain after rotating bone i by angles[i] degrees (each relative to its parent)."""
    rest = np.asarray(rest, np.float32)
    out = [rest[0] + np.asarray(root_shift, np.float32)]
    total = 0.0
    mats = []
    for i in range(len(rest) - 1):
        total += angles[i] if i < len(angles) else 0.0
        t = math.radians(total)
        R = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]], np.float32)
        out.append(out[-1] + R @ (rest[i + 1] - rest[i]))
        mats.append((R, rest[i], out[i]))
    return np.array(out), mats


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-6), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def skin(layer, bones, angles, shift=(0, 0), out_shape=None, sharp=4.0):
    """Deform an RGBA float layer by its bone chain. `bones` are rest joints; `angles` per bone (degrees);
    `shift` moves the whole chain. Returns the deformed layer (premultiplied resampling)."""
    H, W = layer.shape[:2]
    oh, ow = out_shape or (H, W)
    alpha = layer[..., 3] > 1
    if not alpha.any():
        return np.zeros((oh, ow, 4), np.float32)
    grow = cv2.dilate(alpha.astype(np.uint8), np.ones((2 * STEP + 1, 2 * STEP + 1), np.uint8)) > 0
    ys, xs = np.mgrid[0:H:STEP, 0:W:STEP]
    keep = grow[ys, xs]
    src = np.stack([xs[keep], ys[keep]], 1).astype(np.float32)
    bones = np.asarray(bones, np.float32)
    if len(bones) < 2:
        dst = src + np.asarray(shift, np.float32)
    else:
        _, mats = chain_fk(bones, angles, shift)
        d = np.stack([seg_dist(src, bones[i], bones[i + 1]) for i in range(len(bones) - 1)], 1)
        w = 1.0 / (d + 6.0) ** sharp
        w /= w.sum(1, keepdims=True)
        dst = np.zeros_like(src)
        for i, (R, a0, a1) in enumerate(mats):
            dst += w[:, i:i + 1] * ((src - a0) @ R.T + a1)
    return _render_mesh(layer, src, dst, (oh, ow))


def _render_mesh(layer, src, dst, shape):
    oh, ow = shape
    tri = Delaunay(dst)
    simp = tri.simplices
    # drop triangles that span a gap in the rest mesh (concave outlines, between legs)
    e = np.stack([np.linalg.norm(src[simp[:, i]] - src[simp[:, (i + 1) % 3]], axis=1) for i in range(3)], 1)
    ok = e.max(1) <= STEP * 1.5 + 0.01
    x0, y0 = np.floor(dst.min(0)).astype(int)
    x1, y1 = np.ceil(dst.max(0)).astype(int)
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, ow - 1), min(y1, oh - 1)
    out = np.zeros((oh, ow, 4), np.float32)
    if x1 <= x0 or y1 <= y0:
        return out
    gy, gx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
    q = np.stack([gx.ravel(), gy.ravel()], 1).astype(np.float32)
    s = tri.find_simplex(q)
    valid = s >= 0
    valid[valid] = ok[s[valid]]
    T = tri.transform[s[valid]]
    b = np.einsum("nij,nj->ni", T[:, :2], q[valid] - T[:, 2])
    bc = np.concatenate([b, 1 - b.sum(1, keepdims=True)], 1)
    sp = np.einsum("ni,nij->nj", bc, src[simp[s[valid]]])
    mapx = np.full(q.shape[0], -10, np.float32)
    mapy = np.full(q.shape[0], -10, np.float32)
    mapx[valid], mapy[valid] = sp[:, 0], sp[:, 1]
    pm = layer.copy()
    pm[..., :3] *= pm[..., 3:] / 255
    r = cv2.remap(pm, mapx.reshape(gx.shape), mapy.reshape(gx.shape), cv2.INTER_LINEAR,
                  borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    a = r[..., 3:]
    r[..., :3] = np.where(a > 0, r[..., :3] * 255 / np.maximum(a, 1e-3), 0)
    out[y0:y1 + 1, x0:x1 + 1] = r
    return out


def over(dst, src):
    """src over dst, straight-alpha float RGBA."""
    sa = src[..., 3:] / 255
    da = dst[..., 3:] / 255
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.concatenate([rgb, oa * 255], 2)


def shade(layer, k):
    out = layer.copy()
    out[..., :3] *= k
    return out


def soft_shadow(shape, cx, cy, rx, ry, strength=0.55):
    m = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=int(255 * strength))
    m = np.asarray(m.filter(ImageFilter.GaussianBlur(10))).astype(np.float32)
    out = np.zeros(shape[:2] + (4,), np.float32)
    out[..., :3] = (6, 4, 4)
    out[..., 3] = m
    return out


def to_image(a):
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA")


def premul_resize(im, size):
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    o = np.dstack([np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)])
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] * 255 / np.maximum(al, 1e-6), 0)
    return Image.fromarray(np.clip(np.dstack([rgb, al]), 0, 255).astype("uint8"), "RGBA")
