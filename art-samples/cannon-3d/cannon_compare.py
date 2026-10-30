"""cannon_compare.py : cannon-compare.png, tier 2 side by side at the same 30 degree angle (owner, 28 Oct): the painted
still, the 3D Cannon of c4d709e8 (spikes round the barrel), the 3D Cannon with the ring of spikes moved down, and any
AI-generated Cannon rendered by ai_render.py (render/ai/*.png, still heading only). Large, cropped to the tower.

  python cannon_compare.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
PAINTED = Path("D:/Coding/BYMR/worktrees/codex-art/art-samples/redesign/cannon/TALL2/new-4x.png")   # read only
GRASS, PAD, BAR, SCALE = (96, 150, 64, 255), 24, 76, 1.4


def tilted(src, r, k):
    im = Image.open(HERE / src / "t2" / "body-4x.png").convert("RGBA")
    im.alpha_composite(Image.open(HERE / src / "t2" / "tilt-4x" / f"r{r}_h{k:02d}.png").convert("RGBA"))
    return im


def main():
    font = ImageFont.truetype("arialbd.ttf", 26)
    small = ImageFont.truetype("arial.ttf", 22)
    ai = sorted((HERE / "render" / "ai").glob("*.png")) if (HERE / "render" / "ai").exists() else []
    cols = [("Painted (game today)", ""), ("3D now (c4d709e8)", "spikes round the barrel"),
            ("3D, spikes lowered", "ring below the barrel")] + [(f"AI: {p.stem}", "Blender, same camera") for p in ai]
    rows = [
        ("barrel 22° up, heading 9 (the still)",
         [Image.open(PAINTED).convert("RGBA"), tilted("render-c4d", 0, 9), tilted("render", 0, 9)] +
         [Image.open(p).convert("RGBA") for p in ai]),
        ("barrel at its lowest, heading 24 (over the back spikes)",
         [None, tilted("render-c4d", 4, 24), tilted("render", 4, 24)] + [None] * len(ai)),
    ]
    sub = {1: ["", "8° down", "18° down"]}
    boxes = []
    for _, ims in rows:
        bb = [im.getbbox() for im in ims if im is not None]
        boxes.append((min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb), max(b[3] for b in bb)))
    cw = max(round((b[2] - b[0]) * SCALE) for b in boxes) + 2 * PAD
    hs = [round((b[3] - b[1]) * SCALE) + BAR + PAD for b in boxes]
    S = Image.new("RGBA", (cw * len(cols), 60 + sum(hs)), GRASS)
    d = ImageDraw.Draw(S)
    for c, (t, s) in enumerate(cols):
        for txt, f, yy in ((t, font, 6), (s, small, 36)):
            tw = d.textlength(txt, font=f)
            d.text((c * cw + (cw - tw) / 2, yy), txt, fill=(255, 255, 255, 255), font=f, stroke_width=2,
                   stroke_fill=(0, 0, 0, 255))
    y = 60
    for i, ((label, ims), box, h) in enumerate(zip(rows, boxes, hs)):
        d.text((PAD, y + 8), label, fill=(255, 255, 255, 255), font=small, stroke_width=2, stroke_fill=(0, 0, 0, 255))
        for c, im in enumerate(ims):
            if im is None:
                continue
            im = im.crop(box)
            im = im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)
            S.alpha_composite(im, (c * cw + (cw - im.width) // 2, y + BAR - 30))
            if i in sub and sub[i][c]:
                tw = d.textlength(sub[i][c], font=font)
                d.text((c * cw + (cw - tw) / 2, y + h - PAD - 10), sub[i][c], fill=(255, 255, 255, 255), font=font,
                       stroke_width=2, stroke_fill=(0, 0, 0, 255))
        y += h
    out = HERE / "cannon-compare.png"
    S.convert("RGB").save(out, optimize=True)
    print(out, S.size)


if __name__ == "__main__":
    main()
