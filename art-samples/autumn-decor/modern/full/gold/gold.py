"""Gold comparison (owner 10 Nov: "Draw then let me compare"). Recolour only, game files untouched.
    python gold.py stats            gold hue/sat/value of each item, Modern and Flash
    python gold.py build <out.png>  rows A now | B all lemon (like Flash) | C all copper | Flash, at 1x and 3x,
                                    beside one Modern building; recoloured @2x files kept in lemon/ and copper/
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../../../.."))
PUB = os.path.join(REPO, "server", "public")
ITEMS = [(101, "Big Ben"), (100, "Eiffel Tower"), (99, "Statue of Liberty"), (96, "Baseball Trophy"),
         (97, "Football Trophy"), (135, "D.A.V.E. Trophy"), (120, "Big Gulp")]
LEMON_NOW, COPPER_NOW = [96, 97, 135, 120], [101, 100, 99]
BUILDING = ("Pebble Shiner (Modern)", "/assets/buildings/pebbleshiner.v2/top.3d1@2x.webp")
JS = """
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import { setClassicLook } from "@/game/classicLook";
const out: Record<string, string> = {};
for (const c of [true, false]) {
  setClassicLook(c);
  for (const t of JSON.parse(process.argv[2])) out[t + "-" + (c ? "flash" : "modern")] = resolveArt(t, 1, ArtState.DEFAULT)!.top.url;
}
console.log(JSON.stringify(out));
"""
HUE = {"lemon": 40.0, "copper": 28.0}
LO, HI = 15, 65  # hue range (degrees) that counts as gold / copper / brass


def urls():
    web = os.path.join(REPO, "web")
    tmp = os.path.join(web, "tmp-gold.ts")
    open(tmp, "w").write(JS)
    try:
        r = subprocess.run(["bun", "tmp-gold.ts", json.dumps([t for t, _ in ITEMS])], cwd=web, capture_output=True,
                           text=True, check=True, shell=sys.platform == "win32")
    finally:
        os.remove(tmp)
    return json.loads(r.stdout)


def load(url):
    return Image.open(os.path.join(PUB, url.lstrip("/"))).convert("RGBA")


def channels(im):
    hsv = np.asarray(im.convert("RGB").convert("HSV")).astype(float)
    a = np.asarray(im)[..., 3]
    return a, hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255


def stats(im):
    a, h, s, v = channels(im)
    m = (a > 128) & (h >= LO) & (h <= HI) & (s > 0.35) & (v > 0.15)
    w = s[m] * v[m]
    return dict(hue=float((h[m] * w).sum() / w.sum()), sat=float(s[m].mean()), val=float(v[m].mean()),
                frac=float(m.sum() / max(1, (a > 128).sum())))


def recolour(im, dh, ks=1.0, kv=1.0):
    """Shift the gold pixels' hue by dh degrees (soft weight by saturation), scale their sat/value."""
    a, h, s, v = channels(im)
    wgt = np.clip((s - 0.2) / 0.3, 0, 1) * ((h >= LO - 8) & (h <= HI + 8))
    h2 = (h + dh * wgt) % 360
    s2 = np.clip(s * (1 + (ks - 1) * wgt), 0, 1)
    v2 = np.clip(v * (1 + (kv - 1) * wgt), 0, 1)
    out = np.stack([h2 * 255 / 360, s2 * 255, v2 * 255], -1).round().astype(np.uint8)
    rgb = Image.fromarray(out, "HSV").convert("RGB")
    rgb.putalpha(im.getchannel("A"))
    return rgb


def strip(label, items, zoom, f, fb):
    pics = []
    for n, im, is2x in items:
        k = zoom / 2 if is2x else zoom
        size = (max(1, round(im.width * k)), max(1, round(im.height * k)))
        pics.append((n, im.resize(size, Image.LANCZOS if k < 1 else Image.NEAREST)))
    H = max(p.height for _, p in pics) + 34
    W = sum(p.width for _, p in pics) + 24 * len(pics) + 300
    c = Image.new("RGBA", (W, H), (92, 128, 60, 255))
    dr = ImageDraw.Draw(c)
    dr.text((10, H // 2 - 12), label, fill="white", font=fb)
    x = 300
    for n, p in pics:
        c.alpha_composite(p, (x, H - 26 - p.height))
        if zoom > 1:
            dr.text((x, H - 22), n, fill="white", font=f)
        x += p.width + 24
    return c


def main():
    u = urls()
    st = {k: stats(load(v)) for k, v in u.items()}
    if sys.argv[1] == "stats":
        for k, d in st.items():
            print(f"{k:12s} hue {d['hue']:5.1f}  sat {d['sat']:.2f}  val {d['val']:.2f}  gold {d['frac']:.0%}")
        return
    avg = lambda ts, key: sum(st[f"{t}-modern"][key] for t in ts) / len(ts)  # noqa: E731
    target = {"lemon": {k: avg(LEMON_NOW, k) for k in ("hue", "sat", "val")},
              "copper": {k: avg(COPPER_NOW, k) for k in ("hue", "sat", "val")}}
    print("targets", json.dumps(target))
    names = ["A: now", "B: all lemon-gold (Flash-like)", "C: all copper-orange", "Flash originals"]
    rows = {n: [] for n in names}
    for t, name in ITEMS:
        mo = load(u[f"{t}-modern"])
        d = st[f"{t}-modern"]
        rows[names[0]].append((name, mo, True))
        for key, lab in (("lemon", names[1]), ("copper", names[2])):
            g = target[key]
            # every item moved to one hue per row (B: Flash's trophies/Big Gulp ~40 deg, C: today's landmarks
            # ~28 deg), saturation to that group's mean, brightness kept (darkening it read muddy)
            im = recolour(mo, HUE[key] - d["hue"], g["sat"] / d["sat"])
            os.makedirs(os.path.join(HERE, key), exist_ok=True)
            im.save(os.path.join(HERE, key, os.path.basename(u[f"{t}-modern"]).replace(".webp", ".png")))
            rows[lab].append((name, im, True))
        rows[names[3]].append((name, load(u[f"{t}-flash"]), "@2x" in u[f"{t}-flash"]))
    b = load(BUILDING[1])
    for r in rows.values():
        r.append((BUILDING[0], b, True))
    f = ImageFont.load_default(size=16)
    fb = ImageFont.load_default(size=22)
    blocks = []
    for zoom in (1, 3):
        parts = [strip(lab, items, zoom, f, fb) for lab, items in rows.items()]
        W = max(p.width for p in parts)
        H = sum(p.height for p in parts) + 40
        blk = Image.new("RGBA", (W, H), (60, 84, 40, 255))
        ImageDraw.Draw(blk).text((10, 8), f"Gold choice, {'in-game size' if zoom == 1 else '3x'}", fill="white", font=fb)
        y = 40
        for p in parts:
            blk.alpha_composite(p, (0, y))
            y += p.height
        blocks.append(blk)
    W = max(b.width for b in blocks)
    out = Image.new("RGBA", (W, sum(b.height for b in blocks)), (60, 84, 40, 255))
    y = 0
    for blk in blocks:
        out.alpha_composite(blk, (0, y))
        y += blk.height
    out.convert("RGB").save(sys.argv[2])
    print(sys.argv[2], out.size)


main()
