// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttackSummary } from "@/game/attack/attackSave";
import { confirmPanel } from "@/ui/yard/PlannerDialogs";
import { spokenText } from "@/ui/resourceIcon";
import {
  ATTACK_CONFIRM_CLASS,
  isAttackDialogOpen,
  KEEP_FIGHTING,
  keptText,
  RETREAT_TITLE,
  retreatKeptLine,
  retreatMessage,
} from "./attackDialogs";
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

describe("the Retreat question (less-text job 8)", () => {
  it("keeps the damage the strip shows, floored and never below 0", () => {
    expect(keptText(37.9)).toBe("37% kept");
    expect(keptText(-0.2)).toBe("0% kept");
  });

  it("says the attack ends now, and where a HUD switch leads first", () => {
    expect(retreatMessage()).toBe("The attack ends now.");
    expect(retreatMessage("the yard")).toBe(
      "The attack ends now. The end screen saves the result first, then leads to the map, not straight to the yard.",
    );
  });

  it("asks \"Retreat now?\" with the wall and \"35% kept\", Keep fighting or Retreat, told again as the fight goes on", () => {
    const kept = retreatKeptLine(28);
    const confirm = confirmPanel({
      title: RETREAT_TITLE,
      message: retreatMessage(),
      note: kept.line,
      confirmLabel: "Retreat",
      cancelLabel: KEEP_FIGHTING,
      onConfirm: () => confirm.close(),
      onClose: () => {},
    });
    expect(confirm.element.textContent).toContain("Retreat now?");
    const line = confirm.element.querySelector<HTMLElement>(".u-muted")!;
    expect(spokenText(line)).toBe("Yard damage 28% kept");
    expect(line.querySelector('img[src*="yarddamage2"]')).not.toBeNull();
    expect([...confirm.element.querySelectorAll("button")].map((one) => one.textContent)).toEqual(
      expect.arrayContaining(["Keep fighting", "Retreat"]),
    );
    kept.value.textContent = keptText(37);
    expect(spokenText(line)).toBe("Yard damage 37% kept");
    expect(confirm.element.querySelectorAll(".u-muted")).toHaveLength(1);
  });
});
