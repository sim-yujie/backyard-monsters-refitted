# python3 final.py : names the round 5 pictures (from shots/hcc-r5/work), makes 2x desktop crops and the comparison sheets.
from PIL import Image, ImageDraw, ImageFont
import shutil
W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3/shots"
R5 = f"{W}/hcc-r5"
NAMES = {
    "l3-hatch": "1-hatch-rail-l3", "l2-hatch": "1-hatch-rail-l2", "l1-hatch": "1-hatch-rail-l1",
    "l3-hatch-sent": "2-hatch-rail-sent-l3",
    "l3-presets-scrolled": "3-presets-long-row-scrolled-l3",
    "l1-presets": "4-presets-l1-two", "l2-presets": "4-presets-l2-four", "l3-presets": "4-presets-l3-six",
    "l3-edit": "5-editor-boxes-l3", "l3-edit-next": "5-editor-boxes-next-l3", "l3-edit-ten": "5-editor-boxes-full-l3",
    "l1-edit": "5-editor-boxes-l1",
}
import os
for job, name in NAMES.items():
    if os.path.exists(f"{R5}/work/{job}-modern-390x844.png"):  # the rail (and so l3-hatch-sent) is desktop only
        shutil.copy(f"{R5}/work/{job}-modern-390x844.png", f"{R5}/phone-{name}-modern-390x844.png")
    shutil.copy(f"{R5}/work/{job}-modern-1280x720.png", f"{R5}/desktop-{name}-modern-1280x720.png")
    d = Image.open(f"{R5}/work/{job}-modern-1280x720.png").crop((30, 100, 1250, 712))
    d.resize((d.width * 2, d.height * 2), Image.LANCZOS).save(f"{R5}/desktop-2x-window-{name}-modern.png")
for size in ("1024x768", "1024x560", "820x1180"):
    try:
        shutil.copy(f"{R5}/work/l3-hatch-modern-{size}.png", f"{R5}/tablet-1-hatch-l3-modern-{size}.png")
    except FileNotFoundError:
        pass
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
BG = (20, 24, 30)
def row(out, parts, gap=40, head=90):
    ims = [Image.open(p).convert("RGB") for p, _ in parts]
    w = sum(i.width for i in ims) + gap * (len(ims) + 1); h = max(i.height for i in ims) + head + gap
    s = Image.new("RGB", (w, h), BG); d = ImageDraw.Draw(s); x = gap
    for im, (_, words) in zip(ims, parts):
        d.text((x, 22), words, font=font, fill=(255, 255, 255)); s.paste(im, (x, head)); x += im.width + gap
    s.save(out)
def column(out, parts, gap=40, head=90):
    ims = [Image.open(p).convert("RGB") for p, _ in parts]
    w = max(i.width for i in ims) + gap * 2; h = sum(i.height + head for i in ims) + gap
    s = Image.new("RGB", (w, h), BG); d = ImageDraw.Draw(s); y = 0
    for im, (_, words) in zip(ims, parts):
        d.text((gap, y + 22), words, font=font, fill=(255, 255, 255)); s.paste(im, (gap, y + head)); y += im.height + head
    s.save(out)
# 1. Desktop Hatch tab: before (round 4, empty right side) | after (quick-send rail), one above the other at full size.
column(f"{R5}/compare-desktop-hatch-before-after.png", [
    (f"{R5}/before/l3-hatch-modern-1280x720.png", "Before (round 4): empty space right of the queue"),
    (f"{R5}/work/l3-hatch-modern-1280x720.png", "After (round 5): quick-send rail, one chip per preset"),
])
# 2. Phone preset editor: round 4 list | round 5 box grid (empty boxes = room left) | all ten boxes used.
row(f"{R5}/compare-phone-editor-before-after.png", [
    (f"{W}/hcc-r4/phone-2-edit-AFTER-progress-hidden-modern-390x844.png", "Before (round 4)"),
    (f"{R5}/work/l3-edit-modern-390x844.png", "After: queue's box grid"),
    (f"{R5}/work/l3-edit-ten-modern-390x844.png", "After: all 10 boxes used"),
])
# 3. Presets tab at each level (phone): 2 / 4 / 6 slots, and the long row dragged sideways.
row(f"{R5}/compare-phone-presets-l1-l2-l3.png", [
    (f"{R5}/work/l1-presets-modern-390x844.png", "L1: 2 presets"),
    (f"{R5}/work/l2-presets-modern-390x844.png", "L2: 4 presets"),
    (f"{R5}/work/l3-presets-modern-390x844.png", "L3: 6 presets"),
    (f"{R5}/work/l3-presets-scrolled-modern-390x844.png", "L3: long row dragged"),
])
# 4. Desktop editor: round 4 | round 5 box grid.
column(f"{R5}/compare-desktop-editor-before-after.png", [
    (f"{W}/hcc-r4/desktop-2-edit-AFTER-progress-hidden-modern-1280x720.png", "Before (round 4)"),
    (f"{R5}/work/l3-edit-ten-modern-1280x720.png", "After (round 5): queue's box grid, 0 left"),
])
print("sheets done")
