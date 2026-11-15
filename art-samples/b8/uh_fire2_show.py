"""uh_fire2_show.py [contact] [sheets] [videos] [sim game glow] : the owner's pictures of the new Under Hall fire.

From what uh_fire2_anim.py wrote (final/fire2/work/frames-<option>/L<N>/) and the first pass's frames
(final/work/frames<N>/, the OLD flame). Everything stands on the Inferno's lava ground with Flash's shadow.
  contact : fire2/sheets/contact-<option>-L<N>.png, every 3rd frame of the loop in order (for vetting the motion)
  sheets  : fire2/sheets/fire2-stills-L6-6x.png and -gamesize-1x.png: level 6 mid-loop, old flame and each option
  videos  : fire2/videos/fire2-<option>-L4-5-6-4x.mp4 (levels side by side, 4 loops) and
            fire2/videos/fire2-compare-L6-old-vs-options-4x.mp4
Run: ~/.cache/bymr-art-venv/bin/python uh_fire2_show.py   (from art-samples/b8; needs ffmpeg for the videos)
"""
import shutil
import subprocess
import sys

from b8lib import hstack, label, titled, vstack
from uh_final_lib import FINAL, Image
from uh_final_show import TODAY, scene

FIRE2 = FINAL / "fire2"
SHEETS, VIDEOS = FIRE2 / "sheets", FIRE2 / "videos"
N = 48
NAMES = {"old": "OLD flame (rejected)", "sim": "1  Simulated fire", "game": "2  The game's own flame (Tiki Torch)", "glow": "3  No open flame: glow, smoke, sparks"}
SHADOW = TODAY[3][1]
VIEW = (190, 320, 95, 210)           # 1x: width, height, where the building's origin is
YEL, WHITE = (255, 220, 150), (255, 255, 255)


def frame(opt, level, i):
    d = FINAL / "work" / f"frames{level}" if opt == "old" else FIRE2 / "work" / f"frames-{opt}" / f"L{level}"
    return Image.open(d / f"{i:02d}.png").convert("RGBA")


def shot(opt, level, i, up):
    return scene(frame(opt, level, i), SHADOW, up, VIEW)


def contact(opts):
    SHEETS.mkdir(parents=True, exist_ok=True)
    for opt in opts:
        for lv in (4, 5, 6):
            fr = [shot(opt, lv, i, 2).crop((60, 40, 320, 640)) for i in range(0, N, 3)] + [shot(opt, lv, 0, 2).crop((60, 40, 320, 640))]
            vstack([hstack(fr[:9], 2), hstack(fr[9:], 2)], 2).save(SHEETS / f"contact-{opt}-L{lv}.png")


def sheets(opts):
    SHEETS.mkdir(parents=True, exist_ok=True)
    cols = ["old"] + opts
    mid = N // 2
    big = [label(shot(o, 6, mid, 6), NAMES[o], 34, YEL if o == "old" else WHITE) for o in cols]
    titled("Under Hall level 6, the fire: old and the new options (one moment of the loop, 6x game size)", hstack(big, 10)).save(SHEETS / "fire2-stills-L6-6x.png")
    rows = [hstack([shot(o, lv, mid, 1) for o in cols], 4) for lv in (6, 5, 4)]
    vstack(rows, 4).save(SHEETS / "fire2-stills-gamesize-1x.png")
    for o in opts:
        ls = [label(shot(o, lv, mid, 6), f"Level {lv}", 34) for lv in (4, 5, 6)]
        titled(f"Option {NAMES[o]}: levels 4, 5, 6 (one moment of the loop, 6x game size)", hstack(ls, 10)).save(SHEETS / f"fire2-{o}-L4-5-6-6x.png")


def encode(tmp, out, fps=20):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "%04d.png"), "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "14", "-preset", "slow", "-movflags", "+faststart", str(out)], check=True)


def even(im):
    return im.crop((0, 0, im.width // 2 * 2, im.height // 2 * 2))


def videos(opts):
    VIDEOS.mkdir(parents=True, exist_ok=True)
    tmp = FIRE2 / "work" / "vid"
    jobs = [(f"fire2-{o}-L4-5-6-4x.mp4", f"Under Hall fire, option {NAMES[o]}  (levels 4, 5, 6 at 4x game size, 2.4 s loop)",
             [(o, lv, f"Level {lv}", WHITE) for lv in (4, 5, 6)]) for o in opts]
    jobs.append(("fire2-compare-L6-old-vs-options-4x.mp4", "Under Hall level 6: the old flame and the new options (4x game size, 2.4 s loop)",
                 [(o, 6, NAMES[o], YEL if o == "old" else WHITE) for o in ["old"] + opts]))
    for name, title, parts in jobs:
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        fr = [even(titled(title, hstack([label(shot(o, lv, i, 4), text, 24, col) for o, lv, text, col in parts], 8), 30)) for i in range(N)]
        for k in range(4 * N):
            fr[k % N].save(tmp / f"{k:04d}.png")
        encode(tmp, VIDEOS / name)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    opts = [a for a in args if a in ("sim", "game", "glow")] or ["sim", "game", "glow"]
    what = [a for a in args if a in ("contact", "sheets", "videos")] or ["contact", "sheets", "videos"]
    if "contact" in what:
        contact(opts)
    if "sheets" in what:
        sheets(opts)
    if "videos" in what:
        videos(opts)
    print("ok")
