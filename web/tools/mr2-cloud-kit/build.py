#!/usr/bin/env python3
"""Build Map Room 2's far-zoom cloud art (look plan step 9) from the Codex pictures.

Each folder here (deck, banks) holds prompt.txt and the picture Codex painted from it, art.png
(`bash run.sh <folder>`; the game's own clouds are attached with -i so the style matches).
`--take` copies each art.png into source/ as a quality-95 webp (committed); the build reads source/.

- deck: a seamless square of solid, sunlit cumulus seen from above (Civ V's unexplored clouds were the
  owner's reference, 3 Nov), the painted fog (`painted/cloudShader.ts`). Graded on the way (`grade`):
  the shade in the creases is turned from Codex's sky blue towards a cool neutral grey.
    web/public/maproom/painted/cloud-deck@4x.webp   1024 px (Quality High)
    web/public/maproom/painted/cloud-deck@2x.webp   512 px (Medium)
    web/public/maproom/painted/cloud-deck.webp      256 px (Low)
- banks: four long cloud banks painted on black, cut out (alpha from brightness, like mr2-live's
  clouds) into a sheet of two rows, two banks a row, 192 px tall, for the edge of sight (High only, like `clouds.webp`):
    web/public/maproom/live/cloud-banks.webp
  NOT used in the game for now (the painted fog's own bank was enough, and mr2-live's frame of banks is
  off over the painted ground), so it is only built with --banks.

  python web/tools/mr2-cloud-kit/build.py [--take] [--banks]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

KIT = Path(__file__).resolve().parent
SOURCE = KIT / "source"
PAINTED = KIT.parents[1] / "public" / "maproom" / "painted"
LIVE = KIT.parents[1] / "public" / "maproom" / "live"
BANK_HEIGHT = 192


def take() -> None:
    SOURCE.mkdir(exist_ok=True)
    for name in ("deck", "banks"):
        art = KIT / name / "art.png"
        if art.exists():
            Image.open(art).convert("RGB").save(SOURCE / f"{name}.webp", quality=95, method=6)
            print("took", name)


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(SOURCE / f"{name}.webp").convert("RGB")).astype(np.float32) / 255.0


def black_to_alpha(rgb: np.ndarray, floor: float = 0.04, gain: float = 1.0) -> np.ndarray:
    """A picture painted on black: alpha from brightness, colour un-premultiplied."""
    alpha = np.clip((rgb.max(axis=2) - floor) / (1 - floor) * gain, 0, 1)
    colour = np.where(alpha[..., None] > 1e-3, np.clip(rgb / np.maximum(alpha[..., None], 1e-3), 0, 1), 0)
    return np.dstack([colour, alpha])


def crop_islands(rgba: np.ndarray, count: int, pad: int = 12) -> list[np.ndarray]:
    """The `count` biggest separate shapes (by alpha), top to bottom, each cropped with a margin."""
    mask = rgba[..., 3] > 0.05
    labels, n = ndimage.label(ndimage.binary_dilation(mask, iterations=6))
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    keep = np.argsort(sizes)[::-1][:count] + 1
    boxes = [ndimage.find_objects((labels == k).astype(int))[0] for k in keep]
    boxes.sort(key=lambda b: b[0].start)
    out = []
    for ys, xs in boxes:
        y0, y1 = max(ys.start - pad, 0), min(ys.stop + pad, rgba.shape[0])
        x0, x1 = max(xs.start - pad, 0), min(xs.stop + pad, rgba.shape[1])
        out.append(rgba[y0:y1, x0:x1])
    return out


def pack_grid(parts: list[np.ndarray], height: int) -> tuple[np.ndarray, list[tuple[int, int, int, int]]]:
    """Two banks a row, each `height` tall; returns the sheet and each bank's x, y, width, height."""
    scaled = []
    for part in parts:
        image = Image.fromarray((np.clip(part, 0, 1) * 255).astype(np.uint8), "RGBA")
        width = round(image.width * height / image.height)
        scaled.append(np.asarray(image.resize((width, height), Image.LANCZOS)).astype(np.float32) / 255)
    rows = [scaled[i:i + 2] for i in range(0, len(scaled), 2)]
    sheet_width = max(sum(p.shape[1] for p in row) for row in rows)
    sheet = np.zeros((height * len(rows), sheet_width, 4), np.float32)
    frames = []
    for r, row in enumerate(rows):
        x = 0
        for part in row:
            sheet[r * height:(r + 1) * height, x:x + part.shape[1]] = part
            frames.append((x, r * height, part.shape[1], height))
            x += part.shape[1]
    return sheet, frames


# The deck's shade: this share of each pixel's colour away from its own grey is kept (Codex paints
# the creases a strong sky blue; Civ-like cloud shade is a cool, nearly neutral grey), and the grey
# is tinted this cool.
DECK_SATURATION = 0.55
DECK_COOL = np.array([0.97, 0.99, 1.04], np.float32)


def grade(rgb: np.ndarray) -> np.ndarray:
    """Calms the deck's blue shade to a cool grey, keeping its light and dark."""
    luma = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    grey = luma[..., None] * DECK_COOL
    return np.clip(grey + (rgb - luma[..., None]) * DECK_SATURATION, 0, 1)


def main() -> None:
    graded = grade(np.asarray(Image.open(SOURCE / "deck.webp").convert("RGB")).astype(np.float32) / 255)
    deck = Image.fromarray((graded * 255 + 0.5).astype(np.uint8), "RGB")
    print("deck average colour", np.round(graded.mean(axis=(0, 1)), 3))
    PAINTED.mkdir(parents=True, exist_ok=True)
    for suffix, size in (("@4x", 1024), ("@2x", 512), ("", 256)):
        path = PAINTED / f"cloud-deck{suffix}.webp"
        deck.resize((size, size), Image.LANCZOS).save(path, quality=86, method=6)
        print(path.name, size, path.stat().st_size // 1024, "KB")

    if "--banks" not in sys.argv:
        return
    banks = crop_islands(black_to_alpha(load("banks"), floor=0.03, gain=1.15), 4)
    sheet, frames = pack_grid(banks, BANK_HEIGHT)
    path = LIVE / "cloud-banks.webp"
    Image.fromarray((np.clip(sheet, 0, 1) * 255).astype(np.uint8), "RGBA").save(
        path, "WEBP", quality=84, alpha_quality=85, method=6)
    print(path.name, sheet.shape[1], "x", sheet.shape[0], path.stat().st_size // 1024, "KB")
    print("bank frames (x, y, width, height) for live/liveArt.ts BANK_FRAMES:", frames)


if __name__ == "__main__":
    if "--take" in sys.argv:
        take()
    main()
