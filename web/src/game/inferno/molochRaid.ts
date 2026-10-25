import { raidRefusal, type RaidApi, type RaidStartResponse } from "@/api/raid";
import { MOLOCH_RAID_GONE, MOLOCH_RAID_RETRY, MOLOCH_RAID_WAIT } from "./emergenceText";

/**
 * Moloch's emergence raid on the game's side (WP 1.9, `docs/design/inferno.md`
 * §2.3). The server opens it on the load that raises the cave, as an open raid
 * of the tribe {@link MOLOCH_TRIBE}, due at once; the yard plays the
 * earthquake and Moloch's warning, and "Engage Attack" starts it through the
 * wild raid's own `/raid/start`, after which the raid scene plays and lands it
 * as any raid. The wild raid's alert, countdown and result popups keep out of
 * its way (`raidYardFlow.ts`, `yard/plugins/raid.ts`): after it, the yard
 * shows "stage passed" and Moloch's taunt instead (`emergenceFlow.ts`).
 */

/** The open raid's tribe for Moloch's raids (the server's `MOLOCH_TRIBE`). */
export const MOLOCH_TRIBE = "moloch";

/** Whether a raid, or what one landed, is Moloch's. */
export const isMolochRaid = (raid: { readonly tribe: string } | null | undefined): boolean =>
  raid?.tribe === MOLOCH_TRIBE;

export interface MolochStartDeps {
  readonly api: Pick<RaidApi, "start">;
  /** The server fought it: play it (the raid scene). */
  readonly fight: (start: RaidStartResponse) => void;
  readonly notice: (message: string) => void;
}

/**
 * "Engage Attack": asks the server to fight the raid and hands the fight on.
 *
 * @returns Whether the warning is done with: true once the fight is handed
 *   on, or the raid is gone; false when the player may press again (the
 *   server busy or out of reach, or another attack on the yard).
 */
export const startMolochRaid = async (id: string, deps: MolochStartDeps): Promise<boolean> => {
  try {
    deps.fight(await deps.api.start(id));
    return true;
  } catch (caught) {
    switch (raidRefusal(caught)?.reason) {
      case "noRaid":
      case "notWarning":
      case "notMainYard":
        deps.notice(MOLOCH_RAID_GONE);
        return true;
      case "underAttack":
        deps.notice(MOLOCH_RAID_WAIT);
        return false;
      default:
        deps.notice(MOLOCH_RAID_RETRY);
        return false;
    }
  }
};
