// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GoalView } from "@/api/goals";
import { spokenText } from "@/ui/resourceIcon";
import { claimFigure } from "./claimFigure";
import {
  GoalsPanel,
  INFERNO_QUEST_WORDS,
  monstersText,
  NEXT_COUNT,
  SIEGE_ROOM_NOTE,
  siegeText,
  type GoalsPanelView,
} from "./GoalsPanel";

/** The Goals panel (#227, `docs/design/tutorial.md` §6.3). */

const goal = (id: string, status: GoalView["status"], extra: Partial<GoalView> = {}): GoalView => ({
  id,
  order: 1,
  name: `Goal ${id}`,
  description: `Do ${id}.`,
  reward: { r1: 2000, r2: 2000, r3: 0, r4: 0 },
  status,
  ...extra,
});

const CAPS = { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 };

type ListView = Extract<GoalsPanelView, { kind: "list" }>;

const listView = (goals: GoalView[], resources = {}, extra: Partial<ListView> = {}): ListView => ({
  kind: "list",
  goals,
  figures: new Map(goals.map((one) => [one.id, claimFigure(one.reward, resources, CAPS)])),
  claiming: null,
  refusal: null,
  ...extra,
});

const mounted = (inferno = false) => {
  const options = {
    onClaim: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    ...(inferno && { words: INFERNO_QUEST_WORDS }),
  };
  const panel = new GoalsPanel(options).mount(document.body);
  return { panel, options };
};

describe("GoalsPanel on the Inferno yard (Flash's Quests window)", () => {
  it("is titled Quests and lists the ready quests, then open ones, 13 rows in all", () => {
    const { panel } = mounted(true);
    const ready = Array.from({ length: 4 }, (_, index) => goal(`R${index}`, "ready"));
    const open = Array.from({ length: 20 }, (_, index) => goal(`O${index}`, "open"));
    panel.render(listView([...ready, ...open]));
    expect(panel.element.textContent).toContain("Quests");
    expect(panel.element.querySelectorAll(".goals-row--ready")).toHaveLength(4);
    expect(panel.element.querySelectorAll(".goals-row:not(.goals-row--ready)")).toHaveLength(9);
    panel.close();
  });

  it("a Shiny quest shows its Shiny in the reward and on the Claim button", () => {
    const { panel } = mounted(true);
    panel.render(listView([goal("IQT1", "ready", { shiny: 10 }), goal("IT3", "open", { shiny: 10 })]));
    const button = panel.element.querySelector<HTMLButtonElement>(".goals-claim")!;
    expect(spokenText(button)).toContain("Shiny 10 gained");
    const shiny = button.querySelector('.goals-claim__amount[data-resource="shiny"]')!;
    expect(shiny.classList.contains("res-amount--gain")).toBe(true);
    expect(shiny.querySelector(".res-amount__value")!.textContent).toBe("+10");
    const open = panel.element.querySelector('.goals-row[data-goal="IT3"] .goals-reward')!;
    expect(spokenText(open as HTMLElement)).toContain("Shiny 10");
    panel.close();
  });

  it("a monster quest with no room says to make room in your Compound", () => {
    const { panel } = mounted(true);
    const monsters = { id: "IC2", name: "Zagnoid", count: 10 };
    panel.render(listView([goal("IUC2", "ready", { monsters, room: false })]));
    expect(panel.element.querySelector(".goals-row__note")!.textContent).toBe(
      "Make room in your Compound for 10 Zagnoids",
    );
    panel.close();
  });
});

