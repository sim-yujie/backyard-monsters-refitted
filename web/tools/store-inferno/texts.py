"""The words of the Codex prompts: what the store is (keep it), the camera, the finish, and each variant's palette."""

STORE = ("the GENERAL STORE of Backyard Monsters: a giant MATCHBOOK standing on the ground like a small kiosk, as "
         "input 1 shows it: a boxy cover, its front face toward the lower left and its side face toward the lower "
         "right; on the front face a printed label reading MATCH BOOK in chunky pale letters on two lines, with a "
         "rounded triangular emblem (like a guitar pick, with a small dark hole and a thin string) above the words; on "
         "the side face two columns of three round spots, like dice spots; on top, a sloping roof of four long flat "
         "rounded strips side by side (paper matches lying across the box), held along the ridge by a folded metal "
         "STRIP with a row of small dark holes, and a crumpled tuft of torn paper sticking up behind it at the back; "
         "four thin LEGS with round flat foot pads lifting the box a little off the ground, one under each corner. "
         "Keep exactly this shape, these parts, their sizes and places, and the same camera")

CAMERA = ("CAMERA: the isometric 3/4 view of input 1, seen from the front and above at about 35 degrees, NOT a straight "
          "side view and NOT mirrored. Every part where input 1 has it.")

FINISH = ("FINISH: the finish of input 1 and input 2 (the Modern look of the same game: clean stylised 3D renders): "
          "crisp, clean, smooth shading, small bevels catching the light, warm key light from the upper left, right-hand "
          "faces in medium shade (readable, not black), soft ambient occlusion in the creases, clean sharp edges, no "
          "thick black outline, no cel shading, no painterly brush strokes, no pixel art. Not neon, not over-saturated.")

# Each variant keeps the shape and changes only the colours and materials, toward input 2's Inferno buildings.
VARIANTS = {
    "A": ("CHARRED EMBER: the cover a deep scorched oxblood red, darkening to sooty black at its edges and corners as "
          "if singed; the label's letters a pale ash white, the emblem a glowing ember orange; the dice spots dark with "
          "a faint orange glow deep inside; the four roof strips (the matches) charcoal grey, glowing ember orange at their "
          "ends like smouldering match heads (a soft glow, no flames), the ridge strip blackened iron, the paper tuft ash grey; the legs and foot pads dark blackened iron with warm highlights."),
    "B": ("OBSIDIAN AND LAVA: the cover glossy black volcanic glass (obsidian) with thin cracks of molten orange lava "
          "glowing through it along the edges; the label's letters hot lava orange-yellow, the emblem a glowing yellow "
          "coal; the dice spots glowing molten orange; the four roof strips pale bone ivory, the ridge strip brass, the paper tuft dark ember red; the legs "
          "and foot pads polished brass, as the Under Hall's brass funnel in input 2."),
    "C": ("BONE AND COPPER, the Under Hall's colours: the cover burnt copper-orange metal with darker rusty seams and "
          "small rivets at the corners, as the Under Hall's copper roof in input 2; the label's letters pale bone "
          "ivory, the emblem a glowing lava-yellow orb; the dice spots ringed with dark iron and glowing orange inside; "
          "the four roof strips pale bone ivory, the ridge strip dark iron with its holes glowing orange, the paper tuft charred grey; the legs and foot pads dark weathered teal-green steel, "
          "as the Under Hall's teal pillars in input 2."),
}
