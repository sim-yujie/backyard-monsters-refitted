/**
 * What Moloch's Descent says and shows (`docs/design/inferno.md` §2.4 and §4,
 * WP 1.13), word for word from Flash's `english.json` under the key named
 * beside each (`server/public/gamestage/assets/english.json`). Flash's `<b>`,
 * `<i>` and line breaks are dropped; nothing else is changed.
 */

/** The 13 Moloch yards, base ids 201-213 (`maproom_inferno/DescentLayer.as:299-311`). */
export const DESCENT_YARD_COUNT = 13;

/** The Descent yard's base id: yard 1 is 201 (`molochTribes.ts`). */
export const descentBaseid = (yard: number): string => String(200 + yard);

/* ── Art ── */

/** The map itself, 700 x 1842 (`DescentView.as:118`, "ui/descent_maproom2.jpg"; `_MAPSIZE`). */
export const DESCENT_MAP_ART = "/assets/ui/descent_maproom2.jpg";
export const DESCENT_MAP_SIZE = { width: 700, height: 1842 } as const;

/** Moloch's three faces (`INFERNO_DESCENT_POPUPS.as:13-17`). */
export const MOLOCH_NEUTRAL = "/assets/popups/portrait_moloch.png";
export const MOLOCH_GLOAT = "/assets/popups/portrait_muloch_gloat.png";
export const MOLOCH_WHIMPER = "/assets/popups/portrait_muloch_whimper.png";

/**
 * Where each yard sits on the map, map pixels (`DescentLayer.as:66`,
 * `descentBaseProps`, read by yard number in `setMapLinear`).
 */
export const DESCENT_YARD_SPOTS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 350, y: 260 },
  { x: 550, y: 340 },
  { x: 350, y: 420 },
  { x: 135, y: 440 },
  { x: 270, y: 620 },
  { x: 550, y: 560 },
  { x: 450, y: 775 },
  { x: 150, y: 885 },
  { x: 540, y: 1010 },
  { x: 330, y: 1170 },
  { x: 155, y: 1390 },
  { x: 540, y: 1360 },
  { x: 350, y: 1765 },
];

/**
 * Which of Flash's seven yard pictures a yard wears (`DescentMonsterBase.SetLevelArt`):
 * two yards to a picture, the headquarters its own.
 */
export const descentYardArt = (yard: number): number => Math.min(Math.ceil(yard / 2), 7);

/* ── The map ── */

/** `btn_returnhome`, `map_attack_btn`, `descent_depthBar`. */
export const RETURN_HOME = "Return Home";
export const ATTACK = "Attack";
export const DEPTH = "Depth";

/** Ours: the map's title, where Flash's window had none. */
export const DESCENT_TITLE = "Moloch's Descent";

/**
 * The depth bar's warning (`DescentBasePopup.setDepth`): Caution at 9-10,
 * Warning at 11-12. Flash's yard 13 falls through to no word, kept so.
 */
export const depthWarning = (yard: number): string =>
  yard === 9 || yard === 10 ? "Caution" : yard === 11 || yard === 12 ? "Warning" : "";

/** How full the depth bar is, percent (`100 / maxDepth * level`, `maxDepth` 13). */
export const depthPercent = (yard: number): number => Math.max((100 / DESCENT_YARD_COUNT) * yard, 1);

/** `map_msg_nomonsters`: Attack with nothing housed and no champion (`PlayerHandler.onAttack`). */
export const NO_MONSTERS = "You have no healthy monsters in your housing, heal them or hatch more in the hatchery.";

/** Ours, not Flash's: the start refused or out of reach. */
export const DESCENT_START_FAILED = "The attack on Moloch's yard could not start. Try again.";
export const DESCENT_START_OFFLINE = "Could not reach the server to start the attack.";
export const DESCENT_STATE_FAILED = "Could not read how far down you are. Try again.";

/* ── Moloch's lines, yard by yard (index 0 is yard 1) ── */

interface Line {
  /** Moloch's words. */
  readonly moloch: string;
  /** The player's answer, the dialogue's one button. */
  readonly reply: string;
}

