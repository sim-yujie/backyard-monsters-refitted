"""Project X eye fix: paint the eye on headings that showed only the blank back of the
eyeball, and give every frame the long green leaves round the eye that the portrait has.

Usage (from the kit's work folder): python eyefix.py <src_dir> <dst_dir>
Reads <src_dir>/h<n>/frames/fNN.png (the frames build_h.py made) and writes the fixed frames
to <dst_dir>/h<n>/frames/; run assemble.py in <dst_dir> afterwards.

Headings are the sheet columns (12 degrees each, 0 = moving right, 7-8 = down, 15 = left,
22 = up). Columns 6-14 already have a painted eye and keep it. The rest get an orange iris
painted onto the white ball, turned to the side the monster walks: right for 27-5, left for
15-18. Columns 19-26 (walking up the screen, away from the viewer) keep the plain back.
"""
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

N, ROWS = 30, 12
SS = 4  # supersampling for the painted parts
CUT = 48  # top row of the old still inside a frame (build_h.py's PY)
ELEV = math.radians(25)  # camera height used to project the leaves

# iris turn (degrees, + = to screen-right) by heading; None = keep the art as it is
KEEP = set(range(6, 15))
YAW = {27: 66, 28: 61, 29: 56, 0: 52, 1: 50, 2: 50, 3: 50, 4: 50, 5: 50,
       15: -50, 16: -55, 17: -60, 18: -66}


def ball(a):
    """Eyeball circle (cx, cy, R) and its mask in one RGBA frame (float array)."""
    rgb = a[..., :3]; mx = rgb.max(-1); mn = rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1); lum = rgb.mean(-1); solid = a[..., 3] > 200
    m = solid & (lum > 120) & (sat < 0.25)
    lab, n = ndi.label(m)
    ar = ndi.sum(m, lab, range(1, n + 1)); cm = ndi.center_of_mass(m, lab, range(1, n + 1))
    i = min((i for i in range(n) if ar[i] > 0.4 * ar.max()), key=lambda i: cm[i][0])
    comp = lab == i + 1
    # grow into the shaded side of the ball (darker but still unsaturated cream)
    soft = solid & (lum > 85) & (sat < 0.33)
    # a painted iris and pupil at the rim belong to the ball too
    soft |= solid & (((rgb[..., 0] > 120) & (rgb[..., 0] > rgb[..., 1] + 30) & (rgb[..., 2] < 90)) | (lum < 60))
    for _ in range(4):
        comp |= ndi.binary_dilation(comp) & soft
    comp = ndi.binary_opening(ndi.binary_fill_holes(comp))
    lab2, _ = ndi.label(comp); ys, xs = np.where(comp)
    comp = lab2 == np.bincount(lab2[comp]).argmax()
    top = np.where(comp.any(1))[0].min()
    best, cx = 0, 0.0
    for y in range(top, min(top + 40, comp.shape[0])):
        xx = np.where(comp[y])[0]
        if len(xx) and xx.max() - xx.min() + 1 > best:
            best = xx.max() - xx.min() + 1; cx = (xx.max() + xx.min()) / 2; eq = y
    R = best / 2
    if top == CUT:  # the idle still's ball is cut flat by the old cell top
        # the cut chord's width says how much of the cap is missing
        xx = np.where(comp[CUT])[0]; half = min((xx.max() - xx.min() + 1) / 2, R)
        return (xx.max() + xx.min()) / 2, CUT - (R - math.sqrt(R * R - half * half)) + R - 0.5, R, comp
    return cx, top + R - 0.5, R, comp


def round_top(a, cx, cy, R):
    """Paint back the top of the ball that the idle still lost to its cell edge."""
    out = a.copy()
    for x in range(int(cx - R), int(cx + R) + 2):
        if not (0 <= x < a.shape[1]) or a[CUT, x, 3] < 200:
            continue
        for y in range(CUT - 1, int(cy - R) - 2, -1):
            cov = np.clip(R + 0.5 - math.hypot(x - cx, y - cy), 0, 1)
            if cov <= 0 or out[y, x, 3] >= 255 * cov:
                continue
            out[y, x, :3] = a[CUT, x, :3]; out[y, x, 3] = 255 * cov
    return out


