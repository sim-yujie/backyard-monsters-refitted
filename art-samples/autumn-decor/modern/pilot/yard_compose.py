"""Draws yard objects as the yard does (shadow multiplied on grass, picture, first cell of each moving strip),
with the Classic or Modern look, for comparison sheets: a flag shows its cloth, the Tiki Torch its flame.

    python yard_compose.py --repo <checkout> --out <dir> <type> [<type> ...]

Writes <out>/<type>-classic@2x.png and <type>-modern@2x.png (transparent, 2 px a world px; the shadow drawn
as translucent black) and prints the names. Needs bun (web/node_modules linked).
"""
import argparse
import json
import os
import subprocess
import sys

from PIL import Image, ImageChops

JS = """
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import { setClassicLook } from "@/game/classicLook";
const out: object[] = [];
for (const classic of [true, false]) {
  setClassicLook(classic);
  for (const type of process.argv.slice(2).map(Number)) {
    const art = resolveArt(type, 1, ArtState.DEFAULT);
    if (!art) continue;
    const top = art.still ?? art.top;
    const anims = art.still || art.topIsAnim ? [] : art.anims;
    out.push({ type, name: art.name, look: classic ? "classic" : "modern", top, shadow: art.shadow,
      anims: anims.map(({ url, x, y, width, height }) => ({ url, x, y, width, height })) });
  }
}
console.log(JSON.stringify(out));
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("types", nargs="+")
    a = ap.parse_args()
    web = os.path.join(a.repo, "web")
    tmp = os.path.join(web, "tmp-yard-compose.ts")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(JS)
    try:
        res = subprocess.run(["bun", "tmp-yard-compose.ts", *a.types], cwd=web, capture_output=True, text=True,
                             check=True, shell=sys.platform == "win32")
    finally:
        os.remove(tmp)
    pub = os.path.join(a.repo, "server", "public")

    def load(url, crop=None):
        im = Image.open(os.path.join(pub, url.lstrip("/"))).convert("RGBA")
        k = 2 if "@2x" in url else 1
        if crop:
            im = im.crop((0, 0, crop[0] * k, crop[1] * k))
        return im if k == 2 else im.resize((im.width * 2, im.height * 2), Image.LANCZOS)

    os.makedirs(a.out, exist_ok=True)
    for d in json.loads(res.stdout):
        layers = []
        if d["shadow"]:
            s = load(d["shadow"]["url"]).convert("L")
            black = Image.new("RGBA", s.size, (0, 0, 0, 255))
            black.putalpha(ImageChops.invert(s))
            layers.append((black, d["shadow"]["x"], d["shadow"]["y"]))
        fr = d["top"].get("frame")  # a top that is a strip's cell 0 (Flash's Fountain)
        layers.append((load(d["top"]["url"], (fr["width"], fr["height"]) if fr else None), d["top"]["x"], d["top"]["y"]))
        for c in d["anims"]:
            layers.append((load(c["url"], (c["width"], c["height"])), c["x"], c["y"]))
        left = min(x * 2 for _, x, _ in layers)
        up = min(y * 2 for _, _, y in layers)
        right = max(x * 2 + im.width for im, x, _ in layers)
        down = max(y * 2 + im.height for im, _, y in layers)
        # keep the origin's column even so the 1x halving lands on whole pixels
        canvas = Image.new("RGBA", (right - left + (right - left) % 2, down - up + (down - up) % 2), (0, 0, 0, 0))
        for im, x, y in layers:
            canvas.alpha_composite(im, (x * 2 - left, y * 2 - up))
        name = f'{d["type"]}-{d["look"]}@2x.png'
        canvas.save(os.path.join(a.out, name))
        print(name, d["name"])


if __name__ == "__main__":
    main()