/** `descent_moloch_taunt{n}` / `taunt_player_response{n}`: as the yard opens. */
export const DESCENT_TAUNTS: readonly Line[] = [
  { moloch: "You may have mastered your own backyard, Intruder, but you're in Inferno now. And down here, I make the rules! My minions will make mincemeat of your minuscule monster armada!", reply: "Bring it on!" },
  { moloch: "You're just scratching the surface of all of the evils Inferno has waiting for you! I will enjoy watching you suffer and die!", reply: "And I'll enjoy defeating you!" },
  { moloch: "You haven't seen anything yet, Intruder. I can harness the power of earthquakes to send your puny monsters scrambling back to the safety of your yard.", reply: "Earthquakes don't scare me!" },
  { moloch: "Fiery hot, searing magma! That's what's in store for you in my next base. Your monsters will melt from the heat!", reply: "My monsters like it hot!" },
  { moloch: "Earthquakes and magma may not have been enough to defeat you separately, but you won't fare so well against them together! You should just quit now.", reply: "Just watch me!" },
  { moloch: "You may have been able to defeat my tower defenses, but how will you do against my minions? I can't wait to witness the annihilation of your monster armada by my superior creatures.", reply: "You're no match for me!" },
  { moloch: "Inferno is my very own minion factory, Intruder. The more of my bases you defeat, the more minions I'll make to massacre you! You have no chance!", reply: "Keep 'em coming!" },
  { moloch: "You think you're so tough, don't you, Intruder? My fire-spitting Sabnox would tend to disagree. These slippery minions will turn your monsters into mush.", reply: "You don't scare me!" },
  { moloch: "What's that flying around? Oh, right! It's my deadly Balthazar swooping in to eat your puny little monsters. You don't stand a chance against them!", reply: "High flyers fall further!" },
  { moloch: "I guess your monsters just aren't tough enough to make it down here. My monsters are made more powerful the more coal dust and sulfur they breathe. You should just give up now.", reply: "Never!" },
  { moloch: "Is the heat starting to get to your sensitive little monsters? You shouldn't have spoiled them with all those cool breezes. There's no way they'll be strong enough to take on this base!", reply: "I'm stronger than you think!" },
  { moloch: "Don't you love the smell of sulfur in the morning? Oh, I forgot your weak-lunged monsters get choked up by the air down here. Maybe you should equip them with gas masks. You can't do that? Oh well. ", reply: "I'll beat you anyway!" },
  { moloch: "You've reached my headquarters, but this is where your intrusion will end! Behold the power of INFERNO!", reply: "Just watch me!" },
];

/** `descent_moloch_gloat{n}` / `gloat_player_response{n}`: an attack lost. */
export const DESCENT_GLOATS: readonly Line[] = [
  { moloch: "Muwhahaha! As I suspected, your pathetic monsters are no match for my minions.", reply: "I'll be back!" },
  { moloch: "What's wrong? Are my big, bad minions too much for your itty bitty monsters to handle? Maybe you should go back to your baby yard and cry.", reply: "You'll be the one crying!" },
  { moloch: "Your pathetic monster army is more amusing than threatening. I can't stop laughing.", reply: "I'll shut you up soon enough." },
  { moloch: "What's that? Did my minions defeat you? I'm so surprised. I thought you really had me there for a minute. Just kidding. No, I didn't. I knew you were doomed the moment you set foot in my base.", reply: "Just wait until I return." },
  { moloch: "Your lack of strength has ceased being laughable. Now it's just sad. I feel bad for you. Really, I do.", reply: "I don't need your pity!" },
  { moloch: "I don't know why you keep trying to defeat me. You're just going to lose. Can't you see that?", reply: "My rage is blind!" },
  { moloch: "My minions defeated you! What a shame! Perhaps you should try less pathetic monsters next time.", reply: "I'll show you who's pathetic!" },
  { moloch: "Who continues to rule Inferno? Oh, right! It's me!", reply: "Not for much longer!" },
  { moloch: "Your demise is as sweet as marshmallows roasted over a magma pit. Gooey, yummy, sweetness!", reply: "Enjoy it while you can!" },
  { moloch: "Aw, what's wrong? Are your pathetic little monsters having trouble breathing in the heat and fumes? Such a shame. Maybe you should just turn around and go back to all that fresh air above ground.", reply: "I'll be back soon enough!" },
  { moloch: "I thoroughly enjoy basking in my victory over you, but it would be nice if your monsters offered at least a little bit of a challenge to my minions.", reply: "You'll be basking in defeat!" },
  { moloch: "Looks like your wimpy monsters have fallen before my minions again. How does it feel to be such a loser?", reply: "You're the loser!" },
  { moloch: "Oh, what's wrong? Did you lose? I can't really say I'm surprised. I am the ultimate monster overlord, after all.", reply: "Not for long!" },
];

