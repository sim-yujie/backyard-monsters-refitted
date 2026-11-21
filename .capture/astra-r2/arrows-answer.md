**X — Put yard navigation in a top command bar; remove the bottom-left yard control entirely.**  
Navigation becomes part of the top HUD, leaving the bottom dock for actions.

- **390×844:** Keep profile, currencies and resources above y=109. Place a steel/wood navigation bar at **x=12, y=118, w=366, h=48**. Painted previous arrow: left 48px; painted next arrow: right 48px; the middle 270px opens the switcher. Move Help and the hourglass into More to give this bar space.
- **Identity:** Main shows a painted house and **1/201**. An outpost shows a painted flag, **138/201**, and its coordinates, such as **240,209**. The fraction means position in the switcher order, including Main. Coordinates identify the actual outpost even when pinning changes its position. No yard names or navigation words.
- **Bottom-left, precisely:** Delete the flag disc, count badge and name plaque from **x=16–120, y=630–727**. Keep Map’s 60px disc at **x=34, y=738**, with its existing plaque below. Friends and all right-side actions stay put. This removes an entire control cluster from the thumb area compared with picture 2.
- **844×390:** Navigation bar at **x=244, y=76, w=356, h=48**, below the resources. Bottom actions retain their positions; remove the former yard cluster.
- **Desktop:** The same 356×48 bar sits centered immediately below the resource HUD. On iPad, use this arrangement whenever it fits; otherwise use the portrait arrangement.

**Flow**
1. Tap an arrow to visit the adjacent owned yard.
2. Update the fraction and coordinates when that yard finishes loading; disable arrows during loading.
3. Tap the middle to open the switcher, focused on the current yard. Show its complete name there.
4. Select another yard for a direct jump.

**Resting words:** Navigation: **0**. Whole HUD: **9 on Main**, **8 on an outpost**, assuming Events remains visible and Kits replaces Collect all. Existing action labels remain.

**Main risk:** Navigation is always available, but its bar consumes more of the upper view and requires reaching upward on a phone.

---

**Y — Make navigation a temporary dock mode; keep only a compact location tile at rest.**  
The player deliberately switches from building controls to travelling controls.

- **390×844, resting:** Replace the existing yard disc, badge and name plaque with one **96×48 tile at x=16, y=660**. Main shows a painted house plus **1/201**. An outpost shows a painted flag plus **138/201**. No separate badge or plaque. Map stays at **x=34, y=738**, Friends stays beside it, and the right-side actions remain unchanged.
- This replaces roughly 90px of stacked disc-and-plaque height with 48px. It is visibly smaller than picture 2 **before** introducing any arrows.
- **390×844, navigation mode:** Tapping the tile replaces the entire bottom action dock with a solid **390×164 panel at x=0, y=680**. This is a replacement surface, not option C’s floating tray. Top row: painted current-yard icon, coordinates, position fraction, and a **44×44 close button**. Bottom row: **64×64 painted Previous, yard-stack and Next buttons**, centered at x=72, 195 and 318. The yard-stack opens the full switcher.
- **844×390:** Resting tile at **x=16, y=228**. Navigation mode replaces the bottom **104px** with a horizontal panel: identity left, three 56px buttons centered, close right.
- **Desktop:** Keep the compact resting tile above Map. Navigation mode replaces the bottom **112px** action band, with controls grouped centrally. iPad uses the same bottom-band behavior.

**Flow**
1. Tap the location tile.
2. The navigation dock reveals coordinates and the current yard’s **full name**, wrapping if necessary. Names appear only in this explicit mode.
3. Tap arrows repeatedly; the dock stays open across visits.
4. Tap the yard-stack for a jump, or close to restore the action dock.

A player with 200 outposts sees their position at rest and gets exact identity with one deliberate tap.

**Resting words:** Navigation: **0**. Whole HUD: **9 on Main / 8 on an outpost**, on the same assumptions as X.

**Main risk:** Stepping requires entering a mode, and building actions are unavailable until it closes.

For **both directions**, grey out at the ends; never wrap. Main is a useful fixed starting point. Use painted disabled arrows, not thin glyphs. Activate controls only on pointer release with under 8px movement; a pan that starts on the yard must never trigger a control it crosses. Switcher title, search/tabs and close stay fixed; only its list scrolls. Modern and Classic share geometry, using their respective steel/gold and wood/parchment/ribbon assets.

**My pick: Y.**  
It directly addresses the complaint: less HUD at rest, with no name plaque.  
Hundreds of yards justify a deliberate navigation mode that supports both stepping and jumping.

**Owner decisions still needed**

- Is one extra tap before stepping acceptable?
- At rest, prefer the position fraction or coordinates?
- Should selecting a yard from the list keep navigation mode open?
- Is moving Help and the hourglass into More acceptable for X?
