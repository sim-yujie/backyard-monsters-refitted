"""Builds the living map's painted art (MR2 part 1) from Codex's pictures.

Each folder here (water, foam, clouds, bird) holds prompt.txt and the
picture Codex painted from it, art.png (run.sh <folder>). This script cuts them
into the small files the game loads, in web/public/maproom/live/:

- water-glints@2x.webp / water-glints.webp: the sea's highlights, a seamless
  tile, white with the shape in alpha (the shader colours it) (High 512 px, Medium 256 px).
- foam@2x.webp / foam.webp: shore foam, the same way (256 and 128 px: it is only ever a thin band).
- clouds.webp: three clouds side by side (High only; Medium has no clouds).
- bird.webp: one gull from above (High only).

Low draws no animation, so it downloads none of these.

Run: python web/tools/mr2-live-kit/build.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

KIT = Path(__file__).resolve().parent
OUT = KIT.parents[1] / "public" / "maproom" / "live"


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(KIT / name / "art.png").convert("RGB")).astype(np.float32) / 255.0


def black_to_alpha(rgb: np.ndarray, floor: float = 0.04, gain: float = 1.0) -> np.ndarray:
    """A picture painted on black: alpha from brightness, colour un-premultiplied."""
    alpha = np.clip((rgb.max(axis=2) - floor) / (1 - floor) * gain, 0, 1)
    colour = np.where(alpha[..., None] > 1e-3, np.clip(rgb / np.maximum(alpha[..., None], 1e-3), 0, 1), 0)
    return np.dstack([colour, alpha])


def alpha_only(rgba: np.ndarray) -> np.ndarray:
    """White with the picture's alpha: the shader colours it, and a flat colour packs far smaller."""
    out = rgba.copy()
    out[..., :3] = 1.0
    return out


def seamless(rgba: np.ndarray) -> np.ndarray:
    """Blends a tile with its half-shifted self so its edges wrap without a seam."""
    h, w = rgba.shape[:2]
    shifted = np.roll(rgba, (h // 2, w // 2), axis=(0, 1))
    ys = np.abs(np.linspace(-1, 1, h))[:, None]
    xs = np.abs(np.linspace(-1, 1, w))[None, :]
    edge = np.maximum(ys, xs)
    m = np.clip((edge - 0.55) / 0.4, 0, 1)[..., None]
    return rgba * (1 - m) + shifted * m


def save(rgba: np.ndarray, name: str, size: tuple[int, int]) -> None:
    image = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").resize(size, Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    image.save(OUT / name, "WEBP", quality=88, method=6)
    print(name, size, (OUT / name).stat().st_size // 1024, "KB")


def crop_islands(rgba: np.ndarray, count: int, pad: int = 12) -> list[np.ndarray]:
    """The `count` biggest separate shapes (by alpha), left to right, each cropped with a margin."""
    from scipy import ndimage

    mask = rgba[..., 3] > 0.05
    labels, n = ndimage.label(ndimage.binary_dilation(mask, iterations=6))
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    keep = np.argsort(sizes)[::-1][:count] + 1
    boxes = [ndimage.find_objects((labels == k).astype(int))[0] for k in keep]
    boxes.sort(key=lambda b: b[1].start)
    out = []
    for ys, xs in boxes:
        y0, y1 = max(ys.start - pad, 0), min(ys.stop + pad, rgba.shape[0])
        x0, x1 = max(xs.start - pad, 0), min(xs.stop + pad, rgba.shape[1])
        out.append(rgba[y0:y1, x0:x1])
    return out


def pack_row(parts: list[np.ndarray], height: int) -> np.ndarray:
    scaled = []
    for part in parts:
        image = Image.fromarray((part * 255).astype(np.uint8), "RGBA")
        width = round(image.width * height / image.height)
        scaled.append(np.asarray(image.resize((width, height), Image.LANCZOS)).astype(np.float32) / 255)
    return np.concatenate(scaled, axis=1)


def main() -> None:
    water = alpha_only(seamless(black_to_alpha(load("water"), floor=0.06, gain=1.2)))
    save(water, "water-glints@2x.webp", (512, 512))
    save(water, "water-glints.webp", (256, 256))

    foam = alpha_only(seamless(black_to_alpha(load("foam"), floor=0.05)))
    save(foam, "foam@2x.webp", (256, 256))
    save(foam, "foam.webp", (128, 128))

    # Three clouds, each 256 tall, side by side; the game reads them as thirds of the sheet's width
    # only roughly, so it keeps their widths in CLOUD_FRAMES (live/liveArt.ts).
    clouds = crop_islands(black_to_alpha(load("clouds"), floor=0.03, gain=1.15), 3)
    row = pack_row(clouds, 256)
    save(row, "clouds.webp", (row.shape[1], row.shape[0]))
    widths = [round(c.shape[1] * 256 / c.shape[0]) for c in clouds]
    print("cloud widths", widths)

    bird_rgb = load("bird")
    green = (bird_rgb[..., 1] - np.maximum(bird_rgb[..., 0], bird_rgb[..., 2]))
    alpha = np.clip(1 - (green - 0.15) / 0.35, 0, 1)
    # Pull the green spill out of the soft edge.
    rgb = bird_rgb.copy()
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]))
    bird = np.dstack([rgb, alpha])
    ys, xs = np.nonzero(alpha > 0.05)
    bird = bird[max(ys.min() - 8, 0) : ys.max() + 8, max(xs.min() - 8, 0) : xs.max() + 8]
    height = round(128 * bird.shape[0] / bird.shape[1])
    save(bird, "bird.webp", (128, height))


if __name__ == "__main__":
    main()