def lerp(c0, c1, t):
    return tuple(c0[i] + (c1[i] - c0[i]) * t for i in range(3))


def iris_layer(a, cx, cy, R, mask, yaw):
    """RGBA float layer (native size) with the iris and pupil painted on the ball."""
    H, W = a.shape[:2]
    x0, x1 = int(cx - R - 2), int(cx + R + 3); y0, y1 = int(cy - R - 2), int(cy + R + 3)
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(W, x1), min(H, y1)
    ph, pw = (y1 - y0) * SS, (x1 - x0) * SS
    yy, xx = np.mgrid[:ph, :pw]
    u = ((x0 + (xx + 0.5) / SS) - 0.5 - cx) / R; v = ((y0 + (yy + 0.5) / SS) - 0.5 - cy) / R
    r2 = u * u + v * v; inside = r2 < 1
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    b = math.radians(yaw); p = 0.08
    w = (math.sin(b) * math.cos(p), math.sin(p), math.cos(b) * math.cos(p))
    d = u * w[0] + v * w[1] + nz * w[2]
    ang = np.arccos(np.clip(d, -1, 1)); A = 0.62; P = 0.24
    # angle round the iris centre, for faint radial streaks
    e1 = np.array([math.cos(b), 0, -math.sin(b)]); e2 = np.cross(w, e1)
    phi = np.arctan2(u * e2[0] + v * e2[1] + nz * e2[2], u * e1[0] + v * e1[1] + nz * e1[2])
    t = ang / A
    col = np.zeros((ph, pw, 3))
    stops = [(0.0, (250, 178, 70)), (0.45, (246, 150, 45)), (0.75, (222, 104, 22)),
             (0.92, (150, 52, 14)), (1.0, (95, 32, 10))]
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        s = (t >= t0) & (t < t1); k = ((t - t0) / (t1 - t0))[s][:, None]
        col[s] = np.array(c0) + (np.array(c1) - np.array(c0)) * k
    col *= (1 + 0.07 * np.sin(phi * 13))[..., None] * (1 + 0.04 * np.sin(phi * 31 + 1))[..., None]
    pupil = ang < P
    col[pupil] = (22, 12, 10)
    on = inside & (ang < A)
    # keep the ball's own light and shade: scale by the original brightness
    big = np.kron(a[y0:y1, x0:x1], np.ones((SS, SS, 1)))
    lum = big[..., :3].mean(-1)
    ref = np.percentile(a[..., :3].mean(-1)[mask], 90)
    shade = np.clip(lum / ref, 0.55, 1.08)[..., None]
    col = col * shade
    # the ball's bright highlight shows through
    hl = np.clip((lum - 0.97 * ref) / (0.06 * ref), 0, 1)[..., None]
    col = col * (1 - hl * 0.7) + big[..., :3] * hl * 0.7
    mbig = np.kron(ndi.binary_erosion(mask)[y0:y1, x0:x1].astype(float), np.ones((SS, SS)))
    mbig = ndi.uniform_filter(mbig, SS)
    alpha = on * mbig
    # soften the iris edge on the ball
    alpha = ndi.uniform_filter(alpha, 3)
    # downsample (premultiplied)
    pre = np.dstack([col * alpha[..., None], alpha])
    small = pre.reshape(y1 - y0, SS, x1 - x0, SS, 4).mean((1, 3))
    out = np.zeros((H, W, 4)); out[y0:y1, x0:x1] = small
    return out


