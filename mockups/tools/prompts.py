"""Write prompt.txt + inputs.txt for each style's two Codex jobs (frame, kit).
usage: python prompts.py  -> mockups/gen/<style>/<job>/{prompt.txt,inputs.txt}
"""
import os

M = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFS = os.path.join(M, "refs").replace("\\", "/")

COMMON = """It is for the browser game Backyard Monsters (cartoony, colourful monster world; the old Flash game had chunky painted interface art). Painting finish: the same hand-painted, slightly glossy cartoon game-art finish as the game's painted icons and monsters in finish.png (bold shapes, soft shading, light from the upper left, a crisp dark outline round each piece). Everything is seen straight on, flat, front view (no perspective, no tilt).

Background everywhere: flat pure green #00FF00, no shadow on the background. The painting itself must contain no bright pure green. No text, no letters, no numbers, no symbols except where asked, no icons on the pieces."""

FRAME = """Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint ONE empty game WINDOW (a pop-up panel for the game's interface), as a SQUARE image 1024x1024. The window fills the image, with about 40 px of green all round it.

{look}

Inputs: {inputs_text}

Rules for the window, because it will be cut into a 9-slice and stretched to any size:
- Each of the four border sides looks the same all along its length (a pattern that can repeat), so a middle piece of each side can be repeated.
- The four corners may carry bigger decoration, but keep each corner's decoration inside about 170 px from the corner.
- The middle of the window is a plain, quiet fill with no objects, no pictures and no decoration, so text and icons can sit on it. The fill must look the same everywhere in the middle (no vignette, no big light spot).
- The window's outside edge is crisp against the green; nothing sticks out more than about 30 px past the border.

""" + COMMON

KIT = """Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint a SHEET of separate game INTERFACE PIECES, as a LANDSCAPE image 1536x1024. All pieces belong to the same style as the window in the first input (same materials, colours, outline and painting finish).

{look}

Inputs: {inputs_text}

Lay the pieces out in three rows, with wide green gaps between all pieces (at least 50 px; no piece touches another or the image edge). All pieces are EMPTY: no words on them.
Row 1 (top): (1) a wide TITLE BANNER for the window's name, about 760 px wide and 150 px tall, with a long plain middle where a title will be written; (2) a round CLOSE button, about 140 px across, showing a big X.
Row 2: (3) the BIG MAIN BUTTON, normal, about 430 px wide and 140 px tall, with a plain face where a word will go; (4) the SAME big button PRESSED (pushed in: a little darker, its raised edge and bottom shadow gone, the face lower); (5) a SMALL BUTTON, about 230 px wide and 100 px tall, the same kind of button but in a calmer second colour.
Row 3 (bottom): (6) a TAB, SELECTED (about 280 px wide, 120 px tall, rounded top corners, straight flat bottom edge, bright); (7) the SAME tab NOT SELECTED (duller and darker, same shape); (8) a RESOURCE CHIP: a pill-shaped holder about 360 px wide and 95 px tall, for a small icon on its left end and a number, with a plain dark middle.

""" + COMMON

