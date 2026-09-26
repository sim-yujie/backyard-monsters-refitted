import { ATTACK_PLUGINS, type AttackPlugin } from "@/app/scenes/AttackScene";
import type { Yard } from "@/game/yard/yardModel";
import type { AttackSession, FlingInput } from "../AttackSession";
import { AttackBattleLayer } from "../AttackBattleLayer";

/**
 * Attack-scene plugin for the "battle" work package (issue #32, WP5): mounts
 * the {@link AttackBattleLayer} that draws creeps, shots, splats and building
 * damage over the enemy yard, and tears it down with the scene.
 *
 * In development it also hangs `window.__attackBattle` off the page so a
 * battle can be started from the console before the army panel is there:
 *
 *     __attackBattle.fling({ C1: 20 })            // 20 Pokeys at a clear spot
 *     __attackBattle.fling({ C1: 5 }, { champion: { t: 1, l: 1 } })
 *     __attackBattle.session.setSpeed(2)
 */

/** Yard units kept clear around a footprint when picking the drop spot. */
const CLEARANCE = 60;

/**
 * A drop point on open ground: the first spot along the plot's left edge,
 * moving down, that is at least `CLEARANCE` from every footprint. Falls back
 * to the top-left corner if the yard is packed to its edge.
 */
export const openDropSpot = (yard: Yard): { x: number; y: number } => {
  const halfW = yard.bounds.yardWidth / 2;
  const halfH = yard.bounds.yardHeight / 2;
  const x = -halfW + CLEARANCE;
  for (let y = -halfH + CLEARANCE; y <= halfH - CLEARANCE; y += 20) {
    let clear = true;
    for (const building of yard.buildings) {
      const [w, h] = building.footprint;
      if (
        x >= building.x - CLEARANCE &&
        x <= building.x + w + CLEARANCE &&
        y >= building.y - CLEARANCE &&
        y <= building.y + h + CLEARANCE
      ) {
        clear = false;
        break;
      }
    }
    if (clear) return { x, y };
  }
  return { x: -halfW + CLEARANCE, y: -halfH + CLEARANCE };
};

interface DevHook {
  session: AttackSession;
  layer: AttackBattleLayer;
  /** Flings a roster at a clear spot, or at `at`. */
  fling: (
    monsters: FlingInput["monsters"],
    extra?: { champion?: FlingInput["champion"]; at?: { x: number; y: number } },
  ) => ReturnType<AttackSession["appendFling"]>;
  dropSpot: { x: number; y: number };
}

const plugin: AttackPlugin = (mounts) => {
  const layer = new AttackBattleLayer({
    session: mounts.session,
    yard: mounts.yard,
    host: mounts.renderer,
    overlay: mounts.battleLayer,
  });

  let hooked = false;
  if (import.meta.env.DEV) {
    const spot = openDropSpot(mounts.yard);
    const hook: DevHook = {
      session: mounts.session,
      layer,
      dropSpot: spot,
      fling: (monsters, extra) =>
        mounts.session.appendFling({
          x: extra?.at?.x ?? spot.x,
          y: extra?.at?.y ?? spot.y,
          monsters,
          ...(extra?.champion ? { champion: extra.champion } : {}),
        }),
    };
    (window as unknown as { __attackBattle?: DevHook }).__attackBattle = hook;
    hooked = true;
  }

  return () => {
    layer.destroy();
    if (hooked) delete (window as unknown as { __attackBattle?: DevHook }).__attackBattle;
  };
};

ATTACK_PLUGINS.push(plugin);
