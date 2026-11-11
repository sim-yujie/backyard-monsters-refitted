// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { takeoverScores } from "@/game/events/takeoverScores";
import { TakeoverDialog, showTakenOver, type TakeoverDialogOptions } from "./TakeoverDialog";

/**
 * The takeover confirm dialog (issue #82): Flash's PopupTakeover showing the
 * quote's price, a choice of payment, a confirm, and the server's answer.
 */

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** Escape on the page, as after a click on the dialog's text left focus there (#191). */
const escapeOnPage = (): void => {
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

describe("TakeoverDialog", () => {
  let modal: HTMLElement;

  beforeEach(() => {
    modal = document.createElement("div");
    document.body.append(modal);
  });

  afterEach(() => {
    modal.remove();
  });

  const open = (over: Partial<TakeoverDialogOptions> = {}) => {
    const takeOver = vi.fn(async () => ({ error: 0 }));
    const onTaken = vi.fn();
    const dialog = new TakeoverDialog({
      kind: "camp",
      name: "Kozu",
      price: {
        resources: 3_500_000,
        shiny: 924,
        adjacent: true,
        affordable: { resources: true, shiny: true },
      },
      takeOver,
      onTaken,
      ...over,
    }).mount(modal);
    const $ = <T extends HTMLElement>(selector: string) => modal.querySelector<T>(selector)!;
    return { dialog, takeOver, onTaken, $ };
  };

  describe("Not now, while a player outpost's chance is live (#187)", () => {
    const grant = { resources: 5_000_000, shiny: 900, grantExpiresAt: 2_000_000_000 };

    it("is offered only with a live grant and a way to decline", () => {
      const { $ } = open({ kind: "outpost", name: "Ann", price: grant, decline: vi.fn() });
      expect($(".takeover-dialog__not-now").hidden).toBe(false);
      modal.replaceChildren();
      const camp = open({ decline: vi.fn() });
      expect(camp.$(".takeover-dialog__not-now").hidden).toBe(true);
      modal.replaceChildren();
      const noDecline = open({ kind: "outpost", name: "Ann", price: grant });
      expect(noDecline.$(".takeover-dialog__not-now").hidden).toBe(true);
    });

    it("turns the chance down, closes and says when protection ends", async () => {
      const decline = vi.fn(async () => ({ protectedUntil: 1_234 }));
      const onDeclined = vi.fn();
      const { $, takeOver } = open({ kind: "outpost", name: "Ann", price: grant, decline, onDeclined });
      $<HTMLButtonElement>(".takeover-dialog__not-now").click();
      await flush();
      expect(decline).toHaveBeenCalledTimes(1);
      expect(takeOver).not.toHaveBeenCalled();
      expect(onDeclined).toHaveBeenCalledWith(1_234);
      expect(modal.querySelector(".takeover-dialog")).toBeNull();
    });

    it("keeps the chance open when the server does not answer", async () => {
      const decline = vi.fn(async () => Promise.reject(new Error("offline")));
      const { $ } = open({ kind: "outpost", name: "Ann", price: grant, decline });
      $<HTMLButtonElement>(".takeover-dialog__not-now").click();
      await flush();
      expect($(".takeover-dialog__status").textContent).toBe(
        "Could not turn the offer down. The chance is still open.",
      );
      expect($<HTMLButtonElement>(".takeover-dialog__not-now").disabled).toBe(false);
      expect($<HTMLButtonElement>(".takeover-dialog__resources").disabled).toBe(false);
    });
  });

  it("tells the player what the ground does to the yard they take, when the height is known", () => {
    expect(open().$(".takeover-dialog__ground").hidden).toBe(true);
    modal.replaceChildren();
    const { $ } = open({ height: 150 });
    expect($(".takeover-dialog__ground").hidden).toBe(false);
    expect($(".takeover-dialog__ground").textContent).toContain("+20%");
    expect($(".takeover-dialog__ground").textContent).toContain("−17%");
    expect($(".takeover-dialog__ground img[data-icon='range']")).not.toBeNull();
  });

  it("shows Flash's title and lead, and the quote's price for each resource", () => {
    const { $ } = open();
    expect($(".panel__title").textContent).toBe("Take over this Wild Monster Yard");
    expect($(".takeover-dialog__lead").textContent).toBe("Expand your empire!");
    const cost = [...modal.querySelectorAll(".takeover-dialog__cost li")].map((item) => item.textContent);
    expect(cost).toEqual(["3,500,000", "3,500,000", "3,500,000", "3,500,000"]);
    expect($(".takeover-dialog__adjacent").hidden).toBe(false);
    expect($(".takeover-dialog__resources").textContent).toBe("Use Resources");
    expect($(".takeover-dialog__shiny").textContent).toBe("Use 924 Shiny");
    expect(modal.textContent).toContain("Keep your resources and takeover instantly!");
  });

  it("titles an outpost with its owner and counts down the chance", () => {
    const { $ } = open({
      kind: "outpost",
      name: "Bramble",
      price: { resources: 10_000_000, shiny: 1_301, grantExpiresAt: 1_600 },
      serverNow: () => 1_000,
    });
    expect($(".panel__title").textContent).toBe("Take Over Bramble's Outpost");
    expect($(".takeover-dialog__countdown").textContent).toBe("Offer ends in 10m 0s");
  });

  it("says when resources are short and offers only Shiny", () => {
    const { $ } = open({
      price: { resources: 3_500_000, shiny: 924, affordable: { resources: false, shiny: true } },
    });
    expect($<HTMLButtonElement>(".takeover-dialog__resources").disabled).toBe(true);
    expect(modal.textContent).toContain("You need more resources to take over this base.");
    expect($<HTMLButtonElement>(".takeover-dialog__shiny").disabled).toBe(false);
  });

  it("chooses, confirms, takes over, and closes", async () => {
    const { dialog, takeOver, onTaken, $ } = open();
    $(".takeover-dialog__shiny").click();
    expect(dialog.currentStep).toBe("confirm");
    expect($(".takeover-dialog__confirm-text").textContent).toBe("Take this yard over for 924 Shiny?");
    expect(takeOver).not.toHaveBeenCalled();

    $(".takeover-dialog__go").click();
    await flush();
    expect(takeOver).toHaveBeenCalledWith("shiny");
    expect(onTaken).toHaveBeenCalledWith("shiny");
    expect(modal.querySelector(".takeover-dialog")).toBeNull();
  });

  it("closes on Escape even when focus has left it, and stops its clock (#191)", () => {
    vi.useFakeTimers();
    try {
      const { takeOver } = open({
        kind: "outpost",
        name: "Ann",
        price: { resources: 5_000_000, shiny: 900, grantExpiresAt: 2_000_000_000 },
      });
      const running = vi.getTimerCount();
      escapeOnPage();
      expect(modal.querySelector("[role='dialog']")).toBeNull();
      // The countdown's once-a-second tick is the one timer gone.
      expect(vi.getTimerCount()).toBe(running - 1);
      expect(takeOver).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a New to Map Room 2 price: the small label, -90%, each tile the usual price struck then the cut one, no half-price line", () => {
    const { $ } = open({
      price: {
        resources: 350_000,
        usualResources: 1_750_000,
        welcome: true,
        shiny: 924,
        adjacent: true,
        affordable: { resources: true, shiny: true },
      },
    });
    const label = $(".takeover-dialog__welcome");
    expect(label.hidden).toBe(false);
    expect($(".takeover-dialog__welcome-tag").textContent).toBe("Frontier Pass");
    expect($(".takeover-dialog__welcome-off").textContent).toBe("-90%");
    // The label line no longer carries a struck total: each tile has its own.
    expect(label.querySelector("s")).toBeNull();
    expect($(".takeover-dialog__adjacent").hidden).toBe(true);
    const tiles = [...modal.querySelectorAll(".takeover-dialog__cost li")];
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.querySelector(".res-icon")).not.toBeNull();
      const struck = tile.querySelectorAll("s");
      expect(struck).toHaveLength(1);
      expect(struck[0]!.textContent).toBe("1,750,000");
      expect(tile.querySelector(".takeover-dialog__cut")!.textContent).toBe("350,000");
      // Icon, then the struck usual price, then the cut price.
      const order = [...tile.querySelectorAll(".res-icon, s, .takeover-dialog__cut")];
      expect(order.map((el) => el.className.split(" ")[0])).toEqual(["res-icon", "takeover-dialog__usual", "takeover-dialog__cut"]);
    }
    expect([...new Set(tiles.map((tile) => (tile.firstElementChild as HTMLElement).dataset["resource"]))]).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
    ]);
  });

  it("no label and nothing struck on a usual price", () => {
    const { $ } = open();
    expect($(".takeover-dialog__welcome").hidden).toBe(true);
    expect($(".takeover-dialog__adjacent").hidden).toBe(false);
    const tiles = [...modal.querySelectorAll(".takeover-dialog__cost li")];
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.querySelector("s")).toBeNull();
      expect(tile.textContent).toContain("3,500,000");
    }
  });

  it("nothing struck when the quote carries a usual price but no welcome discount", () => {
    open({ price: { resources: 3_500_000, usualResources: 3_500_000, shiny: 924 } });
    expect(modal.querySelectorAll(".takeover-dialog__cost s")).toHaveLength(0);
  });

  it("Back returns to the choice without calling the server", () => {
    const { dialog, takeOver, $ } = open();
    $(".takeover-dialog__resources").click();
    $(".takeover-dialog__back").click();
    expect(dialog.currentStep).toBe("choose");
    expect(takeOver).not.toHaveBeenCalled();
  });

  it("shows a refusal in Flash's words and offers the choice again", async () => {
    const takeOver = vi.fn(async () => {
      throw new ApiError("that yard is under attack by another player.", {
        status: 200,
        details: { data: { reason: "underAttack" } } as never,
      });
    });
    const { dialog, onTaken, $ } = open({ takeOver });
    $(".takeover-dialog__resources").click();
    $(".takeover-dialog__go").click();
    await flush();
    expect(onTaken).not.toHaveBeenCalled();
    expect(dialog.currentStep).toBe("choose");
    expect($(".takeover-dialog__status").textContent).toBe(
      "There was a problem taking over this yard: an attack on this yard is still going on.",
    );
  });
});

