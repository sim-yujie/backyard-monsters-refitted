**A — Flank the yard switcher**
Keep Map/Friends where they are. Put the arrows around the flag one row above them.

- **390×844:** Reserve a 184×96 px block above Map/Friends. Arrange **Prev 48 px / flag 60 px / Next 48 px**, with 8 px gaps. Use painted arrows inside round buttons. Keep the count badge on the flag. Under this group, show the current yard name across the full 184 px width, wrapping to two lines. More and Collect stay to its right; the bottom row stays unchanged.
- **Desktop:** Place the same group immediately above Map/Friends, using 52 px arrows and a 64 px flag. At 844×390, use the phone sizes and anchor it above the bottom dock. On iPad, retain this grouping rather than spreading controls across the screen.
- **Flow:** 1. Tap an arrow to load the adjacent owned yard. 2. Update the existing name label after arrival. 3. Tap the flag for the full switcher; select any yard to jump. Ignore repeated arrow taps while a yard loads.
- **Ends/name:** Grey out Prev at Main and Next at the last outpost. Keep the current name on the existing switcher label; add no banner.
- **Main risk:** The phone’s lower-left becomes dense. Long names need two lines, and even those may not accommodate unrestricted names.

**B — Put travel in the bottom row; move Friends into More**
Make room for permanent, prominent arrows by moving a less immediate action.

- **390×844:** Bottom row becomes **Map / Prev / Next / Monsters / Build**. Give each a 72 px column with 6 px gaps and 48–56 px round buttons; Build gets 64 px. Painted artwork only inside the buttons. Keep the flag and current-name plaque above Map/Prev, with 144 px available for a two-line name. More and Collect remain above the right side. Friends becomes the first 56 px painted tile inside More; its gift indicator appears on that tile.
- **Desktop:** Bottom-left becomes Map, Prev, Next, using 64 px discs. Keep the flag above them. Friends stays inside More at every size so the layout remains predictable. At 844×390, use 52 px travel discs and preserve the existing right-hand action group.
- **Flow:** 1. Tap Prev/Next directly from the bottom row. 2. Tap the flag for jumps. 3. Tap More, then the painted paired-monster portrait for Friends.
- **Ends/name:** Disable arrows at the ends. The existing switcher plaque keeps the current name; the opened switcher shows it in full.
- **Main risk:** Friends loses immediate access, and shrinking the phone’s large buttons changes the dock’s visual balance. This is the closest match to the owner’s “big arrows beside Map” reference, but it charges a real navigation cost.

**C — Make the flag open a compact travel tray**
Keep the resting HUD intact; expose arrows when the player starts travelling.

- **390×844:** Tap the existing flag to open a 208×120 px steel/wood tray directly above it. Its first row contains **Prev 56 px / painted yard-list button 56 px / Next 56 px**, with 8 px gaps. Below, a 44 px-high “All yards” button provides the same list action. A separate 44 px close target sits at the tray’s upper-right edge. No name inside the tray; retain the existing flag label beneath it.
- **Desktop:** Open a 240×128 px tray above the flag, using 64 px discs. At 844×390, open it to the right of the flag, above Map/Friends, to avoid consuming scarce vertical space. It stays open after travelling.
- **Flow:** 1. Tap flag. 2. Step repeatedly with Prev/Next. 3. Tap All yards for jumps. 4. Close the tray or tap the yard background to dismiss it. The switcher retains a fixed title/close area; only its list scrolls.
- **Ends/name:** Disable at the ends. The existing label updates after each arrival.
- **Main risk:** Adds a tap before travel and changes the flag’s established behaviour. The arrows are also less discoverable.

For **all three**, use the game’s painted arrows, flag and house artwork—not the current thin white symbols. Modern uses gold rims and steel; Classic uses warm wood and parchment. Disabled arrows should look visibly dulled, not disappear. In the switcher, give names two lines with coordinates beneath; keep pin/edit targets at least 44 px and eliminate ellipses.

**Recommended: A.** It preserves every existing shortcut and makes the arrows permanently available.  
The arrows and flag form one clear “my yards” group, with no extra banner or interaction mode.  
Disable at the ends: with 800 outposts, accidentally moving from Main to the last yard is an unpleasant surprise.

**Owner decisions still needed**

- What is the maximum yard-name length? Unrestricted names cannot fit a fixed HUD label; full names must remain readable in the switcher.
- Should the flag badge count outposts only, as today’s intent suggests, or all owned yards including Main?
- When a player pins or reorders an outpost, should arrow order change immediately or on the next yard visit?
- Should repeated travel restore each yard’s previous camera position or always centre its Town Hall?
