"""Reshape round (owner 10 Nov: "Work on those whose shape differ from flash").
    python vet.py <outdir> [tag]      Flash | Modern (current wiring) at 1x and 3x + silhouette overlay, per item,
                                      from the game's own art rows (both looks, same anchor).
With old/ pictures saved under <outdir>/old-*.png it shows Flash | old Modern | new Modern.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../../../.."))
PUB = os.path.join(REPO, "server", "public")
ITEMS = [(102, 1, "Swimming Pool"), (104, 1, "Zen Garden"), (100, 1, "Eiffel Tower"), (106, 1, "Tea Garden"),
         (131, 2, "Victory Totem Pole 131 L2")]
JS = """
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import { setClassicLook } from "@/game/classicLook";
const items = JSON.parse(process.argv[2]);
const out: object[] = [];
for (const classic of [true, false]) { setClassicLook(classic);
  for (const [type, lvl] of items) { const a = resolveArt(type, lvl, ArtState.DEFAULT);
    out.push({ type, lvl, look: classic ? "classic" : "modern", top: a.still ?? a.top }); } }
console.log(JSON.stringify(out));
"""


def rows():
    web = os.path.join(REPO, "web"); tmp = os.path.join(web, "tmp-reshape-vet.ts")
    open(tmp, "w").write(JS)
    try:
        r = subprocess.run(["bun", "tmp-reshape-vet.ts", json.dumps([[t, l] for t, l, _ in ITEMS])], cwd=web,
                           capture_output=True, text=True, check=True, shell=sys.platform == "win32")
    finally:
        os.remove(tmp)
    return {(d["type"], d["look"]): d["top"] for d in json.loads(r.stdout)}


def load2x(top):
    """Picture at 2 px per world px, plus its offset in world px *2."""
    im = Image.open(os.path.join(PUB, top["url"].lstrip("/"))).convert("RGBA")
    fr = top.get("frame")
    if "@2x" not in top["url"]:
        if fr: im = im.crop((0, 0, fr["width"], fr["height"]))
        im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    return im, top["x"] * 2, top["y"] * 2


def place(pics):
    """Common canvas (2x) for several (im, x, y)."""
    l = min(x for _, x, _ in pics); u = min(y for _, _, y in pics)
    r = max(x + im.width for im, x, _ in pics); d = max(y + im.height for im, _, y in pics)
    out = []
    for im, x, y in pics:
        c = Image.new("RGBA", (r - l, d - u)); c.alpha_composite(im, (x - l, y - u)); out.append(c)
    return out, (-l, -u)


def outline(im, col):
    a = im.split()[3].point(lambda v: 255 if v > 100 else 0)
    edge = ImageChops.subtract(a.filter(ImageFilter.MaxFilter(3)), a)
    o = Image.new("RGBA", im.size, col); o.putalpha(edge); return o


def sheet(cells, title, zoom):
    """cells: list of (label, RGBA 2x canvas); drawn at in-game size *zoom on yard green."""
    from PIL import ImageFont
    f = ImageFont.load_default()
    sc = [c.resize((c.width * zoom // 2, c.height * zoom // 2), Image.NEAREST) for _, c in cells]
    w = sum(s.width for s in sc) + 20 * (len(sc) + 1); h = max(s.height for s in sc) + 50
    out = Image.new("RGBA", (w, h), (92, 128, 60, 255)); dr = ImageDraw.Draw(out)
    dr.text((10, 4), title, fill="white", font=f)
    x = 20
    for (lab, _), s in zip(cells, sc):
        out.alpha_composite(s, (x, h - 10 - s.height)); dr.text((x, 20), lab, fill="white", font=f); x += s.width + 20
    return out


def main():
    od = sys.argv[1]; os.makedirs(od, exist_ok=True)
    rs = rows(); allsheets = []
    for t, lvl, name in ITEMS:
        fl = load2x(rs[(t, "classic")]); mo = load2x(rs[(t, "modern")])
        oldp = os.path.join(od, f"old-{t}.json")
        pics = [fl]
        if os.path.exists(oldp):
            o = json.load(open(oldp)); oi = Image.open(os.path.join(od, f"old-{t}.png")).convert("RGBA")
            pics.append((oi, o["x"], o["y"]))
        pics.append(mo)
        cv, origin = place(pics)
        labels = ["Flash"] + (["old Modern"] if len(pics) == 3 else []) + ["Modern" + (" NEW" if len(pics) == 3 else "")]
        ov = cv[-1].copy(); ov.alpha_composite(outline(cv[0], (255, 0, 0, 255)))
        cells = list(zip(labels, cv)) + [("red = Flash outline", ov)]
        s1 = sheet(cells, f"{name}: in-game size", 2)
        s3 = sheet(cells, f"{name}: 3x", 6)
        both = Image.new("RGBA", (max(s1.width, s3.width), s1.height + s3.height), (92, 128, 60, 255))
        both.alpha_composite(s1, (0, 0)); both.alpha_composite(s3, (0, s1.height))
        p = os.path.join(od, f"reshape-{t}.png"); both.save(p); allsheets.append(both); print(p, both.size)
        # bounding boxes in world px, relative to anchor
        for lab, c in zip(labels, cv):
            bb = c.getbbox(); print(f"   {lab:12s} bbox x {(bb[0]-origin[0])/2:+.1f}..{(bb[2]-origin[0])/2:+.1f}"
                                    f"  y {(bb[1]-origin[1])/2:+.1f}..{(bb[3]-origin[1])/2:+.1f}")
        if len(sys.argv) > 2 and sys.argv[2] == "save-old":
            mo[0].save(os.path.join(od, f"old-{t}.png")); json.dump({"x": mo[1], "y": mo[2]}, open(oldp, "w"))
    W = max(s.width for s in allsheets); H = sum(s.height for s in allsheets)
    a = Image.new("RGBA", (W, H), (92, 128, 60, 255)); y = 0
    for s in allsheets: a.alpha_composite(s, (0, y)); y += s.height
    a.save(os.path.join(od, "reshape-all.png")); print("all", a.size)


main()
