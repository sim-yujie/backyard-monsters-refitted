Q1: Cell changed

Direction A: Instant Snap + Static State Markers (Calmest)
- What the player sees: Most map changes simply swap in place on a single redraw with no motion—buildings, nameplates, borders, and shield icons update cleanly. "Busy" (under attack) adds a static crossed-swords badge (16 px circular badge, ember orange-red #E85426 with white swords, dark outline) on the nameplate's right edge while the battle is active (no looping pulse). Only the player's own cells or the currently selected cell get a single 350 ms hex-border brighten (opacity 100% -> 0% white/gold wash, ease-out) so you never miss an attack on your own territory.
  - Modern vs Classic: Modern places a matte metallic-rimmed 16 px crossed-swords badge next to the tan nameplate and uses a soft 3 px feathered inner hex brighten. Classic places a glossy retro red/gold outlined 16 px crossed-swords badge beside the existing blue yard dot and uses a crisp 2 px hard-edged hex stroke brighten matching Classic's black-outlined isometric tiles.
- When it shows / does not show: Static state updates show for all visible cells immediately. The 350 ms brighten shows only for own cells (attacked, taken, shield changed) and the currently selected cell; it does not show on initial map load, while panning fast, or for distant/neighbouring cells.
- Scaling to 10+ changes in a few seconds: Effortless. Incoming pushes coalesce into one redraw every ~200 ms; even 30 changes at once cause zero visual flicker or strobe.
- Phone vs desktop: Identical behaviour; on phone (3x density, closer hex framing) the static crossed-swords badge bumps to 18 px logical width so it stays legible beside the level/shield icons without touching neighbouring cells.
- Cost: Lowest possible. One dirty redraw per coalesced batch; zero per-frame loop when idle (only an occasional 350 ms one-shot pass for own/selected cells).

Direction B: Tiered Hex Edge Pulse (Relevance-Filtered, Event-Coded)
- What the player sees: A single-pass luminous trace strictly inside the hex boundary (never spilling onto neighbours): a 3 px inner hex stroke that holds at peak for 100 ms and fades smoothly to 0% over 650 ms (ease-out, cubic-bezier 0.22, 1, 0.36, 1). Colour encodes the event type: warm gold (#F5B82E) for taken/owner swap, ember orange-red (#F05228) for attack started (leaving a static 16 px crossed-swords badge while busy), mint-cyan (#38E09B) for shield up, and pale ice (#DCEAF2) for shield down. Damage and level ticks update silently with no pulse.
  - Modern vs Classic: Modern draws a soft feathered 4 px inner glow that blends naturally with the painterly terrain and merged cyan territory border. Classic draws a crisp, unblurred 2.5 px geometric inner hex outline tucked cleanly inside Classic's black tile border so it feels native to Flash-refreshed tiles.
- When it shows / does not show: Relevance controls intensity:
  - Own cells and selected cell: full 85% peak opacity, 750 ms duration (and own cell attacked/taken adds a one-shot 200 ms 1.0 -> 1.08 -> 1.0 badge pop).
  - Cells in attack range (adjacent / within Flinger range): 75% peak opacity, 650 ms colour-coded pulse.
  - Out-of-range distant cells: muted 40% neutral warm-white pulse (400 ms) for taken/busy only; shield/damage changes snap silently.
  - Never shows on initial viewport load, off-screen cells, or during active fast pan/zoom.
- Scaling to 10+ changes in a few seconds: Two hard guardrails keep busy zones calm: (1) a 1.5 s per-cell cooldown so rapid changes on one cell update art silently without re-flashing; (2) a viewport cap of 6 concurrent pulses (priority: own > selected > in-range > distant), where overflow cells simply snap cleanly in place.
- Phone vs desktop: On phone, inner stroke is slightly bolder (3.5 px Modern / 3 px Classic) for quick scanning at arm's length, and the viewport concurrency cap tightens from 6 to 4 so the smaller 390 px viewport never feels noisy.
- Cost: Low. Draws simple hex-polygon strokes on a lightweight overlay pass only while the active pulse queue is non-empty, then halts completely to 0 fps the moment the last 400-750 ms pulse finishes.

Direction C: Plate Sheen + Expanding Hex Ring (High-Visibility Activity)
- What the player sees: Major changes (taken, attack started) emit a single expanding hex ring starting at the cell perimeter and expanding outward by 12 px (1.0x -> 1.18x scale, 55% -> 0% opacity, 800 ms ease-out; gold #FFD059 for taken, orange-red #FF5A2B for busy) plus a static crossed-swords badge while busy. Minor changes (shield toggle, level change) play a plate-only horizontal light sheen (35% white sweep left-to-right across the nameplate or wild-camp level badge over 450 ms, ease-in-out).
  - Modern vs Classic: Modern uses a soft translucent expanding ring and a metallic specular sheen across the tan/slate plate. Classic uses a crisp 2 px vector Flash-style shockwave hex ring and a sharp bright-gold border highlight around the white/tan label strip.
- When it shows / does not show: Shows on all visible cells on live push (own/selected get a thicker 3 px ring); suppressed on initial load and during fast panning.
- Scaling to 10+ changes in a few seconds: Struggles in dense war zones. Even with a 4-ring cap that downgrades overflow events to plate-sheens, rings cross hex borders and overlap adjacent nameplates and monster sprites, making clusters visually busy.
- Phone vs desktop: On phone, outward expansion must be cut to 6 px and capped at 2-3 rings to avoid visually colliding with adjacent hex labels.
- Cost: Medium. Larger dirty bounding boxes (extending past the cell into neighbours) plus per-plate highlight clipping, though still finite and stops at 0 fps after 800 ms.

Recommendation for Q1:
Direction B (Tiered Hex Edge Pulse). It makes the map immediately feel alive and readable (colour-coding taken, busy, and shield strictly inside the hex footprint), while relevance tiering, a 1.5 s per-cell cooldown, and a 4-6 pulse cap keep hot zones calm and guarantee zero idle frame cost.


Q2: Open info panel when its cell changes

Direction A: Fixed-Slot In-Place Update + Locked CTA Morph (Zero Layout Shift)
- What the player sees: The open panel updates live without ever changing the vertical position of the primary Attack button. When the cell becomes busy or shielded, Attack stays at the exact same coordinates and cross-fades (180 ms, ease-out) into a disabled plate showing an icon + 2-word reason right on the button face: "[swords] Under attack" or "[shield] Shield up" (matching Modern's existing disabled matte-grey riveted plate style used on "Take over", and Classic's muted grey-tan pill). The changed metadata line or status chip (e.g., shield badge, damage, level) receives a single 600 ms warm highlight wash (#F5B82E at 20-25% opacity -> 0%, ease-out) without adding new vertical rows above Attack.
  - Ownership swap (e.g., wild camp taken by a player, or player A -> player B): Header name/avatar updates with the 600 ms highlight, and Attack morphs in-place into a >= 48 px neutral action bar reading "[flag] Taken by [Name] · Tap to update". Secondary buttons below ("View yard", "Message", "Truce" vs "Take over", "Look inside") stay frozen until the player taps that bar—so buttons never reshuffle under a finger.
  - Anti-misclick guard: Whenever a cell's attackability or owner changes, the primary CTA slot ignores taps for 800 ms so a finger already in motion cannot fire a stale or unintended attack.
  - Modern vs Classic: Modern transitions the orange-red riveted Attack plate into a matte dark steel plate (#505860, muted #CBD3DA text, amber/mint status icon). Classic transitions the glossy orange-gold Attack pill into a flat muted parchment-grey pill (#B9AD98, dark brown muted text #5A4A38, crisp border).
- When it shows / does not show: Fires only for live changes on the currently inspected cell. When "Under attack" or "Shield up" clears, Attack cross-fades back to active orange automatically (after the 800 ms tap guard) so players waiting for a shield to drop can strike immediately. Minor damage/level ticks highlight the chip only and keep Attack active.
- Scaling to 10+ changes in a few seconds: Handles rapid sequences on the inspected cell cleanly—latest state wins, the fixed CTA slot simply swaps its 2-word label with a single 180 ms fade, and zero vertical jitter or stacked banners ever occur.
- Phone vs desktop: Identical fixed-height geometry above Attack. On phone bottom sheets, sheet height stays locked so a thumb poised over Attack never lands on "Look inside" or "Take over"; the locked "Tap to update" CTA keeps a >= 48 px touch target.
- Cost: Very low. Lightweight panel state update and one-shot 180-600 ms highlight/fade transitions; zero idle cost.

Direction B: Floating Top-Edge Overlay Strip + Live Full Swap
- What the player sees: All panel content and secondary buttons update live immediately (including swapping a wild-camp layout into a player-outpost layout if taken). To announce the change without pushing content down, a 34 px status strip slides down (200 ms, ease-out) as a floating overlay pinned along the top inner border of the panel—never shifting the Attack button—showing an icon + short text ("[swords] Under attack", "[shield] Shield up", or "[flag] Taken by [Name]"). It stays while busy/shielded, or auto-fades after 3.5 s (250 ms fade-out) for one-off events like ownership change. Attack disables in-place while busy/shielded.
  - Modern vs Classic: Modern uses a dark translucent slate strip (#1E2830 at 92%) with a 1.5 px amber top rim tucked under the top riveted frame. Classic uses a slim crimson-or-gold ribbon strip tucked under the top wood border, echoing the bone-pinned top ribbon already seen on Classic's own-yard phone panel.
- When it shows / does not show: Shows on busy, shield, or owner swap; suppressed for minor damage or level ticks.
- Scaling to 10+ changes in a few seconds: The single overlay strip replaces its message in place and resets its fade timer (no stacking). However, swapping the entire button layout live on an ownership change still risks a mis-tap on secondary buttons unless paired with a brief click lock.
- Phone vs desktop: Fits cleanly inside the desktop right panel (clear of the X close button); slightly tighter vertically on phone bottom sheets where the drag handle and header sit close to the top edge (requires keeping the overlay slim and clear of the 44 px X close button).
- Cost: Low. Single overlay element with short 200-250 ms transitions; idle otherwise.

Direction C: Freeze-and-Prompt Panel Veil
- What the player sees: On any blocking or structural change (busy, shielded, taken), the panel freezes its current content at 75% opacity (zero layout movement), disables Attack immediately, and presents a centred >= 44 px prompt bar over the action area: "[flag] Taken by [Name] · Update" or "[swords] Under attack · Update". The panel only swaps to the new layout/state when the player taps Update.
  - Modern vs Classic: Modern lays a dark steel translucent veil over the panel body with a weathered brass-gold riveted "Update" button. Classic lays a soft warm-sepia veil over the parchment with a glossy green "Update" pill.
- When it shows / does not show: Triggers on busy, shield, or owner changes; does not trigger on unchanged fields or non-blocking minor damage updates.
- Scaling to 10+ changes in a few seconds: Very calm during rapid churn on one cell—multiple events collapse into a single frozen prompt until tapped. Trade-off: adds an annoying extra tap when a player is just waiting for a battle or shield to finish so they can attack.
- Phone vs desktop: Equally safe from mis-taps on both form factors, with an easy >= 44 px touch target on phone, at the expense of slower flow on touch.
- Cost: Very low. Single static overlay state, zero continuous animation.

Recommendation for Q2:
Direction A (Fixed-Slot In-Place Update + Locked CTA Morph). It keeps Attack pinned at the exact same coordinates with an 800 ms tap-guard so nothing ever jumps under a finger, while giving instant live feedback (and automatic re-enabling when a shield/battle ends) and holding full button-list swaps behind a single safe tap only when ownership actually changes.


Q3: Connection lost

Direction A: Top-Centre Floating Notice Chip (Unified with Existing Offline Notice)
- What the player sees: A compact floating pill centred horizontally just below the top chrome: 36 px visual height (44 px invisible touch hit-area on touch devices), ~125 px wide. Shows a small 16 px amber broken-signal icon + "Not live" + a subtle 14 px circular retry arrow on the right. Fades in with a 6 px slide-down over 220 ms (ease-out), then stays completely still (no pulsing dot, no blink). Tapping it triggers an immediate reconnect: the retry arrow executes one clean 360-degree spin (450 ms, ease-in-out) and text switches to "Retrying…" (with a 2 s tap cooldown so rapid tapping never flickers).
  - Modern vs Classic: Modern uses a dark riveted slate pill (#2A3640 at 94%) with a 1.5 px warm-amber/rust border (#C98A3A), crisp white text, and amber icon (#F5A623). Classic uses a glossy dark-brown wood pill (#4B2B16 at 96%) with a gold bevel border (#C89A54), warm cream text (#FFF5DF), and amber icon.
- When it shows / does not show: Appears only after 5 continuous seconds disconnected (and after the first silent auto-reconnect fails), completely hiding short mobile handoffs. Yields to the existing "You are offline" chip when the device has no network at all so two connection banners never stack. Does not trigger while the browser tab is backgrounded.
  - How it goes away: On reconnect (only if the chip was actually shown), it swaps to a green check/signal icon (#3CD070) + "Live" for 1.5 s, then fades out cleanly over 250 ms.
- Scaling to 10+ changes in a few seconds: Completely independent of cell-update volume. A 10 s anti-flap hold prevents the chip from bouncing in and out on spotty mobile reception—once shown, it waits for 2 s of stable live connection before showing "Live" and clearing.
- Phone vs desktop: Desktop sits centred 12 px below the top bar (clear of the top-left ? button and the right info panel). Phone sits centred 8 px below the floating [?] [Search] ... [Mail] [Filter] [Key] toolbar row (staying well above the bottom sheet and clear of the cramped Modern 6-button toolbar, plus avoiding any dependence on the minimap button which Classic does not have).
- Cost: Negligible. Single HUD pill, zero idle cost, only brief 220-450 ms transitions on connection state changes.

Direction B: Docked Top-Bar Pill (Desktop) / Toolbar-Gap Icon Button (Phone)
- What the player sees: Zero map hexes covered by tucking into existing chrome. On desktop, a 32 px recessed pill fades in (200 ms, ease-out) inside the open space of the top bar just left of the [Map | Yard] toggle (empty in both Modern and Classic), showing an amber broken-signal icon + "Not live". On phone, a 44 x 44 px icon-only square button fades into the open centre gap between [Search] and [Mail] in the floating toolbar row (showing only the amber broken-signal icon, matching Mail/Filter/Key). Tapping retries immediately and pops a brief 1.8 s status label underneath ("Retrying…" / "Live").
  - Modern vs Classic: Modern matches the dark recessed steel pill in the desktop top bar and the iron-framed square toolbar buttons on phone. Classic matches the glossy dark-brown bevel pill in the desktop top bar and rounded brown-leather square buttons on phone.
- When it shows / does not show: Hidden whenever live. Appears after 5 s disconnected; suppressed when full offline notice is active. Goes away silently with a 250 ms fade-out (or 1 s green tick on the icon then fade) once live resumes.
- Scaling to 10+ changes in a few seconds: Unaffected by cell-update traffic; same 10 s anti-flap cooldown stops blinking on unstable connections.
- Phone vs desktop: Desktop fits icon + "Not live" comfortably. Phone must drop the words to icon-only, and on Modern phone (which has 6 buttons across 390 px, including the minimap icon) the remaining gap between Search and Mail is only ~70 px—tight on 360 px Android screens, making the row crowded.
- Cost: Negligible. Single HUD control, zero per-frame idle cost.

Direction C: Corner Control Badge Next to "?"
- What the player sees: Anchored to the top-left ? help button (present in the exact same corner in Modern and Classic, unlike the minimap button). On desktop, a compact 36 px pill sits 10 px to the right of ? showing an amber broken-signal icon + "Not live". On phone, a 44 x 44 px circular icon-only badge drops 8 px directly underneath ? on the left margin; tapping retries and briefly expands a 1.5 s inline label ("Retrying…").
  - Modern vs Classic: Modern matches the circular dark steel ? badge with its warm orange-brown ring. Classic matches the glossy brown ? circle with its tan-gold bevel rim.
- When it shows / does not show: Appears after 6 s disconnected; hidden when live or when full offline notice is active. Fades out silently over 250 ms once reconnected.
- Scaling to 10+ changes in a few seconds: Unaffected by cell-change volume; protected by a 10 s anti-flap hold.
- Phone vs desktop: Completely clear of desktop right panels and phone bottom sheets, though less immediately glanceable on phone because players rarely look beneath the top-left help button.
- Cost: Negligible. Single static HUD badge with 200-250 ms fade transitions.

Recommendation for Q3:
Direction A (Top-Centre Floating Notice Chip). It matches the exact placement and mental model of the existing "You are offline" notice, works identically across Modern and Classic without colliding with the cramped 390 px Modern phone toolbar or relying on Classic's absent minimap, gives a clean >= 44 px tap-to-retry target, and stays completely flicker-free via a 5 s delay, 10 s anti-flap cooldown, and brief 1.5 s "Live" confirmation.
