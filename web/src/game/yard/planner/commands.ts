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

export class CommandStack {
  private readonly done: PlanCommand[] = [];
  private readonly undone: PlanCommand[] = [];
  private readonly depth: number;
  private readonly onChange: (() => void) | undefined;

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

  /**
   * Runs a command and records it.
   *
   * The redo side is dropped, because a new edit after an undo forks the
   * history and there is no branch to return to.
   */
  push(command: PlanCommand): void {
    command.apply();
    this.done.push(command);
    this.undone.length = 0;
    if (this.done.length > this.depth) this.done.shift();
    this.onChange?.();
  }

  /**
   * Records a command that has already been applied.
   *
   * A drag applies itself as the pointer moves, so replaying it on push would
   * be a no-op at best and a double move at worst.
   */
  pushApplied(command: PlanCommand): void {
    this.done.push(command);
    this.undone.length = 0;
    if (this.done.length > this.depth) this.done.shift();
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
    this.done.length = 0;
    this.undone.length = 0;
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
