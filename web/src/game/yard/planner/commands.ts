/**
 * Undo and redo for the planner (design §3, F8).
 *
 * A command stack over the plan, not a snapshot history. A 575-building yard
 * snapshotted 200 deep would be 115,000 records; a move of 400 walls stored as
 * before-and-after positions is 400 small objects, and undoing it is the same
 * loop as doing it. The design doc is explicit that this has to exist from day
 * one rather than be retrofitted, because every later mutation — place, store,
 * mirror, align, load — pushes onto the same stack.
 *
 * Nothing here knows what a plan is: a command is two functions and a label, so
 * this file stays a stack and the plan stays the thing being changed.
 */

import type { NodePlan } from "./placement";

/** Depth the design doc specifies. */
export const UNDO_DEPTH = 200;

export interface PlanCommand {
  /** Shown on the undo and redo buttons: "Move 6 buildings". */
  readonly label: string;
  /** Applies the change. Called once on push and again on every redo. */
  apply(): void;
  /** Puts the plan back exactly as it was. */
  revert(): void;
}

/** One building's position before and after a move. */
export interface MoveEntry {
  readonly id: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

/**
 * One building's planned upgrade before and after an edit.
 *
 * Whole values rather than a level, because clearing a plan and setting one
 * are the same edit from the stack's point of view and because `order` has to
 * come back exactly as it was: undoing a re-aimed plan that kept its place in
 * the queue must not send it to the back.
 */
export interface PlanEntry {
  readonly id: number;
  readonly before: NodePlan | null;
  readonly after: NodePlan | null;
}

/**
 * One building moving between the plot and the drawer.
 *
 * `x` and `y` are the cells the building leaves from when it is stored and the
 * cells it lands on when it is placed, which is the same field in both
 * directions: undoing a store puts the building back exactly where it came
 * from, and undoing a place takes it off exactly where it went.
 */
export interface StoreEntry {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** True to lift it off the plot, false to put it back on. */
  readonly store: boolean;
}

/** A position no stack can ever be at, so `isClean` stays false forever. */
const UNREACHABLE = -1;

export class CommandStack {
  private readonly done: PlanCommand[] = [];
  private readonly undone: PlanCommand[] = [];
  private readonly depth: number;
  private readonly onChange: (() => void) | undefined;

  /**
   * The position the plan was last saved at, or `UNREACHABLE`.
   *
   * "Unsaved changes" is a question about where the stack is, not about whether
   * anything has ever been edited: undoing back to the saved state leaves the
   * plan byte-for-byte what the slot holds, and a sticky flag would still call
   * it dirty. Holding a position instead makes undo and redo cross the line in
   * both directions for free.
   */
  private cleanAt = 0;

