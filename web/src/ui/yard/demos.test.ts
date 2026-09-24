// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GroupOp } from "@/game/yard/planner/groupTools";
import { DEMOS, DEMO_ANIM_CLASS, GROUP_OP_DEMOS, demo, type DemoName } from "./demos";

/**
 * The looping pictures the planner's tooltips and its help card are made of.
 *
 * There is no way to assert that an animation *looks* right, so these check
 * the contract the stylesheet depends on instead: every demo is an `<svg>`,
 * every demo has something in it that moves, and anything that moves by a
 * distance carries that distance as a custom property. Break any of those and
 * the picture renders as a still life, which is exactly the failure a reviewer
 * would not notice.
 */

const names = Object.keys(DEMOS) as DemoName[];

describe("demos", () => {
  it("draws every demo it advertises", () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const svg = demo(name);
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(svg.getAttribute("viewBox")).toBe("0 0 120 72");
      expect(svg.getAttribute("data-demo")).toBe(name);
      expect(svg.classList.contains("planner-demo")).toBe(true);
      expect(svg.classList.contains(`planner-demo--${name}`)).toBe(true);
    }
  });

  it("gives every demo at least one animated element", () => {
    for (const name of names) {
      const animated = demo(name).querySelectorAll(`.${DEMO_ANIM_CLASS}`);
      expect(animated.length, `${name} has nothing that moves`).toBeGreaterThan(0);
    }
  });

  it("names the motion as well as marking it", () => {
    const motions = [
      "planner-demo__move",
      "planner-demo__grow",
      "planner-demo__appear",
      "planner-demo__ping",
      "planner-demo__flip-x",
      "planner-demo__flip-y",
      "planner-demo__vanish",
    ];
    for (const name of names) {
      for (const node of demo(name).querySelectorAll(`.${DEMO_ANIM_CLASS}`)) {
        expect(
          motions.some((motion) => node.classList.contains(motion)),
          `${name}: ${node.getAttribute("class")} names no motion`,
        ).toBe(true);
      }
    }
  });

  it("carries the distance a mover travels as a custom property", () => {
    for (const name of names) {
      for (const node of demo(name).querySelectorAll(".planner-demo__move")) {
        const style = node.getAttribute("style") ?? "";
        expect(style, `${name} moves nowhere`).toContain("--dx");
        expect(style).toContain("--dy");
      }
    }
  });

  it("puts a mirror's axis on the group that reflects about it", () => {
    for (const [name, axis] of [
      ["mirrorH", "planner-demo__flip-x"],
      ["mirrorV", "planner-demo__flip-y"],
    ] as const) {
      const group = demo(name).querySelector(`.${axis}`);
      expect(group, `${name} does not reflect`).not.toBeNull();
      // Reflecting about the shapes' own centre is the whole point, so the
      // origin has to be a place and not the default.
      expect(group?.getAttribute("style") ?? "").toContain("transform-origin");
    }
  });

  it("hides the pictures from a screen reader, which has the text instead", () => {
    for (const name of names) {
      expect(demo(name).getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("gives every group operation its own picture", () => {
    for (const op of Object.values(GroupOp)) {
      const name = GROUP_OP_DEMOS[op];
      expect(names, `${op} points at a demo that does not exist`).toContain(name);
    }
    // One picture each, no stand-ins: "top edges" illustrated by a left-align
    // is worse than no picture, because it is confidently wrong about the one
    // thing the player is trying to work out.
    expect(new Set(Object.values(GROUP_OP_DEMOS)).size).toBe(Object.values(GroupOp).length);
  });
});
