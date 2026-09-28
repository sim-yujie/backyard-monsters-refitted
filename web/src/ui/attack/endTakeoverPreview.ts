import { declineTakeover, getTakeoverQuote, takeOverCell } from "@/api/maproom";
import type { TakeoverGrantOffer } from "@/api/types";
import { describeOutcome } from "@/game/attack/attackSave";
import type { TakeoverKind } from "@/game/maproom/takeover";
import { EndAttackPanel } from "./EndAttackPanel";
import { EndTakeoverOffer } from "./EndTakeoverOffer";

/**
 * Development only: shows the end-of-attack panel with a takeover offer
 * without finishing a real attack, which must never be done on the shared
 * test account. The offer is the real one and calls the real routes, so a
 * browser check intercepts `takeoverquote`, `declinetakeover` and
 * `takeoverCell` to answer with mocked data. Installed by the Map Room 2
 * scene as `window.__takeoverPreview` in a dev build.
 */

export interface EndTakeoverPreviewOptions {
  readonly kind: TakeoverKind;
  readonly baseid: string;
  readonly name: string;
  /** A player outpost's grant, as the final save would carry it. */
  readonly grant?: TakeoverGrantOffer | null;
  readonly damagePercent?: number;
}

export const previewEndTakeover = (modal: HTMLElement, options: EndTakeoverPreviewOptions): (() => void) => {
  const kind = options.kind === "camp" ? "wild" : "outpost";
  const damagePercent = options.damagePercent ?? 94;
  let offer: EndTakeoverOffer | null = null;
  const close = (): void => {
    offer?.declineOnLeave(false);
    offer?.destroy();
    offer = null;
    panel.close();
  };
  const panel = new EndAttackPanel({
    summary: {
      targetName: options.name,
      kind,
      endReason: "retreat",
      ...describeOutcome(kind, options.name, damagePercent),
      damagePercent,
      buildingsDestroyed: 30,
      buildingsTotal: 32,
      loot: { r1: 120_000, r2: 80_000, r3: 40_000, r4: 0 },
      lootTaken: { r1: 120_000, r2: 80_000, r3: 40_000, r4: 0 },
      monstersSent: 40,
      monstersLost: 12,
      champions: [],
      elapsedSeconds: 140,
    },
    onReturn: close,
    onRetry: () => {},
    onLeave: close,
  }).mount(modal);
  panel.setSaved({});
  offer = new EndTakeoverOffer({
    kind: options.kind,
    baseid: options.baseid,
    name: options.name,
    grant: options.grant ?? null,
    quote: getTakeoverQuote,
    takeOver: takeOverCell,
    decline: (baseid, request) => declineTakeover(baseid, request),
    modal,
    onTaken: close,
  });
  panel.setExtra(offer.element);
  return close;
};
