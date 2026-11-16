import { raidApi, type RaidApi } from "@/api/raid";
import type { AttackPlugin } from "@/game/attack/attackPlugins";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { raidSheetQueue } from "@/game/attack/sheetQueue";
import { MOLOCH_RAID_GONE } from "@/game/inferno/emergenceText";
import { isMolochRaid } from "@/game/inferno/molochRaid";
import { TROJAN_HORSE_TYPE } from "@/game/trojan/trojanHorse";
import { TRAP_BANNER, TRAP_BANNER_MS } from "@/game/trojan/trojanText";
import "@/ui/styles/raid.css";
import { finishRaidFight, type RaidFinish } from "./raidFinish";
import { raidEvents, setRaidNote, setRaidResult } from "./raidSession";
import { DONT_PANIC } from "./raidText";
import { raidWatch } from "./raidWatch";

/**
 * The raid scene's own package (issue #226 WP4, `docs/design/wild-raids.md`
 * §4.3): plays the fight the server already fought on the player's own yard,
 * with "Don't Panic!" in the strip, and when it is over lands it
 * (`/raid/finish`) and opens the yard, which shows the result.
 *
 * The scene mounts only {@link RAID_PLUGINS}: the battle layer, which draws
 * the fight, and this. No drop, no army and no save of an attack.
 *
 * At 2x the fight can end here before the server takes a finish; the finish
 * then waits (`tooEarly`), with "Don't Panic!" swapped for a waiting line.
 *
 * A Trojan Horse's fight is a `RaidRun` too (`trojan: true`, issue #327,
 * `docs/design/trojan-horse.md` §5), reusing every bit of this: only the
 * trap banner ahead of "Don't Panic!" (§3.4) and the belly door opening on
 * each spawn (§3.5) are its own.
 */

export interface RaidPluginDeps {
  readonly api: Pick<RaidApi, "finish">;
  /** Server unix seconds now. */
  readonly serverNow: () => number;
  /** Forgets the raid once it has landed or gone. */
  readonly clearRaid: () => void;
  readonly wait: (ms: number) => Promise<void>;
  /**
   * Called as the fight is over and its finish goes out: forgets the sheet
   * downloads not yet started and starts no new one until the returned
   * release is called (`sheetQueue.ts`), so the finish never waits behind
   * paintings for a connection. None when left out.
   */
  readonly holdSheets?: () => () => void;
}

/**
 * The horse's belly door: open frame, then real time (not game ticks, so it
 * reads the same at 1x and 2x) before it swings shut again (design §3.5,
 * `BUILDING27.as:69-77`). The art is a 2-frame strip (`buildingArtData.ts`'s
 * type 27 entry): 0 closed, 1 open.
 */
export const DOOR_OPEN_MS = 450;
const DOOR_CLOSED_FRAME = 0;
const DOOR_OPEN_FRAME = 1;
const DOOR_LAYER = 0;

/**
 * What the yard says when the fight did not land. Moloch's raid called off
 * does not come back: its stage counted when the cave grew.
 */
/**
 * How long "The raid is over…" may wait on the server's answer before the
 * screen offers the way back itself (reports 44, 45: a phone left on it with
 * no button at all). A raid has no Map, Yard or Retreat while it plays.
 */
export const LEAVE_OFFER_MS = 8_000;
/** The notice that offers it, and its words: one short line and the button (owner, 15 Nov). */
export const LEAVE_NOTICE = "raid-leave";
export const LEAVE_TEXT = "Raid over";
export const LEAVE_LABEL = "Back to yard";

export const finishNotice = (finish: RaidFinish, tribe = ""): string | null => {
  if (finish.kind === "cancelled") {
    return isMolochRaid({ tribe }) ? MOLOCH_RAID_GONE : "The raid was called off: the wild monsters will be back.";
  }
  if (finish.kind === "failed")
    return "Could not reach the server to land the raid. Your yard shows what the server has.";
  return null;
};

