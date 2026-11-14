import { YardCancelUpgradeSchema, YardUpgradeSchema } from "../../schemas/YardSchemas.js";
import { upgradeQuestEvents } from "../../services/quests/hooks.js";
import { weekendBoost } from "../../services/events/weekendBoosts.js";
import { withInfernoStanding } from "../../services/yard/surfaceInferno.js";
import { withTopUp } from "../../services/yard/topUp.js";
import { planCancelUpgrade, planUpgradeAction } from "../../services/yard/upgrade.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/upgrade` — start the next upgrade step of one building as a
 * countdown holding a worker, however short (`docs/design/yard-buildings.md`
 * §3.2, #137). The rules are
 * `services/yard/upgrade.ts`; the wrapper charges the step and writes. A
 * main-yard Inferno building reads the player's Inferno standing first
 * (`services/yard/surfaceInferno.ts`, Inferno WP 6.1). A Builder's Weekend
 * takes its percentage off the price (`services/events/weekendBoosts.ts`).
 */
export const yardUpgradeAction = defineYardAction({
  schema: YardUpgradeSchema,
  run: async ({ save, user, body, now, em }) => {
    const type = Number(save.buildingdata?.[String(body.id)]?.t);
    const off = weekendBoost("builders", now);
    const standing = await withInfernoStanding(em, user.userid, save, type);
    // A short pool topped up with Shiny, Flash's `BRTOPUP` (`services/yard/topUp.ts`, issue #393).
    const plan = await withTopUp(standing, body.topUp, (seen) => planUpgradeAction(seen, body.id, now, off));
    // Daily quests: an upgrade started on a harvester or a tower.
    return { ...plan, questEvents: upgradeQuestEvents(type) };
  },
  outposts: "allow",
  inferno: "allow",
});

/**
 * `POST /bm/yard/upgrade/cancel` — stop a running upgrade and refund the
 * step's price as paid (full, or less a Builder's Weekend), clamped to the
 * storage cap (§3.2).
 */
export const yardCancelUpgradeAction = defineYardAction({
  schema: YardCancelUpgradeSchema,
  run: ({ save, body }) => ({
    ...planCancelUpgrade(save, body.id),
    // A cancelled upgrade takes its daily quest count back.
    questEvents: upgradeQuestEvents(save.buildingdata?.[String(body.id)]?.t, -1),
  }),
  outposts: "allow",
  inferno: "allow",
});
