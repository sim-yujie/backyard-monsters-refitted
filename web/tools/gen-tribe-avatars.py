"""
Generate refreshed wild-monster tribe avatars with Gemini's image model.

Usage (from the repo root):

    pip install google-genai pillow
    set GEMINI_API_KEY=...          (PowerShell: $env:GEMINI_API_KEY="...")
    python web/tools/gen-tribe-avatars.py [--model MODEL] [--variants N] [--tribe NAME]

Each tribe's original avatar (server/public/assets/popups/tribe_<name>.v2.png)
is sent as a reference image together with a prompt describing the refresh, so
the result keeps the creature's identity and silhouette while updating the
rendering. Output goes to web/public/tribes/<name>-<variant>.png. The art direction
(2D cel-shaded, chosen 2026-09-23) is fixed in STYLE below; keep new assets
consistent with it. The published 256 px files are derived from the 1024 px
sources kept in docs/art/tribes/.

The model name is an argument because Google renames image models often; the
default is the current general-purpose image model at the time of writing. If
it 404s, run `python -c "from google import genai; ..."` or check
https://ai.google.dev/gemini-api/docs/image-generation for the current id.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path

try:
    from google import genai
    from google.genai import types
    from PIL import Image
except ImportError as exc:  # pragma: no cover
    sys.exit(f"missing dependency: {exc}. Run: pip install google-genai pillow")

REPO = Path(__file__).resolve().parents[2]
REFERENCE_DIR = REPO / "server" / "public" / "assets" / "popups"
OUT_DIR = REPO / "web" / "public" / "tribes"

# What each tribe is, from the original art, so the refresh keeps the identity.
TRIBES: dict[str, str] = {
    "legionnaire": (
        "a stocky armoured warrior beast in ornate bronze samurai-style plate "
        "armour with a horned helmet, holding a heavy rifle-like weapon, "
        "disciplined and military"
    ),
    "kozu": (
        "a hooded purple-robed sorcerer creature with a glowing red mystical "
        "orb in its chest, tentacle-like green appendages emerging from under "
        "the robe, clawed green hands raised, mysterious and arcane"
    ),
    "abunakki": (
        "a hulking savage brown ogre-like brute with a wide fanged grin, "
        "wielding a bone battle-axe, standing on a pile of bones, feral and "
        "brutal"
    ),
    "dreadnaut": (
        "a teal armoured crustacean-like monster with red glowing eyes, "
        "mechanical claw arms and a curved blade weapon, heavily plated, "
        "menacing and cold"
    ),
}

STYLE = (
    "Redesign this character for a modern browser strategy game as a 2D "
    "cel-shaded illustration in the style of Brawl Stars 2D promo art or Hades "
    "character portraits. Keep the character's identity: species, pose, key "
    "equipment and colour scheme. Bold clean dark outlines of varying weight, "
    "flat colour zones with two-tone shading and one crisp highlight, strong "
    "graphic silhouette, slightly angular stylisation, vivid but controlled "
    "palette, minimal gradients. No painterly blending, no 3D render look, no "
    "gritty texture. Square composition, character centred with at least 8% "
    "empty margin on every side and the weapon fully inside the frame, plain "
    "fully transparent background, no text, no logo, no border, no ground "
    "shadow."
)


def load_reference(tribe: str) -> Image.Image:
    for name in (f"tribe_{tribe}.v2.png", f"tribe_{tribe}.png"):
        path = REFERENCE_DIR / name
        if path.exists():
            return Image.open(path).convert("RGBA")
    sys.exit(f"no reference image for {tribe} in {REFERENCE_DIR}")


def generate(client: genai.Client, model: str, tribe: str, variants: int) -> list[Path]:
    reference = load_reference(tribe)
    prompt = f"{STYLE}\n\nThe character: {TRIBES[tribe]}. This is the '{tribe.title()}' tribe."
    written: list[Path] = []

    for variant in range(1, variants + 1):
        response = client.models.generate_content(
            model=model,
            contents=[prompt, reference],
            config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
        )

        image_bytes = None
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                image_bytes = part.inline_data.data
                break
        if image_bytes is None:
            print(f"[{tribe} #{variant}] no image in response; text was: "
                  f"{getattr(response, 'text', '')[:200]!r}")
            continue

        image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        # Normalise to 512 px square for the atlas; keep aspect by padding.
        size = 512
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        image.thumbnail((size, size))
        canvas.paste(image, ((size - image.width) // 2, (size - image.height) // 2), image)

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out = OUT_DIR / f"{tribe}-{variant}.png"
        canvas.save(out)
        written.append(out)
        print(f"[{tribe} #{variant}] wrote {out.relative_to(REPO)}")

    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="gemini-2.5-flash-image", help="Gemini image model id")
    parser.add_argument("--variants", type=int, default=2, help="images per tribe")
    parser.add_argument("--tribe", choices=sorted(TRIBES), help="only this tribe")
    args = parser.parse_args()

    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        sys.exit("set GEMINI_API_KEY (from https://aistudio.google.com/apikey) and re-run")

    client = genai.Client(api_key=key)
    tribes = [args.tribe] if args.tribe else sorted(TRIBES)
    total = 0
    for tribe in tribes:
        total += len(generate(client, args.model, tribe, args.variants))
    print(f"done: {total} image(s) in {OUT_DIR.relative_to(REPO)}")


if __name__ == "__main__":
    main()