export const createRaidPlugin =
  (deps: RaidPluginDeps): AttackPlugin =>
  (mounts) => {
    const run = mounts.raid;
    if (!run) return;
    const { session } = mounts;

    const waves = raidEvents(run);
    const banner = document.createElement("span");
    banner.className = "raid-panic";
    banner.setAttribute("role", "status");
    mounts.hudSlot.append(banner);

    // Sprung from the Trojan Horse: the trap banner shows first, the usual
    // raid look (HUD hidden, "Don't Panic!") only once it has had its few
    // seconds (design §3.4, §5). A wild raid's warning already told the
    // player what is coming, so it starts playing at once, as before.
    let started = false;
    const startFight = (): void => {
      started = true;
      banner.textContent = DONT_PANIC;
      session.playScript(waves, run.fight.tick);
      // The view turns to meet the first wave, as the Baiter's does: halfway
      // between it and the yard.
      const first = waves[0];
      if (first && mounts.camera) {
        mounts.camera.centreOn(mounts.renderer.yardToWorld(first.x / 2, first.y / 2));
        mounts.camera.dirty = true;
      }
    };

    let trapTimer: ReturnType<typeof setTimeout> | null = null;
    if (run.trojan) {
      banner.textContent = TRAP_BANNER;
      trapTimer = setTimeout(startFight, TRAP_BANNER_MS);
    } else {
      startFight();
    }

    // The belly door, one open-close per spawn (§3.5): found once by id
    // since `run.fight.yard.buildingdata` is the fight's own frozen yard, not
    // the live one `findTrojanHorse` reads. Absent on anything but a sprung
    // Trojan Horse's own fight.
    const horseId = run.trojan
      ? Object.values(run.fight.yard.buildingdata).find((building) => building.t === TROJAN_HORSE_TYPE)?.id
      : undefined;
    const doorTimers = new Set<ReturnType<typeof setTimeout>>();
    let spawned = 0;
    const checkSpawns = (tick: number): void => {
      if (!started || horseId === undefined) return;
      while (spawned < waves.length && waves[spawned]!.t <= tick) {
        spawned += 1;
        mounts.renderer.setAnimFrame(horseId, DOOR_LAYER, DOOR_OPEN_FRAME);
        const timer = setTimeout(() => {
          doorTimers.delete(timer);
          mounts.renderer.setAnimFrame(horseId, DOOR_LAYER, DOOR_CLOSED_FRAME);
        }, DOOR_OPEN_MS);
        doorTimers.add(timer);
      }
    };

    let finishing = false;
    let gone = false;
    /** The player went back to the yard; the finish may still be on its way. */
    let left = false;
    /** The server said `tooEarly` and its wait is running: no way back offered meanwhile. */
    let early = false;
    /** Lets the sheet downloads go again (`holdSheets`): when the finish is back, or this screen is gone. */
    let release: (() => void) | null = null;
    /** Offers "Back to yard" while the finish is slow; shown again if dismissed. */
    let offerTimer: ReturnType<typeof setInterval> | null = null;
    const stopOffer = (): void => {
      if (offerTimer !== null) clearInterval(offerTimer);
      offerTimer = null;
      mounts.notices.clear(LEAVE_NOTICE);
    };
    const leave = (): void => {
      if (gone || left) return;
      left = true;
      stopOffer();
      mounts.goToYard?.();
    };
    /**
     * The way back, {@link LEAVE_OFFER_MS} after the finish (or its next try)
     * went out. Never during a `tooEarly` wait: a yard load before the server
     * would take the finish calls the fight off (owner Q1); from then on the
     * yard load lands it itself (patch 7.5, `settleRaidOnYardLoad`).
     */
    const startOffer = (): void => {
      if (offerTimer !== null) clearInterval(offerTimer);
      offerTimer = setInterval(() => {
        if (!gone && !left && !early) {
          mounts.notices.show(LEAVE_NOTICE, LEAVE_TEXT, { level: "info", actionLabel: LEAVE_LABEL, onAction: leave });
        }
      }, LEAVE_OFFER_MS);
    };
    const finish = async (): Promise<void> => {
      if (finishing) return;
      finishing = true;
      banner.textContent = "The raid is over…";
      // Only once the fight is over: a raid may not be left while it plays.
      startOffer();
      release = deps.holdSheets?.() ?? null;
      try {
        const outcome = await finishRaidFight({
          api: deps.api,
          id: run.raid.id,
          serverNow: deps.serverNow,
          wait: deps.wait,
          onEarlyWait: (waiting) => {
            early = waiting;
            if (gone || left) return;
            if (waiting) {
              stopOffer();
            } else {
              startOffer();
            }
          },
        }).finally(() => release?.());
        // The watch first, so a yard the result opens afresh does not find the
        // fight still going (its lock). The result is kept for the yard even
        // when this screen has gone meanwhile; an open yard is told, and shows
        // it once (`plugins/raid.ts`).
        try {
          deps.clearRaid();
        } finally {
          if (outcome.kind === "landed") setRaidResult(outcome.result);
        }
        const notice = finishNotice(outcome, run.raid.tribe);
        // Dropped if the yard's load landed this raid meanwhile (patch 7.5).
        if (notice) setRaidNote(notice, run.raid.id);
      } finally {
        // Whatever went wrong above, the player is never left on this screen.
        leave();
      }
    };

    const unsubscribe = session.subscribe((state) => {
      checkSpawns(state.tick);
      if (state.phase === "ended") void finish();
    });
    checkSpawns(session.state().tick);
    if (session.state().phase === "ended") void finish();

    return () => {
      stopOffer();
      gone = true;
      release?.();
      if (trapTimer !== null) clearTimeout(trapTimer);
      for (const timer of doorTimers) clearTimeout(timer);
      unsubscribe();
      banner.remove();
    };
  };

export const raidPlugin: AttackPlugin = createRaidPlugin({
  api: raidApi,
  serverNow: () => raidWatch.serverNow(),
  clearRaid: () => raidWatch.set(null),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  holdSheets: () => {
    raidSheetQueue.dropWaiting();
    return raidSheetQueue.hold();
  },
});

/** What the raid scene mounts, and nothing else. */
export const RAID_PLUGINS: readonly AttackPlugin[] = [battlePlugin, raidPlugin];