def blades(heading, frame, cx, cy, R):
    """List of (depth, polygon-outer, polygon-inner) in supersampled screen coords."""
    psi0 = heading * 12
    if 1 <= frame <= 6:
        sway = 7 * math.sin(2 * math.pi * (frame - 1) / 6); rise = 1 + 0.08 * math.cos(2 * math.pi * (frame - 1) / 6)
    elif frame >= 7:
        sway = [0, -5, 8, 5, 0][frame - 7]; rise = [0.85, 1.2, 0.8, 0.85, 1.0][frame - 7]
    else:
        sway, rise = 0, 1
    spec = [(10, 2.7), (55, 2.2), (110, 2.3), (170, 2.75), (215, 2.3), (265, 1.9), (320, 2.4)]
    bx, by = cx, cy + 0.6 * R
    out = []
    for az, L in spec:
        psi = math.radians(psi0 + az + sway); L *= R
        gx, gy = math.cos(psi), math.sin(psi)
        pts = []
        for j in range(13):
            t = j / 12
            rr = L * t; hh = L * rise * (0.02 * t + 0.42 * t ** 2.2)
            sx = bx + rr * gx
            sy = by + rr * gy * math.sin(ELEV) - hh * math.cos(ELEV)
            pts.append((sx, sy))
        depth = gy * math.cos(ELEV)
        wid = [0.38 * R * (1 - (j / 12) ** 1.4) * (0.55 + 0.45 * math.sin(math.pi * min(1, j / 12 + 0.25))) for j in range(13)]
        def poly(scale):
            left, right = [], []
            for j, (px, py) in enumerate(pts):
                qx, qy = pts[min(j + 1, 12)]; ox, oy = pts[max(j - 1, 0)]
                tx, ty = qx - ox, qy - oy; nl = math.hypot(tx, ty) or 1
                nx, ny = -ty / nl, tx / nl; hw = wid[j] * scale / 2
                left.append(((px + nx * hw) * SS, (py + ny * hw) * SS))
                right.append(((px - nx * hw) * SS, (py - ny * hw) * SS))
            return left + right[::-1]
        out.append((depth, poly(1.0), poly(0.45)))
    return out


def leaf_layer(H, W, items, front):
    im = Image.new('RGBA', (W * SS, H * SS)); d = ImageDraw.Draw(im)
    for depth, outer, inner in sorted(items, key=lambda b: b[0]):
        k = 1.0 if depth > 0 else 0.82
        d.polygon(outer, fill=(int(46 * k), int(100 * k), int(28 * k), 255))
        d.polygon(inner, fill=(int(108 * k), int(182 * k), int(60 * k), 255))
    im = im.resize((W, H), Image.LANCZOS)
    return np.asarray(im).astype(float)


def over(dst, src):
    """alpha-composite straight-alpha float src over dst (both 0-255 RGBA)."""
    sa = src[..., 3:] / 255; da = dst[..., 3:] / 255
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.dstack([rgb, oa * 255])


def fix_frame(a, n, k):
    cx, cy, R, mask = ball(a)
    if k == 0 and mask[CUT].any():
        a = round_top(a, cx, cy, R)
    H, W = a.shape[:2]
    items = blades(n, k, cx, cy, R)
    back = leaf_layer(H, W, items, False)  # every leaf sits behind the ball
    # the ball and the pink lips under it hide the leaves behind them
    yy, xx = np.mgrid[:H, :W]
    disk = np.clip(R + 0.5 - np.hypot(xx - cx, yy - cy), 0, 1)
    rgb = a[..., :3]
    lips = (a[..., 3] > 128) & (rgb[..., 0] > 140) & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > 60)         & (np.abs(xx - cx) < 1.2 * R) & (yy > cy) & (yy < cy + 1.8 * R)
    hide = np.maximum(disk, ndi.uniform_filter((lips | ndi.binary_dilation(mask)).astype(float), 3))
    back[..., 3] *= 1 - np.clip(hide, 0, 1)
    mask = (disk > 0.5) & ~lips
    out = over(a, back)
    if n not in KEEP and n in YAW:
        ir = iris_layer(a, cx, cy, R, mask, YAW[n])
        al = ir[..., 3:]
        rgb = np.where(al > 0, ir[..., :3] / np.maximum(al, 1e-6), 0)
        out = over(out, np.dstack([rgb, al * 255]))
    return np.clip(out, 0, 255).astype('uint8')


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    for n in range(N):
        os.makedirs(f'{dst}/h{n}/frames', exist_ok=True)
        for k in range(ROWS):
            a = np.asarray(Image.open(f'{src}/h{n}/frames/f{k:02d}.png').convert('RGBA')).astype(float)
            Image.fromarray(fix_frame(a, n, k), 'RGBA').save(f'{dst}/h{n}/frames/f{k:02d}.png')
        print('h', n, flush=True)
