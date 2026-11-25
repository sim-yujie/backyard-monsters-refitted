"""Owner set: python3 final.py <shotdir> <finaldir>. Full screens (desktop 1280x720, phone 390x844@3x; Modern, Classic) + 2x crops."""
import sys, os, shutil
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
crops = {  # per question: (desktop box at 1x, phone box in CSS px)
    "q1": ((330, 170, 930, 520), (0, 300, 390, 700)),
    "q2": ((880, 64, 1280, 660), (0, 330, 390, 844)),
    "q3": ((0, 0, 1280, 140), (0, 0, 390, 220)),
}
rows = {"q1": ["few", "busy"], "q2": ["taken", "attack"], "q3": ["down", "live"]}
for q, names in rows.items():
    os.makedirs(f"{out}/{q}", exist_ok=True)
    for o in "ABC":
        for n in names:
            for tag, phone in (("1280x720-modern", 0), ("1280x720-classic", 0), ("390x844-modern", 1), ("390x844-classic", 1)):
                p = f"{src}/{q}-{o}-{n}-{tag}.png"
                if not os.path.exists(p):
                    continue
                shutil.copy(p, f"{out}/{q}/{q}-{o}-{n}-{tag}.png")
                im = Image.open(p)
                box = crops[q][phone]
                if phone:
                    box = tuple(v * 3 for v in box)
                    c = im.crop(box)  # already 3x
                    c = c.resize((c.width * 2 // 3, c.height * 2 // 3))
                else:
                    c = im.crop(box)
                    c = c.resize((c.width * 2, c.height * 2), Image.LANCZOS)
                c.save(f"{out}/{q}/{q}-{o}-{n}-{tag}-crop2x.png")
print("done")
