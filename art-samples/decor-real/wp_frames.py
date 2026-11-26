"""Windpump frames 0/16/32 as the yard draws them (shadow, still, wheel strip cell) at 2x, before and after,
for the owner sheet:  python wp_frames.py   -> windpump/{before,after}/<look>-frame<N>.png"""
import json, os
from PIL import Image, ImageChops
HERE = os.path.dirname(os.path.abspath(__file__))
PROPS = os.path.join(HERE, "../../server/public/assets/buildings/decorations/props/")
new = json.load(open(os.path.join(HERE, "windpump/game/rows.json")))
SETS = {
 "before": (os.path.join(HERE, "before/props/"), {
   "classic": (("windpump@2x.png", -24, -40), ("windpump-shadow.jpg", -21, 8), ("windpump-anim@2x.png", -27, -45, 27, 51)),
   "modern": (("windpump.modern@2x.webp", -24, -40), ("windpump.modern-shadow.jpg", -21, 8), ("windpump-anim.modern@2x.webp", -24, -46, 26, 51))}),
 "after": (PROPS, {l: (tuple(r["top"]), tuple(r["shadow"]), tuple(r["anim"][:5])) for l, r in new.items()}),
}
for which, (base, rows) in SETS.items():
    os.makedirs(os.path.join(HERE, "windpump", which), exist_ok=True)
    for look, (top, sh, an) in rows.items():
        still = Image.open(base + top[0]).convert("RGBA"); strip = Image.open(base + an[0]).convert("RGBA")
        shadow = Image.open(base + sh[0]).convert("L")
        for f in (0, 16, 32):
            C = Image.new("RGBA", (300, 300)); o = 150
            m = ImageChops.invert(shadow).resize((shadow.width * 2, shadow.height * 2))
            blk = Image.new("RGBA", m.size, (0, 0, 0, 0)); blk.putalpha(m.point(lambda v: int(v * 0.8)))
            C.alpha_composite(blk, (o + 2 * sh[1], o + 2 * sh[2])); C.alpha_composite(still, (o + 2 * top[1], o + 2 * top[2]))
            C.alpha_composite(strip.crop((f * an[3] * 2, 0, (f + 1) * an[3] * 2, an[4] * 2)), (o + 2 * an[1], o + 2 * an[2]))
            C.crop((70, 40, 230, 200)).save(os.path.join(HERE, "windpump", which, f"{look}-frame{f}.png"))
