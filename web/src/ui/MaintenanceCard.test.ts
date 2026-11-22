// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MaintenanceCard } from "./MaintenanceCard";

/** The sign-in screen's maintenance card and its Try again (owner, 22 Nov 2026). */

const refusal = { message: "Moving to a faster server", backAt: null };

describe("MaintenanceCard", () => {
  it("says Maintenance, the owner's message, and offers Try again", () => {
    const card = new MaintenanceCard(refusal, { check: vi.fn(), onOver: vi.fn(), onStill: vi.fn() });
    expect(card.element.querySelector(".maint-card__title")?.textContent).toBe("Maintenance");
    expect(card.element.querySelector(".maint-card__message")?.textContent).toBe("Moving to a faster server");
    expect(card.element.querySelector(".maint-card__retry")?.textContent).toBe("Try again");
    expect(card.element.querySelector<HTMLElement>(".maint-card__back")?.hidden).toBe(true);
  });

  it("Try again while still on: Still down, the newest words, then Try again again", async () => {
    vi.useFakeTimers();
    const onStill = vi.fn();
    const card = new MaintenanceCard(refusal, {
      check: async () => ({ on: true, message: "Longer", backAt: null, remainingMs: 0, exempt: false }),
      onOver: vi.fn(),
      onStill,
    });
    const retry = card.element.querySelector<HTMLButtonElement>(".maint-card__retry")!;
    retry.click();
    await vi.waitFor(() => expect(retry.textContent).toBe("Still down"));
    expect(onStill).toHaveBeenCalledWith({ message: "Longer", backAt: null });
    expect(retry.disabled).toBe(true);
    vi.advanceTimersByTime(3_000);
    expect(retry.textContent).toBe("Try again");
    expect(retry.disabled).toBe(false);
    vi.useRealTimers();
  });

  it("Try again once it is over: Back online! and the screen carries on", async () => {
    const onOver = vi.fn();
    const card = new MaintenanceCard(refusal, {
      check: async () => ({ on: false, message: "", backAt: null, remainingMs: 0, exempt: false }),
      onOver,
      onStill: vi.fn(),
    });
    card.element.querySelector<HTMLButtonElement>(".maint-card__retry")!.click();
    await vi.waitFor(() => expect(onOver).toHaveBeenCalled());
    expect(card.element.querySelector(".maint-card__retry")?.textContent).toBe("Back online!");
  });

  it("Try again with no connection says so", async () => {
    const card = new MaintenanceCard(refusal, { check: async () => null, onOver: vi.fn(), onStill: vi.fn() });
    const retry = card.element.querySelector<HTMLButtonElement>(".maint-card__retry")!;
    retry.click();
    await vi.waitFor(() => expect(retry.textContent).toBe("No connection"));
  });
});
