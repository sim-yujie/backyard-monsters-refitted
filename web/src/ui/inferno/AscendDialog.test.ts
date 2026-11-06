// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASCEND_TEXT } from "@/game/inferno/transfer";
import { AscendDialog, type AscendDialogOptions } from "./AscendDialog";

/**
 * "Transfer Monsters" from the cave (Inferno WP 2.6): the Compound's Inferno
 * monsters, picks capped by the Compound and by the main yard's Housing, and
 * one request for them.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const sizeOf = (id: string): number => ({ IC1: 15, IC2: 40 })[id] ?? 0;

let host: HTMLElement;

const open = async (overrides: Partial<AscendDialogOptions> = {}) => {
  host = document.createElement("div");
  document.body.append(host);
  const options: AscendDialogOptions = {
    load: vi.fn(async () => ({ IC2: 3, IC1: 10, C1: 5 })),
    room: () => ({ used: 100, capacity: 200 }),
    sizeOf,
    send: vi.fn(async () => null),
    onDone: vi.fn(),
    ...overrides,
  };
  const dialog = new AscendDialog(options).mount(host);
  await flush();
  return { dialog, options };
};

const row = (id: string) => host.querySelector<HTMLElement>(`.ascend-row[data-monster='${id}']`)!;
const plus = (id: string) => row(id).querySelector<HTMLButtonElement>(".ascend-row__step--plus")!;
const fill = (id: string) => row(id).querySelector<HTMLButtonElement>(".ascend-row__fill")!;
const go = () => host.querySelector<HTMLButtonElement>(".ascend-dialog__go")!;
const figure = () => host.querySelector(".ascend-dialog__figure")!.textContent;

afterEach(() => host.remove());

describe("AscendDialog", () => {
  it("shows Flash's words and lists only the Compound's Inferno monsters, lowest first", async () => {
    await open();
    expect(host.textContent).toContain(ASCEND_TEXT.title);
    expect(host.textContent).toContain(ASCEND_TEXT.action);
    expect(host.textContent).toContain(ASCEND_TEXT.capacity);
    const ids = [...host.querySelectorAll<HTMLElement>(".ascend-row")].map((item) => item.dataset["monster"]);
    expect(ids).toEqual(["IC1", "IC2"]);
    expect(row("IC1").querySelector(".ascend-row__have")!.textContent).toBe("0 / 10");
    expect(figure()).toBe("100 / 200 (50%)");
    expect(go().disabled).toBe(true);
  });

  it("caps a pick at what still fits in the Housing, the other picks counted", async () => {
    const { dialog } = await open();
    plus("IC2").click();
    // 100 used + 40: 60 left, four Spurtz (15 each).
    fill("IC1").click();
    expect(dialog.picks).toEqual({ IC2: 1, IC1: 4 });
    expect(figure()).toBe("200 / 200 (100%)");
    expect(plus("IC2").disabled).toBe(true);
    expect(row("IC1").querySelector(".ascend-row__have")!.textContent).toBe("4 / 10");
  });

  it("sends the picks, closes, and says how many came up", async () => {
    const { options } = await open();
    plus("IC1").click();
    plus("IC1").click();
    go().click();
    await flush();
    expect(options.send).toHaveBeenCalledWith({ IC1: 2 });
    expect(options.onDone).toHaveBeenCalledWith("2 Inferno monsters came up to your yard.");
    expect(host.querySelector(".ascend-dialog")).toBeNull();
  });

  it("stays open with the server's sentence when refused", async () => {
    const { options } = await open({ send: vi.fn(async () => "There is not enough room in your Housing for those monsters.") });
    plus("IC1").click();
    go().click();
    await flush();
    expect(options.onDone).not.toHaveBeenCalled();
    expect(host.querySelector(".ascend-dialog__status")!.textContent).toBe(
      "There is not enough room in your Housing for those monsters.",
    );
    expect(go().disabled).toBe(false);
  });

  it("says so when the Compound is empty", async () => {
    await open({ load: vi.fn(async () => ({})) });
    expect(host.querySelector(".ascend-dialog__note")!.textContent).toBe(ASCEND_TEXT.none);
    expect(host.querySelectorAll(".ascend-row")).toHaveLength(0);
  });

  it("says what went wrong when the Compound cannot be read", async () => {
    await open({ load: vi.fn(async () => Promise.reject(new Error("the server could not be reached."))) });
    expect(host.querySelector(".ascend-dialog__status")!.textContent).toBe(
      ASCEND_TEXT.problem + "the server could not be reached.",
    );
  });
});
