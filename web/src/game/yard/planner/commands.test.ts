import { describe, expect, it, vi } from "vitest";
import { CommandStack, moveCommand, type MoveEntry, type PlanCommand } from "./commands";

/** A command that records what it did, so order and count are observable. */
const trace = (label: string, log: string[]): PlanCommand => ({
  label,
  apply: () => log.push(`do ${label}`),
  revert: () => log.push(`undo ${label}`),
});

describe("CommandStack", () => {
  it("starts empty", () => {
    const stack = new CommandStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(stack.undoLabel).toBeNull();
  });

  it("applies a command when it is pushed", () => {
    const log: string[] = [];
    new CommandStack().push(trace("a", log));
    expect(log).toEqual(["do a"]);
  });

  it("does not re-apply a command pushed as already applied", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.pushApplied(trace("a", log));
    expect(log).toEqual([]);
    expect(stack.canUndo).toBe(true);
  });

  it("undoes and redoes in order", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(trace("a", log));
    stack.push(trace("b", log));
    stack.undo();
    stack.undo();
    stack.redo();
    expect(log).toEqual(["do a", "do b", "undo b", "undo a", "do a"]);
  });

  it("reports what undo and redo would do", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(trace("move", log));
    expect(stack.undoLabel).toBe("move");
    stack.undo();
    expect(stack.redoLabel).toBe("move");
    expect(stack.undoLabel).toBeNull();
  });

  it("returns null rather than throwing at either end", () => {
    const stack = new CommandStack();
    expect(stack.undo()).toBeNull();
    expect(stack.redo()).toBeNull();
  });

  it("drops the redo side once a new command is pushed", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(trace("a", log));
    stack.undo();
    expect(stack.canRedo).toBe(true);
    stack.push(trace("b", log));
    expect(stack.canRedo).toBe(false);
  });

  it("drops the oldest command past its depth", () => {
    const log: string[] = [];
    const stack = new CommandStack({ depth: 3 });
    for (const label of ["a", "b", "c", "d"]) stack.push(trace(label, log));
    expect(stack.size).toBe(3);
    while (stack.canUndo) stack.undo();
    expect(log.filter((line) => line.startsWith("undo"))).toEqual(["undo d", "undo c", "undo b"]);
  });

  it("forgets both sides on clear", () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(trace("a", log));
    stack.undo();
    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it("notifies on every change so the buttons can follow", () => {
    const onChange = vi.fn();
    const stack = new CommandStack({ onChange });
    stack.push(trace("a", []));
    stack.undo();
    stack.redo();
    stack.clear();
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe("moveCommand", () => {
  const entries: MoveEntry[] = [
    { id: 1, fromX: 0, fromY: 0, toX: 100, toY: 0 },
    { id: 2, fromX: 20, fromY: 0, toX: 120, toY: 0 },
  ];

  it("names itself by how many buildings it moves", () => {
    expect(moveCommand(entries, () => {}).label).toBe("Move 2 buildings");
    expect(moveCommand([entries[0]!], () => {}).label).toBe("Move building");
  });

  it("hands the whole batch over at once, not one at a time", () => {
    const calls: { count: number; reverse: boolean }[] = [];
    const command = moveCommand(entries, (batch, reverse) =>
      calls.push({ count: batch.length, reverse }),
    );
    command.apply();
    command.revert();
    expect(calls).toEqual([
      { count: 2, reverse: false },
      { count: 2, reverse: true },
    ]);
  });

  it("takes an explicit label when the caller has a better one", () => {
    expect(moveCommand(entries, () => {}, "Load “Turtle v3”").label).toBe("Load “Turtle v3”");
  });
});
