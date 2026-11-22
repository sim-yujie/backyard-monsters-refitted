# python3 final.py : names the round 4 pictures, makes 2x desktop crops of the window and the before/after sheets.
from PIL import Image, ImageDraw, ImageFont
import shutil
W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3/shots/hcc-r4"
NAMES = {
    "l3-presets": "1-presets-sequence-l3", "l2-presets": "1-presets-sequence-l2",
    "l3-edit-before": "2-edit-BEFORE-progress-shown", "l3-edit": "2-edit-AFTER-progress-hidden",
    "l3-edit-next": "3-edit-next-stack-ghost", "l3-edit-ten": "4-edit-ten-stacks", "l2-building": "5-building-one-l2",
    "l3-sent": "6-sent-partial", "l3-sent-locked": "7-sent-locked-skipped", "l3-remote-presets": "8-outpost-presets", "l3-remote-edit": "9-outpost-edit",
}
for job, name in NAMES.items():
    shutil.copy(f"{W}/work/{job}-modern-390x844.png", f"{W}/phone-{name}-modern-390x844.png")
    shutil.copy(f"{W}/work/{job}-modern-1280x720.png", f"{W}/desktop-{name}-modern-1280x720.png")
    d = Image.open(f"{W}/work/{job}-modern-1280x720.png").crop((30, 100, 1250, 712))
    d.resize((d.width * 2, d.height * 2), Image.LANCZOS).save(f"{W}/desktop-2x-window-{name}-modern.png")
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
def sheet(out, parts, gap=40, head=90):
    ims = [Image.open(p) for p, _ in parts]
    w = sum(i.width for i in ims) + gap * (len(ims) + 1); h = max(i.height for i in ims) + head + gap
    s = Image.new("RGB", (w, h), (20, 24, 30)); d = ImageDraw.Draw(s); x = gap
    for im, (_, words) in zip(ims, parts):
        d.text((x, 22), words, font=font, fill=(255, 255, 255)); s.paste(im, (x, head)); x += im.width + gap
    s.save(out)
sheet(f"{W}/compare-phone-edit-before-after.png", [(f"{W}/work/l3-edit-before-modern-390x844.png", "Before: progress shown"), (f"{W}/work/l3-edit-modern-390x844.png", "After: only the preset")])
for n in ("2-edit-BEFORE-progress-shown", "2-edit-AFTER-progress-hidden"):
    pass
a = Image.open(f"{W}/work/l3-edit-before-modern-1280x720.png"); b = Image.open(f"{W}/work/l3-edit-modern-1280x720.png")
s = Image.new("RGB", (1280 + 80, 720 * 2 + 90 * 2 + 40), (20, 24, 30)); d = ImageDraw.Draw(s)
d.text((40, 22), "Before: progress shown", font=font, fill=(255, 255, 255)); s.paste(a, (40, 90))
d.text((40, 90 + 720 + 22), "After: only the preset", font=font, fill=(255, 255, 255)); s.paste(b, (40, 180 + 720))
s.save(f"{W}/compare-desktop-edit-before-after.png")
