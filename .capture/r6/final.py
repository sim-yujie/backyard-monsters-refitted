# python3 final.py : names the round 6 pictures (from shots/hcc-r6/work) and makes the comparison sheets.
from PIL import Image, ImageDraw, ImageFont
import shutil
W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3/shots"
R6, R5 = f"{W}/hcc-r6", f"{W}/hcc-r5"
NAMES = {"l1-hatch": "1-hatch-l1", "l2-hatch": "1-hatch-l2", "l3-hatch": "1-hatch-l3", "l3-remote-hatch": "1-hatch-l3-outpost", "l3-presets": "2-presets-l3"}
for job, name in NAMES.items():
    for size, kind in (("1280x720", "desktop"), ("390x844", "phone")):
        shutil.copy(f"{R6}/work/{job}-modern-{size}.png", f"{R6}/{kind}-{name}-modern-{size}.png")
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
BG = (20, 24, 30)
LEVELS = [("l1-hatch", "HCC level 1 (main yard)"), ("l2-hatch", "HCC level 2 (main yard)"), ("l3-hatch", "HCC level 3 (main yard)"), ("l3-remote-hatch", "HCC level 3 (an outpost)")]

def stack(out, parts, gap=30, head=70, guides=()):
    w = max(i.width for i, _ in parts) + gap * 2
    h = sum(i.height + head for i, _ in parts) + gap * (len(parts) + 1)
    sheet = Image.new("RGB", (w, h), BG); d = ImageDraw.Draw(sheet); y = gap
    tops = []
    for im, words in parts:
        d.text((gap, y + 12), words, font=font, fill=(255, 255, 255)); y += head
        sheet.paste(im, (gap, y)); tops.append(y); y += im.height + gap
    # thin red guides down the whole sheet: left edges that must not move
    for x in guides:
        d.line([(gap + x, 0), (gap + x, h)], fill=(255, 60, 60), width=2)
    sheet.save(out)

# a) the top of the Hatch tab at each level and in an outpost, stacked; desktop 2x, phone 3x (its native)
d = [(Image.open(f"{R6}/work/{j}-modern-1280x720.png").crop((84, 206, 1200, 462)), w) for j, w in LEVELS]
d = [(i.resize((i.width * 2, i.height * 2), Image.LANCZOS), w) for i, w in d]
stack(f"{R6}/compare-a-top-strip-l1-l2-l3-outpost-desktop-2x.png", d, guides=(2 * 16, 2 * 205, 2 * 521))
p = [(Image.open(f"{R6}/work/{j}-modern-390x844.png").crop((45, 720, 1125, 1640)), w) for j, w in LEVELS]
stack(f"{R6}/compare-a-top-strip-l1-l2-l3-outpost-phone-3x.png", p, guides=(68, 730))

# b) desktop 1280x720 Hatch tab, round 5 | round 6 (level 3, main yard)
def side(out, parts, gap=40, head=80):
    ims = [Image.open(f).convert("RGB") for f, _ in parts]
    w = sum(i.width for i in ims) + gap * (len(ims) + 1); h = max(i.height for i in ims) + head + gap
    sheet = Image.new("RGB", (w, h), BG); dr = ImageDraw.Draw(sheet); x = gap
    for im, (_, words) in zip(ims, parts):
        dr.text((x, 20), words, font=font, fill=(255, 255, 255)); sheet.paste(im, (x, head)); x += im.width + gap
    sheet.save(out)
side(f"{R6}/compare-b-desktop-hatch-round5-round6-1280x720.png", [
    (f"{R5}/desktop-1-hatch-rail-l3-modern-1280x720.png", "Round 5: Send rail on the right"),
    (f"{R6}/work/l3-hatch-modern-1280x720.png", "Round 6: no rail, bigger hatcheries and queue"),
])
# the Hatch row alone at 2x, round 5 over round 6
r = [(Image.open(f"{R5}/desktop-1-hatch-rail-l3-modern-1280x720.png").crop((84, 206, 1200, 462)), "Round 5"),
     (Image.open(f"{R6}/work/l3-hatch-modern-1280x720.png").crop((84, 206, 1200, 462)), "Round 6")]
stack(f"{R6}/compare-b-desktop-hatch-row-round5-round6-2x.png", [(i.resize((i.width * 2, i.height * 2), Image.LANCZOS), w) for i, w in r])

# c) phone 390x844 at level 3, round 5 | round 6
side(f"{R6}/compare-c-phone-l3-round5-round6-390x844.png", [
    (f"{R5}/phone-1-hatch-rail-l3-modern-390x844.png", "Round 5"),
    (f"{R6}/work/l3-hatch-modern-390x844.png", "Round 6"),
])
print("done")
