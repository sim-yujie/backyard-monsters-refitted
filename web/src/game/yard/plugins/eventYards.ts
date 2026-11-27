import { fetchEventYards, type EventYards } from "@/api/eventYards";
import type { EventView } from "@/api/events";
import {
  eventYardTarget,
  setEventYardStarter,
  startEventYardAttack,
  takeEventYardLanded,
  type EventYardTarget,
} from "@/game/eventYards/eventYardAttack";
import { EVENT_EXTRAS } from "@/ui/events/EventsPanel";
import { el } from "@/ui/dom";
import { openYardPrizePopup, wantsPrizePopup, yardCardBody } from "@/ui/eventYards/yardEventUi";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for the Brukkarg attack events (beta 10: Creature Carnage
 * and Brukkarg War's yards; server `services/events/yards/`):
 *
 * - The Events card's part (kind `yards`): the yard track, the next yard,
 *   its prize and Attack, filled from `GET /bm/events/yards` once drawn.
 * - Attack opens the attack scene on the yard, from the main yard's housing.
 * - Back home after an attack that won a building or the trophy, the prize
 *   pop-up with Build now (Glimmers show on the end panel alone).
 *
 * Main yard only, as the Events page.
 *
 * When the dashboard's generic event control (`feat/wave-events`) runs these
 * events, their card comes as kind `wave` with id `carnage-…`/`brukwar-…`:
 * register {@link yardsExtra} for those ids there too (see the server's
 * `yardEventRun.ts` hook).
 */

/** The yards for an event card, fetched once per card draw. */
export const yardsExtra = (
  event: Pick<EventView, "id">,
  load: () => Promise<{ now: number; event: EventYards | null }> = fetchEventYards,
): HTMLElement => {
  const slot = el("div", "yard-card-slot");
  void load()
    .then(({ now, event: yards }) => {
      if (!yards || yards.runId !== event.id) return;
      slot.replaceChildren(
        yardCardBody({
          yards,
          now,
          onAttack: (yard) =>
            startEventYardAttack(yard.baseid, { event: yards.event, index: yard.index, total: yards.yards.length }),
        }),
      );
    })
    .catch(() => undefined);
  return slot;
};

EVENT_EXTRAS.set("yards", (event) => yardsExtra(event));

export const eventYardsPlugin: YardPlugin = (mounts) => {
  if (mounts.store.kind !== "main") return;
  const starter = (baseid: string, yard: EventYardTarget): string | null => {
    const { target, blocker } = eventYardTarget(mounts.store.save, baseid, yard);
    if (!target) return blocker;
    mounts.scene.openAttack(target);
    return null;
  };
  setEventYardStarter(starter);

  const landed = takeEventYardLanded();
  let popup: { close(): void } | null = null;
  if (landed && wantsPrizePopup(landed)) {
    popup = openYardPrizePopup(mounts.overlay.modal, landed, { onBuild: (type) => mounts.scene.openBuildMenu(type) });
  }

  return () => {
    popup?.close();
    setEventYardStarter(null);
  };
};

YARD_PLUGINS.push(eventYardsPlugin);
