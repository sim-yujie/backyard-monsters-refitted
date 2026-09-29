// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mapRoom1Fixture } from "@/game/maproom1/mr1Fixture";
import { readMapRoom1, type Mr1Own } from "@/game/maproom1/mr1Model";
import { avatar, targetCard, type CardHandlers } from "./TargetCard";

const NOW = 1_800_000_000;
const world = readMapRoom1(mapRoom1Fixture(NOW), NOW);
const own: Mr1Own = {
  baseid: "5001",
  seed: 0,
  name: "Me",
  level: 6,
  protectedUntil: 0,
  flinger: { state: "ready", level: 1 },
  army: [{ id: "C1", count: 16 }],
  champion: false,
};

const handlers = (): CardHandlers & Record<string, ReturnType<typeof vi.fn>> => ({
  onClose: vi.fn(),
  onView: vi.fn(),
  onAttack: vi.fn(),
  onAction: vi.fn(),
});

const find = (key: string) =>
  [...world.tribes, ...world.neighbours].find((target) => target.key === key)!;

const buttonNamed = (card: HTMLElement, text: string): HTMLButtonElement =>
  [...card.querySelectorAll("button")].find((one) => one.textContent?.trim() === text)!;

describe("targetCard", () => {
  it("offers View and Attack on a standing tribe, with its blurb and what you can send", () => {
    const on = handlers();
    const card = targetCard(find("tribe-11"), { world, own, now: NOW }, on, "panel");
    expect(card.querySelector("h2")?.textContent).toBe("Kozu Tribe");
    expect(card.textContent).toContain("master mazes");
    expect(card.textContent).toContain("Pokey ×16");
    expect(card.textContent).not.toContain("You are protected");
    buttonNamed(card, "Attack").click();
    buttonNamed(card, "View").click();
    expect(on.onAttack).toHaveBeenCalledTimes(1);
    expect(on.onView).toHaveBeenCalledTimes(1);
  });

  it("greys Attack with the reason under it, tied by aria-describedby", () => {
    const card = targetCard(find("tribe-21"), { world, own, now: NOW }, handlers(), "panel");
    const attack = buttonNamed(card, "Attack");
    expect(attack.disabled).toBe(true);
    const why = card.querySelector(`#${attack.getAttribute("aria-describedby")}`);
    expect(why?.textContent).toBe("Tribe wrecked. Its camp comes back in 7:12.");
    expect(why?.querySelector("[data-until]")?.getAttribute("data-until")).toBe(
      String(NOW + 432),
    );
  });

  it("warns before attacking a player ends your protection", () => {
    const card = targetCard(find("player-901"), { world, own, now: NOW }, handlers(), "float");
    expect(card.querySelector("[role=note]")?.textContent).toBe(
      "You are protected for 2 d 4 h. Attacking Mossbeard ends your protection, and others can attack you again.",
    );
    expect(card.textContent).toContain("times they attacked you");
  });

  it("offers a way out when your own yard is the reason", () => {
    const on = handlers();
    const noFlinger = { ...own, flinger: { state: "none" } as const };
    const card = targetCard(find("tribe-1"), { world, own: noFlinger, now: NOW }, on, "sheet");
    buttonNamed(card, "Build Flinger").click();
    expect(on.onAction).toHaveBeenCalledWith("buildFlinger");
  });

  it("turns View off on a yard under attack", () => {
    const card = targetCard(find("player-907"), { world, own, now: NOW }, handlers(), "panel");
    expect(buttonNamed(card, "View").disabled).toBe(true);
  });

  it("frames a player's critter, and falls back to initials if it will not load (#175)", () => {
    const mossbeard = find("player-901");
    const box = avatar(mossbeard, "lg");
    const art = box.querySelector("img")!;
    expect(art.getAttribute("src")).toMatch(/avatars\/owl\.webp$/);
    expect(avatar(mossbeard, "sm").querySelector("img")!.getAttribute("src")).toMatch(/avatars\/owl-64\.webp$/);
    art.dispatchEvent(new Event("error"));
    expect(box.querySelector("img")).toBeNull();
    expect(box.textContent).toBe("MO");
  });
});
