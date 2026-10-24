/**
 * The game's tunes (beta.5): Flash's own MP3s, which the game server already
 * serves under `/assets/sounds/music/` (`client/scripts/SOUNDS.as:122-125`),
 * and which screen plays which.
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
 * The three Inferno tunes (`infernomusic/`) are left out on purpose: there is
 * no Inferno in this game.
 */
export type Tune = "yard" | "attack" | "underAttack";

export interface TuneFile {
  readonly url: string;
  /** Flash's own volume for it (`SOUNDS.as:131-138`). */
  readonly volume: number;
}

export const TUNES: Readonly<Record<Tune, TuneFile>> = {
  yard: { url: "/assets/sounds/music/Music_Building.mp3", volume: 0.6 },
  attack: { url: "/assets/sounds/music/Music_Attack.mp3", volume: 0.7 },
  underAttack: { url: "/assets/sounds/music/Music_UnderAttack.mp3", volume: 0.7 },
};

/**
 * The map rooms' tune. Flash had none of its own: no map room file starts
 * any music, so the yard tune kept playing there. The owner wants a new tune
 * for the map rooms (answer S6 of 2026-10-24); it does not exist yet, so this
 * stays the yard tune until it does. Add the new file to {@link TUNES} and
 * point this at it.
 */
export const MAP_ROOM_TUNE: Tune = "yard";

