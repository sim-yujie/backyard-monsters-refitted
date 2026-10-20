// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mapRoom1Fixture } from "@/game/maproom1/mr1Fixture";
import { readMapRoom1, type Mr1Own } from "@/game/maproom1/mr1Model";
import { avatar, targetCard, type CardHandlers } from "./TargetCard";
import { Mr1ListView } from "./Mr1ListView";

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

describe("targetCard Message and Truce", () => {
  it("offers both on a neighbour and reports the neighbour tapped", () => {
    const onMessage = vi.fn();
    const onTruce = vi.fn();
    const target = find("player-901");
    const card = targetCard(target, { world, own, now: NOW }, { ...handlers(), onMessage, onTruce }, "panel");
    buttonNamed(card, "Message").click();
    buttonNamed(card, "Truce").click();
    expect(onMessage).toHaveBeenCalledWith(target);
    expect(onTruce).toHaveBeenCalledWith(target);
  });

  it("leaves them off a tribe, and off when the scene gives no handlers", () => {
    const onMessage = vi.fn();
    const tribe = targetCard(find("tribe-11"), { world, own, now: NOW }, { ...handlers(), onMessage }, "panel");
    expect(buttonNamed(tribe, "Message")).toBeUndefined();
    const plain = targetCard(find("player-901"), { world, own, now: NOW }, handlers(), "panel");
    expect(buttonNamed(plain, "Message")).toBeUndefined();
    expect(buttonNamed(plain, "Truce")).toBeUndefined();
  });

  it("hides Truce while one runs", () => {
    const target = { ...find("player-901"), truceUntil: NOW + 3600 } as ReturnType<typeof find>;
    const card = targetCard(target, { world, own, now: NOW }, { ...handlers(), onMessage: vi.fn(), onTruce: vi.fn() }, "panel");
    expect(buttonNamed(card, "Truce")).toBeUndefined();
    expect(buttonNamed(card, "Message")).toBeDefined();
  });
});

