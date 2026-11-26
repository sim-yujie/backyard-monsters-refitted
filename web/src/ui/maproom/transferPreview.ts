import type { ArmyYard } from "@/game/maproom/transferPlan";
import { TransferMode } from "./TransferMode";

/**
 * The layout check's way to the world map's move tray (beta 9 #7,
 * web/e2e/layout): the sandbox yard is not on Map Room 2 and has no outposts,
 * so this opens the real tray over the yard with a fixed, busy empire (the
 * main yard, 40 outposts, seven kinds of monster), every call answered here.
 * No plates: there is no map under it. Installed as
 * `window.__transferPreview(state)` in a dev build or one built with
 * VITE_LAYOUT_CHECK=1, never in a release build.
 */

const KINDS = ["C1", "C2", "C3", "C4", "C7", "C12", "C5"];
const SIZE: Record<string, number> = { C1: 7, C2: 10, C3: 15, C4: 20, C5: 30, C7: 20, C12: 160 };

const empire = (): ArmyYard[] => {
  const yards: ArmyYard[] = [
    { baseid: "preview-main", main: true, x: 240, y: 208, capacity: 2160, attack: false, housed: { C1: 160, C2: 30, C3: 12, C4: 12, C7: 8, C12: 4, C5: 3 } },
  ];
  let seed = 11;
  const next = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 40; i++) {
    const housed: Record<string, number> = {};
    const target = Math.round(next() * 420);
    let used = 0;
    for (let k = 0; k < 200 && used + 7 <= target; k++) {
      const id = KINDS[Math.floor(next() * 5)]!;
      if (used + (SIZE[id] ?? 10) > target) continue;
      housed[id] = (housed[id] ?? 0) + 1;
      used += SIZE[id] ?? 10;
    }
    yards.push({
      baseid: `preview-out-${i}`,
      main: false,
      x: 241 + (i % 8),
      y: 200 + Math.floor(i / 8),
      capacity: i % 7 === 0 ? 675 : 540,
      attack: i === 3,
      housed,
    });
  }
  return yards;
};

/**
 * Opens the tray at its busiest. `in`: Bring to an outpost, every yard
 * ticked, two kinds at as many as fit and the third's stepper open. `out`:
 * Move from the main yard to one outpost, two kinds picked. Returns the
 * function that takes it all down.
 */
export const previewTransferMode = async (layer: HTMLElement, state: "in" | "out" = "in"): Promise<() => void> => {
  const mode = new TransferMode({
    layer,
    sizeOf: (id) => SIZE[id] ?? 10,
    distance: (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)),
    nameOf: (yard) => (yard.main ? "Main yard" : `${yard.x}, ${yard.y}`),
    place: () => null,
    load: async () => empire(),
    send: async () => ({ yards: [] }),
    onMoved: () => undefined,
    mark: () => undefined,
    onEnd: () => undefined,
  });
  const tap = (selector: string, nth = 0): void =>
    layer.querySelectorAll<HTMLButtonElement>(`.xfer-tray ${selector}`)[nth]?.click();
  if (state === "in") {
    await mode.start("preview-out-0", "in");
    for (const nth of [0, 1]) {
      tap(".xfer-chip", nth);
      tap(".xfer-step--max");
      tap(".xfer-step--ok");
    }
    tap(".xfer-chip", 2);
  } else {
    await mode.start("preview-main", "out");
    mode.tapCell(242, 200);
    tap(".xfer-chip", 0);
    for (let i = 0; i < 12; i++) tap(".xfer-step", 1);
    tap(".xfer-step--ok");
    tap(".xfer-chip", 3);
    tap(".xfer-step--max");
    tap(".xfer-step--ok");
  }
  return () => mode.destroy();
};
