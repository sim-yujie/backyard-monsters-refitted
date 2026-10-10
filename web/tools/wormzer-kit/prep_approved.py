"""Builds approved.png (the approved Codex sample with its two side views mirrored so heading 0 faces right) and portrait-big.png."""
from pathlib import Path
from PIL import Image

KIT = Path("D:/Coding/BYMR/art-trials/wormzer-c13")
im = Image.open(KIT / "codex" / "frames-new.png").convert("RGB")
w, h = im.size
out = im.copy()
for q in (0, 2):  # top-left and bottom-left were painted facing left; flip so heading 0 faces right and 180 faces left
    box = ((q % 2) * w // 2, (q // 2) * h // 2, (q % 2 + 1) * w // 2, (q // 2 + 1) * h // 2)
    out.paste(im.crop(box).transpose(Image.FLIP_LEFT_RIGHT), box)
out.save(KIT / "approved.png")
p = Image.open(KIT / "codex" / "portrait.png").convert("RGB")
p.resize((p.width * 3, p.height * 3), Image.LANCZOS).save(KIT / "portrait-big.png")
