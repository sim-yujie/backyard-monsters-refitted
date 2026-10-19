// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { RandomMoveDialog, type RandomMoveDialogOptions } from "./RandomMoveDialog";

/**
 * "Move to a Random Spot" (#366): the warning names every outpost lost and
 * what goes with them, Cancel does nothing, Confirm moves, and the server's
 * refusals (the week not up, an attack running) are shown in its words.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

let host: HTMLElement;

const open = (overrides: Partial<RandomMoveDialogOptions> = {}) => {
  host = document.createElement("div");
  document.body.append(host);
  const options: RandomMoveDialogOptions = {
    outposts: 3,
    move: vi.fn(async () => ({ error: 0, coords: [50, 60] as [number, number], outpostsLost: 3, randommoveat: NOW })),
    onMoved: vi.fn(),
    openMap: vi.fn(),
    now: () => NOW,
    ...overrides,
  };
  const dialog = new RandomMoveDialog(options).mount(host);
  return { dialog, options };
};

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === name && !node.closest("[hidden]"),
  );

afterEach(() => host.remove());

describe("RandomMoveDialog", () => {
  it("warns that every outpost is lost, how many, and what goes with them", () => {
    open();
    expect(host.querySelector(".panel__title")?.textContent).toBe("Move to a Random Spot");
    const warning = host.querySelector(".random-move-dialog__warning");
    expect(warning?.getAttribute("role")).toBe("alert");
    expect(warning?.textContent).toContain("All 3 of your outposts will be lost.");
    expect(warning?.textContent).toContain("They go back to the wild monsters");
    expect(warning?.textContent).toContain("the buildings, the monsters living there");
    expect(warning?.textContent).toContain("This cannot be undone.");
    expect(host.textContent).toContain("you stay in your alliance");
    expect(host.textContent).toContain("once every 7 days");
    expect(host.textContent).toContain("Move your main yard and lose all 3 outposts?");
  });

  it("without outposts, says nothing else is lost", () => {
    open({ outposts: 0 });
    expect(host.querySelector(".random-move-dialog__warning")).toBeNull();
    expect(host.textContent).toContain("You have no outposts, so nothing else is lost.");
  });

  it("Cancel closes it without moving", () => {
    const { options } = open();
    buttonNamed("Cancel")!.click();
    expect(options.move).not.toHaveBeenCalled();
    expect(host.querySelector(".random-move-dialog")).toBeNull();
  });

  it("Confirm moves, then says where the yard is and offers the map", async () => {
    const { dialog, options } = open();
    buttonNamed("Move my yard")!.click();
    await flush();
    expect(options.move).toHaveBeenCalledTimes(1);
    expect(options.onMoved).toHaveBeenCalledWith(expect.objectContaining({ coords: [50, 60] }));
    expect(dialog.currentStep).toBe("done");
    expect(host.textContent).toContain("Your main yard has moved to 50, 60.");
    buttonNamed("Open map")!.click();
    expect(options.openMap).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".random-move-dialog")).toBeNull();
  });

  it("inside the week, shows when it opens again and keeps Confirm off", async () => {
    const move = vi.fn(async () => {
      throw new ApiError("You have already moved this week. Try again when the week is up.", {
        status: 409,
        details: { data: { reason: "coolingDown", availableAt: NOW + 4 * DAY, currenttime: NOW } } as never,
      });
    });
    const { dialog, options } = open({ move });
    buttonNamed("Move my yard")!.click();
    await flush();
    const status = host.querySelector(".takeover-dialog__status")!;
    expect(status.textContent).toBe(
      "You have already moved this week. Try again when the week is up. Available again in 4 days.",
    );
    expect(status.classList.contains("takeover-dialog__status--failed")).toBe(true);
    expect(dialog.currentStep).toBe("confirm");
    expect(buttonNamed("Move my yard")!.disabled).toBe(true);
    expect(options.onMoved).not.toHaveBeenCalled();
  });

  it("while under attack, shows the server's reason and lets the player try again", async () => {
    const move = vi
      .fn<RandomMoveDialogOptions["move"]>()
      .mockRejectedValueOnce(
        new ApiError("Your main yard is under attack. Try again when the attack is over.", {
          status: 409,
          details: { data: { reason: "underAttack" } } as never,
        }),
      )
      .mockResolvedValueOnce({ error: 0, coords: [50, 60] });
    const { dialog, options } = open({ move });
    buttonNamed("Move my yard")!.click();
    await flush();
    expect(host.querySelector(".takeover-dialog__status")?.textContent).toBe(
      "Your main yard is under attack. Try again when the attack is over.",
    );
    expect(buttonNamed("Move my yard")!.disabled).toBe(false);
    buttonNamed("Move my yard")!.click();
    await flush();
    expect(dialog.currentStep).toBe("done");
    expect(options.onMoved).toHaveBeenCalledTimes(1);
  });

  it("a second press while the move is on its way sends nothing more", async () => {
    let resolve: (value: { error: number }) => void = () => {};
    const move = vi.fn(() => new Promise<{ error: number }>((done) => (resolve = done)));
    const { options } = open({ move });
    const confirm = buttonNamed("Move my yard")!;
    confirm.click();
    expect(confirm.disabled).toBe(true);
    confirm.click();
    resolve({ error: 0 });
    await flush();
    expect(options.move).toHaveBeenCalledTimes(1);
  });
});
