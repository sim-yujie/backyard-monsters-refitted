/**
 * The player's "Look and sound" choice in Account Settings (owner, 28 Oct
 * 2026): Modern, the default, or Classic, exactly how Flash looked and
 * sounded wherever Flash had a version. One switch for all of it:
 *
 * - **Buildings**: the Town Hall and the tower tiers, painted or 3D
 *   (`tierArtFor` in `yard/buildingArtTiers.ts`).
 * - **Monsters and champions**, in battle, in the yard and in the guide: the
 *   Flash sheet with the Flash table row's layout, anchor and headings
 *   (`sheetUrl`, `spriteFor` and `sheetColumn` in `attack/monsterSprites.ts`),
 *   and no walking hop (`layoutCreep`).
 * - **Portraits** of monsters and champions (`game/portraits.ts`).
 * - **Battle effects** (`attack/AttackBattleLayer.ts`): the attack effects
 *   as before the big-effects trial (`juiceLevel` is `off`: no wind-up, lunge,
 *   hit-stop, slow motion, demolish blast or big flash), the towers' Flash
 *   shots (no painted shots, tower shake or turret aiming), no punchy blasts,
 *   Eye-ra's yellow rings rather than the fireball, and no damage numbers.
 * - **Music**: Flash's yard tune rather than the new one (`game/sound/tunes.ts`),
 *   unless the player picks the music on its own ({@link flashMusic}).
 * - **Windows**: every panel dressed as the Flash pop-ups, refreshed (cream
 *   parchment, red ribbon), rather than Modern's riveted steel (`ui/skin.ts`).
 *
 * New things with no Flash version stay as they are (the new panels, Bob,
 * eggs, announcements, icons), and so do the comfort settings (volume,
 * mute, screen shake, effects quality, "Reduce effects"), which only shape
 * the Modern effects.
 *
 * Remembered in this browser like the other display settings and read once
 * when the game loads, so a page never mixes the two looks.
 */

/** Where this browser keeps the choice: "classic", or nothing for Modern. */
export const CLASSIC_LOOK_KEY = "bymr.look";

/**
 * Keys the choice had before ("Classic building art", beta 4, then "Classic
 * art"), "1" when on; still read, so a player who turned it on keeps Classic.
 */
export const OLD_CLASSIC_LOOK_KEYS = ["bymr.classicBuildingArt", "bymr.classicArt"] as const;

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Saves the choice for the next time the game loads. True if it was saved. */
export const saveClassicLook = (on: boolean, store: Storage | null = storage()): boolean => {
  try {
    if (on) store?.setItem(CLASSIC_LOOK_KEY, "classic");
    else store?.removeItem(CLASSIC_LOOK_KEY);
    for (const key of OLD_CLASSIC_LOOK_KEYS) store?.removeItem(key);
    return store !== null;
  } catch {
    return false;
  }
};

/** The saved choice, as the dialog shows it and the game reads it at load; Modern when site data is blocked. */
export const savedClassicLook = (store: Storage | null = storage()): boolean => {
  try {
    if (store?.getItem(CLASSIC_LOOK_KEY) === "classic") return true;
    return OLD_CLASSIC_LOOK_KEYS.some((key) => store?.getItem(key) === "1");
  } catch {
    return false;
  }
};

let classicOn = savedClassicLook();

/** Whether the game looks and sounds as Flash did, read once when the game loads. */
export const classicLook = (): boolean => classicOn;

/** Switches Classic on or off for this page, without saving it; for tests. */
export const setClassicLook = (on: boolean): void => {
  classicOn = on;
};

/**
 * The music on its own (a player's request, 31 Oct 2026): "new" for the new
 * yard tune or "flash" for Flash's, whatever the Style; nothing follows the Style.
 */
export const MUSIC_KEY = "bymr.music";

export type MusicChoice = "style" | "new" | "flash";

/** Saves the music choice for the next time the game loads. True if it was saved. */
export const saveMusicChoice = (choice: MusicChoice, store: Storage | null = storage()): boolean => {
  try {
    if (choice === "style") store?.removeItem(MUSIC_KEY);
    else store?.setItem(MUSIC_KEY, choice);
    return store !== null;
  } catch {
    return false;
  }
};

/** The saved music choice; it follows the Style when nothing (or something unknown) is saved. */
export const savedMusicChoice = (store: Storage | null = storage()): MusicChoice => {
  try {
    const saved = store?.getItem(MUSIC_KEY);
    return saved === "new" || saved === "flash" ? saved : "style";
  } catch {
    return "style";
  }
};

let musicChoice = savedMusicChoice();

/** Whether the yard plays Flash's tune, read once when the game loads. */
export const flashMusic = (): boolean => (musicChoice === "style" ? classicOn : musicChoice === "flash");

/** Sets the music choice for this page, without saving it; for tests. */
export const setMusicChoice = (choice: MusicChoice): void => {
  musicChoice = choice;
};
