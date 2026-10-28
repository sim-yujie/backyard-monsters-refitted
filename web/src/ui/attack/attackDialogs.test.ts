// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttackSummary } from "@/game/attack/attackSave";
import { confirmPanel } from "@/ui/yard/PlannerDialogs";
import { ATTACK_CONFIRM_CLASS, isAttackDialogOpen, retreatNote } from "./attackDialogs";
import { EndAttackPanel } from "./EndAttackPanel";

const summary: AttackSummary = {
  targetName: "Kozu",
  kind: "wild",
  endReason: "retreat",
  outcome: "0% damage dealt to Kozu's camp.",
  tone: "neutral",
  damagePercent: 0,
  buildingsDestroyed: 0,
  buildingsTotal: 14,
  loot: { r1: 0, r2: 0, r3: 0, r4: 0 },
  lootTaken: { r1: 0, r2: 0, r3: 0, r4: 0 },
  inferno: false,
  infernoTribe: false,
  monstersSent: 0,
  monstersBorn: 0,
  monstersLost: 0,
  champions: [],
  elapsedSeconds: 12,
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("isAttackDialogOpen", () => {
  it("is true while the Retreat question is up and false once it closes, so Bob's tips wait for it", () => {
    expect(isAttackDialogOpen()).toBe(false);
    const confirm = confirmPanel({
      title: "Retreat?",
      message: "Retreating ends the attack now and cannot be undone.",
      confirmLabel: "Retreat",
      onConfirm: () => confirm.close(),
      onClose: () => {},
    });
    confirm.element.classList.add(ATTACK_CONFIRM_CLASS);
    confirm.mount(document.body);
    expect(isAttackDialogOpen()).toBe(true);

    confirm.close();
    expect(isAttackDialogOpen()).toBe(false);
  });

  it("is true while the Attack over panel is up", () => {
    new EndAttackPanel({ summary, onReturn: vi.fn(), onRetry: vi.fn(), onLeave: vi.fn() }).mount(document.body);
    expect(isAttackDialogOpen()).toBe(true);
  });
});

describe("retreatNote", () => {
  it("tells the damage the strip shows, floored and never below 0", () => {
    expect(retreatNote(37.9)).toBe("37% damage dealt so far will be kept.");
    expect(retreatNote(-0.2)).toBe("0% damage dealt so far will be kept.");
  });

  it("says where a HUD switch leads first", () => {
    expect(retreatNote(28, "the yard")).toBe(
      "28% damage dealt so far will be kept. The result is saved on the end screen first, which leads back to the map, not straight to the yard.",
    );
  });

  it("the question's line is told again as the fight goes on (Inferno S3 browser check)", () => {
    const confirm = confirmPanel({
      title: "Retreat?",
      message: "Retreating ends the attack now and cannot be undone.",
      note: retreatNote(28),
      confirmLabel: "Retreat",
      onConfirm: () => confirm.close(),
      onClose: () => {},
    });
    // The scene finds the line as `confirmPanel` writes it, its one muted line.
    const line = confirm.element.querySelector<HTMLElement>(".u-muted");
    expect(line?.textContent).toBe("28% damage dealt so far will be kept.");
    line!.textContent = retreatNote(37);
    expect(confirm.element.textContent).toContain("37% damage dealt so far will be kept.");
    expect(confirm.element.querySelectorAll(".u-muted")).toHaveLength(1);
  });
});
