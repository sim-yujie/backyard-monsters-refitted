"""bowtrace.py : traces Flash's key bows (frame 0) into Flash-pixel shapes for locker.py.

    python bowtrace.py [show]

Level 3: the gold wire monster, thinned to its centre lines (polylines). Level 4: the solid gold head, its outline
(and any holes). Written to bows.json next to locker.py; `show` also writes work/_bow3.png / _bow4.png (mask, lines).
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
import fref  # noqa: E402

UP = 4                               # trace at 4x for smoother lines
# per level: the box round the bow (Flash px) and a test for pixels that belong to the bow, not the body/stem
BOX = {3: (-47, -92, -12, -50), 4: (-47, -92, -24, -58)}


def keep(lv, x, y):
    if lv == 3:
        return (y < -58.5 and x < -14.5) or (x < -29.5 and y < -50)
    return y < -60.5 or x < -31


def mask(lv):
    x0, y0, x1, y1 = BOX[lv]
    fr = fref.FRAME
    im = np.asarray(fref.flash_rgba(lv, 0)).astype(float)
    a = im[y0 - fr[1]:y1 - fr[1], x0 - fr[0]:x1 - fr[0], 3]
    for j in range(a.shape[0]):
        for i in range(a.shape[1]):
            if not keep(lv, x0 + i + 0.5, y0 + j + 0.5):
                a[j, i] = 0
    big = cv2.resize(a, (a.shape[1] * UP, a.shape[0] * UP), interpolation=cv2.INTER_CUBIC)
    return (big > (110 if lv == 3 else 128)).astype(np.uint8)


def thin(m):
    """Zhang-Suen thinning."""
    m = m.copy()
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(m, 1)
            P = [p[1:-1, 1:-1], p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2],
                 p[1:-1, :-2], p[:-2, :-2]]
            nb = sum(P[1:])
            seq = P[1:] + [P[1]]
            trans = sum(((seq[k] == 0) & (seq[k + 1] == 1)).astype(int) for k in range(8))
            if step == 0:
                c = (P[1] * P[3] * P[5] == 0) & (P[3] * P[5] * P[7] == 0)
            else:
                c = (P[1] * P[3] * P[7] == 0) & (P[1] * P[5] * P[7] == 0)
            rm = (P[0] == 1) & (nb >= 2) & (nb <= 6) & (trans == 1) & c
            if rm.any():
                m[rm] = 0
                changed = True
        if not changed:
            return m


def chains(sk):
    """The skeleton as polylines between ends and junctions."""
    pts = set(zip(*np.nonzero(sk)))
    nbrs = {p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx)
                and (p[0] + dy, p[1] + dx) in pts] for p in pts}
    nodes = {p for p in pts if len(nbrs[p]) != 2}
    used = set()
    out = []
    for n in nodes:
        for q in nbrs[n]:
            if (n, q) in used:
                continue
            line = [n, q]
            used.add((n, q))
            used.add((q, n))
            prev, cur = n, q
            while cur not in nodes:
                nxt = [r for r in nbrs[cur] if r != prev and (cur, r) not in used]
                if not nxt:
                    break
                used.add((cur, nxt[0]))
                used.add((nxt[0], cur))
                prev, cur = cur, nxt[0]
                line.append(cur)
            out.append(line)
    # closed loops with no node
    left = pts - {p for l in out for p in l}
    while left:
        s = left.pop()
        line = [s]
        prev, cur = None, s
        while True:
            nxt = [r for r in nbrs[cur] if r != prev and r in left]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            left.discard(cur)
            line.append(cur)
        line.append(s)
        out.append(line)
    return out


def smooth(line, k=3):
    a = np.array(line, float)
    if len(a) < 5:
        return a
    b = a.copy()
    for i in range(1, len(a) - 1):
        lo, hi = max(0, i - k), min(len(a), i + k + 1)
        b[i] = a[lo:hi].mean(0)
    return b


def to_px(lv, a):
    x0, y0 = BOX[lv][:2]
    return [(round(x0 + (c + 0.5) / UP, 2), round(y0 + (r + 0.5) / UP, 2)) for r, c in a]


def main():
    show = "show" in sys.argv
    res = {}
    m3 = mask(3)
    sk = thin(m3)
    pts = [tuple(int(v) for v in q) for q in zip(*np.nonzero(sk))]
    idx = {q: i for i, q in enumerate(pts)}
    edges = set()
    for (r, c), i in idx.items():
        for dr, dc in ((0, 1), (1, 0)):
            if (r + dr, c + dc) in idx:
                edges.add((i, idx[(r + dr, c + dc)]))
        for dr, dc in ((1, 1), (1, -1)):
            q = (r + dr, c + dc)
            if q in idx and (r, c + dc) not in idx and (r + dr, c) not in idx:
                edges.add((i, idx[q]))
    nb = [[] for _ in pts]
    for i, j in edges:
        nb[i].append(j)
        nb[j].append(i)
    P = np.array(pts, float)
    for _ in range(4):                      # soften the pixel steps (free ends stay put)
        Q = P.copy()
        for i, n in enumerate(nb):
            if len(n) >= 2:
                Q[i] = 0.5 * P[i] + 0.5 * P[n].mean(0)
        P = Q
    res["3"] = {"verts": to_px(3, P.tolist()), "edges": sorted(edges)}
    lines = [[P[i], P[j]] for i, j in edges]
    m4 = mask(4)
    cs, hier = cv2.findContours(m4, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    big = max(range(len(cs)), key=lambda i: cv2.contourArea(cs[i]))
    outer = cv2.approxPolyDP(cs[big], 1.2, True)[:, 0, :]
    holes = [cv2.approxPolyDP(cs[i], 1.0, True)[:, 0, :] for i in range(len(cs))
             if hier[0][i][3] == big and cv2.contourArea(cs[i]) > 6 * UP * UP / 4]
    res["4"] = {"outer": to_px(4, [(p[1], p[0]) for p in outer]),
                "holes": [to_px(4, [(p[1], p[0]) for p in h]) for h in holes]}
    (HERE / "bows.json").write_text(json.dumps(res))
    print("L3 verts", len(res["3"]["verts"]), "edges", len(res["3"]["edges"]))
    print("L4 outer", len(res["4"]["outer"]), "holes", [len(h) for h in res["4"]["holes"]])
    if show:
        for lv, m in ((3, m3), (4, m4)):
            im = np.dstack([m * 120] * 3).astype(np.uint8)
            if lv == 3:
                for l in lines:
                    for (r0, c0), (r1, c1) in zip(l[:-1], l[1:]):
                        cv2.line(im, (int(c0), int(r0)), (int(c1), int(r1)), (255, 60, 60), 1)
            else:
                cv2.polylines(im, [outer.reshape(-1, 1, 2)] + [h.reshape(-1, 1, 2) for h in holes], True,
                              (255, 60, 60), 1)
            Image.fromarray(im).resize((im.shape[1] * 3, im.shape[0] * 3), Image.NEAREST).save(
                HERE / "work" / f"_bow{lv}.png")


main()
