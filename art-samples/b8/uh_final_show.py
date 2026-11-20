"""uh_final_show.py [sheets] [videos] : the owner's sheets and preview videos of the final Under Hall pass, from what
uh_final_anim.py and uh_final_ruin.py wrote into underhall-levels/final/ (and work/frames<N>/, the frames as the game
would show them: body + cell). Everything stands on the Inferno's lava ground with Flash's own shadow, as in the yard.
Run: ~/.cache/bymr-art-venv/bin/python uh_final_show.py   (from art-samples/b8; needs ffmpeg for the videos)
"""
import json
import shutil
import subprocess
import sys

from PIL import ImageDraw

from b8lib import artlib, hstack, label, titled, vstack
from uh_final_lib import F, FH, FINAL, FW, OX2, OY2, WORK, Image, frame_of, ground, multiply

SHEETS, VIDEOS = FINAL / "sheets", FINAL / "videos"
N = 48
TODAY = {1: (("top.c1@2x.webp", -52, -30), ("shadow.1.v2.jpg", -65, 49)),
         2: (("top.c2@2x.webp", -51, -58), ("shadow.2.v2.jpg", -70, 35)),
         3: (("top.c3@2x.webp", -51, -54), ("shadow.3.v2.jpg", -74, 35))}
RUIN_SHADOW = {"damaged": ("shadow.3.damaged.v2.jpg", -73, 33), "destroyed": ("shadow.3.destroyed.v2.jpg", -75, 29)}
VW, VH, VX, VY = 190, 300, 95, 190          # the view (1x): size, and where the building's origin is in it
YEL, WHITE = (255, 220, 150), (255, 255, 255)
INFO = json.loads((FINAL / "anim.json").read_text())
_bg = {}


def backdrop(shadow, view=(VW, VH, VX, VY)):
    """The lava ground with a shadow multiplied on, at 2x."""
    key = (shadow, view)
    if key not in _bg:
        w, h, ox, oy = view
        g = ground(w, h)
        if shadow:
            g = multiply(g, Image.open(F / shadow[0]), ox + shadow[1], oy + shadow[2])
        _bg[key] = g.resize((w * 2, h * 2), Image.LANCZOS).convert("RGBA")
    return _bg[key]


def scene(frame, shadow, up=2, view=(VW, VH, VX, VY)):
    """A 340x660 frame (2x) in the yard, at `up` x game size."""
    w, h, ox, oy = view
    c = backdrop(shadow, view).copy()
    c.alpha_composite(frame, (ox * 2 - OX2, oy * 2 - OY2))
    c = c.convert("RGB")
    return c if up == 2 else c.resize((round(w * up), round(h * up)), Image.LANCZOS)


def still(level):
    if level <= 3:
        (f, x, y), sh = TODAY[level]
        return frame_of(Image.open(F / f), x, y), sh
    f, x, y = INFO[str(level)]["top"]
    return frame_of(Image.open(FINAL / f.replace(".webp", ".png")), x, y), TODAY[3][1]


def ruin(level, state):
    if level <= 3:
        row = {"damaged": {1: (-57, -38), 2: (-50, -47), 3: (-56, -65)}, "destroyed": {1: (-66, 10), 2: (-53, 1), 3: (-61, -21)}}[state][level]
        return frame_of(Image.open(F / f"top.c{level}.{state}@2x.webp"), *row), RUIN_SHADOW[state] if level == 3 else None
    r = json.loads((FINAL / "ruins.json").read_text())[f"{level}.{state}"]
    return frame_of(Image.open(FINAL / r[0].replace(".webp", ".png")), r[1], r[2]), RUIN_SHADOW[state]


def anim_frame(level, i):
    return Image.open(WORK / f"frames{level}" / f"{i:02d}.png").convert("RGBA")


