"""Build refs/style.png, the style reference every batch is painted from.

Needs in art-samples/icons/refs/: the eight approved resource piles (resource<name>.png, from branch
feat/resource-icons, server/public/assets/popups), the status stickers (*.webp, from web/public/status-icons)
and the worker (worker.v1.png, from server/public/assets/archived).
"""
from PIL import Image

from icons import OUT, STYLE

refs = OUT / "refs"
order = ["twigs", "pebbles", "putty", "goo", "bone", "coal", "sulfur", "magma"]
c = Image.new("RGBA", (4 * 260 + 20, 2 * 140 + 2 * 130 + 20), (205, 205, 205, 255))
for i, n in enumerate(order):
    c.alpha_composite(Image.open(refs / f"resource{n}.png").convert("RGBA"), (10 + (i % 4) * 260, 10 + (i // 4) * 140))
for i, f in enumerate(sorted(refs.glob("*.webp"))):
    c.alpha_composite(Image.open(f).convert("RGBA").resize((120, 120), Image.LANCZOS), (10 + i * 130, 300))
c.alpha_composite(Image.open(refs / "worker.v1.png").convert("RGBA"), (10 + 4 * 260 - 160, 430))
c.convert("RGB").save(STYLE)
print("style.png", c.size)
