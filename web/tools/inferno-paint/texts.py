"""The words of the Codex prompts: what each Flash look is (keep it), how each broken look is broken, the camera and
the finish. Read from Flash's own pictures at 4-5x (art-samples/b8-inferno-paint/look/)."""
from common import parse

ACADEMY = ("a craggy, jagged BASE of dark reddish-brown volcanic rock (rough and lumpy, mottled dark red and black), "
           "with thin pale ivory BONE SPIKES standing up from its left and right corners and one at the back, and at "
           "its front foot a small dark opening closed by a grille of pale vertical bars; rising out of the rock a big "
           "rounded GOLDEN SHELL, like a tall half-egg or a rounded arch of polished gold-orange metal, its rounded "
           "front facing the lower right, with a broad pale silver-cream metal band running round its curved edge; on "
           "the shell's right face a round dark iron HUB with a pale bone-coloured spike (like a drill bit) pointing "
           "out to the right. Behind the gold shell, at its left and back, stand pale grey-cream stone SLABS or "
           "pillars like organ pipes, with a beige COG WHEEL standing up between them at the top and small gear teeth "
           "down the shell's left edge")
WHAT = {
    "a1": "the ACADEMY of the Inferno (the monsters' underground lava world), level 1, where monsters are trained: "
          + ACADEMY + ". Fairly compact: the shell and pillars are about as tall as the rock base is wide",
    "a2": "the ACADEMY of the Inferno, levels 2-4, the same building as level 1 but taller and grander: " + ACADEMY +
          ". What level 2 adds: a TALL thin pale bone SPIKE rising high above the top, the pale slabs grown into a "
          "little crenellated castle of cream stone towers with cog wheels between them, a bone spike sticking out "
          "to the LEFT from the back, a taller rock base with more bone spikes, and on the right face TWO dark gear "
          "rings on the hub with TWO pale spikes pointing out to the lower right",
    "b1": "the HOUSING BUNKER (the Compound) of the Inferno, where the monsters live: a wide flat ENCLOSURE drawn as a "
          "big diamond-shaped ring on the ground (an isometric square), made of about thirty curved, pointed HORNS or "
          "tusks standing upright like a fence of stakes, each a dark brown-grey at the base fading to pale bone at "
          "the tip, some in pairs or threes, linked by a sagging thin tan ROPE strung from horn to horn all round the "
          "ring. At the BACK corner of the ring, a small HUT like a bony skull or a mushroom of pale cracked bone and "
          "dried mud on short thick legs, with dark arched openings under its brim and three tall pointed horns "
          "rising from its top. The inside of the ring is empty (clear ground); the ring is drawn as in frames.png "
          "with every horn in its place",
    "c1": "the INFERNO CAVERN, stage 1 of 5: the first sign of Moloch's cave breaking up through the ground: a small "
          "tight cluster of tall sharp shards of dark slate-grey rock (like broken stone crystals, cracked, with flat "
          "faces and chipped edges) jutting up out of the ground, hot orange lava glowing between their feet",
    "c2": "the INFERNO CAVERN, stage 2 of 5: a bigger heap of dark slate-grey rock shards and broken slabs pushed up "
          "out of the ground, hot orange lava glowing in the gaps at their feet, and set into the front right of the "
          "heap a pale bone-white beast SKULL (a vertebra-like skull with a big round eye socket glowing orange)",
    "c3": "the INFERNO CAVERN, stage 3 of 5: a wide low mound of big broken dark slate-grey rock slabs and tall "
          "pointed shards, splayed outwards like a crown, hot orange lava glowing underneath it, the pale bone-white "
          "SKULL with a glowing orange eye socket at the top centre, a few small loose rock "
          "spikes standing around it as frames.png has them",
    "c4": "the INFERNO CAVERN, stage 4 of 5: the cave has become a squat stone GATEHOUSE: a block of big cracked dark "
          "slate-grey stone slabs on thick rough rocky legs with pointed stalagmite feet, molten orange lava glowing "
          "underneath it and between the legs, sharp dark rock shards crowning its back, and at the front right "
          "corner of its top a huge pale bone-white human-like SKULL with deep sockets holding glowing yellow-orange "
          "eyes and a row of teeth, resting on the slabs. A few small rock spikes standing around it as frames.png "
          "has them",
    "c5": "the INFERNO CAVERN, stage 5 of 5 (finished, the way down to the Inferno): the squat stone GATEHOUSE of "
          "stage 4 grown TALLER: a tall block of big cracked dark slate-grey stone slabs on thick rough rocky legs "
          "with pointed stalagmite feet, molten orange lava glowing underneath it and between the legs, a tall crown "
          "of sharp dark rock shards along its back and top, and at the front right of its top the huge pale "
          "bone-white human-like SKULL with deep sockets holding glowing yellow-orange eyes and a row of teeth, "
          "resting on a ledge of slabs. A few small rock spikes standing around it as frames.png has them",
}
HOW = {
    "a1d": "the level 1 Academy DAMAGED (hit in a battle, still standing), as frames.png shows it: the rock "
           "base and its bone spikes whole; the gold shell DENTED and buckled, crumpled in deep folds; the pale slabs "
           "behind it broken and leaning apart at angles, the cog wheel knocked loose and tilted; the hub and its "
           "spike still on the right face; a few dark scorch marks",
    "a1x": "the level 1 Academy DESTROYED: a low wreck on the broken rock base: the gold shell torn off and lying "
           "collapsed and crumpled over the rubble, tipped to the left; dark charred rubble and broken red-brown rock "
           "under it; the pale slabs snapped into stumps sticking up at angles at the right; the cog wheel lying in "
           "front; bone spikes still poking up at the edges",
    "a2d": "the level 2-4 Academy DAMAGED (still standing), as frames.png shows it: the rock base and bone spikes "
           "whole; the tall top spike BENT over to the left; the gold shell dented and buckled; the cream stone towers "
           "cracked and leaning; the gear rings and spikes on the right face still there; a few dark scorch marks",
    "a2x": "the level 2-4 Academy DESTROYED: a low wide wreck: the gold shell flattened into a crumpled plate lying "
           "across the rubble, the pale stone towers and long bone spikes broken and stuck in at wild angles, loose "
           "cog wheels on the left, a lump of broken red-brown rock at the back left, dark charred rubble",
    "b1d": "the Housing Bunker DAMAGED (still standing), as frames.png shows it: the same ring of horns and rope with "
           "a few horns broken short or knocked over (one lies fallen at the right), the rope sagging and snapped in "
           "places, the skull hut at the back cracked and chipped, one of its horns broken",
    "b1x": "the Housing Bunker DESTROYED: only scattered remains of the ring where frames.png has them: a few broken "
           "horn STUMPS standing alone along the old ring, loose broken horn tips lying on the ground, and at the back "
           "left two broken chunks of the bone hut; no rope left, the ring mostly gone, wide gaps of empty ground",
}
CAMERA = ("CAMERA: the isometric 3/4 view of frames.png, seen from the front and above at about 30 degrees, NOT a "
          "straight side view and NOT a symmetric picture. Put every part where frames.png has it, not mirrored and "
          "not rearranged.")
