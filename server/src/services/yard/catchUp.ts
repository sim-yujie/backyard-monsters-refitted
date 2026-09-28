import {
  catchUpBuildings,
  type BuildingJob,
  type CatchUpBuildingsSave,
  type StoreItemJob,
} from "./catchUpBuildings.js";
import { catchUpChampions, type CatchUpChampionsSave, type StarveJob } from "./catchUpChampions.js";
import { catchUpHarvesters, type CatchUpHarvestersSave } from "./catchUpHarvesters.js";
import { catchUpLocker, type CatchUpLockerSave, type UnlockJob } from "./catchUpLocker.js";
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
import { addStarterBase, type StarterBaseJob, type StarterBaseSave } from "./starterBase.js";

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
 * | 2 | `catchUpLocker.ts` — unlocks and the Locker Overdrive (runs first, see there) | 2 |
 * | 2 | `catchUpMonsters.ts` — HCC queue refund, hatchery production, housing cull (after the buildings) | 2 |
 * | 3 | `catchUpRepairs.ts` — repairs heal; runs before the buildings, whose paused countdowns it restarts at the repair's end | 3 |
 * | 3 | `catchUpHarvesters.ts` — harvester buffers fill (nothing is banked); `catchUpMushrooms.ts` | 3 |
 * | 4 | `catchUpTraining.ts` — academy training (legacy relative `time` made absolute once); `catchUpResearch`, lab research | 4 |
 * | 5 | `catchUpChampions.ts` — champions in the cage heal and starve | 5 |
 *
 * Buildings go first (after the locker, which only reads a store buff step 1
 * may expire, and the repairs, which only unpause countdowns step 1 then
 * advances): a finished Housing upgrade changes what the hatcheries may
 * fill. A later step that needs to split its window at a building completion
 * reads the `at` of the `build`/`upgrade` entries step 1 returned.
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
  | StarveJob;

/** The slice of a save the catch-up reads and writes. */
export interface CatchUpSave
  extends CatchUpBuildingsSave,
    CatchUpLockerSave,
    CatchUpMonstersSave,
    CatchUpHarvestersSave,
    StarterBaseSave,
    MushroomYardSave,
    CatchUpTrainingSave,
    CatchUpChampionsSave {
  savetime?: number;
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
  const starter = addStarterBase(save, now);
  const stored = Number(save.savetime);
  const from = Number.isFinite(stored) && stored > 0 && starter.length === 0 ? stored : now;

  const completed: CompletedJob[] = [
    ...starter,
    ...migrateYard(save, now),
    ...catchUpLocker(save, from, now),
    ...catchUpRepairs(save, from, now),
    ...catchUpBuildings(save, from, now),
  ];
  completed.push(...catchUpMonsters(save, from, now, completed));
  catchUpHarvesters(save, from, now, completed);
  catchUpMushrooms(save, now);
  completed.push(...catchUpTraining(save, from, now));
  completed.push(...catchUpResearch(save, now));
  completed.push(...catchUpChampions(save, from, now));

  save.savetime = now;

  return completed.sort((a, b) => a.at - b.at);
};