describe("GoalsPanel", () => {
  it("lists ready goals first with Claim, then the next five, then claimed folded", () => {
    const { panel } = mounted();
    const open = Array.from({ length: 7 }, (_, index) => goal(`O${index}`, "open"));
    panel.render(listView([goal("T1", "ready"), ...open, goal("C0", "claimed", { baseline: true })]));

    const sections = [...panel.element.querySelectorAll(".goals-section__title")].map((one) => one.textContent);
    expect(sections).toEqual(["Ready to claim", "Up next"]);
    expect(panel.element.querySelectorAll(".goals-row--ready")).toHaveLength(1);
    expect(panel.element.querySelectorAll(".goals-row:not(.goals-row--ready)")).toHaveLength(NEXT_COUNT);
    const claimed = panel.element.querySelector<HTMLDetailsElement>(".goals-claimed")!;
    expect(claimed.open).toBe(false);
    expect(claimed.querySelector("summary")!.textContent).toBe("Claimed (1)");
    panel.close();
  });

  it("the Claim button says what will arrive, and (storage full) when the cap cuts it (Q2)", () => {
    const { panel, options } = mounted();
    panel.render(listView([goal("T1", "ready")], { r1: 9000, r2: 0 }));
    const button = panel.element.querySelector<HTMLButtonElement>(".goals-claim")!;
    expect(spokenText(button)).toBe("Claim Twigs 1,000 gained Pebbles 2,000 gained (storage full)");
    // A gain: green "+1,000" (owner, 28 Oct), the capped one keeping its own title.
    const values = [...button.querySelectorAll(".goals-claim__amount.res-amount--gain > .res-amount__value")];
    expect(values.map((value) => value.textContent)).toEqual(["+1,000", "+2,000"]);
    expect(values[1]!.getAttribute("title")).toBe("2,000 gained");
    const capped = button.querySelector<HTMLElement>(".goals-claim__amount--capped")!;
    expect(capped.title).toBe("2,000 reward, 1,000 fits in storage");
    expect(capped.querySelector(".res-amount__value")!.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("data-tut")).toBe("goals-claim");
    button.click();
    expect(options.onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: "T1" }), button);
    panel.close();
  });

  it("monster rewards wait for room in Housing (Q10)", () => {
    const { panel } = mounted();
    const monsters = { id: "C2", name: "Octo-ooze", count: 10 };
    panel.render(
      listView([goal("UC2", "ready", { reward: { r1: 0, r2: 0, r3: 0, r4: 0 }, monsters, room: false })]),
    );
    const button = panel.element.querySelector<HTMLButtonElement>(".goals-claim")!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("+10 Octo-oozes");
    expect(panel.element.querySelector(".goals-row__note")!.textContent).toBe(
      "Make room in Housing for 10 Octo-oozes",
    );
    panel.close();
  });

  it("siege weapon rewards (SW4-SW12) show the weapon, and wait for room in the Chaos Factory", () => {
    const { panel } = mounted();
    const none = { r1: 0, r2: 0, r3: 0, r4: 0 };
    const siege = { id: "decoy", name: "Marilyn Monstroe", count: 1 };
    panel.render(
      listView([
        goal("SW4", "ready", { reward: none, siege, room: false }),
        goal("SW5", "ready", { reward: none, siege: { id: "vacuum", name: "Loot-O-Tron 5000", count: 1 }, room: true }),
        goal("SW6", "open", { reward: none, siege: { id: "jars", name: "Candy Jars", count: 1 } }),
      ]),
    );
    const [blocked, free] = [...panel.element.querySelectorAll<HTMLButtonElement>(".goals-claim")];
    expect(blocked!.disabled).toBe(true);
    expect(blocked!.textContent).toContain("+1 Marilyn Monstroe");
    expect(panel.element.querySelector('[data-goal="SW4"] .goals-row__note')!.textContent).toBe(SIEGE_ROOM_NOTE);
    expect(free!.disabled).toBe(false);
    expect(panel.element.querySelector('[data-goal="SW5"] .goals-row__note')).toBeNull();
    const chip = panel.element.querySelector('[data-goal="SW6"] .goals-siege')!;
    expect(chip.textContent).toBe("1 Candy Jars");
    expect(chip.querySelector("img")!.getAttribute("src")).toBe("/assets/siegebuttons/jars.png");
    expect(siegeText(1, "Loot-O-Tron 5000")).toBe("1 Loot-O-Tron 5000");
    panel.close();
  });

  it("shows progress, a refusal, a claim in flight, loading and errors", () => {
    const { panel, options } = mounted();
    panel.render(
      listView([goal("T1", "ready"), goal("M1", "open", { progress: { have: 3, need: 5 } })], {}, {
        claiming: "T1",
        refusal: { id: "T1", message: "That goal is not finished yet." },
      }),
    );
    expect(panel.element.querySelector(".goals-row__progress")!.textContent).toBe("3 / 5");
    expect(panel.element.querySelector<HTMLButtonElement>(".goals-claim")!.disabled).toBe(true);
    expect(panel.element.querySelector("[role=alert]")!.textContent).toBe("That goal is not finished yet.");

    panel.render({ kind: "loading" });
    expect(panel.element.textContent).toContain("Loading your goals");
    panel.render({ kind: "error", message: "Could not reach the server." });
    panel.element.querySelector<HTMLButtonElement>(".goals-status__retry")!.click();
    expect(options.onRetry).toHaveBeenCalled();
    panel.close();
    expect(options.onClose).toHaveBeenCalled();
  });

  it("names monsters as Flash did", () => {
    expect(monstersText(1, "Brain")).toBe("1 Brain");
    expect(monstersText(2, "D.A.V.E.")).toBe("2 D.A.V.E.s");
    expect(monstersText(20, "Valgos")).toBe("20 Valgos");
    expect(monstersText(5, "Sabnox")).toBe("5 Sabnox");
  });
});
