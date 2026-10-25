import {
  catchUpBuildings,
  type BuildingJob,
  type CatchUpBuildingsSave,
  type StoreItemJob,
} from "./catchUpBuildings.js";
import {
  catchUpChampions,
  type CatchUpChampionsSave,
  type ChampionHatchJob,
  type StarveJob,
} from "./catchUpChampions.js";
import { catchUpDamage, type CatchUpDamageSave } from "./catchUpDamage.js";
import { catchUpHarvesters, type CatchUpHarvestersSave } from "./catchUpHarvesters.js";
import {
  catchUpLocker,
  unlockStarterMonster,
  type CatchUpLockerSave,
  type UnlockJob,
} from "./catchUpLocker.js";
import { catchUpMonsters, type CatchUpMonstersSave, type MonsterJob } from "./catchUpMonsters.js";
import { catchUpMushrooms } from "./catchUpMushrooms.js";
import { catchUpRepairs, type RepairJob } from "./catchUpRepairs.js";
import {
  catchUpResearch,
  catchUpTraining,
  type CatchUpTrainingSave,
  type ResearchJob,
  type TrainJob,
} from "./catchUpTraining.js";
import {
  migrateYard,
  type MapRoomAddedJob,
  type RadioRemovedJob,
} from "./mapRoom.js";
import type { MushroomYardSave } from "./mushrooms.js";
import { clearOutpostMushrooms, placeOutpostCore } from "./outpostYard.js";
import { syncBaseValue, type BaseValueSave } from "./derivedLevels.js";
import { addStarterBase, type StarterBaseJob, type StarterBaseSave } from "./starterBase.js";
import { catchUpSiege, type SiegeCompletedJob, type SiegeSave } from "./siege.js";
import { yardKindOf } from "../yardplanner/costs.js";

/**
 * `catchUpYard(save, now)`: advances a main yard from its `savetime` to `now`
 * (`docs/design/yard-buildings.md` §2.3).
 *
 * One pure function — no database, no clock — that every yard action, the
 * owner's build-mode `/base/load` and `POST /bm/yard/state` run before they
 * read the yard, so whatever finished while the player was away has finished
 * by the time any rule looks at it. Completion is only ever done here; the
 * client predicts it for display and then asks the server (§2.4).
 *
 * The work is split into step modules, one per phase, so each work package
 * owns its own file and adds one line below:
 *
 * | Step | Module | Phase |
 * | --- | --- | --- |
 * | 0 | `starterBase.ts` `addStarterBase` — an empty main yard gets the starter set once (#154) | 1 |
 * | 0 | `mapRoom.ts` `migrateYard` — Map Room cap, `mr2upgraded`, Radio removal, a missing Map Room added (§2.5) | 3 |
 * | 1 | `catchUpBuildings.ts` — countdowns, points, `flinger`/`catapult`, store buffs | 1 |
 * | 2 | `catchUpLocker.ts` — `unlockStarterMonster`, the Pokey always unlocked (#218); unlocks and the Locker Overdrive (runs first, see there) | 2 |
 * | 2 | `catchUpMonsters.ts` — HCC queue refund, hatchery production, housing cull (after the buildings) | 2 |
 * | 2 | `siege.ts` `catchUpSiege` — Siege Lab research and Siege Factory weapons; a job paused over a window its building spends destroyed (runs before the repairs, whose health it reads) | 3 |
 * | 3 | `catchUpRepairs.ts` — repairs heal; runs before the buildings, whose paused countdowns it restarts at the repair's end | 3 |
 * | 3 | `catchUpHarvesters.ts` — harvester buffers fill (nothing is banked); `catchUpMushrooms.ts` | 3 |
 * | 4 | `catchUpTraining.ts` — academy training (legacy relative `time` made absolute once); `catchUpResearch`, lab research | 4 |
 * | 5 | `catchUpChampions.ts` — the egg in the cage hatches; champions in the cage heal and starve | 5 |
 * | 6 | `catchUpDamage.ts` — `damage` follows the repairs down (#182 B) | — |
 * | 7 | `derivedLevels.ts` `syncBaseValue` — `basevalue` rises to the finished buildings' worth (#209) | — |
 *
 * Buildings go first (after the locker, which only reads a store buff step 1
 * may expire, and the repairs, which only unpause countdowns step 1 then
 * advances): a finished Housing upgrade changes what the hatcheries may
 * fill. A later step that needs to split its window at a building completion
 * reads the `at` of the `build`/`upgrade` entries step 1 returned.
 *
 * **Outposts** (`type` `outpost`, outposts WP3) run their own, shorter list
 * ({@link catchUpOutpost}): an empty outpost gets its core first
 * (`outpostYard.ts`), then repairs, buildings, monsters and damage, as above.
 * The rest is the player's or the main yard's alone: the starter base and the
 * Map Room, the Locker, the Academy, the Lab and the Siege Lab and Factory
 * (their data is the main yard's), mushrooms and champions (outposts have neither), and the harvester
 * buffers (an outpost's harvesters hold nothing; their income is autobanked
 * into the main pool, WP4). Run it on the outpost seen through its owner's
 * main yard (`poolView.ts`), so points and the HCC's goo refund land in the
 * main yard's pool.
 *
 * **The Inferno yard** (`type` `inferno`, `docs/design/inferno.md` WP 1.14-1.16)
 * runs {@link catchUpInferno}: its repairs at the Inferno table's repair times
 * (WP 1.16), its buildings' countdowns at the Inferno table's figures, then its
 * Bone, Coal, Sulfur and Magma harvesters at the Inferno rates, each filling
 * its own buffer until full, as in Flash, and last the damage figure. Nothing
 * else yet: its Incubators, Academy and Locker come with their own work
 * packages, and until then none of them is ever started. Run it on the
 * yard seen through its owner's main yard (`poolView.ts`, `infernoView`); the
 * points stay on the Inferno row, its own level as in Flash.
 *
 * **Guarantees.** Idempotent: a second run at the same `now` changes nothing,
 * because `savetime` has moved to `now` and nothing is left at zero. It never
 * charges anything. Elapsed time is clamped to 30 days by
 * `advanceBuildingTimers`, like the original load replay.
 */