describe("showTakenOver", () => {
  it("is Flash's first-open popup", () => {
    const modal = document.createElement("div");
    showTakenOver(modal, "camp", "Kozu");
    expect(modal.querySelector(".panel__title")!.textContent).toBe("Veni, Vidi, Vici!");
    expect(modal.textContent).toContain("You destroyed a Kozu base. Take over their yard and expand your empire.");
    expect(modal.querySelector("img")!.getAttribute("src")).toBe("/assets/popups/building-outpost.png");
    expect(modal.querySelector(".takeover-first-open__score")).toBeNull();
  });

  it("shows a Monster Madness takeover's points: the logo, +points and the total", () => {
    const modal = document.createElement("div");
    showTakenOver(modal, "camp", "Kozu", [{ event: "monster-madness-1762819200", points: 2_100_000, total: 45_000_000 }]);
    const row = modal.querySelector<HTMLElement>(".takeover-first-open__score")!;
    expect(row.querySelector("img")!.getAttribute("src")).toBe("/events/monster-madness-logo.png");
    expect(row.querySelector(".takeover-first-open__score-points")!.textContent).toBe("+2.1M");
    expect(row.querySelector(".takeover-first-open__score-total")!.textContent).toBe("Total 45M");
    expect(row.getAttribute("aria-label")).toBe("+2.1M Monster Madness points, 45M in all");
    // Above the OK button.
    expect(row.nextElementSibling?.textContent).toBe("OK");
  });

  it("takes the last takeover's waiting points by itself, once", () => {
    takeoverScores.set([{ event: "monster-madness-1", points: 3_000_000, total: 3_000_000 }]);
    const first = document.createElement("div");
    showTakenOver(first, "camp", "Kozu");
    expect(first.querySelector(".takeover-first-open__score-points")!.textContent).toBe("+3M");
    const again = document.createElement("div");
    showTakenOver(again, "camp", "Kozu");
    expect(again.querySelector(".takeover-first-open__score")).toBeNull();
  });
});
