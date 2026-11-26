"""Yard-style sheet of decorations on ground, each with its footprint diamond, both looks.

    python seat_view.py --repo <checkout> --out sheet.png [--zoom 3] [--no-grid] <type> ...

Draws as the yard does (shadow multiplied on the ground, then the picture) from the web code's art rows (bun),
with the footprint's diamond outline (origin = its top corner), so the base can be checked against it.
"""
import argparse, json, os, subprocess, sys
from PIL import Image, ImageChops, ImageDraw

JS = """
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import { footprintOf } from "@/game/yard/YardGrid";
import { setClassicLook } from "@/game/classicLook";
const out: object[] = [];
for (const classic of [true, false]) {
  setClassicLook(classic);
  for (const type of process.argv.slice(2).map(Number)) {
    const art = resolveArt(type, 1, ArtState.DEFAULT);
    if (!art) continue;
    const top = art.still ?? art.top;
    out.push({ type, name: art.name, look: classic ? "classic" : "modern", top, shadow: art.shadow, size: footprintOf(type)[0] });
  }
}
console.log(JSON.stringify(out));
"""
GROUND = (112, 92, 48, 255)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--zoom", type=float, default=3)
    ap.add_argument("--no-grid", action="store_true")
    ap.add_argument("types", nargs="+")
    a = ap.parse_args()
    web = os.path.join(a.repo, "web")
    tmp = os.path.join(web, "tmp-seat-view.ts")
    open(tmp, "w").write(JS)
    try:
        res = subprocess.run(["bun", "tmp-seat-view.ts", *a.types], cwd=web, capture_output=True, text=True, check=True)
    finally:
        os.remove(tmp)
    pub = os.path.join(a.repo, "server", "public")
    z = a.zoom

    def load(url):
        im = Image.open(os.path.join(pub, url.lstrip("/"))).convert("RGBA")
        k = 2 if "@2x" in url else 1
        return im.resize((round(im.width * z / k), round(im.height * z / k)), Image.LANCZOS)

    items = json.loads(res.stdout)
    cell_w, up, down = int(170 * z), int(190 * z), int(110 * z)
    rows = {"classic": [d for d in items if d["look"] == "classic"], "modern": [d for d in items if d["look"] == "modern"]}
    ncol = max(len(r) for r in rows.values())
    sheet = Image.new("RGBA", (cell_w * ncol, (up + down) * 2), GROUND)
    for ri, look in enumerate(("classic", "modern")):
        for ci, d in enumerate(rows[look]):
            ox, oy = int(cell_w * ci + cell_w / 2), int((up + down) * ri + up)
            s = d["size"]
            dr = ImageDraw.Draw(sheet)
            if not a.no_grid:
                pts = [(ox, oy), (ox + s * z, oy + s * z / 2), (ox, oy + s * z), (ox - s * z, oy + s * z / 2)]
                dr.polygon(pts, outline=(255, 255, 255, 255))
            if d["shadow"]:
                sh = load(d["shadow"]["url"]).convert("RGB")
                x, y = int(ox + d["shadow"]["x"] * z), int(oy + d["shadow"]["y"] * z)
                region = sheet.crop((x, y, x + sh.width, y + sh.height)).convert("RGB")
                sheet.paste(ImageChops.multiply(region, sh), (x, y))
            top = load(d["top"]["url"])
            sheet.alpha_composite(top, (int(ox + d["top"]["x"] * z), int(oy + d["top"]["y"] * z)))
            if not a.no_grid:
                ov = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
                ImageDraw.Draw(ov).polygon(pts, outline=(255, 255, 255, 110))
                sheet.alpha_composite(ov)
    sheet.save(a.out)
    print(a.out, sheet.size)


if __name__ == "__main__":
    main()
