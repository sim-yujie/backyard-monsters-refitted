Here are three concrete gem-framing directions based on [ability-icons.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/ability-icons.png), [mm-crystal.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/mm-crystal.png), and the desktop, mobile, and unlock screenshots.

---

### 1. Top 3 Gem Directions

#### Direction A: Socketed Octagon Cut ("Relic Bezel") *(evolves b + c)*
* **Why:** Keeps nearly the full square painting readable while creating an unmistakable thematic split—loose shard = currency, socketed jewel = permanent power.
* **Silhouette:** Regular 1:1 **chamfered octagon (emerald/cushion cut)** (~20–22% corner bevels) set inside a 2–3 px stepped metal bezel with four subtle corner claws/rivets.
* **Art placement:** Scale the square art ~104% to crop off its existing thin bronze border and mask to the octagon. Leave the central ~72% completely clear ("flat gem table"); apply a 2 px dark inner recess shadow under the rim, an outer 14% angled bevel band tinted by the art's own edge colour (8 soft planes), and one crisp top-left glass specular tick (never crossing the subject).
* **Bezel per look:**
  * *Modern:* Dark forged gunmetal (`#232b34`–`#5e6c7a`) with tarnished bronze corner prongs (`#9c7a48`), echoing the riveted iron window frame in [abilities-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/abilities-modern.png).
  * *Classic:* Burnished antique brass (`#3d2314` 1.5 px outer outline, `#a87632` bevel, `#e8c478` upper lip), bridging the dark paintings cleanly onto the cream slot in [abilities-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/abilities-classic.png).
* **States:**
  * *Locked:* **Dormant smoky obsidian**—desaturated dark slate/charcoal art at ~45% brightness (opaque, not 35% ghosted), a subtle matte diagonal clouding veil, dull bezel, zero specular glint.
  * *Next:* **Awakening socket**—art at ~85% saturation with a violet-magenta inner bevel refraction (echoing the Monster Madness crystal about to be slotted) and a bright upper-left sheen; the slot's pink `Next` pill does the heavy CTA work.

#### Direction B: Colour-Matched Hex Crystal ("Aspect Gem") *(evolves a)*
* **Why:** Turns each ability into a distinct elemental stone whose glowing rim doubles as a quick colour cue.
* **Silhouette:** **Broad flat-top hexagon** (1:1 box) with thick coloured crystal facets and no heavy metal socket.
* **Art placement:** Hex mask over the painting; the outer ~18% acts as a translucent faceted crystal rim (6 planes) colour-matched to each icon's hue (crimson, emerald, amber, violet, etc.) with a faint glass vignette over the recessed painting and one sharp upper-left facet highlight.
* **Rim per look:**
  * *Modern:* Self-lit coloured crystal edge with a 1 px dark steel shadow (`#141a21`) and soft coloured glow onto the slate slot.
  * *Classic:* Same coloured crystal wrapped in a **1.5 px dark umber outline (`#3a2112`)** plus subtle warm drop shadow so amber/gold/emerald edges don't wash out on cream.
* **States:**
  * *Locked:* **Opaque dull shale/quartz**—muted cold grey (Modern) or warm stone-taupe (Classic) matte hex with dimmed, clouded art inside and flat unlit facets.
  * *Next:* Dimmed (~70%) art ringed by a glowing **magenta-pink energized facet edge** implying "ready to infuse."

#### Direction C: Clawed Shield-Cut ("Champion Crest")
* **Why:** Delivers the sharpest, most menacing monster-fantasy silhouette—especially strong at 52 px on [unlocked-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/unlocked-modern.png) and [unlocked-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/unlocked-classic.png).
* **Silhouette:** Wide **pentagon/shield-cut gem** (flat chamfered top, vertical upper sides, tapered bottom point, ~1:1.06 ratio) gripped by a clawed metal setting.
* **Art placement:** Shift painting up ~2 px so faces/fists stay in the wide upper 65%; 5 outer facet bevels frame an open center; cold-silver inner rim glint reinforces the paintings' existing silver lighting.
* **Bezel per look:**
  * *Modern:* Blackened steel with sharp top-corner fangs (`#1d242c` / `#7d8a96`).
  * *Classic:* Iron-bound dark bronze (`#3d2415` outline, `#9e6b2b` face) matching the bone/claw frame corners.
* **States:**
  * *Locked:* **Petrified dark-iron core**—monochrome low-contrast art looking etched inside dull slate rock.
  * *Next:* Darkened art behind a subtle violet-orange core shimmer matching the MM crystal's fiery center.

---

### 2. What Must Stay True at 26–30 px
* **≥80% visible art area:** Several paintings rely on wide or corner-to-corner compositions (*Acid Spit*, *Twin Bite*, *Burn*, *Breath of Fire*) or bottom-anchored impacts (*Ground Slam*, *Fists of Doom*, *Healing Mist*). Aggressive cropping breaks them.
* **Zero facet lines over the subject:** Keep a clean central "table" (~70% diameter). Put all facets strictly in the outer 12–16% bevel ring—no spiderweb/wireframe lines across the monster or flame.
* **Max 6–8 outer bevel planes** with soft value shifts (no hard white outlines).
* **One tight specular highlight:** Single 1.5–2 px white/silver glint on the upper-left bevel only; oversized glare turns 26 px icons into generic shiny marbles.
* **Strip the existing bronze square border** before masking so no double-frame artifacts appear.

---

### 3. Verdict: Ship vs. Weakest
* **Ship: Direction A (Socketed Octagon Cut).** It preserves ~86% of each square painting (saving *Acid Spit*, *Burn*, and *Breath of Fire*), fits a strict 1:1 bounding box, looks genuinely "embedded" rather than pasted on, and eliminates the harsh black-square look on [abilities-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/abilities-classic.png) and Drull's portrait in [unlocked-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/unlocked-classic.png). One shared bezel asset can also wrap all 12 icons cleanly via CSS/canvas overlay + mask.
* **Weakest: Direction C (Shield-Cut)**—and even weaker would be an elongated `mm-crystal.png` shard. At 26 px in [phone-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/phone-modern.png), the tapered bottom clips the focal point of *Fists of Doom*, *Ground Slam*, and *Bloodthirst*, while clawed corners turn into visual noise.

---

### 4. Key Risks & Mitigations
* **Currency confusion:** [phone-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/phone-modern.png) already shows *two* loose gems (the cyan/violet top-right currency diamond and the tilted magenta-orange `mm-crystal.png` right beside the slots). Avoid loose, tilted, pointed, or sparkled crystal silhouettes for abilities—grounding them in a horizontal metal socket (Direction A) guarantees instant separation.
* **Classic cream contrast:** Frameless or translucent gems lose crispness on `#fdf4d3` / `#dfd0b2` cream slots. Always keep a crisp 1.5 px dark chocolate/bronze outer edge in Classic mode, and make Locked stones *opaque dark matte* instead of low-opacity grey.
* **Tight mobile slot layout:** On [phone-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/neon/phone-classic.png), the `Lv 4+` pill sits pixels away from the icon's left edge and two-line names ("Breath of / Fire") fill the bottom. Keep the gem strictly inside the existing 26–30 px square box (no tall crystal tips or wide protruding prongs).
