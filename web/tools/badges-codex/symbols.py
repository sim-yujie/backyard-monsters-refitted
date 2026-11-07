"""The ten badges still on the plain CSS medal (#298, beta 7): what each symbol shows.

id: (slug, name, what the achievement asks, reference picture in art-samples/badges/ref or None, option 1, option 2)
make.py writes one Codex prompt per badge from this; run.sh paints it.
"""

SYMBOLS = {
    14: ("better-together", "Better Together", "join an alliance", "alliance.png",
         "two chunky cartoon monster hands clasped in a firm handshake, one green and scaly with dark claws, one "
         "purple and furry, seen from the front, with a small gold sparkle above the handshake.",
         "a polished heraldic alliance shield (like the attached alliance emblem: a pointed shield with a steel "
         "rim and a bold diagonal stripe), with two monster hands, one green and one purple, clasping in a handshake "
         "in front of it."),
    18: ("into-the-depths", "Into the Depths", "clear the first level of the Descent, the dungeon that leads down into the fiery Inferno underworld",
         None,
         "the round dark mouth of a deep rocky pit seen from above at a slight angle, with rough stone stairs "
         "spiralling down into it, and hot orange-red lava light glowing up from the bottom.",
         "a jagged rocky cave entrance in a chunk of dark volcanic rock, with stone steps going down into the dark, "
         "lit by a strong orange lava glow from inside, and one big glossy red arrow pointing straight down into it."),
    19: ("rock-bottom", "Rock Bottom", "clear all 14 levels of the Descent and reach the very bottom of the Inferno underworld",
         None,
         "a chunky chunk of dark volcanic bedrock with glowing orange lava cracks, with a sturdy pickaxe driven into "
         "its top and a small red victory flag planted beside the pickaxe.",
         "a deep narrow rocky shaft seen from above, its bottom glowing with orange lava, with a red victory flag "
         "planted on a rock at the very bottom."),
    20: ("hall-of-the-deep", "Hall of the Deep", "upgrade the Underhall (the Inferno town hall) to level 5", "underhall.png",
         "the Underhall from the attached picture, made grander: a round copper-and-bronze furnace building with a "
         "big funnel chimney on top, riveted metal bands, and glowing orange lava windows all around it, with a "
         "little gold star above the chimney.",
         "the Underhall from the attached picture: a round copper furnace building with a funnel chimney and glowing "
         "orange lava windows, standing on a small chunk of dark volcanic rock, with a big glossy green arrow pointing up beside it."),
    21: ("hellraiser", "Hellraiser", "complete 10 Inferno quests (missions in the fiery underworld)", None,
         "a rolled-up parchment quest scroll tied with a red ribbon and a red wax seal, wrapped in bright orange and "
         "yellow flames, with two small red devil horns poking up from behind it.",
         "a big glossy red horned demon skull with glowing yellow eyes and a grin, with bright orange flames rising "
         "from the top of its head."),
    23: ("neighbourly", "Neighbourly", "visit 30 other players' yards in one day", None,
         "a wooden signpost with three wooden arrow signs pointing in different directions (completely blank, no "
         "writing), with a trail of big green monster footprints walking past its base.",
         "a chunky cartoon monster sneaker / walking boot in bright red with white laces, mid-stride with motion "
         "streaks behind it, kicking up a little puff of dust."),
    24: ("regular", "Regular", "play the game 30 days in a row", None,
         "a chunky desk calendar page with a red top binding and a grid of small squares, every square ticked with "
         "a green check mark (no numbers, no letters), with a bright orange flame (a streak flame) rising from its top corner.",
         "a chunky round alarm clock in red with two bells on top and a big bright orange streak flame behind it."),
    25: ("popular", "Popular", "have 80 friends", None,
         "a cheerful crowd of three cute round monster faces squeezed together and smiling (one green, one purple, "
         "one orange, each with big eyes), with a big glossy red heart floating above them.",
         "a big glossy red heart surrounded by four small smiling monster faces (green, purple, orange, blue) peeking around its edges."),
    26: ("kozu-hunter", "Kozu Hunter", "attack camps of the Kozu tribe 100 times", "kozu.png",
         "the face of the Kozu tribe from the attached picture: a deep purple hood with glowing white eyes in the "
         "dark inside and the red gem shining below it, with a bold red hunter's crosshair (target ring with four "
         "ticks) over the hood.",
         "a small Kozu camp hut: a purple pointed tent with green tentacles curling around its base and the red "
         "Kozu gem shining over its door, with two crossed spiked wooden clubs in front of it."),
    27: ("landlord", "Landlord", "hold 100 outposts (captured enemy bases on the world map) at once", None,
         "a small grassy hill-island packed with many little stone fort towers, every one with its own little red "
         "flag on top, crowded together, the biggest tower in the middle.",
         "a big gold key ring holding many chunky gold and bronze keys, with a little stone fort tower with a red "
         "flag hanging from it like a key tag."),
}