/** `descent_moloch_whimper{n}` / `whimper_player_response{n}`: a yard beaten. */
export const DESCENT_WHIMPERS: readonly Line[] = [
  { moloch: "Don't get too cocky, Intruder! That last base could have been bested by a baby. You'll find this next one much more menacing!", reply: "We'll see about that!" },
  { moloch: "You may have defeated another of my bases, but I can smell your destruction in the air. Can't you smell it? It's like the aroma of burning monster flesh mingled with toasted marshmallows.", reply: "I smell your doom!" },
  { moloch: "Do you think I'm worried that you've destroyed another of my bases, Intruder? Because I'm not. Really, I'm not.", reply: "You should be!" },
  { moloch: "What do you really think you're going to accomplish, Intruder? You think there's an end to the number of minions I can throw at you? Well, there is, but why don't you just give up now?", reply: "Never!" },
  { moloch: "Your persistence is perturbing, Intruder! Perhaps I should whip my underlings harder to make them stronger. But mark my words. You will be stopped!", reply: "You'll never stop me!" },
  { moloch: "Intruder, your insistence on destroying my bases is just getting annoying. You may think you're making progress, but you're really not. Stop! Stop now! I'm warning you!", reply: "Starting to get scared?" },
  { moloch: "There's only one possible explanation for how you continue to defeat my bases. You're a hacker, aren't you? Well, maybe I'll just start hacking. What do you think about that?", reply: "I think you're too stupid!" },
  { moloch: "Lucky! That's all you are. But your luck will run out soon enough. I've got plenty more in store for you.", reply: "I can take anything!" },
  { moloch: "You may think you're big and tough, but the strongest of my minions still await, and the depths of Inferno have their own little surprises waiting for you. It's going to get a lot harder for you now.", reply: "I'm ready for anything!" },
  { moloch: "You're really starting to make me mad now, Intruder. And trust me, I'm a lot less friendly when I'm mad.", reply: "You don't scare me!" },
  { moloch: "Your latest attack has forced me to toss many minions into the magma pits as punishment. I hope you're happy. Their blood is on your hands.", reply: "The bloodier, the better!" },
  { moloch: "You may have defeated all of my smaller bases, but there's no way you'll take down my headquarters! ", reply: "We'll see about that!" },
  { moloch: "My headquarters! My beautiful headquarters! What have you done? You'll pay for this, Intruder! I'll be back when you least expect it!", reply: "I'm looking forward to it!" },
];

/** A yard's line, yard 1-13; the nearest end for anything outside. */
export const lineFor = (lines: readonly Line[], yard: number): Line =>
  lines[Math.min(Math.max(Math.trunc(yard), 1), lines.length) - 1]!;

/* ── The battle report and the capture ── */

/** `pop_youlooted_title`. */
export const BATTLE_REPORT_TITLE = "Battle Report";

/**
 * `descent_battlereport`: this attack's loot, Bone, Coal, Sulfur, Magma. Its
 * closing "Total:" heads the four boxes of the running total.
 */
export const battleReportLine = (loot: readonly [number, number, number, number]): string =>
  `You just looted one of Moloch's bases for  ${loot[0]} Bone, ${loot[1]} Coal, ${loot[2]} Sulfur, and ${loot[3]} Magma.`;
export const BATTLE_REPORT_TOTAL = "Total:";

/** `btn_close`. */
export const CLOSE = "Close";

/** `descent_pop_victory_*`: after the 13th win (`ShowCapturePopup`). */
export const CAPTURE_TITLE = "You Defeated Moloch!";
export const CAPTURE_BODY =
  "Congratulations! You've driven Moloch from his base. He's not dead, but he's gone for now. There's not much left of his base, but what's still there is now yours.";
export const CAPTURE_BUTTON = "Start Building!";
