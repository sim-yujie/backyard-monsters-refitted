// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GoalView } from "@/api/goals";
import { spokenText } from "@/ui/resourceIcon";
import { claimFigure } from "./claimFigure";
import { GoalsPanel, monstersText, NEXT_COUNT, type GoalsPanelView } from "./GoalsPanel";

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

const mounted = () => {
  const options = { onClaim: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
  const panel = new GoalsPanel(options).mount(document.body);
  return { panel, options };
};

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
    expect(spokenText(button)).toBe("Claim Twigs +1,000 Pebbles +2,000 (storage full)");
    expect(button.querySelector(".goals-claim__amount--capped")).not.toBeNull();
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
  });
});
