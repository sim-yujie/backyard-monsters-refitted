"""Per-sheet part checklists (from the old Flash sheet and the level portrait) and colour notes."""
CHAMP = {"ape": "gorgo", "dragon": "drull", "fly": "fomor", "krallen": "krallen"}
COLOUR = {
    "ape": "saturated royal/deep blue skin with lighter blue highlights, yellow eyes, white claws and spikes",
    "dragon": "deep brick-red skin with darker red shading and small gold-orange spots, bright yellow-orange flame crests, yellow eyes, cream belly where present",
    "fly": "dark maroon-purple skin, glowing cyan-blue gems, yellow eyes, pale horn and spikes; NOT bright pink",
    "krallen": "",
}
_G = ("squat bulky blue ape-toad body, heavy head with a thick brow ridge, glowing yellow eyes, wide frowning mouth with lower tusks/teeth, "
      "two pointed ear flaps, two thick front arms with white claws, two short hind legs with white-clawed feet (both feet)")
_D = "TWO dragon heads side by side (one slightly bigger), each with a spiky yellow-orange crest, yellow eyes, a mouth with small teeth"
_F = "round heavy toad-like body, wide mouth full of small teeth, yellow eyes"
PARTS = {
    "ape_2": _G + ", a bit bigger and more muscular than level 1, row of small white spikes down the back, short spiked tail, red stud on the forehead if the old sprite or portrait shows it. NO armour.",
    "ape_3": _G + ", more upright gorilla stance with longer arms, shaggy fur texture, white horn spike on top of the head, a row of white spikes down the head and back, big lower tusks, three white claws on each hand and foot. NO armour.",
    "ape_4": _G + ", gorilla stance, shaggy fur, white spikes on the head and back, big lower tusks, FIRST ARMOUR: brown leather shoulder pads on both shoulders held by straps across the chest, brown leather wrist bands; red gem/stud on the forehead if visible.",
    "ape_5": _G + ", gorilla stance, big lower tusks, ARMOUR: silver metal helmet plate on the forehead with a spike on top, brown leather shoulder pauldrons, a long silver segmented spiked plate armour down the whole back, brown chest harness straps with a gold buckle/belt, brown leather wrist cuffs.",
    "ape_6": _G + ", gorilla stance, big lower tusks, HEAVY ARMOUR: silver metal helmet with a spike, large pale tan/khaki metal shoulder pauldrons, silver segmented spiked plate armour down the whole back, brown leather straps and belt, brown wrist cuffs; the biggest Gorgo. Armour colours as in the old sprite (silver plates, muted tan/khaki pauldrons), not the darker brown of the portrait.",
    "dragon_2": _D + ", low four-legged crawling body like level 1 but bigger, short legs with white claws, small white spikes along the back, short tail, gold spots on the skin.",
    "dragon_3": _D + " raised on two longer necks, body standing higher on four legs, cream/pale-green belly, white spikes along the necks and back, tail with spikes, gold spots, white claws.",
    "dragon_4": _D + " on two long necks, upright on two strong hind legs with two short front arms, cream/pale-green segmented belly, white spikes along the necks, back and long tail, gold-orange spots, white claws.",
    "dragon_5": _D + " (bigger crests) on two long necks, upright on two hind legs, two short arms, cream/pale-green segmented belly, gold-orange armour-like plates/spots on the shoulders, arms and knees, white spikes along necks, back and long tail, white claws.",
    "dragon_6": _D + " (biggest, flame-like crests) on two long thick necks, upright on two hind legs, two arms, big cream/pale-green segmented belly, gold-orange plates on the shoulders, arms and knees, white spikes along necks, back and long curving tail, white claws; the biggest Drull.",
    "fly_2": _F + ", like level 1 but bigger, a row of pale/white spikes on the back, small glowing cyan gems if the old sprite or portrait shows them, four short legs.",
    "fly_3": _F + ", upright bulldog stance, two tall folded bat WINGS standing up behind the head, small pale horns, glowing cyan gems on the head and back, white spikes, very wide grin with many teeth, four short legs with claws.",
    "fly_4": _F + ", two folded bat wings standing up (pink membrane), pale horns, glowing cyan gems, FIRST ARMOUR: blue-grey/lavender metal plates on the chest and a segmented plate armour down the back with spikes, wide toothy grin, short arms with claws.",
    "fly_5": _F + ", two folded bat wings, two curved pale horns, blue-grey/lavender metal helmet plate on the head, chest plate and segmented spiked back armour, glowing cyan gems, wide toothy grin, short clawed arms and legs.",
    "fly_6": _F + ", two folded bat wings, two curved pale horns, HEAVY blue-grey/lavender armour: helmet, chest plate, shoulder plates and segmented spiked back armour, huge open mouth full of teeth, short clawed arms and legs; the biggest Fomor.",
    "krallen_1": "four-legged big cat (leopard-like) with golden-yellow fur covered in dark brown leopard spots, long tail, head with an open mouth showing pink inside and white fangs, yellow eyes, white claws on all four feet. NO extra arms and NO spines at this level (the portrait shows extra arms on the back: IGNORE them for this level, follow the old sprite).",
    "krallen_2": "four-legged big cat (leopard-like) with golden-yellow fur and dark brown leopard spots, long tail, open mouth with white fangs, white claws, PLUS two extra long thin arms growing from the back/shoulders, held out to the sides, each ending in white claws, and a few short spines along the spine.",
    "krallen_3": "four-legged big cat (leopard-like) with golden-yellow fur and dark brown leopard spots, long tail, open mouth with white fangs, white claws, two extra long thin arms from the back held out to the sides with white claws, PLUS many long dark brown/purple spines bristling along the head, back and tail; the biggest Krallen.",
}
