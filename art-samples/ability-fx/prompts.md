# Ability effect sheets: the Codex prompts

Refs: m1/m2 got server/public/assets/fx/tower-fx.png (cells on grey) and a real in-game frame; c1 got Flash's putty splat and rock chips (effects/putty.png, pebblehit.png). The Codex sheets (sheet.png) are not kept in git (art-samples/.gitignore); build_atlas.py cuts them into server/public/assets/fx/ability-fx.{modern,classic}.webp. 4 Codex image calls in all (m1, m2, c1, plus one flipbook sample for direction A).

## m1

```
Generate an image using your image generation tool (one image only, 1536x1024, landscape). Save the final PNG as sheet.png in the current working directory.

It is a SPRITE SHEET of 12 separate game effect pieces for the browser game Backyard Monsters Revamped (Modern look), laid out in a grid of 4 columns x 3 rows, each piece centred in its own cell with clear empty space around it. The background of the WHOLE image is flat pure magenta (#FF00FF), no gradient, no texture, no shadow on it, no grid lines, no text, no labels, no numbers.

Style: the game's MODERN look (see the reference images: the tower effect bits sheet and an in-game frame). Clean, crisp, stylised 3D-rendered game effect pieces, slightly toy-like, with smooth shading, a warm key light from the upper left, bright specular highlights on glossy parts, readable medium shadows, rich but not neon colour. No outlines, no cel shading, no flat vector fills, no glow halos, no ground and no cast shadow under the pieces. Every piece must read clearly when shrunk to 20-60 pixels.

The 12 pieces, row by row, left to right:
Row 1:
1. A SQUARE swatch of grey stone surface filling most of its cell: weathered granite slab texture with a few dark cracks and lighter chipped edges, seen straight on, even lighting so it can be tiled. Neutral cool grey.
2. One jagged chunk of grey rock (a broken shard of stone armour), chunky, about fist-shaped.
3. A small cluster of four grey pebbles and stone chips of different sizes.
4. A ground crack: dark cracks radiating out from a broken centre in cracked brown earth, seen from above at an angle so it is a FLAT ellipse twice as wide as tall, lifted crumbly edges, no grass.
Row 2:
5. A spray of brown dirt clods and small dirt lumps flying outward (a few chunks, not a cloud).
6. A glob of glossy bright lime-green acid spit flying to the right: a rounded wet blob with a short dripping tail trailing to the left, highlights on top.
7. A splat of lime-green acid seen from above at an angle (flat ellipse, twice as wide as tall), wet and glossy, with a few separate droplets around it.
8. Three small glossy lime-green acid droplets of different sizes.
Row 3:
9. One glossy deep-red blood droplet (teardrop shape, pointing up), with a bright highlight.
10. A monster BITE: two curved rows of sharp white fangs, an upper arc and a lower arc closing on each other like jaws snapping shut, ivory white with a light pink gum line only, no mouth, no face, no eyes.
11. A glossy red target reticle emblem: a thick red ring with four short notches pointing in, and a small solid red dot in the middle, like a 3D badge, slightly bevelled.
12. A small glossy golden-yellow five-pointed star, puffy and bevelled like a toy.

Keep each piece fully inside its cell, never touching another piece. Pure magenta background everywhere else.
```

## m2

```
Generate an image using your image generation tool (one image only, 1536x1024, landscape). Save the final PNG as sheet.png in the current working directory.

It is a SPRITE SHEET of 6 separate LIGHT and VAPOUR effect pieces for the browser game Backyard Monsters Revamped (Modern look), in a grid of 3 columns x 2 rows, each centred in its own cell with clear empty space around it. The background of the WHOLE image is flat PURE BLACK (#000000), no gradient, no stars, no texture, no grid lines, no text, no labels. The pieces are drawn in WHITE and light grey only (no colour at all), because the game tints them and lays them over the yard in added light, so black means fully see-through. Match the look of the reference sheet of tower effect bits (soft painted greyscale effect pieces).

The 6 pieces, row by row, left to right:
Row 1:
1. A SOAP BUBBLE: a clear transparent sphere, mostly empty and black inside, with a thin bright rim, a soft brighter band along the lower edge, one bold curved window-shaped highlight at the upper left and a small round highlight at the lower right. Perfect circle, fills most of its cell.
2. A soft puff of drifting mist: a loose, wispy cloud with soft edges and a few curling tendrils, brighter in the middle, fading to black at the edges.
3. A soft glowing PLUS sign (a healing cross) with rounded ends, bright core, soft glow around it.
Row 2:
4. A ground SHOCKWAVE: a ring of dust and air seen from above at an angle, so it is a FLAT ellipse twice as wide as tall, the ring thick and smoky with a brighter leading outer edge, empty black middle.
5. A BUBBLE POPPING: a ring of small round droplets and short curved fragments flying outward from an empty centre.
6. A curved SLASH arc: a crescent-shaped swoosh of white light, thick in the middle and tapering to sharp points at both ends, like a claw or bite streak.

Keep each piece fully inside its cell. Pure black background everywhere else.
```

## c1

```
Generate an image using your image generation tool (one image only, 1536x1024, landscape). Save the final PNG as sheet.png in the current working directory.

It is a SPRITE SHEET of 12 separate game effect pieces for the CLASSIC look of Backyard Monsters (the 2009 Flash game), laid out in a grid of 4 columns x 3 rows, each piece centred in its own cell with clear empty space around it. The background of the WHOLE image is flat pure magenta (#FF00FF), no gradient, no texture, no shadow on it, no grid lines, no text, no labels, no numbers.

Style: the original Flash game's effects, see the reference image (a purple putty splat and flying grey rock chips, both from the real game): small PRE-RENDERED 3D pieces like a late-2000s 3ds Max render shrunk to sprite size; soft grainy shading, one soft key light from the upper left, deep near-black shadow sides, natural somewhat muted and dusty colours, small soft highlights only on wet surfaces. No outlines, no cel shading, no cartoon gloss, no glow halos, no ground and no cast shadow under the pieces. Every piece must read clearly when shrunk to 20-60 pixels.

The 12 pieces, row by row, left to right:
Row 1:
1. A SQUARE swatch of grey stone surface filling most of its cell: rough weathered rock with a few dark cracks, seen straight on, even lighting so it can be tiled. Dusty grey.
2. One jagged chunk of grey rock (a broken shard of stone), chunky, about fist-shaped.
3. A small cluster of four grey pebbles and stone chips of different sizes.
4. A ground crack: dark cracks radiating out from a broken centre in dry brown earth, seen from above at an angle so it is a FLAT ellipse twice as wide as tall, no grass.
Row 2:
5. A spray of brown dirt clods and small dirt lumps flying outward (a few chunks, not a cloud).
6. A blob of wet green acid spit flying to the right: a rounded goo blob with a short dripping tail trailing to the left (like the reference putty blob, but acid green).
7. A splat of green acid goo seen from above at an angle (flat, twice as wide as tall), like the flattened putty splat in the reference, with a few separate droplets.
8. Three small green goo droplets of different sizes.
Row 3:
9. One dark-red blood droplet (teardrop shape, pointing up).
10. A monster BITE: two curved rows of sharp off-white fangs, an upper arc and a lower arc closing on each other like jaws snapping shut, no mouth, no face, no eyes.
11. A red target reticle emblem: a thick red ring with four short notches pointing in, and a small red dot in the middle, like a small 3D badge.
12. A small golden-yellow five-pointed star, chunky 3D.

Keep each piece fully inside its cell, never touching another piece. Pure magenta background everywhere else.
```