  constructor(options: { depth?: number; onChange?: () => void } = {}) {
    this.depth = options.depth ?? UNDO_DEPTH;
    this.onChange = options.onChange;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** What undo would reverse, for the button's tooltip. */
  get undoLabel(): string | null {
    return this.done[this.done.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.undone[this.undone.length - 1]?.label ?? null;
  }

  /** How many commands are on the undone side; the tests read it. */
  get size(): number {
    return this.done.length;
  }

  /** How many commands deep the stack currently is. */
  get position(): number {
    return this.done.length;
  }

  /** True while the stack sits where `markClean` last left it. */
  get isClean(): boolean {
    return this.done.length === this.cleanAt;
  }

  /** Records that the plan as it stands right now has been saved. */
  markClean(): void {
    this.cleanAt = this.done.length;
  }

  /**
   * Runs a command and records it.
   *
   * The redo side is dropped, because a new edit after an undo forks the
   * history and there is no branch to return to.
   */
  push(command: PlanCommand): void {
    command.apply();
    this.record(command);
  }

  /**
   * Records a command that has already been applied.
   *
   * A drag applies itself as the pointer moves, so replaying it on push would
   * be a no-op at best and a double move at worst.
   */
  pushApplied(command: PlanCommand): void {
    this.record(command);
  }

  /** The bookkeeping `push` and `pushApplied` share. */
  private record(command: PlanCommand): void {
    // The saved position may have been on the redo side this push just threw
    // away, and a forked history can never be walked back to.
    if (this.cleanAt > this.done.length) this.cleanAt = UNREACHABLE;
    this.done.push(command);
    this.undone.length = 0;
    if (this.done.length > this.depth) {
      this.done.shift();
      // Everything above shifted down one; a saved position that fell off the
      // bottom with it is gone.
      this.cleanAt = this.cleanAt > 0 ? this.cleanAt - 1 : UNREACHABLE;
    }
    this.onChange?.();
  }

  undo(): PlanCommand | null {
    const command = this.done.pop();
    if (!command) return null;
    command.revert();
    this.undone.push(command);
    this.onChange?.();
    return command;
  }

  redo(): PlanCommand | null {
    const command = this.undone.pop();
    if (!command) return null;
    command.apply();
    this.done.push(command);
    this.onChange?.();
    return command;
  }

  /** Forgets everything. Apply and loading a different slot both do this. */
  clear(): void {
    // Forgetting the history does not save the plan: a stack that was dirty
    // stays dirty, it just has nothing left to undo.
    const clean = this.isClean;
    this.done.length = 0;
    this.undone.length = 0;
    this.cleanAt = clean ? 0 : UNREACHABLE;
    this.onChange?.();
  }
}

/**
 * A move of one or more buildings, as before-and-after positions.
 *
 * Positions rather than a single delta because a load or an align moves each
 * building by a different amount, and one shape for every positional command
 * means undo never has to ask which kind it is holding.
 *
 * `move` takes the whole batch rather than one building at a time. Applying a
 * group one member at a time would have the plan's occupancy grid briefly hold
 * two buildings in one cell and then clear both, which leaves a hole where a
 * wall still stands.
 */
export const moveCommand = (
  entries: readonly MoveEntry[],
  move: (entries: readonly MoveEntry[], reverse: boolean) => void,
  label = entries.length === 1 ? "Move building" : `Move ${entries.length} buildings`,
): PlanCommand => ({
  label,
  apply: () => move(entries, false),
  revert: () => move(entries, true),
});

/**
 * A planned upgrade set or cleared on one or more buildings.
 *
 * The same shape as a move for the same reason: planning ten towers to level 5
 * from a multi-selection is one press and has to be one Ctrl+Z, and the stack
 * should not have to know which kind of edit it is holding.
 */
export const planCommand = (
  entries: readonly PlanEntry[],
  setPlans: (entries: readonly PlanEntry[], reverse: boolean) => void,
  label: string,
): PlanCommand => ({
  label,
  apply: () => setPlans(entries, false),
  revert: () => setPlans(entries, true),
});

/**
 * Buildings stored off the plot, or placed back onto it.
 *
 * The same batch shape as a move, for the same reason: clearing a 575-building
 * yard is one gesture and has to be one Ctrl+Z, and the stack should not have
 * to know which kind of edit it is holding.
 */
export const storeCommand = (
  entries: readonly StoreEntry[],
  setStored: (entries: readonly StoreEntry[], reverse: boolean) => void,
  label: string,
): PlanCommand => ({
  label,
  apply: () => setStored(entries, false),
  revert: () => setStored(entries, true),
});

/**
 * Several commands as one undo entry, applied in order and reverted in
 * reverse.
 *
 * Loading a layout moves buildings *and* restores the upgrades that were
 * planned when it was saved. Those are two kinds of edit and the player made
 * one gesture, so they go on the stack as one command rather than two the
 * player has to undo twice to get back where they were.
 *
 * Reverting backwards is not decoration: it is the only order that puts the
 * plan back when two commands in the list touch the same building.
 */
export const compositeCommand = (
  label: string,
  parts: readonly PlanCommand[],
): PlanCommand => ({
  label,
  apply: () => {
    for (const part of parts) part.apply();
  },
  revert: () => {
    for (let index = parts.length - 1; index >= 0; index--) parts[index]!.revert();
  },
});
