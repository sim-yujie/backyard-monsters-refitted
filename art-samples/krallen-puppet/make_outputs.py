"""make_outputs.py : the owner's sheets and animations for the Krallen puppet trial. `python make_outputs.py`

Writes, next to this file:
  compare-<rig>.png        painted frames now (top) vs puppet frames (below): four frames large (@4x), then all 16 frames
                           at game size (1x) and @2x
  compare.png              all rigs in one sheet, @2x
  parts-l3_side.png        the cut parts of the side view, spread out, with the inpainted body
  anim-<look>-large.gif    walk twice then attack twice at game speed (100 ms a frame), now above, puppet below
  anim-<look>-game.gif     the same at game size, 1x and @2x
  anim-large.webm          both looks, large
  frames/<rig>@4x.png      the 16 puppet cells of each rig in sheet order (walk 0-9, attack 10-15), @4x
"""
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import anim
import puppet as P

GRASS = (86, 92, 74, 255)
FONT = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 26)
SMALL = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 18)
RIGS = {"l3_side": "Look 3 (L5) - side", "l3_front": "Look 3 (L5) - 3/4 front", "l3_back": "Look 3 (L5) - 3/4 back",
        "l2_side": "Look 2 (L3-4) - side, rig carried over", "l2_front": "Look 2 (L3-4) - 3/4 front, rig carried over"}
SHOW = [0, 3, 6, 12]               # frames shown large: three of the run, the attack's blow
SEQ = list(range(10)) * 2 + list(range(10, 16)) * 2
MS = 100                           # 8 game ticks a frame, 80 ticks a second


def painted(rig):
    look, col, _ = anim.get_rig(rig)["src"]
    return [P.painted_cell(look, col, r) for r in range(16)]


def on_grass(im):
    bg = Image.new("RGBA", im.size, GRASS)
    bg.alpha_composite(im)
    return bg


def union_box(frames, pad=10):
    box = None
    for f in frames:
        b = f.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    w, h = frames[0].size
    return (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))


