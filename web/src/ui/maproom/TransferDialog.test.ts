// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransferYard } from "@/game/maproom/moveYards";
import { TransferDialog, type TransferDialogOptions } from "./TransferDialog";

/**
 * "Move monsters" (outposts WP7, #186): pick where from and where to among the
 * player's yards, then how many; no count goes past the target's free
 * housing, and what is sent is both yards' whole rosters after the move.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const MAIN = "3510";
const OUTPOST = "2291";
const OTHER = "2292";

/** C1 takes 1, C2 takes 2. */
const sizeOf = (id: string): number => ({ C1: 1, C2: 2 })[id] ?? 1;

const yards: Record<string, TransferYard> = {
  [MAIN]: { baseid: MAIN, housed: { C1: 30, C2: 10 }, space: 2_000 },
  [OUTPOST]: { baseid: OUTPOST, housed: { C1: 8 }, space: 20 },
  [OTHER]: { baseid: OTHER, housed: {}, space: 0 },
};

let host: HTMLElement;

const open = async (overrides: Partial<TransferDialogOptions> = {}) => {
  host = document.createElement("div");
  document.body.append(host);
  const options: TransferDialogOptions = {
    yards: [
      { baseid: MAIN, label: "Main yard", main: true },
      { baseid: OUTPOST, label: "Outpost (230, 215)", main: false },
      { baseid: OTHER, label: "Outpost (250, 200)", main: false },
    ],
    from: MAIN,
    load: vi.fn(async (baseid: string) => yards[baseid]!),
    sizeOf,
    send: vi.fn(async () => ({ error: 0 })),
    onMoved: vi.fn(),
    ...overrides,
  };
  const dialog = new TransferDialog(options).mount(host);
  await flush();
  return { dialog, options };
};

const select = (label: string): HTMLSelectElement =>
  host.querySelector<HTMLSelectElement>(`select[aria-label='${label}']`)!;

const go = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".transfer-dialog__go")!;

afterEach(() => host.remove());

/** Escape on the page, as after a click on the dialog's text left focus there (#191). */
const escapeOnPage = (): void => {
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

describe("TransferDialog", () => {
  it("offers only outposts as targets from the main yard, and every other yard from an outpost", async () => {
    await open();
    expect([...select("Move monsters to").options].map((option) => option.value)).toEqual([OUTPOST, OTHER]);

    const from = select("Move monsters from");
    from.value = OUTPOST;
    from.dispatchEvent(new Event("change"));
    await flush();
    expect([...select("Move monsters to").options].map((option) => option.value)).toEqual([MAIN, OTHER]);
  });

  it("lists the source's monsters and the target's room", async () => {
    await open();
    expect(host.querySelectorAll(".transfer-row")).toHaveLength(2);
    expect(host.querySelector(".transfer-dialog__room")?.textContent).toBe(
      "Room left at Outpost (230, 215): 12 of 20",
    );
    expect(go().disabled).toBe(true);
  });

  it("clamps every count to the target's free housing", async () => {
    const { dialog } = await open();
    // Fill C1: 12 fit though 30 are here.
    const c1 = host.querySelectorAll(".transfer-row")[0]!;
    c1.querySelector<HTMLButtonElement>(".transfer-row__fill")!.click();
    expect(dialog.picks).toEqual({ C1: 12 });
    expect(host.querySelector(".transfer-dialog__room")?.textContent).toBe(
      "Room left at Outpost (230, 215): 0 of 20",
    );
    // No room is left for a C2, and typing more C1 is cut back.
    const c2 = host.querySelectorAll(".transfer-row")[1]!;
    expect(c2.querySelector<HTMLButtonElement>(".transfer-row__step--plus")!.disabled).toBe(true);
    const input = c1.querySelector<HTMLInputElement>("input")!;
    input.value = "25";
    input.dispatchEvent(new Event("input"));
    expect(dialog.picks).toEqual({ C1: 12 });
  });

  it("sends the counts moved, and says it is done (#196)", async () => {
    const { options } = await open();
    const c1 = host.querySelectorAll(".transfer-row")[0]!;
    const input = c1.querySelector<HTMLInputElement>("input")!;
    input.value = "5";
    input.dispatchEvent(new Event("input"));
    expect(go().textContent).toBe("Transfer 5");
    go().click();
    await flush();
    expect(options.send).toHaveBeenCalledWith(MAIN, OUTPOST, { C1: 5 });
    expect(options.onMoved).toHaveBeenCalledWith(MAIN, OUTPOST, "All monsters successfully transferred.");
    expect(host.querySelector(".popup-backdrop")).toBeNull();
  });

  it("closes on Escape even when focus has left it (#191)", async () => {
    await open();
    escapeOnPage();
    expect(host.querySelector(".transfer-dialog")).toBeNull();
  });

  it("says a target has no housing, in Flash's words", async () => {
    await open();
    const to = select("Move monsters to");
    to.value = OTHER;
    to.dispatchEvent(new Event("change"));
    await flush();
    expect(host.querySelector(".transfer-dialog__room")?.textContent).toBe(
      "You don't have any Monster Housing at this Outpost.",
    );
  });

  it("keeps the dialog open and says why when the server refuses", async () => {
    const { options } = await open({
      send: vi.fn(async () => Promise.reject(new Error("one of those yards is under attack."))),
    });
    const input = host.querySelectorAll(".transfer-row")[0]!.querySelector<HTMLInputElement>("input")!;
    input.value = "2";
    input.dispatchEvent(new Event("input"));
    go().click();
    await flush();
    expect(options.onMoved).not.toHaveBeenCalled();
    expect(host.querySelector(".takeover-dialog__status")?.textContent).toBe(
      "There was a problem with the transfer: one of those yards is under attack.",
    );
    expect(go().disabled).toBe(false);
  });
});
