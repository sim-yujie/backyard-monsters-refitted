# New-player tutorial: guided start, Goals and screen tips

The design for the new-player tutorial (issue #227). It turns the owner's decisions of
2026-10-01 into steps, data, routes and work packages. The owner answered the open questions in a
second round the same day; every section those answers changed is marked "Decided 2026-10-01"
and §10 lists them. The foundation package (WP0) is built; §9.5 says how the three packages build
on it.

Binding inputs: the owner's decisions (13 points and the confirmed step order) and the research
report on Flash's tutorial and the web client today. Citations are `path:line` from the repository
root. `client/` is the Flash ActionScript, `server/` the Bun server, `web/` the new client.

Contents:

1. [Summary](#1-summary)
2. [The guided start, step by step](#2-the-guided-start-step-by-step)
3. [Bob's art](#3-bobs-art)
4. [The staged raid](#4-the-staged-raid)
5. [The practice camp](#5-the-practice-camp)
6. [Goals](#6-goals)
7. [Screen tips](#7-screen-tips)
8. [Server data, routes and anti-cheat](#8-server-data-routes-and-anti-cheat)
9. [Build plan](#9-build-plan) (9.5: how to build on WP0)
10. [Open questions (all decided)](#10-open-questions-all-decided)

## 1. Summary

- **Guided start** (about 8 minutes, new accounts only). Bob, a painted green monster whose
  pointing hand is the pointer, talks in a speech bubble and walks the player through: collect, a
  Sniper Tower, a staged raid by a named wild-monster tribe that the tower wins, Housing
  and 15 free Pokeys, a Map Room and a Flinger, a forced first attack on a private practice camp,
  then Goals, cheap Shiny finishes and 7 days of protection. The server tops up every tutorial
  building to its exact cost and finishes it for free. Nothing waits on a timer. The rest of the UI
  is locked while Bob waits for a tap. Skippable, with a warning; skipping forfeits the gifts.
- **Goals.** Flash's quest list with Flash's exact rewards, minus quests for missing features, plus
  three new ones. Every condition is checked on the server from save data or from server-side
  counters. A Goals button on the dock carries a badge; Claim plays the Collect all ball animation.
  Rewards are capped at storage, and the Claim button shows what will actually arrive. Existing
  saves get a baseline: goals they already meet are marked claimed with no reward.
- **Screen tips.** One to three Bob tips the first time each screen opens, stored per account on the
  server, re-shown by a "?" button.
- **Server.** One new server-only column, `save.onboarding`, holds the guide's step, a ledger of
  every grant, the practice camp's state, goal claims, counters and tips seen. The client cannot
  write it (`/base/save` never touches it). All new routes are yard actions, so each runs under the
  save row lock.
- **Build plan.** A short foundation package (the shared Bob bubble, pointer, targets, column and
  plugin hooks), then three packages in parallel: (a) Goals, (b) guided start with the raid and the
  camp, (c) tips.

## 2. The guided start, step by step

### 2.1 How it runs

- **Who gets it.** Accounts created after this ships, while the `guidedStart` switch is on. A new
  main save starts with `onboarding.guide.state = "pending"`; the first own-yard load shows step 1.
  Existing accounts get `"legacy"` from the migration and never see it (§8.2).
- **Macro steps and micro steps.** The server knows only the macro step (`guide.step`, e.g.
  `build-sniper`). The client splits a macro step into micro steps (open Build, pick the tab, pick
  the card, Build, place) and derives which one applies from what is on screen. A reload resumes at
  the server's macro step; the client works out the micro step again. This replaces Flash's
  `TUTORIAL.Process()` resync (`client/scripts/TUTORIAL.as:104-145`).
- **Advancing.** Steps that grant something advance inside the grant route (the grant and the new
  step are written in one transaction). Steps that grant nothing advance with `guide/advance`,
  which only moves forward along the fixed order and checks the step's own condition where the
  server can see it (§8.3).
- **The blocker.** **Decided 2026-10-01.** (Q16) While the guided start runs, the rest of the UI is
  locked: as Flash did (`TUTORIAL.as:1175-1180`), the screen is dimmed and does not take input while
  Bob waits for a tap; only the pointed-at control and Bob's bubble are live (a spotlight cut-out,
  `web/src/ui/guide/Spotlight.ts`). Panning and zooming the yard stay on during placement so the
  player can find space (that step shows without the blocker). Skip is always visible in the bubble.
- **Rewind.** If the player backs out of a micro step (closes the Build menu, cancels carrying the
  building, closes the building panel), the pointer goes back to the first micro step of that macro
  step. This replaces Flash's `_rewindCondition`. Macro steps never rewind.
- **Skip.** "Skip" in the bubble asks, in the bubble: "Skip the guided start? You'll miss Bob's free
  army and the gifts." [Keep going] [Skip]. Skip calls `guide/skip` (§8.3). Anything already
  granted stays (buildings, Pokeys); nothing more is granted; Goals still work.
- **Replay from Help.** **Decided 2026-10-01.** (Q5) Account menu > Help > "Replay the guided start" is a
  walkthrough tour: Bob's lines and pointers with a Next button on every step, instead of waiting
  for the action. No route is called, no grant is made, nothing is built, and the practice camp is
  not recreated. The staged raid can replay (it touches no data).
- **Phone layout.** Bob's bubble sits bottom-left on desktop (Flash's `BOBBOTTOMLEFTLOW`) and as a
  strip above the dock on a phone (at or below 620 px, the attack scene's `PHONE_WIDTH`,
  `web/src/app/scenes/AttackScene.ts:70`). The pointer flips to point from below when the target is
  near the top edge.

### 2.2 Targets

The pointer resolves a target name to a screen rectangle (`findTarget`,
`web/src/game/guide/targets.ts`). Every DOM target carries a `data-tut="<name>"` attribute, added
in the foundation package (built; the names are the `TutTarget` constants). A name may carry a
parameter after a colon (`build-card:21`, `building:7`). Canvas targets are registered by the scene
that draws them (`registerCanvasTarget(name, (param) => rect)`, a prefix such as `"building:"`
answering every id).

| Target name | What it is | Rendered | Hook (where it is created) |
|---|---|---|---|
| `collect-all` | Collect all button | DOM | add `data-tut` to `.yard-collect__button`, `web/src/ui/yard/CollectAll.ts:179` |
| `dock-build`, `dock-map`, `dock-monsters`, `dock-layout`, `dock-mail`, `yard-switcher` | Dock buttons | DOM | every round button is `dock-<name>` (`web/src/ui/yard/YardDock.ts`, `roundButton`) |
| `dock-goals` | Goals button (new) | DOM | package (a) makes it with `dockButton("goals", …)` (tagged `dock-goals`) and adds it with `YardDock.placeBesideMonsters`, so `YardDock.ts` is not edited |
| `build-tab:defensive`, `build-tab:buildings` | Build menu tabs | DOM | `BuildMenu.ts`, the tab strip |
| `build-card:<type>` | A building card | DOM | `BuildMenu.ts`, `tile`. If the card is on another page, the pointer shows `build-next-page` first |
| `build-go` | Build in the info panel | DOM | add `data-tut` to `.build-info__build`, `BuildMenu.ts:601` |
| `build-here` | Build here while carrying | DOM | add `data-tut` to `.build-placing__here`, `BuildMenu.ts:830` |
| `carry-ghost` | The building being placed | canvas | registered by `YardScene` from the carried ghost's position |
| `building:<id>` | A building on the yard | canvas | registered by `YardRenderer` (world position through the camera) |
| `finish` | Finish free / Finish now in the job block | DOM | add `data-tut` in `web/src/ui/yard/BuildingPanel.ts:905-930` |
| `upgrade`, `instant` | Upgrade and Instant | DOM | add `data-tut`, `BuildingPanel.ts:783`, `:793` |
| `hud-shiny` | Shiny readout | DOM | add `data-tut` to the Shiny control in `web/src/ui/Hud.ts` |
| `mr1-practice` | The practice camp's tile and pin | DOM | added by package (b) in `web/src/ui/maproom1/Mr1ListView.ts:123` and `Mr1MapView.ts:186` |
| `target-attack` | Attack on the target card | DOM | add `data-tut` in `web/src/ui/maproom1/TargetCard.ts:146` |
| `fill-all` | Fill all in the army panel | DOM | existing `.attack-army__fill-all`, `web/src/ui/attack/ArmyPanel.ts:140` |
| `practice-box` | The highlighted drop box | canvas | registered by the practice attack plugin (§5.4) |
| `attack-home` | The end panel's way home | DOM | add `data-tut` in `web/src/ui/attack/EndAttackPanel.ts` |

Built in WP0 beyond this table, for the tips: `build-instant`, `build-cancel-carry`, `repair`,
`repair-all`, `shop-workers`, `shop-<section>` (`shop-protection`), `mail-threads`, `mail-new`,
`monsters-tab:<tab>`, `mr1-tribes`, `mr1-neighbours`, `mr2-range`, `mr2-takeover`, `mr2-find`,
`attack-speed`, `attack-retreat`, `baiter-run`, `champion-feed`, `starter-kits`, `planner-help`.

### 2.3 The steps

Lines are adapted from Flash's `tut_*` strings (`server/public/gamestage/assets/english.json`); the
Flash key is in brackets. "On me" means the server pays the shortfall (§2.4).

| # | Macro step (`guide.step`) | Bob says | Pointer | Advances when | Server grants / validates | Rewind, reload |
|---|---|---|---|---|---|---|
| 1 | `welcome` | "Welcome to Backyard Monsters, {name}! I'm Bob. Give me eight minutes and I'll have your yard ready for anything." [`tut_1`] | none | Next | `guide/advance`: state `pending` to `active` | reload: same |
| 2 | `collect` | "Harvesters work until they're full, so empty them often. Tap Collect all to bank what your Twig Snapper has made." [`tut_3`, `tut_4`] then "Nice! Twigs build and upgrade your buildings." [`tut_5`] | `collect-all` | the bank answers (the starting Snapper holds 200 twigs) | none (no grant) | none |
| 3 | `build-sniper` | a) "Wild monsters are gathering nearby. Let's build a Sniper Tower. Tap Build." [`tut_31`] b) "Open the Defensive tab." [`tut_32`] c) "Pick the Sniper Tower." [`tut_33`] d) "Here's what it does and what it costs. This one's on me: tap Build." [`tut_34`] e) "Drag it onto the grass, then tap Build here." [`tut_35`] | a `dock-build`, b `build-tab-defensive`, c `build-card:21`, d `build-go`, e `build-here` (with `carry-ghost` highlighted) | placement accepted | `guide/build {type: 21, x, y}`: tops up to the cost (1,500 / 2,000 / 500), places it, records `grants["fund:21"]`, step becomes `finish-sniper` | menu closed or carry cancelled: back to a |
| 4 | `finish-sniper` | "Tap your Sniper Tower, then Finish now. Building usually takes time, but not today." [`tut_36`, `tut_37`] | `building:<id>`, then `finish` | the job finishes | `guide/finish {id}`: finishes the recorded building's construction for free, records `grants["finish:21"]`, step becomes `raid` | panel closed: back to the building |
| 5 | `raid` | A banner first: "Legionnaire scouts are attacking!" Then: "WHOA! Just in time, here come some wild monsters! Your Sniper Tower will make short work of them. Sit back and watch." [`tut_40`] At the end: "That's defence: towers fire on anything that comes into range. Those were Legionnaire scouts. Let's strike back before they come back bigger!" [`tut_42`, `tut_44`] | the tower (`building:<id>`) | the raid ends (about 22 s; Skip appears after 3 s) | `guide/advance {from: "raid"}`: sets `onboarding.raidSeen` (Goal D1), step `build-housing`. Nothing else changes (§4) | reload: the raid plays again |
| 6 | `build-housing` | a) "First, your army needs somewhere to live. Tap Build." [`tut_50`] b) "Open the Buildings tab." [`tut_51`] c) "Pick Monster Housing." [`tut_52`] d) "On me again: tap Build." [`tut_53`] e) "Place it on the grass, then tap Build here. You can drag the yard to find space." [`tut_54`] | as step 3, tab `build-tab-buildings`, card `build-card:15` | placement accepted | `guide/build {type: 15}`: top-up to 2,160 / 2,160, `grants["fund:15"]`, step `finish-housing` | as step 3 |
| 7 | `finish-housing` | "Tap your Housing, then Finish now." [`tut_55`] | `building:<id>`, `finish` | the job finishes | `guide/finish {id}`: `grants["finish:15"]`, step `pokeys` | as step 4 |
| 8 | `pokeys` | "I've recruited some Pokeys to help. They're slow and small, but what they lack in strength they make up for in numbers!" [`tut_57`] | the Housing while 15 Pokeys walk in from the yard edge | Next | `guide/army`: housed Pokeys topped up to 15, entry in `grants["army"]`, step `build-maproom` | reload: Pokeys already housed, Next only |
| 9 | `build-maproom` | a) "Now a Map Room, so we can find those Legionnaires. Tap Build." [`tut_90_b`] b) "Buildings tab." c) "Pick the Map Room." d) "On me: tap Build." e) "Place it, then tap Build here." [`tut_91`-`tut_94`] | as step 6, card `build-card:11` | placement accepted | `guide/build {type: 11}`: top-up to 2,000 / 2,000, `grants["fund:11"]`, step `finish-maproom` | as step 3 |
| 10 | `finish-maproom` | "Tap your Map Room, then Finish now. Free again." [`tut_97`] | `building:<id>`, `finish` | the job finishes | `guide/finish {id}`: free finish of the level 1 construction only, `grants["finish:11"]`, step `build-flinger`. **Decided 2026-10-01.** (Q3) A one-off exception to D16, server-checked: only `guide/finish`, only at this step, only the building recorded in `grants["fund:11"]` | as step 4 |
| 11 | `build-flinger` | a) "Last piece: a Flinger, so we can fling our Pokeys into the enemy's yard. Tap Build." [`tut_65`] b-e as before [`tut_66`-`tut_69`] | as step 6, card `build-card:5` | placement accepted | `guide/build {type: 5}`: top-up to 1,000 / 1,000 / 500, `grants["fund:5"]`, step `finish-flinger` | as step 3 |
| 12 | `finish-flinger` | "A Flinger takes 15 minutes, which would normally cost a few Shiny to skip. Today it's free: tap Finish now." [`tut_96`] | `building:<id>`, `finish` | the job finishes | `guide/finish {id}`: `grants["finish:5"]`, opens the practice camp (§5.5), step `open-map` | as step 4 |
| 13 | `open-map` | "Let's find the tribe that attacked you. Tap Map." [`tut_101`] | `dock-map` | Map Room 1 opens | `guide/advance {from: "open-map"}` (no grant) | map closed: back here |
| 14 | `pick-camp` | "This is your map. That glowing camp is a Legionnaire outpost, and it's yours alone to practise on. Tap it." then "Now tap Attack!" [`tut_102`] | `mr1-practice`, then `target-attack` | the attack scene opens | the attack load is the normal Map Room 1 tribe load; the server allows the camp only while it is open for this player (§5.5) | card closed: back to the pin |
| 15 | `attack` | "This is their base: one Sniper Tower and a few walls." [`tut_110`] "Your 15 Pokeys are in the army panel. Tap Fill all to load every one." [`tut_111`] "Now tap inside the glowing box to fling them in." [`tut_112`] During the fight, on timers: "Excellent! Your Pokeys are attacking." [`tut_113`] "Take out that tower and the rest is easy." "Your Pokeys are looting their harvesters!" [`tut_115`] "Flatten the base and you win." [`tut_116`] | `fill-all`, then `practice-box` | the attack ends (auto-end, retreat or quit) | the attack save is the normal Map Room 1 save; the server replays the battle (§5) | left mid-attack: on return the step is still `attack`; the outcome is whatever the server saved |
| 16 | `attack-result` | Won: "Congratulations, you levelled their whole base! Check out that loot." [`tut_120`, `tut_130`] Lost, retreated or quit: "Ouch, the Legionnaires got lucky. Here's a fresh squad of 15 Pokeys: let's go again!" | Won: `attack-home`. Lost: Bob's "Try again" button | Won: home. Lost: Try again | `guide/advance {from: "attack"}` reads the camp's `destroyed`. Won: removes the camp, step `home-goals`. Lost: `guide/army` tops Pokeys up to 15, resets the camp's health, step back to `pick-camp` (§5.6) | reload: the server state decides won or lost |
| 17 | `home-goals` | "You finished a pile of Goals along the way. Tap Goals and claim your rewards." [`tut_131`, `tut_191`] | `dock-goals`, then each Claim | the Goals panel is opened (claiming is the player's choice) | `guide/advance {from: "home-goals"}` (no grant). Claims are ordinary `goals/claim` calls (§6) | panel closed before claiming: Bob says "Don't forget them!" and the step ends anyway |
| 18 | `finish-now` | "One more tip. Instant and Finish now cost Shiny, and early on they're cheap: upgrading your Town Hall to level 2 instantly costs about 24 of your 1,500 Shiny." | `hud-shiny` | Next | `guide/advance` (no grant) | none |
| 19 | `protection` | "Your yard is protected for the next 7 days: other players can't attack you while it lasts. Check Goals for what to do next. Good luck!" [`tut_190`, `tut_191`] | none | Finish | `guide/advance {from: "protection"}`: state `done`, `protected = max(protected, now + 7 days)`, `tutorialstage = 205` | none |

Expected time: about 8 minutes (welcome and collect 40 s; the tower 60 s and three more builds of
45 s each; the raid 25 s; Pokeys 15 s; map and camp 45 s; the attack 60 to 90 s; Goals and the last
tips 90 s).

### 2.4 What the guided start pays for

"Top up to the exact cost" works as Flash's `BASE.Fund` before a tutorial build
(`client/scripts/TUTORIAL.as:396-400`, `:484-488`, `:604-608`, `:682-686`): if the player holds less
than the cost, the tutorial adds the difference, then the full cost is charged. The server does it
in one step without ever handing resources over: the build debits `min(held, cost)` per resource
and records the difference as the grant. The player cannot pull the top-up out by cancelling,
because cancelling a guided-start building is refused while the guide is active (Flash locked
recycling during its tutorial, `tut_recycle_locked`).

| Grant | Most it can be | Once per account |
|---|---|---|
| Sniper Tower top-up | 1,500 twigs, 2,000 pebbles, 500 putty | `grants["fund:21"]` |
| Housing top-up | 2,160 twigs, 2,160 pebbles | `grants["fund:15"]` |
| Map Room top-up | 2,000 twigs, 2,000 pebbles | `grants["fund:11"]` |
| Flinger top-up | 1,000 twigs, 1,000 pebbles, 500 putty | `grants["fund:5"]` |
| Four free finishes | the four constructions above | `grants["finish:<type>"]` |
| Pokeys | housed Pokeys topped up to 15 (never above) | `grants["army"]`, a list; each entry records how many were added. Only in steps `pokeys` and `attack-result` |
| Protection | `protected = max(protected, now + 7 days)` | at `done` or `skipped` |

As in Flash, the first top-ups use up the starting 1,600 twigs and 1,600 pebbles; the Goals claimed
in step 17 refill them (T1, D1, CR3, C18, C17 and WM1 pay 11,300 twigs, 11,300 pebbles, 3,500 putty
and 6,500 goo, plus the camp's loot).

## 3. Bob's art

**What Flash had.** There is no Bob character art anywhere in the repo. "Bob" is the name of the
variable holding the tutorial popup (`_mcBob`, `client/scripts/TUTORIAL.as:96`), a
`TUTORIALPOPUPMC_CLIP` symbol embedded from `client/scripts/_assets/assets.swf`
(`client/scripts/TUTORIALPOPUPMC_CLIP.as`). Read straight out of the SWF, that symbol holds:

| Part | What it is | Size |
|---|---|---|
| `mcBlocker` | vector shape (sprite 1215, shape 1214) | 2000x1500, the dimming screen |
| `mcBubble` | vector shape (sprite 1217, shape 1216) | 172x70, stretched to fit the text |
| `mcText`, `mcButton` | a text field and a standard button | — |
| `mcArrow` (`TUTORIALARROWMC_CLIP`) | sprite 1173 wrapping one bitmap: a **green monster hand, pointing** (JPEG with alpha, bitmap 1168) | **100x49** |

So the Flash guide was a speech bubble plus a green pointing hand, with no character. The only
other trace is `fivestarbob.png`, a rating popup image that `client/scripts/POPUPS.as:688` loads
from `popups/` and that is not in the repo. Nothing in `server/public/assets/popups/`,
`server/public/assets/ui/` (the seven `mr2_tutorial_*.png` are 315x180 yard screenshots),
`web/public` or `docs/art` is a guide. How it was read: `assets.swf` is uncompressed (`FWS`); a
small Node reader of the SWF tags found the symbol and wrote the hand out. The reader and the
extracted hand are in the session scratchpad, not committed.

**Usable at web sizes?**

- The bubble: no art needed. Rebuild it in CSS (rounded, cream fill, dark outline, tail to the
  bottom left), so it fits any text length and theme.
- The hand: fine at 1x on desktop (100x49), soft on a 2x screen, where it needs 200x98. Usable as a
  stand-in, not as the final asset.
- Bob himself: there is nothing to reuse.

****Decided 2026-10-01.**** (Q4) The owner picked design A, "Round buddy": a painted green monster whose
hand is the pointer. The four files below are made and published (`web/public/guide/`, written by
`web/tools/gen-guide-art.py` from the approved cut-outs `bob-A-bust-cut.png`,
`bob-A-worried-cut.png`, `bob-A-icon-cut.png` and `bob-A-hand-cut.png`). The hand is 200x93 (drawn
100x47). The bubble ships with the bust from the start; the original Flash hand is no longer
needed.

**Proposal (as made).** Paint the guide with the pipeline that made the approved portraits
(`docs/art/portraits.md`: Google Gemini through Antigravity's image tool, original art as the
reference, owner review before anything is committed):

| File (`web/public/guide/`) | Content | Size (2x what is drawn) |
|---|---|---|
| `bob.webp` | Bob, bust, cheerful, transparent background | 240x240, drawn at 120 px (80 px on a phone) |
| `bob-worried.webp` | the same, worried (the lost-attack retry) | 240x240 |
| `bob-icon.webp` | head only, for tips | 96x96, drawn at 48 px |
| `hand.webp` | Bob's pointing hand, repainted from bitmap 1168 | 200x93, drawn at 100x47 |

Concept for Bob (Q4): a friendly green monster whose hand **is** Flash's pointer, so the one piece of
Flash guide art carries into the new guide. Prompt references: the extracted hand plus two approved
portraits (`web/public/portraits/C1.webp`, `C2.webp`) for style. Until the paintings are approved,
the bubble ships with the original hand scaled up and no portrait.

## 4. The staged raid

- **What it is.** A scripted animation on the player's own yard, drawn by the client only. No route
  is called during it, no save data changes, and no combat engine runs. When it ends the client
  calls `guide/advance {from: "raid"}`, which sets `raidSeen`.
- **Presented as a tribe attack.** **Decided 2026-10-01.** The raid is shown as a NAMED wild-monster tribe
  attack: a banner "Legionnaire scouts are attacking!" before the monsters walk in, and Bob names
  the tribe after. It stays client-only and harmless: nothing is lost. Real periodic tribe raids
  are a separate feature (#226), not part of this build; when #226 lands, the later defence goal
  becomes "survive a tribe attack" (§6.1, N1).
- **Monsters.** 8 Octo-oozes (C2), from the original sprite sheets, as Flash's
  `CUSTOMATTACKS.TutorialAttack` sent (`client/scripts/CUSTOMATTACKS.as:75-103`). Six die, one per
  shot; the last two turn and run away (`TUTORIAL.as:1490-1497`).
- **Path.** They spawn just off the yard edge in the direction from the Town Hall to the new Sniper
  Tower, about 600 yard units from the tower, and walk straight at it in a loose group.
- **The tower.** The real Sniper Tower sprite fires with the attack screen's shot effect every 2
  seconds, its level 1 rate (80 ticks times the rearm multiplier 2, at 80 ticks a second:
  `server/src/game-rules/combat/combatStatsData.ts:72-74`, `stats.ts:65`, `:448`), once the first
  ooze is inside its 300-unit range. Each hit kills one ooze with the death puff.
- **Timeline, about 22 s.** 0 to 4 s walk in; 4 to 16 s six shots; 16 to 19 s two run off; 19 to 22 s
  Bob's closing line. The camera pans to the tower and zoom is locked. Skip appears in the bubble
  after 3 s and still counts as watched.
- **Safety.** The raid layer sits above the yard and owns its sprites; it reads the tower's
  position and nothing else. A reload during the raid restarts it.

## 5. The practice camp

### 5.1 Layout

The camp reuses Map Room 1 base id `"1"`, the id Flash's tutorial camp had and that the server
still recognises as a tribe (`server/src/game-data/tribes/v1/index.ts:18-30`). Its template
(`server/src/game-data/tribes/v1/tutorial.ts`) is replaced with this layout. `X`/`Y` are the
building's corner in yard units, as in every tribe template. Footprints:
`server/src/game-rules/combat/yard.ts:188-240`. Health: `combatStatsData.ts:186-290`.

| id | Type | Building | Level | X | Y | Footprint | Health |
|---|---|---|---|---|---|---|---|
| 0 | 14 | Town Hall | 1 | -65 | -65 | 130x130 | 4,000 |
| 1 | 21 | Sniper Tower | 1 | 110 | -35 | 70x70 | 6,000 |
| 2 | 1 | Twig Snapper | 1 | -35 | 95 | 70x70 | 500 |
| 3 | 2 | Pebble Shiner | 1 | -35 | -165 | 70x70 | 500 |
| 4 | 6 | Storage Silo | 1 | -195 | -40 | 80x80 | 750 |
| 5-12 | 17 | Wall, 8 blocks | 1 | -105 | -80, -60, -40, -20, 0, 20, 40, 60 | 20x20 each | 1,000 each |

- One Sniper Tower at level 1 (range 300, 100 damage every 2 s). Walls at level 1 behind the Town
  Hall, on the side away from the drop box, so they are seen but never in the Pokeys' way.
- No monsters (`monsters: {}`): the old template's three Octo-oozes and its `storedata` go.
- Resources for loot: 3,000 twigs, 3,000 pebbles, 1,000 putty, 1,000 goo [PLACEHOLDER].
- Health that counts towards victory: 11,750 (walls are not counted,
  `server/src/game-rules/combat/damagePercent.ts:42-48`). Victory is 90% (`stats.ts:99`), and the
  Map Room 1 save marks a tribe destroyed at that threshold
  (`server/src/services/maproom/v1/scaledMR1Tribes.ts`, `tribeBattle`).

### 5.2 The drop box

- Drop centres allowed: **X from 300 to 420, Y from -60 to 60** (yard units), east of the tower.
- The drop ring for 15 Pokeys has radius 100 (`max(200, bucket / 4) / 2`, the fling event's `r`,
  `server/src/game-rules/combat/types.ts:458-470`). The box's nearest edge is 120 from the tower's
  footprint, so no point in the box is "too close to a building".
- The whole box is inside the tower's range (the far corner is 281 from the tower's centre), and
  from every point in it the tower is the nearest building. Pokeys (target group "all",
  `web/src/game/combat/rules/stats.ts:217-224`) go for the tower first, which is the lesson.

### 5.3 Why 15 level 1 Pokeys always win

A level 1 Pokey has 200 health and hits for 60 every 60 ticks, 80 damage a second
(`combatStatsData.ts:1342-1350`, `stats.ts:151`). The tower does 100 every 2 s, so it kills one
Pokey every 4 s and cannot hit two at once (no splash).

- **Pessimistic case:** the tower fires from the moment they land, and the Pokeys need 5 s before
  they start hitting. Pokeys alive at time t: 15 - t/4. Damage they deal before the last one dies
  (t = 60 s): the integral from 5 to 60 of 80(15 - t/4) dt, **about 30,000**, against the 11,750 that
  wins. A 2.6x margin even if they never killed the tower.
- **Expected case:** they hit the tower first. Its 6,000 health is gone by about t = 11 s, with at
  most 2 Pokeys lost. Thirteen Pokeys (1,040 a second) then take the remaining 5,750 in about 6 s
  plus walking. The battle ends well inside a minute; the limit is 300 s.

**The automated proof** (package b), using the real engine:

1. `server/src/game-data/tribes/v1/practiceCamp.test.ts` (Bun). For every drop point on a 10-unit
   grid over the box (13 x 13 = 169 points) and seeds 1 to 10, build the fling log
   `{ v: 1, seed, events: [{ kind: "fling", t: 0, x, y, r: 100, monsters: { C1: 15 } }] }` and run
   `replayAttack` (`server/src/game-rules/combat/replay.ts`) over the camp's `buildingdata` and
   `resources`, kind `"tribe"`, levels `{ C1: 1 }`, player level 1. Assert for every run that
   `damage >= 90` (destroyed), plus margin checks so a future rule change is caught before it bites:
   `damage === 100`, the battle over within 90 s (`ticks <= 7,200`), and at least 7 Pokeys alive
   (`creepsKilled <= 8`) [thresholds PLACEHOLDER: set from the first run, with slack].
2. `web/src/game/attack/practiceBox.test.ts` (Vitest). For each of the 169 points, `judgeDrop`
   (`web/src/game/attack/AttackInput.ts:378`) on the camp's yard with a 15-Pokey bucket says legal.
   This proves the box never shows a red ring.

Both run in CI. If either fails after a combat change, the camp is retuned, not the test.

### 5.4 The forced select-all and the drop box (client)

A new attack plugin, `web/src/game/attack/plugins/practice.ts`, registered on `ATTACK_PLUGINS`
(`web/src/game/attack/attackPlugins.ts`), mounts only when the target is base `"1"` and the guide is
at `attack`:

- **Army panel.** Every stepper is disabled; only Fill all is live, with the pointer on it. Once the
  bucket holds all 15 Pokeys, Fill all and the steppers stay locked. This needs a small lock API on
  `web/src/ui/attack/ArmyPanel.ts`.
- **Drop box.** A pulsing isometric box drawn on `battleLayer` over the box in §5.2 and registered as
  the `practice-box` target. Taps outside it are refused before the normal legality check (a drop
  filter API on `AttackInput`), with the ring red and Bob saying "Inside the glowing box, please!".
- **One drop.** After the drop the box fades; there is nothing left to fling.
- **Speed and Retreat.** 1x and 2x work. Retreat stays (Q12); retreating leads to the free retry.
- **Bob's battle lines** run on the timers in step 15.

### 5.5 How the server creates, shows and removes the camp

Map Room 1 tribes are already per player: each player's copy lives in their own `Maproom` row
(`tribedata`, `server/src/types/TribeData.ts`), and an attack builds the tribe from the template
plus that copy (`server/src/services/maproom/v1/tribeSaveV1.ts`). The camp uses that machinery.

| When | What the server does | Where |
|---|---|---|
| `guide/finish` on the Flinger (step 12) | Ensures the `Maproom` row; adds `{ baseid: "1", tribeHealthData: {} }` to `tribedata`; `onboarding.camp = { state: "open", openedAt }` | new `server/src/services/maproom/v1/practiceCamp.ts` |
| `GET /bm/maproom1` | While `camp.state` is `"open"`, the answer carries one extra target: `practice: { baseid: "1", name: "Practice camp", level: 1 }` | `server/src/controllers/maproom/getMapRoom1.ts`, `services/maproom/v1/mapRoom1View.ts` |
| Attack load on base `"1"` | Allowed only while this player's camp is open; any other player, or this one after removal, gets `notYourTribe` | `services/maproom/v1/mr1TribeAttack.ts` (`requireAttackableMR1Tribe`) |
| Attack save | Unchanged: the replay, the loot, the flung Pokeys leaving housing | `services/maproom/v1/scaledMR1Tribes.ts` |
| Map Room 1 refresh | Keeps entry `"1"` while open and never respawns it | `services/maproom/v1/createMR1Tribes.ts` |
| Won (`guide/advance` from `attack`) or `guide/skip` | Deletes `tribedata` entry `"1"`, removes `wmstatus` entry 1, `camp.state = "removed"` | `practiceCamp.ts` |

Only its owner sees it: each player's map lists their own tribes, and the neighbour list holds
player yards only. It never appears on Map Room 2. A player has at most one camp: `camp.state` is
per account and the id is fixed. A Map Room 1 tribe attack does not touch the attacker's damage
protection.

### 5.6 The free retry

If the server's copy of the camp is not destroyed when the player comes back (lost, retreated, quit,
or the 420 s attack session lapsed), step 16 shows the worried Bob and Try again:

- `guide/army` tops housed Pokeys back up to 15 (the attack already took the flung ones out of
  housing) and resets the camp's `tribeHealthData` and `destroyed`. It does **not** reset `looted`,
  so losing on purpose cannot farm the camp's loot twice.
- The step goes back to `pick-camp`. Retries are unlimited while the guide is active; the top-up
  rule caps a retry at 15 Pokeys in housing.

## 6. Goals

### 6.1 The list

Every quest in `client/scripts/QUESTS.as`, in Flash's display order (`order`), with Flash's exact
reward `[twigs, pebbles, putty, goo]` and monster rewards. Flash's Shiny rewards appear only on
quests marked drop. "Prereq" means the goal shows once that goal is claimed.

Status: **keep** (as Flash), **keep\*** (kept, but the server reads the condition differently),
**drop** (feature missing in the web, or never paid in Flash), **new**. The server check column
refers to §6.2; "B" is a building check.

| Order | Id | Goal | Condition | Reward t / p / pu / g (+ monsters) | Prereq | Status | Server check |
|---|---|---|---|---|---|---|---|
| 1 | C0 | Build a Town Hall | Town Hall | 0 / 750 / 0 / 0 | — | drop (`block: true`, never paid) | — |
| 2 | C1 | The Gathering Begins | a harvester | 1,100 / 800 / 0 / 0 | — | drop (blocked) | — |
| 3 | C8 | Open For Business | General Store | 500 / 1,500 / 500 / 500, 1,000 Shiny | — | drop (blocked) | — |
| 4 | U1 | Next Level | any building at level 2 | 4,000 / 4,600 / 500 / 0 | — | keep | B: any building `l >= 2` |
| 5 | T1 | Sniper Tower | Sniper Tower | 2,000 / 2,000 / 0 / 0 | — | keep | B: type 21 |
| 6 | D1 | First Blood | defend the yard | 800 / 800 / 1,000 / 1,000 | — | keep\* | `raidSeen`: the staged raid, as Flash's tutorial completed D1 itself (`TUTORIAL.as:457-459`) |
| 7 | CR3 | Home Sweet Home | Monster Housing | 2,000 / 2,000 / 2,000 / 2,000 | — | keep | B: type 15 |
| 8 | C18 | Flinger | Flinger | 0 / 0 / 0 / 1,000 | — | keep | B: type 5 |
| 9 | C17 | Monster Maps | Map Room | 0 / 0 / 0 / 1,000 | — | keep | B: type 11 |
| 10 | WM1 | Junior Destroyer | destroy a Legionnaire base | 6,500 / 6,500 / 500 / 1,500 | — | keep | counter `tribes.legionnaire >= 1`; the practice camp counts as Legionnaire |
| 11 | CR2 | Start Hatching | Hatchery | 1,000 / 1,000 / 0 / 1,000 | — | keep | B: type 13 |
| 12 | C3 | Next Level II | one of each harvester at level 2 | 8,000 / 8,000 / 8,000 / 8,000 | — | keep | B: types 1, 2, 3 and 4 each `l >= 2` |
| 13 | M1 | Mushroom Soup | pick 5 mushrooms | 1,000 / 1,000 / 500 / 500 | — | keep | counter `mushrooms >= 5` |
| 14 | T2 | Cannon Tower | Cannon Tower | 2,000 / 2,000 / 0 / 0 | — | keep | B: type 20 |
| 15 | S1 | Storage Silo | Storage Silo | 2,000 / 2,000 / 1,000 / 1,000 | — | keep | B: type 6 |
| 16 | C13 | Town Hall Level 2 | Town Hall 2 | 4,000 / 4,000 / 0 / 500 | — | keep | B: type 14 `l >= 2` |
| 17 | EM1 | Radio Tower | Radio Tower (type 113) | 20,000 each | C13 | drop (email feature; type 113 is not buildable) | — |
| 18 | WM2 | Novice Destroyer | destroy a Kozu base | 10,000 each | — | keep | counter `tribes.kozu >= 1` |
| 19 | CR1 | Monster Locker | Monster Locker | 1,000 / 1,000 / 5,000 / 0 | C13 | keep | B: type 8 |
| 20 | UC2 | Unlock Octo-ooze | C2 unlocked | 10 Octo-oozes | CR1 | keep | `lockerdata.C2.t == 2` |
| 21 | UC3 | Unlock Bolt | C3 unlocked | 10 Bolts | UC2 | keep | lockerdata |
| 22 | UC4 | Unlock Fink | C4 unlocked | 10 Finks | UC3 | keep | lockerdata |
| 23 | C9 | Level 3 Twig Snapper | type 1 at L3 | 20,000 / 0 / 0 / 0 | — | keep | B |
| 24 | C10 | Level 3 Pebble Shiner | type 2 at L3 | 0 / 10,000 / 0 / 0 | — | keep | B |
| 25 | C11 | Level 3 Putty Squisher | type 3 at L3 | 0 / 0 / 2,500 / 0 | — | keep | B |
| 26 | C12 | Level 3 Goo Factory | type 4 at L3 | 0 / 0 / 0 / 2,000 | — | keep | B |
| 27 | S2 | Storage Silo Level 2 | type 6 at L2 | 4,000 / 4,000 / 2,000 / 2,000 | S1 | keep | B |
| 28 | BK1 | Resource Gatherer | bank 1,000 in one tap | 1,000 each | — | keep | counter `bestBank >= 1,000` |
| 29 | C4 | Level 4 Twig Snapper | type 1 at L4 | 20,000 / 0 / 0 / 0 | C9 | keep | B |
| 30 | C5 | Level 4 Pebble Shiner | type 2 at L4 | 0 / 20,000 / 0 / 0 | C10 | keep | B |
| 31 | C6 | Level 4 Putty Squisher | type 3 at L4 | 0 / 0 / 10,000 / 0 | C11 | keep | B |
| 32 | C7 | Level 4 Goo Factory | type 4 at L4 | 0 / 0 / 0 / 10,000 | C12 | keep | B |
| 33 | WM3 | Savage Destroyer | destroy an Abunakki base | 20,000 each | — | keep | counter `tribes.abunakki >= 1` |
| 34 | S3 | Storage Silo Level 3 | type 6 at L3 | 8,000 / 8,000 / 4,000 / 4,000 | S2 | keep | B |
| 35 | C14 | Town Hall Level 3 | Town Hall 3 | 5,000 / 5,000 / 2,500 / 2,500 | C13 | keep | B |
| 36 | C51 | Catapult | Catapult | 20,000 / 0 / 0 / 0 | — | keep | B: type 51 |
| 37 | S4 | Storage Silo Level 4 | type 6 at L4 | 16,000 / 16,000 / 8,000 / 8,000 | S3 | keep | B |
| 38 | S5 | Storage Silo Level 5 | type 6 at L5 | 32,000 / 32,000 / 16,000 / 16,000 | S4 | keep | B |
| 39 | UC5 | Unlock Eye-ra | C5 unlocked | 2 Eye-ras | C14 | keep | lockerdata |
| 40 | UC6 | Unlock Ichi | C6 unlocked | 15 Ichis | UC5 | keep | lockerdata |
| 41 | UC7 | Unlock Bandito | C7 unlocked | 15 Banditos | UC6 | keep | lockerdata |
| 42 | UC8 | Unlock Fang | C8 unlocked | 15 Fangs | UC7 | keep | lockerdata |
| 43 | BK2 | Resource Collector | bank 20,000 in one tap | 2,000 each | BK1 | keep | counter |
| 44 | BL1 | Monster Juice | juice 10 monsters | 0 / 0 / 1,000 / 1,000 | — | keep | counter `juiced >= 10` |
| 45 | C15 | Town Hall Level 4 | Town Hall 4 | 20 Brains | C14 | keep | B |
| 46 | T3 | Tesla Tower | Tesla Tower | 10,000 / 10,000 / 10,000 / 0 | — | keep | B: type 25 |
| 47 | UC9 | Unlock Brain | C9 unlocked | 20 Brains | C15 | keep | lockerdata |
| 48 | UC10 | Unlock Crabatron | C10 unlocked | 20 Crabatrons | UC9 | keep | lockerdata |
| 49 | UC11 | Unlock Project X | C11 unlocked | 5 Project X | UC10 | keep | lockerdata |
| 50 | WM4 | Dread Destroyer | destroy a Dreadnaut base | 40,000 each | — | keep | counter `tribes.dreadnaut >= 1` |
| 51 | C16 | Town Hall Level 5 | Town Hall 5 | 5 Teratorns | C14 | keep | B |
| 52 | UG1 | Gorgo the Great | Gorgo at level 6 | 0 / 0 / 0 / 800,000 | HG1 | keep | `champion` entry G1 at level 6 |
| 53 | UG2 | Drull the Destroyer | Drull at level 6 | 0 / 0 / 0 / 800,000 | HG2 | keep | champion G2 |
| 55 | UC13 | Unlock Wormzer | C13 unlocked | 5 Wormzers | UC11 | keep | lockerdata |
| 56 | UC12 | Unlock D.A.V.E. | C12 unlocked | 2 D.A.V.E.s | UC13 | keep | lockerdata |
| 57 | BK3 | Resource Trader | bank 100,000 in one tap | 10,000 each | BK2 | keep | counter |
| 57 | UG3 | Fomor the Fearless | Fomor at level 6 | 0 / 0 / 0 / 800,000 | HG3 | keep | champion G3 |
| 58 | BK4 | Resource Mogul | bank 500,000 in one tap | 50,000 each | BK3 | keep | counter |
| 59 | BL2 | Monster Smoothie | juice 100 | 0 / 0 / 10,000 / 10,000 | BL1 | keep | counter |
| 59-67 | SW4-SW12 | Siege weapons: decoy, vacuum and jars to levels 1, 5 and 10 | Siege Lab levels | a siege weapon each | C16, then chains | drop (no Siege Factory or Siege Lab in the web) | — |
| 60 | BL3 | Monster Milkshake | juice 1,000 | 0 / 0 / 100,000 / 100,000 | BL2 | keep | counter |
| 61 | BL4 | Monster Margarita | juice 5,000 | 0 / 0 / 1,000,000 / 1,000,000 | BL3 | keep | counter |
| 62 | M4 | Golden Mushroom Booty | 5 golden mushrooms | 1,000 / 1,000 / 500 / 500 | M1 | keep | counter `goldMushrooms >= 5` |
| 63 | M2 | Mushroom Pizza | 100 mushrooms | 5,000 each | M1 | keep | counter |
| 64 | M5 | Golden Mushroom Bling | 20 golden | 5,000 each | M4 | keep | counter |
| 65 | M6 | Golden Mushroom Jackpot | 50 golden | 50,000 each | M5 | keep | counter |
| 66 | M3 | Mushroom Burger | 200 mushrooms | 10,000 / 10,000 / 20,000 / 20,000 | M2 | keep | counter |
| 67 | HG1 | Hatch Gorgo | Gorgo in the Champion Cage | 0 / 0 / 0 / 10,000 | — | keep | `champion` has a G1 |
| 68 | HG2 | Hatch Drull | Drull | 0 / 0 / 0 / 10,000 | — | keep | G2 |
| 69 | HG3 | Hatch Fomor | Fomor | 0 / 0 / 0 / 10,000 | — | keep | G3 |
| 70 | FAN | Become a fan | Facebook | 50 Shiny | — | drop | — |
| 71, 74, 76 | INVITE1, INVITE5, INVITE10 | Invite friends | Facebook invites | 25 / 45 / 65 Shiny | chain | drop | — |
| 72-73 | GA1-GA3 | Gifts accepted | Facebook gifts | 1,000 to 20,000 each | chain | drop | — |
| 80 | N1 | Test Your Defences | finish a practice run with the Wild Monster Baiter (needs Town Hall 4 and a Monster Locker) | 5,000 / 5,000 / 2,500 / 2,500 [PLACEHOLDER] | CR1 | **new** | counter `baiterRuns >= 1` (Decided 2026-10-01: a real recorded run, not just the building; see §6.2). Becomes "survive a tribe attack" when #226 lands |
| 81 | N2 | Master Planner | save a layout in the Yard Planner | 2,000 / 2,000 / 0 / 0 [PLACEHOLDER] | — | **new** | `save.savetemplate` holds a layout |
| 82 | N3 | Into the Wild | move to Map Room 2 (Map Room level 2) | 10,000 each [PLACEHOLDER] | C14 | **new** | B: type 11 `l >= 2` |

Counts: Flash has 85 quests; 65 are kept (12 of them monster unlocks), 20 dropped, and 3 are new.
The kept list pays 373,300 twigs, 343,900 pebbles,
1,398,000 putty and 3,816,500 goo in all, most of it in the champion and juice goals at the far end.
The first thirteen (orders 4 to 16) pay about 33,300 / 33,900 / 13,500 / 17,500, roughly 48 hours of
level 1 output: the lever the research found missing.

Monster names from `server/src/game-data/monsterCatalogue.ts`. Monster rewards from `QUESTS.as`'s
`_loc1_` table (C2 10, C3 10, C4 10, C5 2, C6 15, C7 15, C8 15, C9 20, C10 20, C11 5, C12 2,
C13 5) and C15's 20 Brains and C16's 5 Teratorns (`QUESTS.as:622-667`).

### 6.2 How each condition is checked on the server

Every check is a pure function of the main save plus `onboarding` (`services/goals/goalRules.ts`).

| Kind | Source | Notes |
|---|---|---|
| B: a building of type T at level L or more | `save.buildingdata`: an entry with `t == T` and level `>= L`, not still under construction (`cB`) | Level read as the yard code reads it (a missing `l` after construction is level 1). U1 accepts any type. C3 needs each of types 1 to 4 |
| Monster unlocked | `save.lockerdata[id].t == 2` | as Flash's `CREATURELOCKER` reads it |
| Champion hatched, or at level 6 | `save.champion` (an entry of that type, and its level) | |
| Layout saved (N2) | `save.savetemplate` holds at least one layout (`server/src/controllers/yardplanner/getLayouts.ts:29`) | `/base/save` cannot write it |
| `raidSeen` (D1) | `onboarding.raidSeen` | set by `guide/advance` from the raid step, or by the raid in the replay (Q6) |
| Counters | `onboarding.counters`, written only by server routes | below |

The counters are new because nothing on the server counts these today, and `save.stats` cannot be
trusted for them: `/base/save` lets the Flash client write it (`saveKeys` in
`server/src/database/models/save.model.ts`).

| Counter | Incremented in | By |
|---|---|---|
| `mushrooms`, `goldMushrooms` | `POST /bm/yard/mushroom/pick` (`server/src/controllers/yard/mushrooms.ts`) | 1 per pick; golden is the server's own roll (`services/yard/mushrooms.ts`) |
| `bestBank` | `POST /bm/yard/bank` (`controllers/yard/bank.ts`) | `max(bestBank, total banked by this request)`; Collect all counts as one tap |
| `juiced` | `POST /bm/yard/juice` (`controllers/yard/juice.ts`) and `POST /bm/yard/bunker/remove` when a Juicer works (`bunker.ts`) | monsters juiced by the request. As Flash (`BUILDING9.Prep`, called from `CreepBase.changeModeJuice`), from Housing and from a bunker alike; a champion's juicing never counted. Left out (accepted 2026-10-01): Flash also counted monsters a "juice"-behaviour Map Room 1 tribe juiced during an attack (`HOUSING.as:104-114`) |
| `tribes.<name>` | the Map Room 1 tribe save, when the replay marks the tribe destroyed (`services/maproom/v1/scaledMR1Tribes.ts`) | +1 to the tribe whose template holds that base id; base `"1"` counts as Legionnaire |
| `baiterRuns` | `goals/baiter-run`, sent by the Baiter scene when a practice run really ends (not a stop), spending the one-use token `goals/baiter-start` issued as the run began (Redis, 15 min) | +1, only with that token, at least 5 s after it was issued, and with a finished Wild Monster Baiter (type 19) standing. **Decided 2026-10-01.** A Baiter run is a client simulation, so this is the "tiny server-side record of finished Baiter runs" the owner asked for: the server cannot replay it, but a run counts only from a token it issued |

**Done is sticky.** When a condition is first seen met (in `goals/state`, `goals/claim` or the guided
start), `goals[id].done` is written with the time, so recycling a building later does not take a
finished goal back. Flash's `_global` stats only ever went up, to the same effect.

### 6.3 The Goals screen and the claim flow

- **Button.** A Goals button on the yard dock (`data-dock="goals"`), next to Monsters, with a badge
  showing how many goals are ready to claim. The count comes with every yard action answer and with
  `/base/load` (`onboarding.goalsReady`, §8.1), so it refreshes when jobs finish.
- **Panel.** "Ready to claim" first; then the next five open goals in order, each with its
  condition, a progress figure where there is one (e.g. "3 / 5 mushrooms") and its reward; then a
  folded "Claimed" list. Goals whose prereq is not claimed are hidden.
- **Claim.** Claim calls `goals/claim {id}`. On success the row closes and the yard plays the
  **Collect all ball animation**: balls of each rewarded resource fly from the point under the Goals
  button to the Town Hall, and the HUD counts up as they land. This reuses `planFlights` and
  `CollectFxLayer.launch` (`web/src/game/yard/collectFx.ts:128`, `CollectFxLayer.ts:194`) through one
  new method, `YardRenderer.throwGrant(amounts, from)`, beside `throwBank`
  (`web/src/game/yard/YardRenderer.ts:482`). Monster rewards walk in to Housing instead (the guided
  start's Pokey walk-in, shared).
- **Over the cap.** **Decided 2026-10-01.** (Q2) Rewards are CAPPED at the storage cap, and the excess is
  lost (unlike Flash's `BASE.Fund(..., true)`, `QUESTS.as:1787`). The claim pays through the yard
  action's ordinary `credit`, which clamps every credit to the cap (`services/yard/credit.ts`); no
  uncapped grant is needed. The Claim button shows what will actually be received, worked out with
  the same rule (the client from the yard state's `resources` and `caps`; the server's
  `goals/state` may send it as `fitCredit`'s `credited`), for example "+1,000 (storage full)" when
  only 1,000 of a 2,000 reward fits.
- **Monster rewards** need room for the whole reward in Housing; otherwise Claim is disabled with,
  for example, "Make room in Housing for 10 Octo-oozes" (Q10).
- **Refusals.** A claim the server refuses (not met, already claimed, no room) answers 409 with the
  reason; the panel shows it and refreshes.

### 6.4 Existing accounts

Per the decisions, the guided start is for new accounts only.

**Decided 2026-10-01.** (Q1; there are no real players yet) Existing saves get a baseline: the goals an
existing save already meets are marked claimed with NO reward (`claimed: "baseline"`); only goals
met after that pay. The migration marks every existing main save `goalsBaseline: "pending"`; the
Goals package applies the baseline the first time it reads such a save (the goal rules are
TypeScript, not SQL), in the same locked write, and sets `goalsBaseline` to the time. A `NULL`
column (a sandbox yard, or a yard made while `guidedStart` is off) reads the same way.

- Counters start at 0 for everyone (Flash's `stats.mp` and its kin were written by the client), D1
  is met for legacy accounts (`raidSeen: 1`), and WM1-WM4 are shown only to accounts on Map Room 1
  (Q9).
- The owner's own account is deleted and recreated before launch, so it takes the new-player path.

## 7. Screen tips

### 7.1 How tips work

- **When.** The first time a screen opens after the guided start has ended or been skipped, Bob
  shows its tips in sequence: the bubble with the small Bob icon, a pointer at the target, Next (or
  "Got it" on the last), dots for 1 to 3, and "Skip tips", which marks the screen seen. A tip whose
  target is not on screen is skipped. Tips never show while the guided start is active.
- **Seen.** Stored on the server per account and per screen (`onboarding.tips[screen] = time`), so
  it carries across devices. Written by `tips/seen {screen}` when the sequence ends or is skipped.
- **The "?" button.** Every screen with tips gets a small "?" in its header that replays its tips at
  any time without changing "seen". The planner keeps its existing help card as its "?"
  (`web/src/ui/yard/PlannerHelp.ts`); its `localStorage` flag (`bymr.planner.hint-seen`,
  `PlannerHelp.ts:34`) moves to the server on first load.
- **Skippers** also get the tips for the screens the guided start teaches (yard, Build menu,
  building panel); players who finished the guided start do not (Q14).
- **Finding screens.** Each screen emits `guideBus.emit("screen", { id, root, header })` when it
  opens (added once in the foundation package), so the tip runner attaches without editing the
  screens again.

### 7.2 The tips

| Screen (`id`) | # | Text | Target |
|---|---|---|---|
| Yard (`yard`, skippers only) | 1 | "Harvesters fill up and then stop. Tap Collect all to bank everything at once." | `collect-all` |
| | 2 | "Build opens every building you can add. More unlock as your Town Hall grows." | `dock-build` |
| | 3 | "Goals pay big rewards. Check them whenever you're unsure what to do next." | `dock-goals` |
| Build menu (`build`) | 1 | "Build instantly spends Shiny to skip the wait. Early on it's cheap." | Build instantly (`BuildMenu.ts:658`) |
| | 2 | "Greyed-out buildings say what they need, usually a bigger Town Hall." | the first gated card |
| Building panel (`building`) | 1 | "Upgrade makes a building stronger or faster. Each job needs a free worker." | `upgrade` |
| | 2 | "Jobs with 5 minutes or less left finish free. Longer ones cost a little Shiny." | `finish` (when a job runs) |
| | 3 | "Instant does the whole upgrade now, for Shiny." | `instant` |
| Damaged building (`repair`) | 1 | "Damaged buildings stop working. Repair them here, or use Repair all on the banner." | Repair (`BuildingPanel.ts:743`), Repair all (`DamageBanner.ts:59`) |
| Mail (`mail`) | 1 | "Attack reports, notices and messages from other players land here." | the thread list (`MailboxScreen.ts:201`) |
| | 2 | "Write to any player you've met." | New message (`MailboxScreen.ts:203`) |
| | 3 | "In a player's thread you can propose a truce: neither of you can attack the other while it lasts." | Propose truce (when a player thread is open) |
| Monsters, Unlock (`monsters-unlock`) | 1 | "Unlock new kinds of monster here. It takes putty and time, one at a time." | the first lockable card (`LockerTab.ts`) |
| Monsters, Hatch (`monsters-hatch`) | 1 | "Hatcheries turn goo into monsters. Queue several and come back later." | the queue (`HatchTab.ts:193`) |
| | 2 | "Hatched monsters move into Housing. When it's full, hatching waits." | the Housing bar |
| Monsters, Housing (`monsters-housing`) | 1 | "This is your army. Juicing a monster turns it back into goo." | the juice control (`HousingJuice.ts`) |
| Monsters, Train (`monsters-train`) | 1 | "The Monster Academy trains a monster type to a higher level: more health, more damage." | the first academy slot (`TrainTab.ts`) |
| Monsters, Lab (`monsters-lab`) | 1 | "The Monster Lab researches a special ability for one monster type at a time." | the Lab slot (`LabTab.ts`) |
| Shop (`shop`) | 1 | "More workers mean more jobs at once." | the workers item (`ShopScreen.ts:271`, `data-item`) |
| | 2 | "Protection stops other players attacking you. It stacks." | the Protection section (`ShopScreen.ts:243`, `data-section="protection"`) |
| Yard Planner (`planner`) | — | its existing help card (six demos) | `PlannerHelp.ts` |
| Map Room 1 (`mr1`) | 1 | "Wild monster tribes are always there to raid. A flattened tribe is back in 10 minutes." | the tribe list |
| | 2 | "Neighbours are real players. Protected yards can't be attacked." | the neighbour list |
| Map Room 2 (`mr2`) | 1 | "The blue area is your Flinger's reach. Attacking further away costs resources." | `RangeControl` (`web/src/ui/maproom/RangeControl.ts:19`) |
| | 2 | "Beat a wild camp or a player's outpost and you can take it over as your own outpost." | `TakeoverControl` (`TakeoverControl.ts:54`) |
| | 3 | "Find jumps to your yard, your outposts or any cell." | `FindControl` (`FindControl.ts:11`) |
| Attack (`attack`, not on the practice camp) | 1 | "Pick your army here. Fill all loads as many as your Flinger can carry." | `fill-all` |
| | 2 | "Tap open ground to drop. A red ring means too close to a building." | the yard |
| | 3 | "2x speeds the battle up. Retreat ends it and keeps what you've looted." | the speed group (`AttackScene.ts:526`), Retreat (`:545`) |
| Baiter (`baiter`) | 1 | "Send pretend wild monsters at your own yard to see how your defences hold. Nothing is lost." | Run (`BaiterPanel.ts`) |
| Champion Cage (`champion`) | 1 | "Feed your champion every day to keep it growing." | Feed (`ChampionPanel.ts`) |
| Outposts (`outposts`) | 1 | "Switch between your yard and your outposts here." | the yard switcher (`YardSwitcher.ts:50`) |
| | 2 | "A Starter Kit sets a new outpost up quickly." | `StarterKitPicker.ts` |

The wording is a draft for the owner; all of it lives in one catalogue file
(`web/src/game/guide/tipsCatalogue.ts`).

## 8. Server data, routes and anti-cheat

### 8.1 What is stored

One new column on `save`: **`onboarding jsonb NULL`**. It is not a `@FrontendKey` (an attacker's load
of someone's yard never carries it), and it is in neither `saveKeys` nor `attackSaveKeys`
(`save.model.ts`), so `/base/save` cannot write it. Only the main save's row holds it.

```json
{
  "v": 1,
  "guide": { "state": "active", "step": "build-housing", "startedAt": 1790000000, "endedAt": null },
  "grants": {
    "fund:21": { "r1": 0, "r2": 400, "r3": 500, "r4": 0, "id": 7, "at": 1790000060 },
    "finish:21": { "id": 7, "at": 1790000075 },
    "army": [{ "added": 15, "at": 1790000200 }]
  },
  "raidSeen": 1790000110,
  "camp": { "state": "open", "openedAt": 1790000400 },
  "goals": { "T1": { "done": 1790000075, "claimed": 1790000700 }, "U1": { "claimed": "baseline" } },
  "goalsBaseline": 1790000000,
  "counters": {
    "mushrooms": 0, "goldMushrooms": 0, "bestBank": 200, "juiced": 0, "baiterRuns": 0,
    "tribes": { "legionnaire": 1, "kozu": 0, "abunakki": 0, "dreadnaut": 0 }
  },
  "tips": { "mail": 1790003000 }
}
```

- `guide.state`: `pending` (new account, not started), `active`, `done`, `skipped`, or `legacy`
  (existing account). The replay is client-only and stores nothing.
- `tutorialstage` (the existing column) stays: 0 while the guide is pending or active, 205 at `done`
  or `skipped`. Banking keeps paying full points below 200 (`server/src/services/yard/bank.ts:72-77`),
  as it did during Flash's tutorial. The web client never reads `tutorialstage`;
  `devConfig.skipTutorial` keeps applying to the Flash client only.
- A new config switch, `devConfig.guidedStart` (`guidedStartOn`, `server/src/config/GameConfig.ts`):
  `GUIDED_START=1` on, `GUIDED_START=0` off; unset, on everywhere but production, where it stays off
  until (a), (b) and (c) are merged and the owner has played it through (§9.1). Local development
  and tests see the guide, which `skipTutorial` would otherwise hide. Off, a new main save gets no
  record at all, which reads as `legacy`: no guided start, Goals with the baseline.

What the client receives:

- `/base/load` (the owner's build-mode load of the main yard or an outpost, not Inferno) adds
  `onboarding`, the summary below.
- Every `/bm/yard/*` answer adds the same `onboarding` to `YardState`
  (`server/src/services/yard/yardState.ts`, frozen: an agreed addition, §9.2), read from the main
  row after the action.
- The summary (`services/onboarding/summary.ts`, built):
  `{ guide: { state, step?, building? }, camp: "none" | "open" | "removed", goalsReady, tips }`.
  `building` is the building the guide paid for and has not finished yet (the newest `fund:<type>`
  grant without its `finish:<type>`), so the pointer finds it after a reload. The grant ledger and
  the counters are never sent.
- `goals/state` returns the full list with status, for the panel.

### 8.2 Migration

`server/src/database/migrations/20261002_AddOnboardingToSave.ts`:

1. `ALTER TABLE "bym"."save" ADD COLUMN IF NOT EXISTS "onboarding" jsonb NULL;`
2. `UPDATE "bym"."save" SET "onboarding" = '{"v":1,"guide":{"state":"legacy"},"raidSeen":1,"goalsBaseline":"pending"}' WHERE "type" = 'main' AND "onboarding" IS NULL;`
3. **Decided 2026-10-01.** (Q1) The goals a legacy save already meets are marked `claimed: "baseline"`, with
   no reward, the first time the Goals package reads it (`goalsBaseline: "pending"`), in TypeScript
   (the rules are not SQL).

New main saves get `{ "v": 1, "guide": { "state": "pending" } }` from
`server/src/game-data/getDefaultBaseData.ts` while `guidedStart` is on. A `NULL` read anywhere
counts as `legacy` with the baseline pending (`readOnboarding`, `services/onboarding/state.ts`).

### 8.3 Routes

All are yard actions, `POST /api/:apiVersion/bm/yard/<path>`, listed in each package's own route
file (`controllers/yard/goals.ts`, `guide.ts`, `tips.ts`), which `yardRoutes`
(`server/src/controllers/yard/index.ts`) spreads in. Each runs under the save row lock, catches the yard up
first and answers with the yard state (`server/src/controllers/yard/yardAction.ts`). All refuse on an
outpost (`notInOutpost`).

| Path | Body | Allowed when | Does |
|---|---|---|---|
| `guide/advance` | `{ from: step }` | `from` equals the stored step; state `pending` or `active` | checks the step's condition (next table) and moves to the next step |
| `guide/build` | `{ type, x, y }` | step is `build-<type>`; no `fund:<type>` grant yet | `planBuild` (`server/src/services/yard/build.ts:359`) with the debit cut to `min(held, cost)`; records the grant and the building id; step `finish-<type>` |
| `guide/finish` | `{ id }` | step is `finish-<type>`; `id` is the recorded building; its construction is running | finishes the construction for free (the completion `planSpeedup` uses, `server/src/services/yard/speedup.ts:82`, with Shiny 0; for the Map Room only its level 1 construction); records `finish:<type>`; next step. After the Flinger, also opens the camp |
| `guide/army` | `{}` | step `pokeys`, or step `attack-result` with the camp not destroyed | tops housed C1 up to 15 (`monsters.housed`, `server/src/services/yard/production.ts:183`); on a retry also resets the camp's health; appends to `grants.army` |
| `guide/skip` | `{}` | state `pending` or `active` | state `skipped`, `tutorialstage` 205, protection `max(protected, now + 7 days)`, camp removed |
| `goals/state` | `{}` | any | marks newly met goals done; returns the list |
| `goals/claim` | `{ id }` | goal met or done, not claimed, prereq claimed, Housing room for monster rewards | pays the reward capped at storage (`credit`, Decided 2026-10-01), adds monsters to `housed`, writes `claimed` |
| `goals/baiter-start` | `{}` | a finished Wild Monster Baiter stands | issues a one-use run token (Redis, 15 min) |
| `goals/baiter-run` | `{ token }` | the token this player was issued, unspent, at least 5 s old; a finished Baiter stands | `counters.baiterRuns + 1` (goal N1) |
| `tips/seen` | `{ screen }` | `screen` is a known screen id | writes `tips[screen]` |

`guide/advance` checks, by step:

| From | Server checks and effect |
|---|---|
| `welcome` | state `pending`; sets `active` and `startedAt` |
| `collect` | none (no grant) |
| `raid` | a finished Sniper Tower stands; sets `raidSeen` |
| `pokeys` | `grants.army` has an entry |
| `open-map` | the camp is open |
| `pick-camp` | none: the attack load itself refuses anything but this player's open camp |
| `attack` | reads `tribedata["1"]`: destroyed, then camp removed and step `home-goals`; not destroyed, then step `attack-result` |
| `home-goals`, `finish-now` | none |
| `protection` | sets `done`, `endedAt`, `tutorialstage` 205, protection |

Existing routes that change:

- `build/cancel` refuses a building recorded in `grants` while the guide is active
  (`server/src/controllers/yard/build.ts`).
- The Map Room 1 read and the tribe attack load, for the camp (§5.5).
- The four counter hooks (§6.2).

### 8.4 Anti-cheat rules

1. **The client cannot write any of it.** `onboarding` is outside `saveKeys` and `attackSaveKeys`;
   only the routes above and the four counter hooks write it.
2. **Every grant at most once.** Each grant has a ledger key in `grants`, written in the same locked
   transaction as its effect. A route whose key already exists refuses (`409 alreadyGranted`).
3. **Every grant is tied to its step.** Grant routes check `guide.state == "active"` and the exact
   step, and move the step on in the same transaction, so a replayed request finds the wrong step.
4. **Top-ups cannot be taken away.** A top-up is a smaller debit on the exact building being placed,
   never a credit, and cancelling that building is refused while the guide runs.
5. **Pokeys are capped, not added.** `guide/army` fills housed Pokeys up to 15, so a second call
   gives nothing. Retries do not reset the camp's `looted`.
6. **Skip is final.** After `skipped` (or `done`) every guide route refuses. The replay calls none of
   them.
7. **Goals are re-checked at claim.** The server evaluates the condition from save data and counters
   when the claim arrives; the client's "ready" is only a display. `claimed` is written in the same
   transaction as the reward.
8. **Counters move on server events only:** a mushroom the server rolled, a bank the server paid, a
   juice the server performed, a tribe the server's replay destroyed.
9. **The camp is private.** The attack load allows base `"1"` only for a player whose own camp is
   open (§5.5), and the save replays the battle on the server as for every tribe.
10. **Tips grant nothing,** so `tips/seen` only validates the screen id.

## 9. Build plan

### 9.1 Shape

A short foundation package first (one agent), then three packages in parallel. The foundation
exists so that the three never edit the same file: it lands the shared pieces and the hooks each
package plugs into.

```
WP0 foundation ──┬── (a) Goals
                 ├── (b) Guided start, staged raid, practice camp
                 └── (c) Screen tips
```

Feature switch: `guidedStart` stays off in production until (a), (b) and (c) are merged and the
owner has played it through once.

### 9.2 WP0: foundation (first, one agent)

| Area | Files |
|---|---|
| Column and state | `server/src/database/migrations/20261002_AddOnboardingToSave.ts` (new); `server/src/database/models/save.model.ts` (`onboarding`, not a frontend key, in neither save key list); `server/src/services/onboarding/state.ts` (new: types, read with defaults, `legacy` for null); `server/src/game-data/getDefaultBaseData.ts` (pending guide on new main saves); `server/src/config/GameConfig.ts` (`guidedStart`) |
| Yard action contract (agreed changes to frozen files) | `server/src/controllers/yard/yardAction.ts`: `onboarding` in `YardSlices`; `em` (the request's transaction) on `YardActionInput`, for the practice camp's `Maproom` row; no `grant` (rewards are capped, Decided 2026-10-01, so the ordinary `credit` serves). `server/src/services/yard/yardState.ts`: the `onboarding` summary (`services/onboarding/summary.ts`), calling a stub `server/src/services/goals/summary.ts` that returns 0 until (a) fills it. `services/yard/poolView.ts`: `onboarding` lives on the main row |
| Load | `server/src/controllers/base/load/baseLoad.ts`: `onboarding` on the own-yard build load |
| Docs | `docs/server-api.md`: the column, the summary field and the planned routes |
| Web types | `web/src/api/types.ts`: `Onboarding` |
| Bob kit (shared, built once) | `web/src/ui/guide/BobBubble.ts` (text, mood, Next / Finish / Got it, Skip, step dots, bottom-left or phone strip); `GuideArrow.ts` (bouncing hand, auto-flip); `Spotlight.ts` (blocker with a cut-out); `GuideOverlay.ts` (the three together, following a target); `guideArt.ts`; `web/src/ui/styles/guide.css`; `web/src/game/guide/targets.ts` (`data-tut` lookup and `registerCanvasTarget`); `web/src/game/guide/guideBus.ts` (events: `screen`, `buildMenu`, `carry`, `placed`, `panel`, `jobFinished`, `banked`, `mapOpened`, `targetPicked`, `attackEnded`); `web/src/ui/overlay.ts` (a `guide` layer above `modal`); the attack scene's `AttackMounts.guide` |
| Hooks sweep | `data-tut` attributes and one `guideBus.emit` per screen in `CollectAll.ts`, `YardDock.ts`, `BuildMenu.ts`, `BuildingPanel.ts`, `Hud.ts`, `ShopScreen.ts`, `MonstersScreen.ts`, `MailboxScreen.ts`, `PlannerBar.ts`, `MapRoom1Ui.ts`, `TargetCard.ts`, `MapRoomUi.ts`, `AttackScene.ts`, `ArmyPanel.ts`, `EndAttackPanel.ts`, `BaiterPanel.ts`, `ChampionPanel.ts`, `YardSwitcher.ts`, `StarterKitPicker.ts`, `DamageBanner.ts`; canvas targets in `YardRenderer.ts` |
| Yard plugin registry | `web/src/game/yard/yardPlugins.ts` (new): `YARD_PLUGINS`, like `ATTACK_PLUGINS`, with mounts (renderer, camera, store, overlay, dock, notices, scene controls); `web/src/game/yard/plugins.ts` imports one stub per package (`plugins/goals.ts`, `guidedStart.ts`, `tips.ts`); `web/src/app/scenes/YardScene.ts` mounts them. This keeps (a), (b) and (c) out of `YardScene.ts`. The server's twin: one stub route file per package, spread into `yardRoutes` |
| Art | Bob A, approved: `web/public/guide/{bob,bob-worried,bob-icon,hand}.webp` from `web/tools/gen-guide-art.py` |

### 9.3 The three packages

| | (a) Goals | (b) Guided start, raid, camp | (c) Screen tips |
|---|---|---|---|
| Server, new | `server/src/game-data/goals.ts` (the §6.1 table); `server/src/services/goals/goalRules.ts`, `claim.ts`; fills `summary.ts`; `server/src/controllers/yard/goals.ts` | `server/src/services/onboarding/guidedStart.ts` (steps and checks); `server/src/controllers/yard/guide.ts`; `server/src/services/maproom/v1/practiceCamp.ts`; `server/src/game-data/tribes/v1/practiceCamp.test.ts` | `server/src/services/onboarding/tips.ts` (screen ids); `server/src/controllers/yard/tips.ts` |
| Server, changed | `controllers/yard/mushrooms.ts`, `bank.ts`, `juice.ts` (counters); `services/maproom/v1/scaledMR1Tribes.ts` (tribe counter) | `game-data/tribes/v1/tutorial.ts` (camp layout); `services/maproom/v1/mr1TribeAttack.ts`, `createMR1Tribes.ts`, `mapRoom1View.ts`; `controllers/maproom/getMapRoom1.ts`; `controllers/yard/build.ts` (cancel refusal) | none (its route file is a WP0 stub) |
| Web, new | `web/src/ui/goals/GoalsPanel.ts`, `goals.css`; `web/src/api/goals.ts`; `web/src/game/yard/plugins/goals.ts` | `web/src/game/guide/steps.ts` (§2.3 as data); `web/src/game/yard/plugins/guidedStart.ts` (the runner); `web/src/game/guide/stagedRaid.ts`, `StagedRaidLayer.ts`; `web/src/game/attack/plugins/practice.ts`; `web/src/game/attack/practiceBox.test.ts`; `web/src/api/guide.ts` | `web/src/game/guide/tipsCatalogue.ts`; `web/src/game/guide/TipRunner.ts`; `web/src/ui/guide/HelpButton.ts`; `web/src/game/yard/plugins/tips.ts`; `web/src/api/tips.ts` |
| Web, changed | none for the Goals button (`dockButton` and `placeBesideMonsters`, §9.5); `web/src/game/yard/YardRenderer.ts` (`throwGrant` only); the Baiter scene's end (`goals/baiter-run`) | `web/src/ui/attack/ArmyPanel.ts` (lock API); `web/src/game/attack/AttackInput.ts` (drop filter API); `web/src/game/attack/plugins.ts` (one import line); `web/src/ui/maproom1/Mr1ListView.ts`, `Mr1MapView.ts`, `TargetCard.ts`; `web/src/game/maproom1/mr1Model.ts`; `web/src/app/scenes/MapRoom1Scene.ts`; `web/src/ui/AccountMenu.ts` (Help, replay) | `web/src/ui/yard/PlannerHelp.ts` (the seen flag moves to the server) |
| Uses from WP0 | collect-fx (existing); the badge needs nothing else | Bob kit, Spotlight, targets, guideBus; `dock-goals` from (a) (step 17 shows Bob without a pointer if that button is not there yet) | Bob kit, guideBus `screen` events |
| Tests | goal rules per kind; claim refusals (not met, claimed, prereq, no room); counters; the reward capped at storage and the Claim button's figure; `goals/baiter-run` | every guide route's refusals (wrong step, twice, after skip); top-up arithmetic; cancel refused; camp listed and attackable only for its owner; the §5.3 proofs | `tips/seen` validation; the runner skips missing targets |

Shared pieces, built once in WP0 and never re-implemented: the Bob bubble, the pointer, the
spotlight, the target resolver, the guide bus, the `onboarding` types and the yard plugin registry.
The Pokey walk-in animation is built by (b) and exported for (a)'s monster rewards; until (b) lands,
(a) shows the HUD count only.

### 9.4 Dependencies and order

1. WP0, then (a), (b) and (c) in parallel. (c) can start as soon as the Bob kit and the guide bus
   exist.
2. (b)'s step 17 points at (a)'s Goals button and degrades without it.
3. Bob's paintings (§3) are independent: they need the owner's approval, not code, and drop into
   `web/public/guide/`.
4. Before `guidedStart` is turned on: a live run on a fresh test account (not the owner's), a skip,
   a lose-and-retry, and a reload at every step.

### 9.5 How to build on WP0

WP0 is built (branch `feat/tutorial-wp0`). It holds no Goals logic, no guided-start steps and no
tips content: only the pieces below. Each package owns the files in its column and touches nothing
else; anything outside them that a package needs is a question for the team lead, not an edit.

**Files each package owns.** "New" files do not exist yet; "stub" files exist, empty, for the
package to fill; "edit" files are shared and listed against one package only.

| | (a) Goals | (b) Guided start, raid, camp | (c) Screen tips |
|---|---|---|---|
| Server, stub | `controllers/yard/goals.ts` (`goalsRoutes`), `services/goals/summary.ts` (`goalsReady`) | `controllers/yard/guide.ts` (`guideRoutes`) | `controllers/yard/tips.ts` (`tipsRoutes`) |
| Server, new | `game-data/goals.ts`, `services/goals/*` | `services/onboarding/guidedStart.ts`, `services/maproom/v1/practiceCamp.ts`, `game-data/tribes/v1/practiceCamp.test.ts` | `services/onboarding/tips.ts` |
| Server, edit | `controllers/yard/mushrooms.ts`, `bank.ts`, `juice.ts`; `services/maproom/v1/scaledMR1Tribes.ts` (counters) | `game-data/tribes/v1/tutorial.ts`; `services/maproom/v1/mr1TribeAttack.ts`, `createMR1Tribes.ts`, `mapRoom1View.ts`; `controllers/maproom/getMapRoom1.ts`; `controllers/yard/build.ts` (cancel refusal) | none |
| Web, stub | `game/yard/plugins/goals.ts` | `game/yard/plugins/guidedStart.ts` | `game/yard/plugins/tips.ts` |
| Web, new | `ui/goals/*`, `api/goals.ts` | `game/guide/steps.ts`, `stagedRaid.ts`, `StagedRaidLayer.ts`; `game/attack/plugins/practice.ts` (and its import line in `game/attack/plugins.ts`); `game/attack/practiceBox.test.ts`; `api/guide.ts` | `game/guide/tipsCatalogue.ts`, `TipRunner.ts`; `ui/guide/HelpButton.ts`; `api/tips.ts` |
| Web, edit | `game/yard/YardRenderer.ts` (`throwGrant` only); the Baiter scene's end, to post `goals/baiter-run` | `ui/attack/ArmyPanel.ts` (lock API), `game/attack/AttackInput.ts` (drop filter); `ui/maproom1/Mr1ListView.ts`, `Mr1MapView.ts` (`mr1-practice`); `game/maproom1/mr1Model.ts`; `app/scenes/MapRoom1Scene.ts`; `ui/AccountMenu.ts` (Help, the tour) | `ui/yard/PlannerHelp.ts` (the seen flag moves to the server) |

Not to be edited by any package: `YardScene.ts`, `YardDock.ts`, `yardAction.ts`, `yardState.ts`,
`controllers/yard/index.ts`, the WP0 kit under `web/src/ui/guide/` and `web/src/game/guide/`
(`guideBus.ts`, `targets.ts`), `yardPlugins.ts`, `web/src/api/types.ts`'s `Onboarding`, and the
screens WP0 swept for `data-tut` and `guideBus` (§9.2). A missing hook is added by the team lead's
call, not by a package.

**Shared server APIs.**

- `services/onboarding/state.ts`: the `Onboarding` type and its parts; `readOnboarding(save)` (every
  field with its default; `NULL` is legacy with `goalsBaseline: "pending"`);
  `updateOnboarding(save, change)`, the only way to write the column: return its result as
  `slices: { onboarding }` from a yard action, or assign it outside one (the Map Room 1 tribe save);
  `guideOpen(onboarding)`; `emptyCounters()`. Grant keys are `fund:<type>`, `finish:<type>` and
  `army` (a list).
- `services/onboarding/summary.ts`: `onboardingSummary(save)`, sent on every yard answer and the
  own-yard load. (a) fills `goalsReady` in `services/goals/summary.ts` (pure: it must not write);
  `tips` and `guide` are already there.
- Yard actions (`controllers/yard/yardAction.ts`): `slices.onboarding`; `em` on the input, the
  request's transaction, for the camp's `Maproom` row (persist through it; the wrapper flushes);
  rewards through the ordinary `credit` (capped). `fitCredit` (`services/yard/credit.ts`) says what
  a credit will come to, for the Claim button's figure.
- Routes go in the package's own route file as `{ path, controller: yardRoute(action) }`; every
  tutorial route refuses on an outpost (leave `outposts` unset).
- `devConfig.guidedStart`: new main saves start `pending` only while it is on.

**Shared web APIs.**

- Types (`web/src/api/types.ts`): `Onboarding` (the summary), `GuideState`, `CampState`. The own
  yard's `YardStore.save.onboarding` holds the latest: the load's, then every answer's (it is a
  `YARD_STATE_KEYS` field, merged like the rest).
- Yard plugins (`web/src/game/yard/yardPlugins.ts`): push a `YardPlugin` onto `YARD_PLUGINS` in the
  package's own `game/yard/plugins/<name>.ts`. It is mounted on the player's own yard (main or
  outpost) once the store is up and the yard drawn, and its teardown runs when the yard closes or
  reloads. `YardMounts` gives `store`, `binding`, `renderer`, `camera`, `canvas`, `overlay`
  (`content`, `modal`, `guide`), `dock`, `hud`, `notices`, and `scene` (`YardSceneControls`:
  `openBuildMenu`, `closeBuildMenu`, `focusBuilding`, `closePanel`, `selectedBuilding`, `openMap`,
  `openMonsters`, `openShop`, `centreOn`, `plannerOpen`, `carrying`).
- The dock: `dockButton(name, label, art, onClick)` makes a round button like the dock's own,
  tagged `dock-<name>`; `YardDock.placeBesideMonsters(element)` puts it in. (a)'s Goals button is
  `dockButton("goals", …)`.
- Bob (`web/src/ui/guide/`): `GuideOverlay` (on `overlay.guide`) is the one to use:
  `show({ text, mood?, icon?, actions?, dots?, skip?, target?, side?, block?, onTargetFound? })`,
  `hide()`, `destroy()`. It re-finds the target every frame, points Bob's hand at it, and, unless
  `block: false`, dims and blocks everything but the target and the bubble. `BobBubble`,
  `GuideArrow` (`placeArrow`) and `Spotlight` are its parts, usable alone. Art: `guideArt.ts`
  (`bobBust(mood)`, `BOB_ICON`, `BOB_HAND`). Styles: `ui/styles/guide.css`.
- Targets (`web/src/game/guide/targets.ts`): `findTarget(name)`; `registerCanvasTarget(name or
  "prefix:", resolve)` for a canvas thing (b registers `practice-box`); `tutTarget(element, name)`
  for a new DOM control (a tags nothing by hand: `dockButton` does it; b tags `mr1-practice`);
  `TutTarget` lists every name. The own yard registers `building:<id>` and `carry-ghost`.
- Events (`web/src/game/guide/guideBus.ts`): `guideBus.on(name, listener)` returns its
  unsubscribe. `screen { id, root, header }` from every screen in `GuideScreen` as it opens (a
  Monsters tab each time it is switched to), `buildMenu { open, tab? }`, `carry { type | null }`,
  `placed { type, id }`, `panel { building | null }`, `jobFinished { jobs }`, `banked { banked }`,
  `mapOpened { map }`, `targetPicked { baseid, kind }`, `attackEnded { baseid, destroyed }`. (c)'s
  "?" goes in `header` when there is one.
- The attack scene's plugins get `mounts.guide` (the guide layer) for Bob in the practice attack.

**Order of work and merging.** The three packages branch from WP0's commit and can merge in any
order: their stub files are the only shared files they fill, each owned by one package. (b)'s
step 17 points at `dock-goals` and shows Bob without a pointer while (a) has not landed.

## 10. Open questions (all decided)

**Decided 2026-10-01.** The owner answered every question in a second round; the answers override the
proposed defaults and are written into the sections above.

| # | Question | Proposed default | Decided 2026-10-01 |
|---|---|---|---|
| Q1 | Existing accounts and Goals: claimable for everything already met (up to about 373K twigs / 344K pebbles / 1.4M putty / 3.8M goo plus monsters), or a baseline? | The stated default is claimable. My recommendation: baseline (goals already met are marked claimed, no reward), so only progress after launch pays | Baseline: goals already met are marked claimed with no reward (§6.4) |
| Q2 | Goal rewards above the storage cap? | Yes, uncapped, as Flash (`BASE.Fund(..., true)`) | Capped at the cap; the excess is lost. The Claim button shows what will actually be received, e.g. "+1,000 (storage full)" (§6.3) |
| Q3 | The free finish of the Map Room's level 1 construction is an exception to D16 ("the Map Room cannot be rushed with Shiny") | Allow it for that one construction only | A one-off exception for the tutorial's L1 Map Room, server-checked and tied to the step (§2.3, step 10) |
| Q4 | Bob's look. Flash had no character art, only a bubble and a green pointing hand | Paint a green monster Bob whose hand is the pointer, with the portraits pipeline; the owner approves the paintings | Design A, "Round buddy"; its hand is the pointer (§3) |
| Q5 | Replay from Help: a tour with Next buttons (no grants, no camp; the raid replays), rather than doing the steps again | Tour | A tour with Next buttons; no grants, no camp, no builds (§2.1) |
| Q6 | D1 "First Blood" is met by watching the staged raid. A skipper can earn it by replaying the raid from Help | Allow it: D1 is a Goal, not a guided-start gift | Yes |
| Q7 | New goals: Baiter, Yard Planner layout, Map Room 2. Their rewards are placeholders | These three, with the placeholder rewards in §6.1 | Yes, with the placeholder rewards |
| Q8 | The Baiter goal can only check that a Baiter is built: its runs never reach the server | Building only | Overridden: the Baiter goal needs an actual finished practice run, recorded on the server (`baiterRuns`, §6.1, §6.2); it becomes "survive a tribe attack" when #226 lands |
| Q9 | WM1-WM4 need Map Room 1 tribes. Hide them on Map Room 2, or also count Map Room 2 wild camps of the same tribe? | Hide on Map Room 2 for now | Yes, hidden |
| Q10 | Monster rewards when Housing is short: wait for room, or take what fits (Flash offered to take what fits and lose the rest) | Wait for room | Yes, wait for room |
| Q11 | Does skipping also restart the 7 days of protection? | Yes: `max(protected, now + 7 days)` at skip, as at finish | Yes |
| Q12 | Retreat during the practice attack | Allowed; it leads to the free retry | Yes |
| Q13 | Map Room before Flinger (the decisions' order) or Flinger before Map Room (Flash's) | Map Room, then Flinger | Yes, Map Room then Flinger |
| Q14 | Skippers get the tips for the yard, Build menu and building panel | Yes | Yes |
| Q15 | Flash had a protection counter on the HUD (`tut_190`); the web has none | No new HUD element: Bob says it, and the Shop's Protection section shows the time left | Yes, no new HUD element |
| Q16 | The guided start dims and blocks the rest of the UI while it waits for a tap | Yes, as Flash's blocker; Skip always available | Yes: the UI is locked except the target Bob points at; Skip always visible (§2.1) |
| Q17 | The camp's loot (3,000 / 3,000 / 1,000 / 1,000) | Placeholder; tune after the first playtest | Yes, placeholders |
