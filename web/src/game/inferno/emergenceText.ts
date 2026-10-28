/**
 * What Moloch's emergence says (`docs/design/inferno.md` §2.2, WP 1.10),
 * word for word from Flash's `english.json` under the key named beside each
 * (`server/public/gamestage/assets/english.json`). Flash's `<b>` and line
 * breaks are dropped; nothing else is changed.
 */

/** The cave's name (`YARD_PROPS.as:6829`). */
export const CAVE_NAME = "Inferno Cavern";

/** Moloch's portrait (`INFERNO_EMERGENCE_POPUPS.as`, "popups/portrait_moloch.png"). */
export const MOLOCH_PORTRAIT = "/assets/popups/portrait_moloch.png";

/** The picture over the last popup (`ShowComplete`, "popups/popup_emergecomplete.v2.jpg"). */
export const EMERGE_COMPLETE_ART = "/assets/popups/popup_emergecomplete.v2.jpg";

/** The cave at its last level, for its menu (`buildings/iportal/top.5.v2.png`). */
export const CAVE_ART = "/assets/buildings/iportal/top.5.v2.png";

/** `ai_moloch_intro`: before the first raid. */
export const MOLOCH_INTRO =
  "Your reign over the backyard has come to an end! I am Moloch, Lord of Inferno, and I'm here to shake up your pathetic little world! Prepare to meet your doom!";

/** `ai_moloch_taunt1` to `ai_moloch_taunt5`: after each raid, in order. */
export const MOLOCH_TAUNTS: readonly string[] = [
  "Gloat all you want! I'm simply testing your defenses. I'll be back with more minions soon. Your days are numbered!",
  "You may think you've beaten me, but I'm just biding my time. Wait and see!",
  "Don't get too comfortable! Once my Skull of Doom has fully penetrated the outer crust, you'll wish you had submitted to me from the start.",
  "Your puny yard is more of an annoyance than a challenge. Once my Skull of Doom emerges and you're faced with the full power of Inferno, your monsters will quake with fear and flee my wrath.",
  "My Skull of Doom is complete! The doorway to Inferno is open. Now I can come and go as I please. Wait a minute. That means you can too. I shouldn't have said that. Forget I said that!",
];

/** `cavern_pop1` to `cavern_pop4`: a tap on the cave below its last level. */
export const CAVERN_NOTES: readonly string[] = [
  "This structure looks unstable. It would probably be a good idea to check it again later.",
  "The earthquake has revealed more of this strange formation. It's possible future earthquakes will do the same.",
  "This structure looks like some sort of cavern, but it's too small to tell for sure. You'll need to wait for another earthquake to learn more.",
  "It looks like this \"Skull of Doom\" is an entrance of some sort, but it's not accessible yet. One more earthquake should open it up enough for you to see what's inside.",
];

/** `entercavernfail_popup`: a tap on the open cave with the hall below 5. */
export const ENTER_CAVERN_FAIL =
  "Word to the wise: Don't bring a knife to a gun fight. You're not ready to take on Moloch yet, but you're not far off. Upgrade your Town Hall to Level 5 and gain a fighting chance.";

/** `emerge_earthquake`: the warning bar as the cave grows. */
export const EARTHQUAKE = "EARTHQUAKE !";

/** `ai_caverndefense`: after each of Moloch's raids, won or lost. */
export const CAVERN_DEFENCE = "You successfully defended your yard from an attack by Moloch.";

/** `entercavern_popup`: once all five raids are over (Flash's "fight your way though" mended). */
export const ENTER_CAVERN_INVITE =
  "Moloch's on the run. Enter Inferno and fight your way through his network of subterranean bases.  Any monster in your arsenal is fair game, but you'll have to leave the catapults at home. If you survive, you'll control your own Inferno Base. Are you ready to rip the crown off Moloch's head and take your place as ruler of all that's unholy in the underworld?";

/** `btn_entercavern`, `btn_ascendmonsters`, `emerge_upgrade_btnaction`, `btn_exitcavern`. */
export const ENTER_CAVERN = "Enter Cavern";
/** The cave's one button in the Inferno yard: back up to the main yard (`BUILDINGINFO.as:298-300`). */
export const EXIT_CAVERN = "Exit Cavern";
export const TRANSFER_MONSTERS = "Transfer Monsters";
export const UPGRADE_NOW = "Upgrade Now";

/** `ai_inferno_popupwarning_title`: Moloch's warning before each raid (`INFERNO_EMERGENCE_ATTACKPOPUP.as`). */
export const MOLOCH_ALERT_TITLE = "INFERNO MONSTER ALERT";

/** Ours: the raid scene's title and status line for Moloch's raid, where a wild raid names its tribe. */
export const MOLOCH_RAID_TITLE = "Moloch's raid";
export const MOLOCH_RAIDERS = "Moloch's monsters";

/** `ai_engage_btn`: the warning's one button, which brings the raid on. */
export const ENGAGE_ATTACK = "Engage Attack";

/**
 * `emerge_mondesc_mi_*_desc`: what the warning says of each of Moloch's
 * monsters, shown over its card (Flash: on mouse-over). Keyed by monster id.
 */
export const MOLOCH_MONSTER_HINTS: Readonly<Record<string, string>> = {
  IC1: "Little flaming critters that seem to be made of magma. Favorite Target: ???",
  IC2: "A strange creature that looks like a reject from a chemistry lab. Favorite Target: ???",
  IC3: "A sneaky-looking creature that scurries around on multiple legs. Favorite Target: ???",
  IC4: "This guy looks to be mostly mouth and seems to be able to burrow. Favorite Target: ???",
  IC5: "It's got wings, so we know it flies, but not much else. Favorite Target: ???",
  IC6: "This guy looks kind of like a land octopus with rocks on his head. Favorite Target: ???",
  IC7: "A nasty-looking, worm-like creature that can spit from a distance. Favorite Target: ???",
  IC8: "This guy looks like a Wormzer on steroids. Favorite Target: ???",
};

/**
 * Ours, not Flash's (Flash's raid could not fail to start): what the yard
 * says when Moloch's raid cannot start now, and when it is gone. The stage
 * counts either way: the cave's level was saved before the raid opened.
 */
export const MOLOCH_RAID_WAIT = "Another attack is on your yard. Moloch's monsters wait until it is over.";
export const MOLOCH_RAID_RETRY = "Could not reach the server to bring Moloch's monsters on. Try again.";
export const MOLOCH_RAID_GONE = "Moloch's monsters went back underground. The cave has grown all the same.";
