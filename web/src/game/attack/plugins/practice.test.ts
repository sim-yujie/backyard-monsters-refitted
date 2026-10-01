// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import type { GuideApi } from "@/api/guide";
import type { BaseLoadResponse } from "@/api/types";
import { Camera } from "@/game/Camera";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import { ATTACK_DROP_FILTERS, AttackInput } from "@/game/attack/AttackInput";
import { readYard } from "@/game/yard/yardModel";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackRoster, AttackTarget } from "@/game/attack/attackTarget";
import { bucketFor } from "@/game/attack/bucket";
import { guideBus } from "@/game/guide/guideBus";
import { LINES } from "@/game/guide/steps";
import { clearCanvasTargets, findTarget, TutTarget } from "@/game/guide/targets";
import { ArmyPanel } from "@/ui/attack/ArmyPanel";
import { isPracticeAttack, practicePlugin } from "./practice";

/**
 * The camp as the server serves it (`server/src/game-data/tribes/v1/tutorial.ts`;
 * the server's `practiceCamp.test.ts` checks this copy equals it). Read as data:
 * importing the server module would pull its database layer into the web's type check.
 */
const tutorial = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../test/fixtures/practice-camp.json"), "utf8"),
) as BaseLoadResponse & { baseid: string };

/**
 * The practice attack (issue #227, `docs/design/tutorial.md` §5.4): the army
 * panel locked to Fill all, the drop box as the only legal ground and Bob's
 * lines, on the practice camp only.
 */

const roster = {
  monsters: { C1: 15 },
  levels: { C1: 1 },
  champions: [],
  flingerLevel: 1,
  catapultLevel: 0,
  sources: [],
  siege: null,
} as unknown as AttackRoster;

const targetOf = (baseid: string, mapversion: number): AttackTarget => ({
  baseid,
  kind: "wild",
  name: "Practice camp",
  roster,
  mapversion,
});

const teardowns: (() => void)[] = [];

const mount = (target: AttackTarget = targetOf("1", 1)) => {
  const session = new AttackSession({ target, seed: 1 });
  session.load({ ...tutorial, error: 0, attackid: 5 } as BaseLoadResponse);
  session.start();
  const bucket = bucketFor(session);
  const panel = new ArmyPanel(bucket).mount(document.body);
  const guide = document.createElement("div");
  document.body.append(guide);
  const api = {
    advance: vi.fn(async () => ({})),
    finish: vi.fn(),
    army: vi.fn(),
    skip: vi.fn(async () => ({})),
  };
  const mounts = {
    session,
    target,
    renderer: { yardToWorld: (x: number, y: number) => ({ x, y }) },
    camera: new Camera({ zoom: 1 }),
    canvas: document.createElement("canvas"),
    guide,
    battleLayer: new Container(),
  } as unknown as AttackMounts;
  const teardown = practicePlugin(api as unknown as GuideApi)(mounts);
  if (teardown) teardowns.push(teardown);
  teardowns.push(() => panel.destroy());
  return { session, bucket, panel, guide, api, teardown };
};

const button = (panel: ArmyPanel, selector: string): HTMLButtonElement =>
  panel.element.querySelector<HTMLButtonElement>(selector)!;

afterEach(() => {
  while (teardowns.length) teardowns.pop()?.();
  guideBus.clear();
  clearCanvasTargets();
  document.body.replaceChildren();
});

describe("the practice attack plugin", () => {
  it("mounts only on the practice camp from Map Room 1", () => {
    expect(isPracticeAttack({ target: targetOf("1", 1) })).toBe(true);
    expect(isPracticeAttack({ target: targetOf("2", 1) })).toBe(false);
    expect(isPracticeAttack({ target: targetOf("1", 2) })).toBe(false);
    const { teardown } = mount(targetOf("2", 1));
    expect(teardown).toBeUndefined();
    expect(ATTACK_DROP_FILTERS).toHaveLength(0);
  });

  it("moves the guide on to the attack, and leaves only Fill all live", () => {
    const { panel, api } = mount();
    expect(api.advance).toHaveBeenCalledWith("pick-camp");
    expect(button(panel, ".attack-army__fill-all").disabled).toBe(false);
    for (const stepper of panel.element.querySelectorAll<HTMLButtonElement>(".attack-army__row button")) {
      expect(stepper.disabled).toBe(true);
    }
    expect(panel.inputFor("C1")?.disabled).toBe(true);
  });

  it("after Fill all, every Pokey is in and nothing can change it", () => {
    const { panel, bucket } = mount();
    button(panel, ".attack-army__fill-all").click();
    expect(bucket.requestedCount("C1")).toBe(15);
    expect(button(panel, ".attack-army__fill-all").disabled).toBe(true);
    expect(button(panel, ".attack-army__clear").disabled).toBe(true);
  });

  it("allows a fling only inside the box, and draws the box as Bob's target", () => {
    const { guide, panel } = mount();
    expect(ATTACK_DROP_FILTERS).toHaveLength(1);
    expect(guide.querySelector(".guide-bob__text")?.textContent).toBe(`${LINES.attackBase} ${LINES.fillAll}`);
    button(panel, ".attack-army__fill-all").click();
    expect(guide.querySelector(".guide-bob__text")?.textContent).toBe(LINES.dropBox);
    expect(findTarget(TutTarget.PRACTICE_BOX)).not.toBeNull();
  });

  it("says won or lost when the attack ends, pointing at the way back", () => {
    const { guide } = mount();
    guideBus.emit("attackEnded", { baseid: "1", destroyed: false });
    expect(guide.querySelector(".guide-bob__text")?.textContent).toBe(LINES.lostHere);
    guideBus.emit("attackEnded", { baseid: "1", destroyed: true });
    expect(guide.querySelector(".guide-bob__text")?.textContent).toBe(LINES.won);
  });

  it("the drop input refuses outside the box with Bob's words, and judges the box by the yard's rule", () => {
    const { session, bucket, panel } = mount();
    button(panel, ".attack-army__fill-all").click();
    const input = new AttackInput({
      canvas: document.createElement("canvas"),
      camera: new Camera({ zoom: 1 }),
      renderer: { worldToYard: (x, y) => ({ x, y }) },
      yard: readYard(tutorial),
      session,
      bucket,
      onPreview: () => {},
    });
    expect(input.judge({ x: -400, y: 300 })).toMatchObject({ legal: false, reason: LINES.outsideBox });
    expect(input.judge({ x: 360, y: 0 }).legal).toBe(true);
  });

  it("tears down: the filter goes and the panel unlocks", () => {
    const { panel, teardown } = mount();
    teardown!();
    expect(ATTACK_DROP_FILTERS).toHaveLength(0);
    expect(panel.inputFor("C1")?.disabled).toBe(false);
  });
});