/**
 * One job the catch-up finished, as the client receives it in `completed`.
 *
 * Every kind has `{ kind, id, t, at, detail }`. Later steps widen this union
 * with their own kinds (`unlock`, `hatch`, `train`, …).
 */
export type CompletedJob =
  | BuildingJob
  | StoreItemJob
  | UnlockJob
  | MonsterJob
  | RadioRemovedJob
  | MapRoomAddedJob
  | TrainJob
  | ResearchJob
  | RepairJob
  | StarterBaseJob
  | StarveJob
  | ChampionHatchJob
  | SiegeCompletedJob;

/** The slice of a save the catch-up reads and writes. */
export interface CatchUpSave
  extends CatchUpBuildingsSave,
    CatchUpLockerSave,
    CatchUpMonstersSave,
    CatchUpHarvestersSave,
    StarterBaseSave,
    MushroomYardSave,
    CatchUpTrainingSave,
    CatchUpChampionsSave,
    CatchUpDamageSave,
    BaseValueSave,
    SiegeSave {
  savetime?: number;
  /** When the row was made: where an Inferno yard never caught up starts its clock. */
  createtime?: number | null;
}

/**
 * Advances the yard to `now` and returns what finished, oldest first.
 *
 * A `savetime` of 0 or less means the yard has never been saved, so there is
 * no elapsed time to replay: the web client reads such a yard's countdowns from
 * the current time too (`web/src/game/yard/yardModel.ts:244-250`), and
 * replaying from 1970 would hand every countdown the full 30 days. A yard
 * that was empty until the starter set went in now has nothing to replay
 * either: its new Twig Snapper must not fill for the time it did not stand.
 *
 * @param save - The yard, mutated in place; `savetime` ends at `now`.
 * @param now - Unix seconds to advance to.
 */
export const catchUpYard = (save: CatchUpSave, now: number): CompletedJob[] => {
  const kind = yardKindOf(save);
  if (kind === "outpost") return catchUpOutpost(save, now);
  if (kind === "inferno") return catchUpInferno(save, now);

  const starter = addStarterBase(save, now);
  unlockStarterMonster(save);
  const stored = Number(save.savetime);
  const from = Number.isFinite(stored) && stored > 0 && starter.length === 0 ? stored : now;

  const completed: CompletedJob[] = [
    ...starter,
    ...migrateYard(save, now),
    ...catchUpLocker(save, from, now),
    ...catchUpSiege(save, from, now),
    ...catchUpRepairs(save, from, now),
    ...catchUpBuildings(save, from, now),
  ];
  completed.push(...catchUpMonsters(save, from, now, completed));
  catchUpHarvesters(save, from, now, completed);
  catchUpMushrooms(save, now);
  completed.push(...catchUpTraining(save, from, now));
  completed.push(...catchUpResearch(save, now));
  completed.push(...catchUpChampions(save, from, now));
  catchUpDamage(save);
  syncBaseValue(save);

  save.savetime = now;

  return completed.sort((a, b) => a.at - b.at);
};

/**
 * An outpost's catch-up (the file comment): the core into an empty outpost,
 * then repairs, buildings, monsters and damage, with the same guarantees.
 *
 * @param save - The outpost, mutated in place; `savetime` ends at `now`.
 * @param now - Unix seconds to advance to.
 */
export const catchUpOutpost = (save: CatchUpSave, now: number): CompletedJob[] => {
  const cored = placeOutpostCore(save);
  // The Locker is the main yard's, seen through the pool view: a player who
  // opens an outpost before their main yard still gets the Pokey (#218).
  unlockStarterMonster(save);
  // Mushrooms copied from a main save: an outpost never has any (#191).
  clearOutpostMushrooms(save);
  const stored = Number(save.savetime);
  // A core that has just gone in has stood for no time at all.
  const from = Number.isFinite(stored) && stored > 0 && !cored ? stored : now;

  const completed: CompletedJob[] = [
    ...catchUpRepairs(save, from, now),
    ...catchUpBuildings(save, from, now),
  ];
  completed.push(...catchUpMonsters(save, from, now, completed));
  catchUpDamage(save);

  save.savetime = now;

  return completed.sort((a, b) => a.at - b.at);
};

/**
 * The Inferno yard's catch-up (the file comment): repairs, building
 * countdowns, the harvesters and damage, as an outpost's order, from the last
 * catch-up (`savetime`, else the moment the yard was made, `createtime`) to
 * `now`, with the same guarantees. A yard with neither starts its clock now.
 *
 * @param save - The Inferno yard, mutated in place; `savetime` ends at `now`.
 * @param now - Unix seconds to advance to.
 */
export const catchUpInferno = (save: CatchUpSave, now: number): CompletedJob[] => {
  const stored = Number(save.savetime) || Number(save.createtime);
  const from = Number.isFinite(stored) && stored > 0 ? Math.min(stored, now) : now;

  const completed: CompletedJob[] = [
    ...catchUpRepairs(save, from, now),
    ...catchUpBuildings(save, from, now),
  ];
  catchUpHarvesters(save, from, now, completed, "inferno");
  catchUpDamage(save);

  save.savetime = now;

  return completed.sort((a, b) => a.at - b.at);
};
