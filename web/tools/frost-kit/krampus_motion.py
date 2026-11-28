"""Krampus's attack and stomp frames, moved from one painted pose per heading (no new painting).

Owner, 28 Nov 2026 (desk frost-abil): the painted attack frames were "horrendous": four separate paintings per
heading never showed the same body twice. Here every attack and stomp frame is the heading's own idle pose (walk
frame 1), bent smoothly by a displacement field, so the body, horns and colours are identical in every frame:

- attack, 10 frames (5 ticks each, the blow on frame 5): rear back with the head raised, then a horns-first lunge,
  head down, held a beat, and back to stand. The hind hooves stay planted.
- stomp, 9 frames (8 ticks each, the slam on frame 6 = Korath's quake tick 48): rear up on the hind legs, then
  slam the forefeet down, then settle.

`motion(cell, heading, kind, frame)` returns the moved cell; headings are the five painted columns
(0 front/S, 1 front-left/SW, 2 left/W, 3 back-left/NW, 4 back/N).
"""
import math

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

# Screen-space forward (x right, y down) and where the head sits in the body box (fraction), per painted heading.
FORWARD = {0: (0.0, 1.0), 1: (-0.8, 0.6), 2: (-1.0, 0.0), 3: (-0.8, -0.6), 4: (0.0, -1.0)}
HEAD = {0: (0.5, 0.28), 1: (0.27, 0.3), 2: (0.16, 0.3), 3: (0.3, 0.22), 4: (0.5, 0.16)}
SIDE = {0: 0.0, 1: 0.75, 2: 1.0, 3: 0.75, 4: 0.0}   # how much in-plane head rotation reads as a nod
REACH = {0: 0.6, 1: 0.9, 2: 1.0, 3: 0.9, 4: 0.6}    # face on or from behind a lunge mostly stretches: less of it

# Attack: body and head shift along forward and head drop, x body height; head nod in degrees (+ = nose down).
ATTACK = {
    "body": [0, -0.035, -0.065, -0.08, -0.02, 0.15, 0.17, 0.11, 0.05, 0.015],
    "head": [0, -0.03, -0.06, -0.08, 0.03, 0.12, 0.13, 0.08, 0.03, 0.0],
    "drop": [0, -0.04, -0.08, -0.10, -0.03, 0.06, 0.07, 0.045, 0.015, 0.0],
    "nod": [0, -7, -13, -16, -5, 15, 18, 11, 4, 0],
}
ATTACK_FRAMES = len(ATTACK["body"])
RIGID = 0.65   # share of the lunge that moves the whole body
DROP = 0.45    # how much of the head drop is kept
NOD = 0.7      # how much of the nod is kept
ATTACK_STRIKE = 5

# Stomp: the front lifted (x body height, up) and the body tipped back about the hind feet (degrees, + = front up).
STOMP = {
    "lift": [0, 0.06, 0.13, 0.19, 0.22, 0.16, -0.03, 0.015, 0.0],
    "tip": [0, 5, 10, 14, 16, 11, -3, 1, 0],
}
STOMP_FRAMES = len(STOMP["lift"])
STOMP_SLAM = 6


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bbox(al):
    ys, xs = np.where(al > 128)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def warp(cell, field):
    """Samples the cell at (x - dx, y - dy) for the field (dx, dy): premultiplied, so edges stay clean."""
    a = np.asarray(cell).astype(np.float32) / 255
    pre = a.copy()
    pre[..., :3] *= a[..., 3:4]
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = field
    coords = [yy - dy, xx - dx]
    out = np.stack([ndi.map_coordinates(pre[..., c], coords, order=3, mode="constant", cval=0) for c in range(4)], -1)
    out = np.clip(out, 0, 1)
    al = out[..., 3:4]
    rgb = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
    return Image.fromarray((np.concatenate([np.clip(rgb, 0, 1), al], -1) * 255).round().astype(np.uint8), "RGBA")


def motion(cell, heading, kind, frame):
    if frame == 0:
        return cell
    al = np.asarray(cell)[..., 3]
    x0, y0, x1, y1 = bbox(al)
    bw, bh = x1 - x0, y1 - y0
    h, w = al.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    fx, fy = FORWARD[heading]
    hx, hy = x0 + HEAD[heading][0] * bw, y0 + HEAD[heading][1] * bh
    cx, cy = x0 + bw / 2, y0 + bh / 2
    rx, ry = 2 * cx - hx, 2 * cy - hy                       # the rear: the head mirrored through the middle
    ax_, ay_ = hx - rx, hy - ry
    t = ((xx - rx) * ax_ + (yy - ry) * ay_) / max(1.0, ax_ * ax_ + ay_ * ay_)
    w_body = smooth(t, -0.1, 0.9)
    w_head = np.exp(-((xx - hx) ** 2 + (yy - hy) ** 2) / (2 * (0.27 * bh) ** 2))
    feet = smooth(yy, y1 - 0.30 * bh, y1 - 0.04 * bh)  # 1 at the hooves
    planted = 1 - feet * (1 - 0.75 * smooth(t, 0.35, 0.8))  # hind hooves stay put, forefeet step with the lunge
    dx = np.zeros_like(xx)
    dy = np.zeros_like(yy)
    if kind == "attack":
        body, head, drop, nod = (ATTACK[k][frame] * (1 if k == "nod" else bh) for k in ("body", "head", "drop", "nod"))
        body *= REACH[heading]
        head *= REACH[heading]
        # Most of the lunge moves the whole beast, hooves too: a shift keeps his size in every heading
        # (lead, 28 Nov: the front-left lunge shrank him 20% when the body was pushed into planted hooves).
        dx += RIGID * body * fx
        dy += RIGID * body * fy
        # The rest stretches him sideways only, hind hooves planted: a reach, never a squash.
        dx += w_body * planted * (1 - RIGID) * body * fx
        # The head leads: further forward (sideways), a little lower.
        dx += w_head * planted * head * fx
        dy += w_head * planted * drop * DROP
        side = SIDE[heading]
        if side > 0 and nod != 0:
            px, py = hx + (cx - hx) * 0.55, hy + (cy - hy) * 0.55
            sign = -1 if fx < 0 else 1
            phi = math.radians(nod * NOD) * sign * side * w_head
            ox, oy = xx - px, yy - py
            dx += (ox * np.cos(phi) - oy * np.sin(phi) - ox) * planted
            dy += (ox * np.sin(phi) + oy * np.cos(phi) - oy) * planted
    else:
        lift = STOMP["lift"][frame] * bh
        tip = STOMP["tip"][frame]
        lifted = w_body * (1 - 0.6 * (1 - planted) * (1 - w_body))
        dy -= lifted * lift
        side = SIDE[heading]
        if side > 0 and tip != 0:
            # tip back about the hind feet: the front rises
            px, py = rx, y1
            sign = 1 if fx < 0 else -1
            phi = math.radians(tip) * sign * side * w_body
            ox, oy = xx - px, yy - py
            dx += ox * np.cos(phi) - oy * np.sin(phi) - ox
            dy += ox * np.sin(phi) + oy * np.cos(phi) - oy
    # the field moves pixels by (dx, dy); sample backwards (fields are smooth and small, one step is enough)
    return warp(cell, (dx, dy))
