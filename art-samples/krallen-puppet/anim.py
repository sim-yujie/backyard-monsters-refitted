"""anim.py : cut a rig's painted cell into parts and pose them through the walk (10 frames) and attack (6 frames)
of Krallen's sheet rows. `python anim.py <rig> [debug]` writes _<rig>_frames.png (and the cut overlay with debug).
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

import puppet as P
from rigs import RIGS

WALK, ATTACK = 10, 6
_BUILT = {}


def get_rig(name):
    """A hand-placed rig from rigs.py, or `l2_<heading>`: the look 3 rig carried onto look 2 (transfer.py)."""
    if name in RIGS:
        return RIGS[name]
    if name not in _BUILT:
        from transfer import transfer
        look, heading = int(name[1]), name.split("_", 1)[1]
        _BUILT[name], M = transfer(RIGS[f"l3_{heading}"], look)
        print(name, "fit", np.round(M, 3).tolist())
    return _BUILT[name]
PARENT = {"jaw": "head"}


def cut(rig):
    """The rig's parts as float RGBA layers, the leftover body with its covered areas inpainted, and the shadow."""
    look, col, row = rig["src"]
    creature, shadow = P.split_shadow(P.painted_cell(look, col, row))
    shape = creature.shape
    layers, body_out, fills = {}, np.zeros(shape[:2], np.float32), []
    for p in rig["parts"]:
        if p["name"] == "body":
            continue
        m = P.poly_mask(shape, p["poly"], feather=1.5)
        lay = creature.copy()
        lay[..., 3] *= m
        layers[p["name"]] = lay
        hole = p.get("hole", None if p.get("behind") else p["poly"])
        if hole is not None:
            body_out = np.maximum(body_out, P.poly_mask(shape, hole, feather=1.5))
        if "fill" in p:
            fills.append(P.poly_mask(shape, p["fill"]) > 0.5)
    body = creature.copy()
    fill = np.zeros(shape[:2], bool)
    for f in fills:
        fill |= f
    fill &= creature[..., 3] > 0
    body[..., 3] = creature[..., 3] * (1 - body_out)
    body[..., 3] = np.where(fill, 255, body[..., 3])
    body = P.inpaint(body, fill)
    layers["body"] = body
    # the jaw's own hole in the head: the dark mouth behind it
    if "jaw" in layers and "head" in layers:
        jp = next(p for p in rig["parts"] if p["name"] == "jaw")
        hm = P.poly_mask(shape, jp["poly"], feather=1.0)
        head = layers["head"]
        head[..., 3] *= 1 - hm
        mouth = (P.poly_mask(shape, jp["fill"]) > 0.5) & (creature[..., 3] > 0)
        head[..., :3] = np.where(mouth[..., None], (70, 12, 16), head[..., :3])
        head[..., 3] = np.where(mouth, 255, head[..., 3])
    sa = shadow[..., 3] * (np.arange(shape[0])[:, None] > rig["ground"] - 70)
    ys, xs = np.where(sa > 60)
    sh = dict(cx=(xs.min() + xs.max()) / 2, cy=(ys.min() + ys.max()) / 2, rx=(xs.max() - xs.min()) / 2,
              ry=(ys.max() - ys.min()) / 2) if len(xs) else dict(cx=shape[1] / 2, cy=rig["ground"], rx=120, ry=24)
    return layers, sh, shape


def s(t, ph=0.0):
    return math.sin(2 * math.pi * (t + ph))


def walk_pose(t, swing=1.0):
    """A bounding gallop: hind pair then front pair, one lift of the body per stride."""
    pose = dict(body=dict(dx=0, dy=-7 * max(0, s(t, 0.15)) + 3, rot=[3.5 * s(t, 0.0)]))
    legs = dict(near_hind=0.0, far_hind=0.08, near_front=0.5, far_front=0.58)
    for name, ph in legs.items():
        front = "front" in name
        amp = (32 if front else 28) * swing
        lift = max(0.0, s(t, ph + 0.25))           # bend while the leg swings forward
        knee = (-40 if front else 34) * lift
        pose[name] = dict(rot=[amp * s(t, ph), knee * swing, -knee * 0.5 * swing])
    pose["tail"] = dict(rot=[-6 * s(t, 0.3), -10 * s(t, 0.45)])
    pose["head"] = dict(rot=[-3.0 * s(t, 0.0) + 2 * s(t, 0.5)])
    pose["jaw"] = dict(rot=[-4 - 4 * max(0, s(t, 0.2))])
    pose["arm"] = dict(rot=[5 * s(t, 0.35), 8 * s(t, 0.5)])
    pose["arm_r"] = dict(rot=[-5 * s(t, 0.35), -8 * s(t, 0.5)])
    return pose


ATTACK_KEYS = [  # body shift/pitch, head, jaw (opening is negative: the jaw swings down and back), arm, front legs
    dict(dx=10, dy=6, pitch=5, head=6, jaw=-4, arm=(-14, -10), front=(-10, 10), hind=(-6, 8)),
    dict(dx=14, dy=-4, pitch=10, head=10, jaw=-12, arm=(-24, -16), front=(20, -35), hind=(-12, 14)),
    dict(dx=-24, dy=6, pitch=-7, head=-12, jaw=-20, arm=(28, 16), front=(32, -10), hind=(-22, 6)),
    dict(dx=-20, dy=4, pitch=-5, head=-6, jaw=-14, arm=(20, 10), front=(26, -4), hind=(-18, 4)),
    dict(dx=-8, dy=2, pitch=-1, head=0, jaw=-6, arm=(8, 4), front=(10, 0), hind=(-8, 2)),
    dict(dx=0, dy=0, pitch=0, head=2, jaw=-4, arm=(0, 0), front=(0, 0), hind=(0, 0)),
]