def sized(f, k):
    return P.premul_resize(f, (f.width * k // 4, f.height * k // 4))


def label(d, xy, text, font=FONT):
    d.text(xy, text, fill=(240, 240, 230), font=font)


def compare_sheet(rig, now, pup):
    box = union_box(now + pup)
    cw, ch = box[2] - box[0], box[3] - box[1]
    W = max(cw * len(SHOW), 16 * now[0].width // 2) + 200
    small1, small2 = [now[0].width // 4, now[0].height // 4], [now[0].width // 2, now[0].height // 2]
    H = 60 + 2 * (ch + 10) + 2 * (small1[1] + 6) + 2 * (small2[1] + 6) + 90
    out = Image.new("RGBA", (W, H), (40, 44, 36, 255))
    d = ImageDraw.Draw(out)
    label(d, (10, 12), RIGS[rig] + ":  painted now (top)  vs  puppet (below)")
    y = 60
    for name, fr in (("now", now), ("puppet", pup)):
        label(d, (10, y + ch // 2 - 14), name)
        for i, k in enumerate(SHOW):
            out.alpha_composite(on_grass(fr[k].crop(box)), (200 + i * cw, y))
        y += ch + 10
    label(d, (10, y + 4), "game size 1x (16 frames: run 0-9, attack 10-15), then @2x", SMALL)
    y += 30
    for k, sz in ((1, small1), (2, small2)):
        for name, fr in (("now", now), ("puppet", pup)):
            label(d, (10, y + sz[1] // 2 - 10), f"{name} {k}x" if k == 1 else f"{name} @2x", SMALL)
            for i, f in enumerate(fr):
                out.alpha_composite(on_grass(sized(f, k)), (200 + i * sz[0], y))
            y += sz[1] + 6
    return out


def parts_sheet(rig):
    layers, _, _ = anim.cut(anim.get_rig(rig))
    names = [p["name"] for p in anim.get_rig(rig)["parts"]]
    w, h = 568, 400
    out = Image.new("RGBA", (w * 4, h * ((len(names) + 3) // 4)), (40, 44, 36, 255))
    d = ImageDraw.Draw(out)
    for i, n in enumerate(names):
        x, y = (i % 4) * w, (i // 4) * h
        out.alpha_composite(on_grass(P.to_image(layers[n])), (x, y))
        label(d, (x + 8, y + 6), n + (" (holes inpainted)" if n == "body" else ""))
    return out


def anim_frames(groups, k, crop=True):
    """One image per step of SEQ: each group (a look) is a row pair, now above puppet, headings across."""
    cols = []
    for rig, now, pup in groups:
        box = union_box(now + pup) if crop else (0, 0, now[0].width, now[0].height)
        cols.append((rig, now, pup, box))
    cw = [(b[2] - b[0]) * k // 4 for *_, b in cols]
    ch = max((b[3] - b[1]) * k // 4 for *_, b in cols)
    W, H = sum(cw) + 120, 2 * ch + 40
    seq = []
    for s in SEQ:
        out = Image.new("RGBA", (W, H), GRASS)
        d = ImageDraw.Draw(out)
        x = 120
        for (rig, now, pup, box), w in zip(cols, cw):
            for j, fr in enumerate((now, pup)):
                f = fr[s].crop(box)
                f = P.premul_resize(f, (w, (box[3] - box[1]) * k // 4)) if k != 4 else f
                out.alpha_composite(f, (x, 30 + j * ch))
            x += w
        label(d, (8, 30 + ch // 2 - 10), "now", SMALL)
        label(d, (8, 30 + ch + ch // 2 - 10), "puppet", SMALL)
        label(d, (8, 4), ("run" if s < 10 else "attack") + f"  frame {s}", SMALL)
        seq.append(out)
    return seq


def save_gif(seq, path):
    rgb = [f.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT) for f in seq]
    rgb[0].save(path, save_all=True, append_images=rgb[1:], duration=MS, loop=0, optimize=True)


def save_webm(seq, path):
    tmp = P.HERE / "_webm"
    tmp.mkdir(exist_ok=True)
    for i, f in enumerate(seq * 3):
        f.convert("RGB").save(tmp / f"{i:04d}.png")
    w, h = seq[0].size
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(1000 // MS), "-i", str(tmp / "%04d.png"),
                    "-vf", f"pad={w + w % 2}:{h + h % 2}", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24",
                    "-pix_fmt", "yuv420p", str(path)], check=True)
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()


def main():
    (P.HERE / "frames").mkdir(exist_ok=True)
    data = {}
    for rig in RIGS:
        now, pup = painted(rig), anim.frames(rig)
        data[rig] = (now, pup)
        compare_sheet(rig, now, pup).save(P.HERE / f"compare-{rig}.png")
        strip = Image.new("RGBA", (pup[0].width * 16, pup[0].height))
        for i, f in enumerate(pup):
            strip.alpha_composite(f, (i * f.width, 0))
        strip.save(P.HERE / "frames" / f"{rig}@4x.png")
    parts_sheet("l3_side").save(P.HERE / "parts-l3_side.png")
    # overview: one run frame and the blow of every rig, @2x
    tiles = []
    for rig, (now, pup) in data.items():
        tiles.append([on_grass(sized(now[3], 2)), on_grass(sized(pup[3], 2)), on_grass(sized(now[12], 2)),
                      on_grass(sized(pup[12], 2))])
    tw, th = 284, 200
    ov = Image.new("RGBA", (360 + 4 * tw, 50 + len(tiles) * th), (40, 44, 36, 255))
    d = ImageDraw.Draw(ov)
    for i, t in enumerate(["run - now", "run - puppet", "attack - now", "attack - puppet"]):
        label(d, (360 + i * tw + 10, 12), t, SMALL)
    for r, (rig, row) in enumerate(zip(data, tiles)):
        label(d, (10, 50 + r * th + th // 2 - 10), RIGS[rig].replace(", rig carried over", " (carried)"), SMALL)
        for i, t in enumerate(row):
            ov.alpha_composite(t, (360 + i * tw, 50 + r * th))
    ov.save(P.HERE / "compare.png")
    big = []
    for look, rigs in (("l3", ["l3_side", "l3_front", "l3_back"]), ("l2", ["l2_side", "l2_front"])):
        groups = [(r, *data[r]) for r in rigs]
        large = anim_frames(groups, 4)
        save_gif([f.resize((f.width * 3 // 4, f.height * 3 // 4), Image.LANCZOS) for f in large],
                 P.HERE / f"anim-{look}-large.gif")
        g1, g2 = anim_frames(groups, 1, crop=False), anim_frames(groups, 2, crop=False)
        game = []
        for a, b in zip(g1, g2):
            f = Image.new("RGBA", (a.width + b.width + 20, max(a.height, b.height)), GRASS)
            f.alpha_composite(a, (0, 0))
            f.alpha_composite(b, (a.width + 20, 0))
            game.append(f)
        save_gif(game, P.HERE / f"anim-{look}-game.gif")
        big.append(large)
    w = max(s[0].width for s in big)
    both = []
    for a, b in zip(*big):
        f = Image.new("RGBA", (w, a.height + b.height), GRASS)
        f.alpha_composite(a, (0, 0))
        f.alpha_composite(b, (0, a.height))
        both.append(f)
    save_webm(both, P.HERE / "anim-large.webm")


if __name__ == "__main__":
    main()
