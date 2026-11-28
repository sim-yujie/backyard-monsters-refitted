import type { PlayerCell } from "@/api/types";
import { YardCard } from "./YardCard";

/**
 * The layout check's way to the "Your outpost" card (bug 73, 27 Nov 2026,
 * web/e2e/layout): the sandbox yard is not on Map Room 2 and has no
 * outposts, so this opens the real card over the yard with a fixed outpost
 * at its busiest: a long name, a Starter Kit, Forest (three bonuses), the
 * neighbour bonus, protected with an invite pending, seven kinds housed and
 * every button. Installed as `window.__yardCardPreview()` in a dev build or
 * one built with VITE_LAYOUT_CHECK=1, never in a release build.
 */

const SIZE: Record<string, number> = { C1: 7, C2: 10, C3: 15, C4: 20, C5: 30, C7: 20, C12: 160 };

const busyOutpost = (): PlayerCell => ({
  uid: 1,
  b: 3,
  i: 150,
  bid: "preview-outpost",
  aid: null,
  n: "Preview",
  l: 30,
  v: 1,
  dm: 0,
  d: 0,
  lo: 0,
  p: 1,
  pe: Date.now() / 1000 + 6 * 3600,
  mine: 1,
  pic_square: null,
  pi: 1,
  fr: 0,
  kit: 3,
  wi: 1,
  lf: 1,
  nb: 3,
  m: { housed: { C1: 12, C2: 9, C3: 6, C4: 4, C5: 3, C7: 2, C12: 1 }, space: 540 },
});

/** Opens the card on `layer`; returns the function that takes it down. */
export const previewYardCard = (layer: HTMLElement): (() => void) => {
  const card = new YardCard({ col: 239, row: 207 }, busyOutpost(), {
    onOpen: () => undefined,
    onBookmark: () => undefined,
    canBookmark: () => true,
    sizeOf: (id) => SIZE[id] ?? 10,
    ownFlinger: () => ({ level: 4, reach: 4 }),
    ownMoves: () => ({ monsters: true, relocate: true }),
    onMoveFrom: () => undefined,
    onBringHere: () => undefined,
    onRelocate: () => undefined,
    onInvite: () => undefined,
    onWithdrawInvite: () => undefined,
    cellsFromHome: () => 5,
    onClose: () => undefined,
  }).mount(layer);
  return () => card.dismiss();
};
