// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAVERN_DEFENCE,
  EARTHQUAKE,
  ENTER_CAVERN,
  ENGAGE_ATTACK,
  ENTER_CAVERN_INVITE,
  MOLOCH_ALERT_TITLE,
  MOLOCH_INTRO,
  MOLOCH_MONSTER_HINTS,
  TRANSFER_MONSTERS,
  UPGRADE_NOW,
} from "@/game/inferno/emergenceText";
import {
  caveMenu,
  caveNote,
  earthquakeBanner,
  emergenceComplete,
  molochDialogue,
  molochWarning,
  stagePassed,
} from "./EmergenceScreens";

/** The screens of Moloch's emergence on the own main yard (Inferno WP 1.10), as the DOM shows them. */

const host = (): HTMLElement => {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
};

const buttonNamed = (root: ParentNode, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((one) => one.textContent === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};

const labels = (root: ParentNode): string[] =>
  [...root.querySelectorAll(".inferno-popup__actions button")].map((one) => one.textContent ?? "");

afterEach(() => {
  document.body.replaceChildren();
});

describe("Moloch's dialogue", () => {
  it("shows his portrait and line, and Next closes it", () => {
    const modal = host();
    const onClose = vi.fn();
    molochDialogue(modal, MOLOCH_INTRO, onClose);
    expect(modal.querySelector(".inferno-says__line")?.textContent).toBe(MOLOCH_INTRO);
    expect(modal.querySelector<HTMLImageElement>(".inferno-says__portrait")?.alt).toBe("Moloch");
    buttonNamed(modal, "Next").click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modal.querySelector(".popup-backdrop")).toBeNull();
  });
});

describe("the cave's note", () => {
  it("offers Upgrade Now while the hall is below 5, which closes it and goes to the hall", () => {
    const modal = host();
    const upgrade = vi.fn();
    caveNote(modal, "unstable", upgrade);
    expect(modal.querySelector(".inferno-says__line")?.textContent).toBe("unstable");
    buttonNamed(modal, UPGRADE_NOW).click();
    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(modal.querySelector(".popup-backdrop")).toBeNull();
  });

  it("has no buttons of its own once the hall is at 5", () => {
    const modal = host();
    caveNote(modal, "unstable", null);
    expect(labels(modal)).toEqual([]);
  });
});

describe("the open cave's menu", () => {
  it("offers Transfer Monsters and Enter Cavern, each closing the menu first", () => {
    const modal = host();
    const enter = vi.fn();
    const transfer = vi.fn();
    caveMenu(modal, { enter, transfer });
    expect(labels(modal)).toEqual([TRANSFER_MONSTERS, ENTER_CAVERN]);
    buttonNamed(modal, ENTER_CAVERN).click();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(modal.querySelector(".popup-backdrop")).toBeNull();

    caveMenu(modal, { enter, transfer });
    buttonNamed(modal, TRANSFER_MONSTERS).click();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it("offers Enter Cavern alone before the Descent is passed, as Flash's menu did", () => {
    const modal = host();
    caveMenu(modal, { enter: vi.fn() });
    expect(labels(modal)).toEqual([ENTER_CAVERN]);
  });
});

describe("after a raid", () => {
  it("says stage passed, and Next closes it", () => {
    const modal = host();
    const onClose = vi.fn();
    stagePassed(modal, onClose);
    expect(modal.textContent).toContain(CAVERN_DEFENCE);
    buttonNamed(modal, "Next").click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ends with the last popup, Enter Cavern only with somewhere to go", () => {
    const modal = host();
    const enter = vi.fn();
    const onClose = vi.fn();
    emergenceComplete(modal, enter, onClose);
    expect(modal.querySelector(".inferno-complete__line")?.textContent).toBe(ENTER_CAVERN_INVITE);
    // Flash's "fight your way though" mended.
    expect(ENTER_CAVERN_INVITE).toContain("fight your way through his network");
    buttonNamed(modal, ENTER_CAVERN).click();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    emergenceComplete(modal, null);
    expect(labels(modal)).toEqual([]);
  });
});

describe("the earthquake banner", () => {
  it("is an alert on the content layer until removed", () => {
    const content = host();
    const banner = earthquakeBanner(content);
    expect(banner.textContent).toBe(EARTHQUAKE);
    expect(banner.getAttribute("role")).toBe("alert");
    expect(content.contains(banner)).toBe(true);
    banner.remove();
    expect(content.querySelector(".inferno-quake")).toBeNull();
  });
});

describe("Moloch's warning", () => {
  const groups = [
    { monster: "IC1", count: 12 },
    { monster: "IC3", count: 4 },
  ];

  it("shows his army in order, a card per group with its count and line", () => {
    const modal = host();
    molochWarning(modal, groups, async () => true);
    expect(modal.textContent).toContain(MOLOCH_ALERT_TITLE);
    const cards = [...modal.querySelectorAll(".inferno-army__card")];
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.querySelector(".inferno-army__count")?.textContent)).toEqual(["×12", "×4"]);
    // The first card's line to begin with, another card's once pointed at.
    const about = modal.querySelector(".inferno-army__about");
    expect(about?.textContent).toBe(MOLOCH_MONSTER_HINTS.IC1);
    (cards[1] as HTMLElement).click();
    expect(about?.textContent).toBe(MOLOCH_MONSTER_HINTS.IC3);
    expect(cards[1]!.classList.contains("is-shown")).toBe(true);
    expect(cards[0]!.classList.contains("is-shown")).toBe(false);
    expect(cards[0]!.querySelector("img")?.getAttribute("src")).toContain("IC1");
    expect(labels(modal)).toEqual([ENGAGE_ATTACK]);
    expect(document.activeElement).toBe(buttonNamed(modal, ENGAGE_ATTACK));
  });

  it("cannot be closed but by Engage Attack, which closes it once the raid starts", async () => {
    const modal = host();
    const onClose = vi.fn();
    const engage = vi.fn(async () => true);
    molochWarning(modal, groups, engage, onClose);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(modal.querySelector('[aria-label="Close"]')).toBeNull();
    buttonNamed(modal, ENGAGE_ATTACK).click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(engage).toHaveBeenCalledOnce();
    expect(modal.querySelector(".inferno-army")).toBeNull();
  });

  it("gives the button back when the raid could not start", async () => {
    const modal = host();
    const onClose = vi.fn();
    let answer!: (done: boolean) => void;
    molochWarning(modal, groups, () => new Promise<boolean>((resolve) => (answer = resolve)), onClose);
    const start = buttonNamed(modal, ENGAGE_ATTACK);
    start.click();
    expect(start.disabled).toBe(true);
    answer(false);
    await vi.waitFor(() => expect(start.disabled).toBe(false));
    expect(start.textContent).toBe(ENGAGE_ATTACK);
    expect(onClose).not.toHaveBeenCalled();
  });
});
