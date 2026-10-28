"""Korath sheet layouts (monsterSpriteData.ts G4_1-G4_6), part checklists and colour note, plus cell helpers."""
from pathlib import Path
from PIL import Image

KIT = Path("D:/Coding/BYMR/art-trials/champions/_kit")
GORGO = Path("D:/Coding/BYMR/worktrees/korath-art/server/public/assets/monsters")
# level: (fw, fh, walk count, walk row used for the sample). Walk starts at row 0 (= idle), attack follows the walk;
# levels 5 and 6 also have a 10-row stomp after the attack.
KL = {1: (72, 49, 8, 4), 2: (119, 81, 8, 4), 3: (128, 102, 9, 3), 4: (153, 123, 10, 5), 5: (199, 162, 10, 5), 6: (202, 167, 10, 5)}
APE = {1: (96, 69), 2: (89, 73), 3: (103, 88), 4: (148, 127), 5: (160, 137), 6: (140, 120)}

KCOLOUR = ("charcoal-black and dark brown volcanic rock plates, split by a network of glowing molten-lava cracks "
           "(bright yellow in the middle of each crack, orange to red at the edges); glowing yellow-orange eyes and mouth; "
           "armour, where present, is bright silver-grey steel as in the Flash sprite (light silver highlights, darker steel-grey shading, a few rivets). NOT bright pink, NOT blue.")

_ROCK = ("body made of rounded dark volcanic rock plates with glowing yellow-orange lava cracks between every plate")
_APE = (_ROCK + ", hunched gorilla-like stance, massive rounded shoulders and back, small head low between the shoulders, "
        "two glowing yellow eyes under a heavy brow, a wide jagged glowing mouth full of lava light, two very thick long front arms "
        "ending in big rock fists (knuckles on the ground), two short thick hind legs with rock feet")
KPARTS = {
    1: ("a small, low, molten lava blob (a slug-like lump, no arms and no legs): a rounded lumpy dome of dark cooled rock plates on top, "
        "separated by wide glowing yellow-orange lava seams, a smooth glossy molten yellow-orange underside that spreads out at the base into "
        "a few short stubby nubs, and when it crawls the molten body stretches out into a flowing tail behind it. A small, faint face at the "
        "front like the portrait (two small glowing eyes and a jagged glowing mouth), only if the facing shows it. NO limbs, NO armour."),
    2: ("a crawling lava beast, bigger than level 1: a long low molten body made of dark red-brown rock with many thin bright yellow "
        "lava cracks, a heavy rounded head/shoulder hump at the front, two thick stubby front arms ending in round dark rock fists, "
        "and the back half tapering into a flowing molten tail that drags on the ground (no hind legs visible). Face like the portrait "
        "(glowing eyes and a jagged glowing mouth) where the facing shows it. NO armour."),
    3: _APE + ". NO armour at this level.",
    4: _APE + (", PLUS ARMOUR: two curved dark steel bands arching over the shoulders and down the back (like a harness), "
               "and wide dark steel cuffs around both wrists. No spikes yet."),
    5: _APE + (", PLUS heavier ARMOUR: dark steel shoulder harness bands with rows of short pointed steel spikes/blades sticking up "
               "along the back and shoulders, a pointed rock crest on top of the head, and big chunky dark steel cuffs on both wrists."),
    6: _APE + (", the biggest Korath, PLUS full ARMOUR: dark steel harness over the shoulders with LONG curved steel blade-spikes fanning up "
               "from the back and shoulders, a pointed rock crest on the head, and huge spiked steel cuffs (spiked mace rings with "
               "pointed studs all round) on both wrists."),
}


def cell(lvl, col, row):
    fw, fh = KL[lvl][:2]
    im = Image.open(KIT / "sheets" / f"korath_{lvl}.png").convert("RGBA")
    return im.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))


def gorgo_cell(lvl, col, row):
    """A cell of the approved Gorgo repaint of this level, at 4x."""
    fw, fh = APE[lvl]
    im = Image.open(GORGO / f"ape_{lvl}-repaint@4x.png").convert("RGBA")
    return im.crop((col * fw * 4, row * fh * 4, (col + 1) * fw * 4, (row + 1) * fh * 4))


def on(bg, im):
    b = Image.new("RGBA", im.size, bg + (255,)); b.alpha_composite(im); return b.convert("RGB")
