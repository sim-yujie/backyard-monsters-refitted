/**
 * The game's tunes (beta.5): Flash's own MP3s, which the game server already
 * serves under `/assets/sounds/music/` (`client/scripts/SOUNDS.as:122-125`),
 * and which screen plays which. The yard has a new tune of its own (owner's
 * pick B1, 2026-10-25; how it was made: `yard-theme-CREDITS.md` next to the
 * files); Flash's `Music_Building.mp3` stays on the server in case it has to
 * come back.
 *
 * Flash's choice by mode (`client/scripts/GLOBAL.as:866-885`): the yard tune
 * (`musicbuild`) in the own yard, a visit and a help; the attack tune
 * (`musicattack`) in an attack; and the "under attack" tune (`musicpanic`)
 * while monsters attack the player's own yard: a wild monster raid
 * (`WMATTACK.as:575-578`) and the Monster Baiter's wave
 * (`MONSTERBAITER.as:70-73`). Flash had no replays; a defence replay is the
 * player's own yard under attack, so it plays the "under attack" tune too
 * (`AttackScene`), and an auto-attack's replay the attack tune.
 *
 * The Inferno has tunes of its own (`infernomusic/`, Inferno WP 7.2), chosen
 * by the same Flash switch: the Inferno yard tune (`musicibuild`) on an
 * Inferno yard, the player's own or another player's looked at
 * (`ibuild`, `iview`), and the Inferno attack tune (`musiciattack`) in every
 * Inferno fight: a Descent yard (Flash loaded it as `iwmattack`,
 * `maproom_inferno/PlayerHandler.as:293-334`), a Moloch tribe and another
 * player's Inferno yard. The yard and attack screens switch to them once they
 * know the yard is the Inferno's (`YardScene`, `AttackScene`). The Moloch
 * raid out of the cave plays the ordinary "under attack" tune, as Flash's did
 * (`INFERNO_EMERGENCE_EVENT.as:193`). Flash's third, `Music_IDefense.mp3`
 * (`musicipanic`), took the "under attack" tune's place on an Inferno yard
 * (`BASE.isInfernoMainYardOrOutpost`) at three moments only: the Trojan Horse
 * springing (`BUILDING27.as:83-93`), the tutorial's raid
 * (`CUSTOMATTACKS.as:84-93`) and a Monster Invasion wave
 * (`MonsterInvasion.as:155-162`). None of them can happen on an Inferno yard
 * in this game (checked 28 Oct, the owner asked for Flash's behaviour): the
 * horse is placed and sprung on the main yard only (`trojanHorse.ts`), the
 * tutorial's raid is on the main yard, and there are no Monster Invasions.
 * So it is not listed.
 */
export type Tune = "yard" | "attack" | "underAttack" | "infernoYard" | "infernoAttack";

export interface TuneFile {
  /** An MP3, which every browser plays, iPhones included. */
  readonly url: string;
  /**
   * The same tune as Ogg Vorbis, for browsers that play it. Ogg loops
   * without the short silence an MP3 encoder pads its ends with.
   */
  readonly ogg?: string;
  /** Flash's own volume for it (`SOUNDS.as:131-138`). */
  readonly volume: number;
}

export const TUNES: Readonly<Record<Tune, TuneFile>> = {
  // As loud as Flash's yard tune (-16 against -16.7 LUFS), so Flash's volume holds.
  yard: { url: "/assets/sounds/music/yard-theme.mp3", ogg: "/assets/sounds/music/yard-theme.ogg", volume: 0.6 },
  attack: { url: "/assets/sounds/music/Music_Attack.mp3", volume: 0.7 },
  underAttack: { url: "/assets/sounds/music/Music_UnderAttack.mp3", volume: 0.7 },
  infernoYard: { url: "/assets/sounds/infernomusic/Music_IBuild.mp3", volume: 0.6 },
  infernoAttack: { url: "/assets/sounds/infernomusic/Music_IAttack.mp3", volume: 0.7 },
};

/** The file to stream: the Ogg copy where the browser can play it, else the MP3. */
export const tuneUrl = (file: TuneFile, canPlayOgg: boolean): string =>
  canPlayOgg && file.ogg ? file.ogg : file.url;

/**
 * The map rooms' tune. Flash had none of its own: no map room file starts
 * any music, so the yard tune kept playing there. The owner wants a new tune
 * for the map rooms (answer S6 of 2026-10-24); it does not exist yet, so this
 * stays the yard tune until it does. Add the new file to {@link TUNES} and
 * point this at it.
 */
export const MAP_ROOM_TUNE: Tune = "yard";

