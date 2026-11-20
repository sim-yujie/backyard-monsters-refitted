/**
 * What the planner shows of whatever is in hand (owner, 19 Nov 2026, desk
 * fix B: "the box"). The yard's placing box is green where the building can
 * go and red where it cannot; the planner's carry out of Stored stayed orange
 * even on a building or off the plot, because only the building in the way
 * was marked. Drawing only: what a drop is allowed to do is unchanged.
 */
export interface InHandInput {
  /** A building carried out of Stored, and whether it can stand where it is. */
  readonly placing: { readonly id: number; readonly ok: boolean } | null;
  /** A placed selection picked up by a click (it follows the pointer). */
  readonly carrying: boolean;
  /** A placed selection dragged away from where it stands (button held). */
  readonly dragging: boolean;
  /** Buildings the plan says are illegal now: the move's or the blocker. */
  readonly faulted: ReadonlySet<number>;
}

export interface InHandMarks {
  /** Something is in hand: the selection is boxed green or red. */
  readonly inHand: boolean;
  /** The faulted set, plus a carried building that cannot stand where it is. */
  readonly invalid: ReadonlySet<number>;
}

export const inHandMarks = (input: InHandInput): InHandMarks => {
  const { placing, faulted } = input;
  const inHand = placing !== null || input.carrying || input.dragging;
  if (!placing || placing.ok || faulted.has(placing.id)) return { inHand, invalid: faulted };
  const invalid = new Set(faulted);
  invalid.add(placing.id);
  return { inHand, invalid };
};
