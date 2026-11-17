"""make.py <job> <variant> : set up one Codex painting (run.sh runs it).

job = one look id or several joined by '+' (painted side by side in ONE picture, left to right), e.g. a1+a2,
a1d+a1x, b1, c1+c2, c5. Look ids: common.py. Writes art-samples/b8-inferno-paint/runs/<job>-<variant>/:
frames.png (the Flash look(s) blown up on grey, all at one scale: design, camera, footprint, size), style.png (the
Modern Inferno buildings already in the game: the painted Under Hall and Resource Pod, the 3D Bone Cruncher and Magma
Tower), for damaged/destroyed looks base.png (the new whole look they break, from BASE=<job>-<variant> of the whole
look, default <b><level>-A run), prompt.txt and inputs.txt. NOTE="..." adds a correction.
"""
import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, B, OUT, flash_body, flash_rgba, on, parse  # noqa: E402
from texts import CAMERA, FINISH, how, what  # noqa: E402

job, variant = sys.argv[1], sys.argv[2]
looks = job.split("+")
parsed = [parse(lk) for lk in looks]
bld = parsed[0][0]
out = OUT / "runs" / f"{job}-{variant}"
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)
n = len(looks)

# frames.png: the Flash look(s), cropped, blown up on grey at ONE scale, bases on one line near the bottom
crops = []
for lk in looks:
    im = flash_body(lk) if lk[0] == "c" else flash_rgba(lk)
    crops.append(im.crop(im.getbbox()))
wide = sum(c.width for c in crops) / max(c.height for c in crops)
if n > 1 or wide > 1.2:
    W, H = 1536, 1024
elif max(c.height for c in crops) / max(c.width for c in crops) > 1.2:
    W, H = 1024, 1536
else:
    W, H = 1024, 1024
cell = W // n
FILL = 0.86
k = min(min(cell * FILL / c.width for c in crops), min(H * FILL / c.height for c in crops))
print("scale", round(k, 2), file=sys.stderr)
if k < float(os.environ.get("MINSCALE", "3")):
    sys.exit(f"painting scale {k:.2f}x is under MINSCALE (default 3): split the job or set MINSCALE")