def sheets():
    SHEETS.mkdir(exist_ok=True)
    lab = lambda lv: (f"Level {lv}  TODAY", YEL) if lv <= 3 else (f"Level {lv}  NEW", WHITE)
    cs = [label(scene(*still(lv), 3), lab(lv)[0], 26, lab(lv)[1]) for lv in range(1, 7)]
    titled("Under Hall levels 1-6, final B 'Lava and Black Iron' (stills, 3x game size; the flame and lava move in the game)", hstack(cs, 8)).save(SHEETS / "underhall-final-all-levels-3x.png")
    big = [label(scene(*still(lv), 6), "Level 3  TODAY (unchanged)" if lv == 3 else f"Level {lv}  NEW", 34, YEL if lv == 3 else WHITE) for lv in (3, 4, 5, 6)]
    titled("Under Hall final B: level 3 (today) and the new levels 4, 5, 6 (6x game size)", vstack([hstack(big[:2]), hstack(big[2:])])).save(SHEETS / "underhall-final-large-6x.png")
    if (FINAL / "ruins.json").exists():
        rows = []
        for state in ("damaged", "destroyed"):
            rows.append(hstack([label(scene(*ruin(lv, state), 4), f"Level {lv} {state}" + ("  TODAY" if lv == 3 else "  NEW"), 28, YEL if lv == 3 else WHITE) for lv in (3, 4, 5, 6)], 8))
        titled("Under Hall final B: damaged and destroyed looks, level 3 (today) and new 4, 5, 6 (4x game size)", vstack(rows)).save(SHEETS / "underhall-final-damaged-destroyed-4x.png")
    for up in (1, 2):
        rws = [hstack([scene(*still(lv), up) for lv in range(1, 7)], 4)]
        if (FINAL / "ruins.json").exists():
            rws += [hstack([scene(*ruin(lv, st), up) for lv in range(1, 7)], 4) for st in ("damaged", "destroyed")]
        vstack(rws, 4).save(SHEETS / f"underhall-final-gamesize-{up}x.png")
    # the moving parts, for a look without a video: 8 of the 48 frames of each new level, 3x
    for lv in (4, 5, 6):
        fr = [scene(anim_frame(lv, i), TODAY[3][1], 3) for i in range(0, N, 6)]
        titled(f"Under Hall level {lv}: every 6th frame of the 48-frame loop (3x game size)", vstack([hstack(fr[:4], 4), hstack(fr[4:], 4)], 4)).save(SHEETS / f"underhall-final-frames-L{lv}.png")


def encode(tmp, out, fps=20):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "%04d.png"), "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "15", "-preset", "slow", "-movflags", "+faststart", str(out)], check=True)


def videos():
    VIDEOS.mkdir(exist_ok=True)
    tmp = WORK / "vid"
    for lv in (4, 5, 6):
        shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
        frames = [label(scene(anim_frame(lv, i), TODAY[3][1], 4), f"Under Hall level {lv}  (4x game size, 20 frames a second, 2.4 s loop)", 22) for i in range(N)]
        for k in range(4 * N):
            frames[k % N].save(tmp / f"{k:04d}.png")
        encode(tmp, VIDEOS / f"underhall-L{lv}-anim-4x.mp4")
        small = [f.resize((f.width * 3 // 4, f.height * 3 // 4), Image.LANCZOS) for f in frames]      # 3x, one loop, repeats for ever
        small[0].save(VIDEOS / f"underhall-L{lv}-anim-3x.webp", save_all=True, append_images=small[1:], duration=50, loop=0, quality=88, method=4)
    # all six side by side, 3x
    view = (170, 300, 85, 190)
    shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
    rows = []
    for i in range(N):
        ps = []
        for lv in range(1, 7):
            sh = TODAY[lv][1] if lv <= 3 else TODAY[3][1]
            p = scene(anim_frame(lv, i), sh, 3, view)
            ps.append(label(p, f"Level {lv}  today's art + OPTIONAL core glow" if lv <= 3 else f"Level {lv}  NEW", 20, YEL if lv <= 3 else WHITE))
        rows.append(titled("Under Hall levels 1-6 animated (3x game size). Levels 1-3: today's approved pictures, only the lava core glow is added (optional).", hstack(ps, 6), 30))
    for k in range(4 * N):
        rows[k % N].save(tmp / f"{k:04d}.png")
    encode(tmp, VIDEOS / "underhall-all-six-anim-3x.mp4")
    half = [r.resize((r.width // 2, r.height // 2), Image.LANCZOS) for r in rows]
    half[0].save(VIDEOS / "underhall-all-six-anim-1.5x.webp", save_all=True, append_images=half[1:], duration=50, loop=0, quality=85, method=4)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    what = sys.argv[1:] or ["sheets", "videos"]
    if "sheets" in what:
        sheets()
    if "videos" in what:
        videos()
    print("ok")