_FIN = ("FINISH: the finish of style.png (the Modern Inferno buildings of the same game: the painted Under Hall and "
        "Resource Pod, the 3D Bone Cruncher and the 3D Magma Tower): crisp, clean, polished, almost rendered stylised "
        "3D, smooth shading, small bevels catching the light, soft light from the upper left, ambient occlusion in the "
        "gaps, clean sharp edges, no thick black outline, no cel shading, no pixel art, no painterly brush mess. "
        "Right-hand faces in medium shade, readable, not black. ")
FINISH = {
    "a": _FIN + "COLOURS as Flash's, a little richer: the rock a deep red-brown with darker crevices and a faint warm "
         "glow in its deepest cracks, the bone spikes pale ivory, the shell a warm polished gold-orange with bright "
         "highlights (gold, not yellow plastic), its rim band pale silver-cream, the slabs pale warm grey stone, the "
         "hub dark iron. Not neon, not over-saturated.",
    "b": _FIN + "COLOURS as Flash's: the horns dark umber-brown at the foot fading to pale bone at the tips, the rope "
         "a light tan, the hut pale cracked bone and dried mud with dark shadowed openings. Earthy and muted, not "
         "orange. The thin horns and rope must stay crisp and readable at small game size.",
    "c": _FIN + "COLOURS as Flash's: the rock a cool dark slate grey with lighter blue-grey edges where the light "
         "catches it, the lava a hot orange with yellow centres glowing from below (glowing but not neon), the skull a "
         "pale greenish bone-white, NOTHING painted on the ground around it: no cracks, no "
         "glow, no dark patch (the game draws the cracked, glowing ground separately); the lava glow shows only in "
         "the gaps between the rocks at their feet.",
}


def what(look):
    return WHAT[look[:2]]


def how(look):
    return HOW[look]