fr = Image.new("RGB", (W, H), GREY)
for i, c in enumerate(crops):
    big = on(GREY, c).resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
    fr.paste(big, (i * cell + (cell - big.width) // 2, round(H * 0.85) - big.height))
fr.save(out / "frames.png")
inputs = ["frames.png"]

# style.png: the Modern Inferno buildings in the game, so the new art sits with them
BB = ASSETS / "buildings"
st = [Image.open(BB / f).convert("RGBA") for f in ("itownhall/top.c1@2x.webp", "itownhall/top.c3@2x.webp",
                                                    "istoragesilo/top.c1@2x.webp", "iboneharvester/body.3d7@2x.webp",
                                                    "imagmatower/top.t3@2x.webp")]
sp = Image.new("RGBA", (sum(s.width for s in st) + 20 * (len(st) + 1), max(s.height for s in st) + 40), GREY + (255,))
x = 20
for s in st:
    sp.alpha_composite(s, (x, 20 + sp.height - 40 - s.height)); x += s.width + 20
sp = sp.convert("RGB")
sp.resize((sp.width * 2, sp.height * 2), Image.LANCZOS).save(out / "style.png")
inputs.append("style.png")

broken = [p for p in parsed if p[2]]
if broken:
    base = os.environ["BASE"]  # the whole look's run folder, e.g. a1+a2-A
    run = OUT / "runs" / base
    pics = [Image.open(p).convert("RGBA") for p in sorted(run.glob("new-4x-*.png")) if p.stem[7:] in
            {f"{b}{lv}" for b, lv, _ in parsed}]
    pics = [p.crop(p.getbbox()) for p in pics]
    bw = sum(p.width for p in pics) + 40 * (len(pics) + 1)
    bh = max(p.height for p in pics) + 80
    if not pics:
        sys.exit(f"no new-4x pictures for {looks} in {run}")
    bs = Image.new("RGBA", (bw, bh), GREY + (255,))
    x = 40
    for p in pics:
        bs.alpha_composite(p, (x, bh - 40 - p.height)); x += p.width + 40
    bs.convert("RGB").save(out / "base.png")
    inputs.append("base.png")
ref_note = ""
if os.environ.get("REF"):   # REF=<run>/<look>: an approved new look of the same building, for its materials (Cavern stages)
    rrun, rlook = os.environ["REF"].split("/")
    p = Image.open(OUT / "runs" / rrun / f"new-4x-{rlook}.png").convert("RGBA")
    p = p.crop(p.getbbox())
    rs = Image.new("RGBA", (p.width + 80, p.height + 80), GREY + (255,))
    rs.alpha_composite(p, (40, 40))
    rs.convert("RGB").save(out / "ref.png")
    inputs.append("ref.png")
    ref_note = (f"Input {len(inputs)}, ref.png: the NEW Modern version of a later stage of this same building, "
                "already approved: paint the rock, lava, bone and finish exactly like it (same materials, colours, "
                "light and level of detail), but the SHAPE of this stage from frames.png.\n")
(out / "inputs.txt").write_text(" ".join(inputs) + "\n")

def label(lk):
    b, lv, st = parse(lk)
    if not st:
        return what(lk)
    lvl = f"level {lv}" if b != "a" else ("level 1" if lv == 1 else "levels 2-4")
    return f"the {st.upper()} look of the {B[b]['name']} ({lvl}), described below"


pos = ["LEFT half", "RIGHT half"] if n == 2 else ["LEFT third", "MIDDLE third", "RIGHT third"]
if n == 1:
    which = f"Paint {label(looks[0])}"
    layout = f"Output: ONE image, {W}x{H}, the building alone, complete and fully inside the image with margin."
    fr_note = f"Input 1, frames.png: the OLD Flash version, blown up, on grey ({W}x{H})"
else:
    which = "Paint " + str(n) + " pictures side by side in ONE image, in the same order as frames.png:\n" + "\n".join(
        f"- In the {pos[i]}: {label(lk)}" for i, lk in enumerate(looks))
    layout = (f"Output: ONE image, {W}x{H}, the {n} pictures side by side, each centred in its own {pos[0].split()[1]} "
              f"of the image, at the same scale as each other (as in frames.png), each complete with margin, nothing "
              f"crossing into the next one's part of the image.")
    fr_note = f"Input 1, frames.png: the OLD Flash versions, side by side at one scale, blown up, on grey ({W}x{H})"
extra = ""
if broken:
    extra = ("Input 3, base.png: the NEW whole building, already approved (Modern look). This is the building that is "
             "damaged or destroyed: same parts, same materials, same colours, same finish.\n\n" +
             "\n".join(how(lk) for lk in looks if parse(lk)[2]) + "\n")

prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

{which}

It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera, the same camera, angle and orientation as frames.png (not mirrored).

{CAMERA}

{fr_note}: design, camera angle, ground footprint and size. Each new picture stands on the same footprint, centred on the same spot, base on the same ground line, about the same height, and is not wider. Read the small details from it.
Input 2, style.png: the Modern look of the other Inferno buildings from the same game. See FINISH below.
{extra}{ref_note}
THE FLASH DESIGN, REFRESHED (most important): keep the Flash silhouette, proportions, colour scheme and every signature part in the same place, so a player of the old game instantly recognises it, with richer materials, crisper detail, better lighting and sharper edges. NOT a new design, nothing added or left out, and NOT a plain copy.

{FINISH[bld]}

{layout}
Background everywhere: flat pure green #00FF00, also in every gap between the parts. No ground plane, no grass, no tile, no cast shadow on the ground, no grid lines, no text, no labels. The building itself must contain no bright pure green.
"""
if os.environ.get("NOTE"):
    prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
