import { InfernoTransferSchema } from "../../schemas/YardSchemas.js";
import { noInfernoYardErr } from "../../errors/errors.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import { syncInfernoCap } from "../../services/inferno/infernoLoad.js";
import { housedOf, planInfernoTransfer, type InfernoTransferPlan } from "../../services/inferno/transfer.js";
import { catchUpYard } from "../../services/yard/catchUp.js";
import { academyLevels, isMapRoom3Monsters } from "../../services/yard/hatchery.js";
import { housingCapacity } from "../../services/yard/housing.js";
import { yardRefusedErr } from "../../services/yard/yardErrors.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { defineYardAction, lockInfernoRow, type YardSlices } from "../yard/yardAction.js";

/**
 * `POST /bm/inferno/transfer` (`docs/design/inferno.md` §3.2, WP 2.5): brings
 * Inferno monsters up from the Inferno yard's Compound into the main yard's
 * Housing, free. The rules are `services/inferno/transfer.ts`.
 *
 * A main-yard action (`runYardAction`): the main row is locked and caught up
 * first, then the Inferno yard's row is locked (`lockInfernoRow`: `403
 * infernoOff` while the new Inferno is off, `409 underAttack` while it is
 * attacked), caught up and written in the same transaction. `409
 * noInfernoYard` when the player has none yet. The answer is the main yard's
 * state, with the plan as `report`.
 */
export const infernoTransferAction = defineYardAction({
  schema: InfernoTransferSchema,
  run: async ({ save, user, body, now, em }) => {
    requireInfernoEnabled();
    if (!(Number(save.baseid_inferno) > 0)) throw noInfernoYardErr();
    if (isMapRoom3Monsters(save.monsters)) {
      throw yardRefusedErr("mapRoom3", "Bringing up Inferno monsters on a Map Room 3 yard is not supported yet.");
    }

    const inferno = await lockInfernoRow(em, user, String(save.baseid_inferno));
    catchUpYard(inferno, now);

    const expansion = Number((save.storedata?.EXH as JsonObject | undefined)?.e ?? 0) > now;
    const report: InfernoTransferPlan = planInfernoTransfer({
      moved: body.monsters,
      compound: housedOf(inferno.monsters),
      housed: housedOf(save.monsters),
      capacity: housingCapacity(save, expansion),
      levels: academyLevels(save.academy),
    });

    // Read through the transaction, so the commit writes it with the main yard.
    inferno.monsters = { ...(inferno.monsters ?? {}), housed: report.compound };

    const slices: YardSlices = { monsters: { ...(save.monsters ?? {}), housed: report.housed } };
    // The Inferno yard's catch-up may have finished a Resource Pod: the main
    // yard's Inferno caps follow it, as on every Inferno load (`syncInfernoCap`).
    const caps = { iresources: save.iresources };
    syncInfernoCap(caps, inferno);
    if (caps.iresources !== save.iresources) slices.iresources = caps.iresources;

    return { report, slices };
  },
});