def attack_pose(i, swing=1.0, fwd=(-1.0, 0.0)):
    k = ATTACK_KEYS[i]
    pose = dict(body=dict(dx=-k["dx"] * fwd[0], dy=k["dy"] - k["dx"] * fwd[1], rot=[k["pitch"] * swing]))
    pose["near_front"] = dict(rot=[k["front"][0], k["front"][1], 0])
    pose["far_front"] = dict(rot=[k["front"][0] * 0.7 - 6, k["front"][1]])
    pose["near_hind"] = dict(rot=[k["hind"][0], k["hind"][1], 0])
    pose["far_hind"] = dict(rot=[k["hind"][0] * 0.8, k["hind"][1]])
    pose["head"] = dict(rot=[k["head"]])
    pose["jaw"] = dict(rot=[k["jaw"]])
    pose["arm"] = dict(rot=list(k["arm"]))
    pose["arm_r"] = dict(rot=[-a for a in k["arm"]])
    pose["tail"] = dict(rot=[-k["pitch"] * 1.2, k["dx"] * 0.4])
    return pose


def rot_about(pt, c, deg):
    t = math.radians(deg)
    x, y = pt[0] - c[0], pt[1] - c[1]
    return (c[0] + x * math.cos(t) - y * math.sin(t), c[1] + x * math.sin(t) + y * math.cos(t))


def render(rig, layers, sh, shape, pose, flip=1):
    """One frame. flip=-1 mirrors every angle and shift (a rig facing right uses the same motions)."""
    parts = {p["name"]: p for p in rig["parts"]}
    b = pose["body"]
    bp = parts["body"]["bones"][0]
    if "head" not in parts:  # head hidden (back views): keep the body nearly level
        b = dict(b, rot=[b["rot"][0] * 0.3])
    brot = b["rot"][0] * flip
    bshift = (b["dx"] * flip, b["dy"])

    def world(pt):  # a rest point carried by the body
        q = rot_about(pt, bp, brot)
        return (q[0] + bshift[0], q[1] + bshift[1])

    frame = P.soft_shadow(shape, sh["cx"] + bshift[0] * 0.8, sh["cy"], sh["rx"] * (1 - 0.003 * max(0, -b["dy"])),
                          sh["ry"])
    head_world = None
    order = [p["name"] for p in rig["parts"]]
    for name in order:
        p = parts[name]
        lay = layers[name]
        own = [a * flip for a in pose.get(p["role"], {}).get("rot", [0])]
        if name == "body":
            img = P.skin(lay, [bp, (bp[0] + 1, bp[1])], [brot], bshift)
        else:
            piv = p["bones"][0]
            parent_rot, carry = brot, world
            if PARENT.get(name) == "head" and head_world:
                hpiv, hrot = head_world
                parent_rot = brot + hrot

                def carry(pt, hpiv=hpiv, hrot=hrot):
                    return rot_about(world(pt), hpiv, hrot)
            npiv = carry(piv)
            angles = [parent_rot + own[0]] + own[1:]
            img = P.skin(lay, p["bones"], angles, (npiv[0] - piv[0], npiv[1] - piv[1]))
            if name == "head":
                head_world = (npiv, own[0])
        if p.get("shade"):
            img = P.shade(img, p["shade"])
        frame = P.over(frame, img)
    return frame


def frames(rig_name, flip=1):
    rig = get_rig(rig_name)
    layers, sh, shape = cut(rig)
    sw, fwd = rig.get("swing", 1.0), rig.get("fwd", (-1.0, 0.0))
    walk = [render(rig, layers, sh, shape, walk_pose(i / WALK, sw), flip) for i in range(WALK)]
    att = [render(rig, layers, sh, shape, attack_pose(i, sw, fwd), flip) for i in range(ATTACK)]
    return [P.to_image(f) for f in walk + att]


def debug(rig_name):
    rig = get_rig(rig_name)
    look, col, row = rig["src"]
    im = P.painted_cell(look, col, row)
    bg = Image.new("RGBA", im.size, (200, 200, 200, 255))
    bg.alpha_composite(im)
    d = ImageDraw.Draw(bg)
    cols = [(255, 0, 0), (0, 160, 0), (0, 0, 255), (200, 0, 200), (0, 160, 160), (220, 120, 0), (120, 0, 220), (0, 0, 0)]
    for i, p in enumerate(rig["parts"]):
        c = cols[i % len(cols)]
        if "poly" in p:
            d.line([tuple(q) for q in p["poly"]] + [tuple(p["poly"][0])], fill=c + (255,), width=1)
        d.line([tuple(q) for q in p["bones"]], fill=c + (255,), width=2)
        for q in p["bones"]:
            d.ellipse((q[0] - 3, q[1] - 3, q[0] + 3, q[1] + 3), fill=c + (255,))
    return bg


if __name__ == "__main__":
    name = sys.argv[1]
    if len(sys.argv) > 2:
        debug(name).resize((1136, 800), Image.LANCZOS).save(P.HERE / f"_{name}_debug.png")
    fs = frames(name)
    big = Image.new("RGBA", (fs[0].width * 2, fs[0].height), (86, 92, 74, 255))
    big.alpha_composite(fs[2], (0, 0)); big.alpha_composite(fs[12], (fs[0].width, 0))
    big.save(P.HERE / f"_{name}_big.png")
    w, h = fs[0].size
    out = Image.new("RGBA", (w * 4, h * 4), (86, 92, 74, 255))
    for i, f in enumerate(fs):
        out.alpha_composite(f, ((i % 4) * w, (i // 4) * h))
    out.save(P.HERE / f"_{name}_frames.png")
