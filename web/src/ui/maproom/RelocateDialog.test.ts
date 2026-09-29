// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { RelocateDialog, type RelocateDialogOptions } from "./RelocateDialog";

/**
 * "Move Main Yard Here" (outposts WP7, #186): Flash's warning and price, the
 * outpost's monsters that are lost with it, a confirm before the move, the
 * day's cooldown, and the server's refusal.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

let host: HTMLElement;

const open = (overrides: Partial<RelocateDialogOptions> = {}) => {
  host = document.createElement("div");
  document.body.append(host);
  const options: RelocateDialogOptions = {
    lost: { C1: 40, C12: 2 },
    move: vi.fn(async () => ({ error: 0, coords: [241, 208] as [number, number] })),
    onMoved: vi.fn(),
    ...overrides,
  };
  const dialog = new RelocateDialog(options).mount(host);
  return { dialog, options };
};

const buttonNamed = (name: string): HTMLButtonElement =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === name && !node.closest("[hidden]"),
  )!;

afterEach(() => host.remove());

/** Escape on the page, as after a click on the dialog's text left focus there (#191). */
const escapeOnPage = (): void => {
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

describe("RelocateDialog", () => {
  it("shows Flash's warning, the price and every monster that is lost", () => {
    open();
    expect(host.querySelector(".panel__title")?.textContent).toBe("Move Main Yard Here");
    expect(host.textContent).toContain(
      "Relocating your yard to this outpost will destroy the outpost and all buildings on it. " +
        "Wild Monsters will claim your old main yard location.",
    );
    const lost = [...host.querySelectorAll(".relocate-dialog__lost-item")].map((row) =>
      row.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(lost).toHaveLength(2);
    expect(lost[0]).toContain("× 40");
    expect(lost[1]).toContain("× 2");
    expect(host.querySelectorAll(".takeover-dialog__cost li")).toHaveLength(4);
    expect(host.querySelector(".takeover-dialog__cost")?.textContent).toContain("30,000,000");
    expect(buttonNamed("Use 1,500 Shiny")).toBeDefined();
  });

  it("says so when no monsters are lost", () => {
    open({ lost: {} });
    expect(host.querySelector(".relocate-dialog__lost-title")?.textContent).toBe(
      "No monsters live here, so none are lost.",
    );
    expect(host.querySelector(".relocate-dialog__lost-list")).toBeNull();
  });

  it("disables a payment the purse cannot cover", () => {
    open({ affordable: { resources: false, shiny: true } });
    expect(buttonNamed("Use Resources").disabled).toBe(true);
    expect(host.textContent).toContain("You don't have enough resources to relocate.");
    expect(buttonNamed("Use 1,500 Shiny").disabled).toBe(false);
  });

  it("confirms before moving, then moves and hands back the new cell", async () => {
    const { dialog, options } = open();
    buttonNamed("Use Resources").click();
    expect(dialog.currentStep).toBe("confirm");
    expect(options.move).not.toHaveBeenCalled();
    expect(host.querySelector(".takeover-dialog__confirm-text")?.textContent).toContain(
      "30,000,000 of each resource",
    );
    expect(host.querySelector(".takeover-dialog__confirm-text")?.textContent).toContain(
      "its 42 monsters are lost",
    );
    buttonNamed("Move main yard here").click();
    await flush();
    expect(options.move).toHaveBeenCalledWith("resources");
    expect(options.onMoved).toHaveBeenCalledWith([241, 208]);
    expect(host.querySelector(".popup-backdrop")).toBeNull();
  });

  it("closes on Escape even when focus has left it, without moving (#191)", () => {
    const { options } = open();
    buttonNamed("Use 1,500 Shiny").click();
    escapeOnPage();
    expect(host.querySelector("[role='dialog']")).toBeNull();
    expect(options.move).not.toHaveBeenCalled();
  });

  it("goes back without moving", () => {
    const { dialog, options } = open();
    buttonNamed("Use 1,500 Shiny").click();
    buttonNamed("Back").click();
    expect(dialog.currentStep).toBe("choose");
    expect(options.move).not.toHaveBeenCalled();
  });

  it("shows the cooldown the server answers with, and offers no payment until it ends", async () => {
    const { dialog, options } = open({
      move: vi.fn(async () => ({ error: 0, cantMoveTill: 10_000 + 7_260, currenttime: 10_000 })),
    });
    buttonNamed("Use 1,500 Shiny").click();
    buttonNamed("Move main yard here").click();
    await flush();
    expect(options.onMoved).not.toHaveBeenCalled();
    expect(dialog.currentStep).toBe("choose");
    expect(host.querySelector(".takeover-dialog__status")?.textContent).toBe(
      "You have already moved your main yard. Try again in 2h 1m",
    );
    expect(buttonNamed("Use Resources").disabled).toBe(true);
    expect(buttonNamed("Use 1,500 Shiny").disabled).toBe(true);
  });

  it("shows a refusal in Flash's words and offers the choice again", async () => {
    const refusal = new ApiError("that yard is under attack. Try again when the attack is over.", {
      status: 409,
    });
    const { dialog, options } = open({ move: vi.fn(async () => Promise.reject(refusal)) });
    buttonNamed("Use Resources").click();
    buttonNamed("Move main yard here").click();
    await flush();
    expect(options.onMoved).not.toHaveBeenCalled();
    expect(dialog.currentStep).toBe("choose");
    expect(host.querySelector(".takeover-dialog__status")?.textContent).toBe(
      "There was a problem relocating your yard: that yard is under attack. Try again when the attack is over.",
    );
  });
});
