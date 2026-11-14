import { noteCoins } from "@/game/eventCoins";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for event coins (beta 7, `game/eventCoins.ts`): hands the
 * yard load's purse to the coin module. Coins come from big events' calendar
 * days and ladder tiers (owner, 8 Nov 2026) and from weekend events: 50 for
 * each day's check-in on the event's card or pop-up (owner, 13 Nov 2026).
 * A gain raises no toast (owner, 13 Nov 2026): the top bar's Glimmers
 * readout floats the "+N" (`ui/Hud.ts`).
 */
export const eventCoinsPlugin: YardPlugin = ({ store }) => {
  // The main yard's load carries the purse.
  const save = store.save;
  if (typeof save.eventcoins === "number") noteCoins(save.eventcoins);
};

YARD_PLUGINS.push(eventCoinsPlugin);