describe("targetCard", () => {
  it("puts a neighbour's achievements line under the name, and none on a tribe (#204)", () => {
    const achievementsLine = vi.fn((target: { userid: number; name: string }) => {
      const line = document.createElement("button");
      line.className = "ach-line";
      line.textContent = `Achievements of ${target.name}`;
      return line;
    });
    const card = targetCard(find("player-901"), { world, own, now: NOW }, { ...handlers(), achievementsLine }, "panel");
    expect(achievementsLine).toHaveBeenCalledTimes(1);
    expect(achievementsLine.mock.calls[0]![0].userid).toBe(901);
    const line = card.querySelector(".ach-line")!;
    expect(line.previousElementSibling?.classList.contains("mr1-card__head")).toBe(true);
    targetCard(find("tribe-11"), { world, own, now: NOW }, { ...handlers(), achievementsLine }, "panel");
    expect(achievementsLine).toHaveBeenCalledTimes(1);
    // Without the option, no line.
    expect(targetCard(find("player-901"), { world, own, now: NOW }, handlers(), "panel").querySelector(".ach-line")).toBeNull();
  });

  it("tells the truth about the guided start's practice camp: it does not come back (#227)", () => {
    const practice = readMapRoom1(
      { ...mapRoom1Fixture(NOW), practice: { baseid: "1", name: "Practice camp", level: 1, step: "pick-camp" } } as never,
      NOW,
    ).tribes.find((tribe) => tribe.practice)!;
    const card = targetCard(practice, { world, own, now: NOW }, handlers(), "panel");
    expect(card.querySelector("h2")?.textContent).toBe("Practice camp");
    expect(card.textContent).not.toContain("comes back");
    expect(card.textContent).toContain("it is gone once you win");
    // An ordinary tribe still says when it comes back.
    expect(targetCard(find("tribe-11"), { world, own, now: NOW }, handlers(), "panel").textContent).toContain(
      "The camp comes back 10 minutes later.",
    );
  });

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

describe("targetCard Add friend (friends WP11, #378)", () => {
  const addFriend = () =>
    vi.fn((target: { readonly name: string }) => {
      const node = document.createElement("span");
      node.className = "add-friend";
      node.textContent = `Add ${target.name}`;
      return node;
    });

  it("puts a neighbour's Add friend in a row under Message and Truce", () => {
    const make = addFriend();
    const target = find("player-901");
    const card = targetCard(target, { world, own, now: NOW }, { ...handlers(), onMessage: vi.fn(), addFriend: make }, "panel");
    expect(make).toHaveBeenCalledWith(target);
    expect(card.querySelector(".mr1-card__friend .add-friend")?.textContent).toBe(`Add ${target.name}`);
  });

  it("offers none on a tribe", () => {
    const make = addFriend();
    const tribe = targetCard(find("tribe-11"), { world, own, now: NOW }, { ...handlers(), addFriend: make }, "panel");
    expect(tribe.querySelector(".add-friend")).toBeNull();
    expect(make).not.toHaveBeenCalled();
  });
});

describe("targetCard online status", () => {
  it("puts a green dot by an online player's name and no words", () => {
    const card = targetCard(find("player-902"), { world, own, now: NOW }, handlers(), "panel");
    const dot = card.querySelector(".mr1-card__title-row .online-dot");
    expect(dot?.getAttribute("aria-label")).toBe("Online");
    expect(dot?.getAttribute("title")).toBe("Online");
    expect(card.textContent).not.toContain("Last seen");
    expect(card.textContent).not.toContain("Playing now");
  });

  it("gives an offline player no dot and no \"Offline\", only when they were last seen", () => {
    const card = targetCard(find("player-901"), { world, own, now: NOW }, handlers(), "panel");
    expect(card.querySelector(".online-dot")).toBeNull();
    expect(card.querySelector(".mr1-card__sub")?.textContent).toMatch(/^Last seen 3 h ago/);
    expect(card.textContent).not.toContain("Offline");
  });
});

describe("battle icons", () => {
  it("shows a shield and a sword with counts beside \"Last seen\", the words on hover", () => {
    const card = targetCard(find("player-901"), { world, own, now: NOW }, handlers(), "panel");
    const sub = card.querySelector(".mr1-card__sub")!;
    expect(sub.textContent).toBe("Last seen 3 h ago21");
    const badges = [...sub.querySelectorAll<HTMLElement>(".mr1-battle")];
    expect(badges.map((badge) => [badge.title, badge.getAttribute("aria-label"), badge.textContent])).toEqual([
      ["Attacked you 2 times", "Attacked you 2 times", "2"],
      ["You attacked them 1 time", "You attacked them 1 time", "1"],
    ]);
    expect(badges[0]!.getAttribute("role")).toBe("img");
    expect(badges[0]!.querySelector("svg")).not.toBeNull();
    expect(card.textContent).not.toContain("attacked");
  });

  it("shows only the sides above 0, and nothing (no \"No battles yet\") without battles", () => {
    const sword = targetCard(find("player-907"), { world, own, now: NOW }, handlers(), "panel");
    expect([...sword.querySelectorAll(".mr1-battle")].map((badge) => badge.className)).toEqual([
      "mr1-battle mr1-battle--youAttacked",
    ]);
    const none = targetCard(find("player-903"), { world, own, now: NOW }, handlers(), "sheet");
    expect(none.querySelector(".mr1-battles")).toBeNull();
    expect(none.textContent).not.toMatch(/battles/i);
    expect(none.querySelector(".mr1-card__sub")?.textContent).toBe("Last seen 24 h ago");
  });

  it("puts the icons on the list's second line and the words in the row's name", () => {
    const list = new Mr1ListView({ onSelect: vi.fn() });
    list.setData(world, NOW);
    const row = list.element.querySelector<HTMLElement>('[data-key="player-901"]')!;
    expect(row.getAttribute("aria-label")).toBe(
      "Mossbeard, level 9, Last seen 3 h ago, Attacked you 2 times, You attacked them 1 time",
    );
    expect(row.querySelector(".mr1-row__line .mr1-battles")?.textContent).toBe("21");
    const quiet = list.element.querySelector<HTMLElement>('[data-key="player-903"]')!;
    expect(quiet.querySelector(".mr1-battles")).toBeNull();
    expect(list.element.textContent).not.toMatch(/no battles/i);
  });
});
