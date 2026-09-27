/**
 * The buildings an armed drop is lit on (issue #88), kept in step with the
 * preview: each move lights what has come under the zone and puts back what
 * has left it, so a pointer sweeping over a wall line touches only the blocks
 * that changed rather than every one of them each frame.
 */
export class DropHighlight {
  private lit = new Set<number>();

  /** `light` switches one building's highlight: `YardRenderer.highlightBuilding`. */
  constructor(private readonly light: (id: number, on: boolean) => void) {}

  /** Lights exactly `ids`. */
  show(ids: readonly number[]): void {
    const next = new Set(ids);
    for (const id of this.lit) if (!next.has(id)) this.light(id, false);
    for (const id of next) if (!this.lit.has(id)) this.light(id, true);
    this.lit = next;
  }

  /** Puts every lit building back. */
  clear(): void {
    this.show([]);
  }

  /** The buildings lit now. */
  get ids(): ReadonlySet<number> {
    return this.lit;
  }
}
