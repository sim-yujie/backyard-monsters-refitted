/**
 * Everything past the sign-in screen, as one piece the page loads on its own
 * (beta 9 speed work, item 9).
 *
 * The first script holds only what the boot and sign-in screens need (the app
 * shell, Pixi, the forms). The yard, the map rooms and the attack screens, and
 * every window they open, come from this module's chunk, which `gameLoader.ts`
 * starts fetching as soon as the first screen is up, so it is usually in hand
 * before the player has typed their password. Only `gameLoader.ts` imports it,
 * and only dynamically; a static import would pull it all back into the first
 * script.
 */
// In the order App.ts imported them before the split, so every module runs in
// the order it always has (the yard's and the attack's plugin lists are filled
// as their modules run).
import { MapGateScene } from "./scenes/MapGateScene";
import { MapRoom1Scene } from "./scenes/MapRoom1Scene";
import { MapRoom2Scene } from "./scenes/MapRoom2Scene";
import { YardScene } from "./scenes/YardScene";
import { AttackScene } from "./scenes/AttackScene";
import { BAITER_PLUGINS, BAITER_REPLAY_PLUGINS } from "@/game/baiter/baiterPlugin";
import { WATCH_PLUGINS } from "@/game/autoAttack/watchPlugin";
import { RAID_PLUGINS } from "@/game/raid/raidPlugin";
import type { Scene } from "./SceneManager";

/** The game's screens, by the scene names `App.ts` registers them under. */
export const gameScenes = {
  map: (): Scene => new MapGateScene(),
  mapRoom1: (): Scene => new MapRoom1Scene(),
  mapRoom2: (): Scene => new MapRoom2Scene(),
  yard: (): Scene => new YardScene(),
  attack: (): Scene => new AttackScene(),
  baiter: (): Scene => new AttackScene(BAITER_PLUGINS, { practice: true }),
  baiterReplay: (): Scene => new AttackScene(BAITER_REPLAY_PLUGINS, { practice: true }),
  watch: (): Scene => new AttackScene(WATCH_PLUGINS, { watch: true }),
  raid: (): Scene => new AttackScene(RAID_PLUGINS, { raid: true }),
} as const;

export type GameScenes = typeof gameScenes;
