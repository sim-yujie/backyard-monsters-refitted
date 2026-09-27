import { TRAP_TYPES } from "@/game/yard/buildingCosts";
import type { Yard } from "@/game/yard/yardModel";

/**
 * Enemy traps stay hidden until they go off (issue #66).
 *
 * `BTRAP.SetProps` hides a trap in every mode but BUILD (`client/scripts/
 * BTRAP.as:33-43`, `BHEAVYTRAP.as:107`): an attacker, or a visitor, never sees
 * one until `Explode` shows it as a ruin with a scorch under it (`:88-153`). A
 * trap fired in an earlier attack is saved at zero health and never fires
 * again, so it stays hidden for good.
 *
 * The concealment is the renderer's (`YardRenderer.setConcealed`): a concealed
 * building is drawn nowhere, cannot be picked and has no corners, so the
 * minimap and the building panel never see it either. The server keeps sending
 * traps because the client-side engine is what fires them.
 */

/** Whether a type is a trap: the Booby Trap (24) or the Heavy Trap (117). */
export const isTrapType = (type: number): boolean => TRAP_TYPES.includes(type);

/** Something that can hide a building from every view. */
export interface Concealer {
  setConcealed(id: number, concealed: boolean): void;
}

/** Hides every trap in a yard; returns how many were hidden. */
export const concealTraps = (renderer: Concealer, yard: Yard): number => {
  let hidden = 0;
  for (const building of yard.buildings) {
    if (!isTrapType(building.type)) continue;
    renderer.setConcealed(building.id, true);
    hidden += 1;
  }
  return hidden;
};

/**
 * Watches the engine's `firedTraps` list and says which ids are new.
 *
 * The list is every trap that has gone off this battle, ascending, so a diff
 * against what has been seen is the "it just fired" signal the picture needs.
 */
export class TrapReveal {
  private readonly seen = new Set<number>();

  /** The ids in `fired` not reported before, in the order given. */
  sync(fired: readonly number[]): number[] {
    const fresh: number[] = [];
    for (const id of fired) {
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      fresh.push(id);
    }
    return fresh;
  }

  /** Whether a trap has been seen firing. */
  has(id: number): boolean {
    return this.seen.has(id);
  }
}
