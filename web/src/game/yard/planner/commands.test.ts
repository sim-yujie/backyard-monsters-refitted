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

describe("the clean position", () => {
  it("is the empty stack until something is pushed", () => {
    const stack = new CommandStack();
    expect(stack.isClean).toBe(true);
    stack.push(trace("a", []));
    expect(stack.isClean).toBe(false);
  });

  it("is crossed in both directions by undo and redo", () => {
    const stack = new CommandStack();
    stack.push(trace("a", []));
    stack.markClean();
    stack.push(trace("b", []));
    expect(stack.isClean).toBe(false);

    stack.undo();
    expect(stack.isClean).toBe(true);
    expect(stack.position).toBe(1);

    stack.redo();
    expect(stack.isClean).toBe(false);
  });

  it("reads clean again after undoing back to an unedited stack", () => {
    const stack = new CommandStack();
    stack.push(trace("a", []));
    stack.undo();
    expect(stack.isClean).toBe(true);
  });

  it("can never be reached again once a new edit forks past it", () => {
    const stack = new CommandStack();
    stack.push(trace("a", []));
    stack.push(trace("b", []));
    stack.markClean();
    stack.undo();
    // "b" is on the redo side; pushing throws it away, so position 2 is no
    // longer the saved plan even though the depth matches.
    stack.push(trace("c", []));
    expect(stack.position).toBe(2);
    expect(stack.isClean).toBe(false);
  });

  it("gives up on a clean position that falls off the bottom of the stack", () => {
    const stack = new CommandStack({ depth: 2 });
    stack.markClean();
    stack.push(trace("a", []));
    stack.push(trace("b", []));
    stack.push(trace("c", []));
    while (stack.canUndo) stack.undo();
    expect(stack.isClean).toBe(false);
  });

  it("keeps a saved position as the stack shifts under it", () => {
    const stack = new CommandStack({ depth: 3 });
    stack.push(trace("a", []));
    stack.push(trace("b", []));
    stack.markClean();
    stack.push(trace("c", []));
    stack.push(trace("d", []));
    expect(stack.isClean).toBe(false);
    stack.undo();
    stack.undo();
    expect(stack.isClean).toBe(true);
  });

  it("does not call a dirty plan saved just because the history was cleared", () => {
    const stack = new CommandStack();
    stack.push(trace("a", []));
    stack.clear();
    expect(stack.isClean).toBe(false);
  });

  it("stays clean through a clear when it already was", () => {
    const stack = new CommandStack();
    stack.push(trace("a", []));
    stack.markClean();
    stack.clear();
    expect(stack.isClean).toBe(true);
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
