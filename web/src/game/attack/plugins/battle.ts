// From the registry itself rather than the scene, so the Baiter scene (#126)
// can import this plugin without going round the scene and the app.
import { ATTACK_PLUGINS, type AttackPlugin } from "@/game/attack/attackPlugins";
import type { Yard } from "@/game/yard/yardModel";
import type { AttackSession, FlingInput } from "../AttackSession";
import { AttackBattleLayer } from "../AttackBattleLayer";
import { clampDropPoint } from "../AttackInput";

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
 *
 * A wild camp's plot is the one `WMBASE.Setup` grows it to (`wildYardSize`),
 * so on Kozu the left edge is open ground outside the walls, not a spot
 * between them; the result is on the pathing grid either way.
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
    if (clear) return clampDropPoint({ x, y });
  }
  return clampDropPoint({ x: -halfW + CLEARANCE, y: -halfH + CLEARANCE });
};

interface DevHook {
  session: AttackSession;
  layer: AttackBattleLayer;
  /** Flings a roster at a clear spot, or at `at` (pulled onto the grid). */
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
  // The HUD's damage and the end panel follow what the screen shows (#148).
  const releaseHold = mounts.presentation.hold(() => layer.settling);
  const releaseDamage = mounts.presentation.showDamageWith(() => layer.shownDamage());
  // Only the Baiter's report asks for this (#308); a real attack never does.
  const releaseSettle = mounts.presentation.settleWith(() => layer.settle());

  let hooked = false;
  if (import.meta.env.DEV) {
    const spot = openDropSpot(mounts.yard);
    const hook: DevHook = {
      session: mounts.session,
      layer,
      dropSpot: spot,
      fling: (monsters, extra) => {
        const at = extra?.at ? clampDropPoint(extra.at) : spot;
        return mounts.session.appendFling({
          x: at.x,
          y: at.y,
          monsters,
          ...(extra?.champion ? { champion: extra.champion } : {}),
        });
      },
    };
    (window as unknown as { __attackBattle?: DevHook }).__attackBattle = hook;
    hooked = true;
  }

  return () => {
    releaseHold();
    releaseDamage();
    releaseSettle();
    layer.destroy();
    if (hooked) delete (window as unknown as { __attackBattle?: DevHook }).__attackBattle;
  };
};

ATTACK_PLUGINS.push(plugin);

/** The plugin itself, for the Baiter scene (#126), which mounts the battle layer without the rest. */
export { plugin as battlePlugin };
