/**
 * The Trojan Horse's own words (issue #327, `docs/design/trojan-horse.md`
 * §3), Flash's (`server/public/gamestage/assets/english.json`, the
 * `ai_trojan_*` keys): the letter popup and the trap banner.
 */

/** `ai_trojan_headline`. */
export const TROJAN_HEADLINE = "Wild Monsters left you a note pinned to a large wooden structure.";

/** `ai_trojan_letter`, `#v1#` filled with the player's name. */
export const trojanLetterText = (playerName: string): string =>
  `Dear ${playerName}, Too much needless blood has been spilled on our yards. It is time we let our ` +
  "monsters live out the rest of their days in peace. Let this be known as Armistice Day! As a token " +
  "of our sincerity, please accept this wooden memorial.";

/** `ai_trojan_sendback_btn`. Both letter buttons spring the trap (the joke, design §3.3). */
export const SEND_BACK = "Send Back";
/** `ai_trojan_accept_btn`. */
export const ACCEPT_TRUCE = "Accept Truce";

/** `ai_trojan_trap`. */
export const TRAP_BANNER = "It was a trap! Who didn't see that coming?";

/** How long the trap banner shows before the fight's own "Don't Panic!" (design §3.4). */
export const TRAP_BANNER_MS = 3_000;

/** The result popup's headline on a well-defended Trojan Horse fight (design §6: "the wild monsters"). */
export const TROJAN_GOOD_DEFENCE = "You successfully defended your yard from an attack by the wild monsters";
