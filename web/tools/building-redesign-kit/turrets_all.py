"""turrets_all.py : one GIF of every tower's tier 3 turret turning, side by side at 3x game size (art-samples/redesign/turrets-all-3x.gif).

  python turrets_all.py [tier]      (default T3)
"""
import sys
from PIL import Image, ImageDraw, ImageFont
import turret
from turret import RED, UP, headings, tower, resize_pm
from common import grass

TOWERS = ["sniper", "laser", "aerial", "railgun"]


def main(t="T3"):
    sc, pad, lab = 3, 12, 30
    font = ImageFont.truetype("arial.ttf", 20)
    big = {}
    for tw in TOWERS:
        full = [tower(tw, t, f) for f in headings(tw, t)]
        bbs = [im.getbbox() for im in full]
        box = (min(b[0] for b in bbs) - 8, min(b[1] for b in bbs) - 8, max(b[2] for b in bbs) + 8, max(b[3] for b in bbs) + 8)
        big[tw] = [resize_pm(im.crop(box), ((box[2] - box[0]) * sc // UP, (box[3] - box[1]) * sc // UP)) for im in full]
    Hm = max(big[tw][0].height for tw in TOWERS)
    W = sum(big[tw][0].width for tw in TOWERS) + pad * (len(TOWERS) + 1)
    bg = grass(W, Hm + 2 * pad + lab, seed=5).convert("RGBA")
    dr = ImageDraw.Draw(bg)
    dr.rectangle((0, 0, W, lab), fill=(20, 20, 20, 255))
    x = pad
    for tw in TOWERS:
        name = {"aerial": "Aerial Defense"}.get(tw, tw.title())
        dr.text((x, 5), f"{name} {turret.NAME[t].split(' (')[0].lower()}", fill=(255, 255, 255, 255), font=font)
        x += big[tw][0].width + pad
    # one palette for every frame, from the towers themselves (every 4th heading) plus a strip of the grass: built from whole
    # frames, the grass takes most of the 255 colours and the blue glows come out teal
    picks = [big[tw][j] for tw in TOWERS for j in range(0, 32, 4)]
    sample = Image.new("RGBA", (max(p.width for p in picks), sum(p.height for p in picks) + 64), (0, 0, 0, 0))
    y = 0
    for p in picks:
        sample.alpha_composite(p, (0, y))
        y += p.height
    sample.paste(bg.crop((0, lab, sample.width, lab + 64)), (0, y))
    a = sample.split()[3]
    pal = Image.composite(sample, Image.new("RGBA", sample.size, (60, 110, 40, 255)), a).convert("RGB").quantize(
        colors=255, method=Image.MEDIANCUT, dither=Image.NONE)
    frames = []
    for j in range(32):
        f = bg.copy()
        x = pad
        for tw in TOWERS:
            im = big[tw][j]
            f.alpha_composite(im, (x, lab + pad + Hm - im.height))
            x += im.width + pad
        frames.append(f.convert("RGB").quantize(palette=pal, dither=Image.NONE))
    o = RED / f"turrets-all-{sc}x.gif"
    frames[0].save(o, save_all=True, append_images=frames[1:], duration=90, loop=0, disposal=1)
    print("gif", o.as_posix(), frames[0].size)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "T3")