STYLES = {
    "flash": {
        "refs": ["flash.png"],
        "refs_text": "flash.png shows the OLD Flash game's own interface art: a tan parchment window with carved bone corners, a plain cream pop-up, the red 'NEW!' ribbon, round red close button, wooden YES/NO buttons and a yellow note. Use it only as loose inspiration for the style; redraw everything new, crisp and richer.",
        "look": """Style "Flash refreshed": the old Flash game's light pop-ups, redrawn crisp and richer. The window is a warm CREAM PARCHMENT panel (light cream, faint paper grain) with gently rounded corners, a THICK dark chocolate-brown outline (about 16 px), and just inside it a lighter tan bevel band with a thin line, like a picture-frame edge. In each corner a small carved, slightly yellowed BONE ornament (curled bone with a leather strap) wraps over the border, as on the old game's frame. Fill: smooth light cream parchment.
Title banner: a red cloth RIBBON with folded swallow-tail ends and a darker red underside, as the old game's 'NEW!' ribbon. Big main button: a chunky glossy ORANGE-YELLOW pill-shaped rounded rectangle (yellow top fading to orange at the bottom), thick dark brown outline, white shine on top, a darker orange raised bottom edge. Small button: the same shape in glossy GREEN. Close button: a round glossy RED button with a white X and a dark outline. Tabs: cream parchment with the dark brown outline (selected), tan / khaki darker (not selected). Resource chip: a dark chocolate-brown pill with a lighter brown bevel edge.""",
    },
    "wood": {
        "refs": ["wood.png"],
        "refs_text": "wood.png shows the OLD Flash game's wooden art: plank textures, plank strips, a small wooden arrow sign and wooden YES/NO buttons. Use it only as loose inspiration; redraw everything new, crisp and richer.",
        "look": """Style "Junkyard wood": a backyard fort built from scrap lumber. The window's border is four THICK weathered WOODEN PLANKS (warm honey-brown wood, painted grain, knots, slightly chipped ends), overlapping at the corners and fixed with big round-headed IRON NAILS and a few bolts; a dark brown outline round everything. Fill: darker, quiet inset WOODEN BOARDS running sideways (dark walnut brown, low contrast, thin dark seams between boards) so light text reads on it.
Title banner: a wide wooden SIGN BOARD (lighter pine plank, nailed at each end, a little crooked-cut ends). Big main button: a chunky wooden board button with a bright YELLOW painted face (paint slightly chipped at the corners showing wood), nails at both ends, dark outline. Small button: the same kind of painted board with a GREEN painted face. Close button: a round wooden disc (end of a log, with rings) with a RED painted X. Tabs: a wooden plank tab, light pine (selected), dark weathered wood (not selected). Resource chip: a small dark wooden plank pill with a nail at each end.""",
    },
    "scrap": {
        "refs": ["scrap.png"],
        "refs_text": "scrap.png shows the OLD Flash game's own frame: rusty iron straps with rivets and toothy clamps, lashed BONES at the corners, a red close button and grey stone/metal plates. Use it only as loose inspiration; redraw everything new, crisp and richer.",
        "look": """Style "Scrap metal and bone": a monster-made junk window, after the old Flash game's bone-and-rust frame. The window's border is RUSTY IRON STRAPS (rust-orange and brown, with big round RIVETS spaced evenly), and at each corner a short BONE lashed on with leather cord, with a small toothy metal clamp; dark outline round everything. Fill: a dented, dull blue-grey STEEL sheet with faint scratches and a few tiny rivets only near its edge, quiet in the middle so light text reads on it.
Title banner: a riveted TIN SIGN plate painted mustard-yellow, with rusty dented edges and a rivet in each corner. Big main button: a chunky riveted steel plate button painted bright SAFETY ORANGE, slightly worn paint, a rivet at each end, dark outline. Small button: the same kind of plate in plain bare steel grey. Close button: a round riveted steel bolt-head disc with a RED X painted on it. Tabs: a steel plate tab with rivets, bright clean steel (selected), dark rusted steel (not selected). Resource chip: a dark gunmetal pill with a rivet at each end.""",
    },
    "cardboard": {
        "refs": [],
        "refs_text": "",
        "look": """Style "Cardboard and stickers": a kid's backyard craft look. The window is a cut piece of corrugated CARDBOARD (warm kraft brown, slightly rough cut edges showing the wavy corrugation on the rim), with a thick dark brown outline, and a strip of beige MASKING TAPE stuck diagonally across each corner. Fill: flat light kraft cardboard with faint fibres, quiet (dark text will sit on it).
Title banner: a strip of bright RED DUCT TAPE with torn zig-zag ends and a slight shine. Big main button: a fat glossy vinyl STICKER button in bright LIME GREEN with a thick WHITE die-cut sticker border and a dark outline round the white border, a soft shine on top. Small button: the same sticker style in bright SKY BLUE. Close button: a round glossy RED sticker with a white X and a white die-cut border. Tabs: cardboard tab with a bit of masking tape, light kraft (selected), darker brown cardboard (not selected). Resource chip: a dark brown cardboard pill with a white sticker border.""",
    },
}


def write(style, job):
    s = STYLES[style]
    d = os.path.join(M, "gen", style, job)
    os.makedirs(d, exist_ok=True)
    inputs = [f"{REFS}/{r}" for r in s["refs"]] + [f"{REFS}/finish.png"]
    texts = []
    if s["refs_text"]:
        texts.append(s["refs_text"])
    texts.append("finish.png shows today's painted game art (monsters and icons): match its painting finish, not its subjects.")
    if job == "kit":
        win = os.path.join(M, "gen", style, "frame", "first.png")
        if not os.path.exists(win):
            win = os.path.join(M, "gen", style, "frame", "sample-new.png")
        if os.path.exists(win):
            inputs.insert(0, win.replace("\\", "/"))
            texts.insert(0, "The first input is the approved WINDOW of this style (it may also show some of the pieces already: paint those the same way): match it exactly in materials, colours and finish.")
    if job == "frame":
        look = s["look"].split("\n", 1)[0] + "\nPaint ONLY the window: no buttons, no banner, no tabs, no close button, nothing inside it or on it."
        text = FRAME.format(look=look, inputs_text=" ".join(texts))
    else:
        text = KIT.format(look=s["look"], inputs_text=" ".join(texts))
    open(os.path.join(d, "prompt.txt"), "w", encoding="utf-8").write(text)
    open(os.path.join(d, "inputs.txt"), "w").write("\n".join(inputs))
    print("dir", d.replace("\\", "/"))


if __name__ == "__main__":
    import sys
    write(sys.argv[1], sys.argv[2])
