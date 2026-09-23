import { describe, expect, it } from "vitest";
import { plannerAction } from "./shortcuts";

const key = (
  k: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean } => ({
  key: k,
  ctrlKey: modifiers.ctrl ?? false,
  metaKey: modifiers.meta ?? false,
  shiftKey: modifiers.shift ?? false,
});

describe("plannerAction", () => {
  it("binds the two tools, in either case", () => {
    expect(plannerAction(key("v"))).toEqual({ kind: "tool", tool: "select" });
    expect(plannerAction(key("V"))).toEqual({ kind: "tool", tool: "select" });
    expect(plannerAction(key("b"))).toEqual({ kind: "tool", tool: "box" });
    expect(plannerAction(key("B"))).toEqual({ kind: "tool", tool: "box" });
  });

  it("switches the view on Tab", () => {
    expect(plannerAction(key("Tab"))).toEqual({ kind: "view" });
    expect(plannerAction(key("Tab", { ctrl: true }))).toBeNull();
  });

  it("nudges by one grid step on the arrows", () => {
    expect(plannerAction(key("ArrowUp"))).toEqual({ kind: "nudge", dx: 0, dy: -5 });
    expect(plannerAction(key("ArrowDown"))).toEqual({ kind: "nudge", dx: 0, dy: 5 });
    expect(plannerAction(key("ArrowLeft"))).toEqual({ kind: "nudge", dx: -5, dy: 0 });
    expect(plannerAction(key("ArrowRight"))).toEqual({ kind: "nudge", dx: 5, dy: 0 });
  });

  it("nudges by ten steps with Shift", () => {
    expect(plannerAction(key("ArrowUp", { shift: true }))).toEqual({ kind: "nudge", dx: 0, dy: -50 });
    expect(plannerAction(key("ArrowRight", { shift: true }))).toEqual({
      kind: "nudge",
      dx: 50,
      dy: 0,
    });
  });

  it("binds undo and both redo forms", () => {
    expect(plannerAction(key("z", { ctrl: true }))).toEqual({ kind: "undo" });
    expect(plannerAction(key("z", { ctrl: true, shift: true }))).toEqual({ kind: "redo" });
    expect(plannerAction(key("y", { ctrl: true }))).toEqual({ kind: "redo" });
    expect(plannerAction(key("Z", { ctrl: true }))).toEqual({ kind: "undo" });
  });

  it("takes Cmd as well as Ctrl", () => {
    expect(plannerAction(key("z", { meta: true }))).toEqual({ kind: "undo" });
  });

  it("binds Escape to cancel", () => {
    expect(plannerAction(key("Escape"))).toEqual({ kind: "cancel" });
  });

  it("swallows Delete and Backspace rather than letting the browser have them", () => {
    expect(plannerAction(key("Delete"))).toEqual({ kind: "ignore" });
    expect(plannerAction(key("Backspace"))).toEqual({ kind: "ignore" });
  });

  it("leaves Ctrl+S to the layouts panel", () => {
    expect(plannerAction(key("s", { ctrl: true }))).toBeNull();
  });

  it("leaves everything else alone", () => {
    for (const k of ["a", "p", "Enter", " ", "F5", "1"]) {
      expect(plannerAction(key(k))).toBeNull();
    }
  });

  it("does not claim a tool key that is held with Ctrl", () => {
    // Ctrl+B is the browser's bookmark bar, not the box tool.
    expect(plannerAction(key("b", { ctrl: true }))).toBeNull();
    expect(plannerAction(key("ArrowUp", { ctrl: true }))).toBeNull();
  });
});
