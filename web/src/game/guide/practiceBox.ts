/**
 * The guided start's practice camp and its drop box, on the client (issue
 * #227, `docs/design/tutorial.md` §5.1, §5.2). The camp's layout is the
 * server's (`server/src/game-data/tribes/v1/tutorial.ts`); the box is the one
 * `server/src/game-data/tribes/v1/practiceCamp.test.ts` proves 15 level 1
 * Pokeys always win from, and `practiceBox.test.ts` proves is all legal
 * ground. Keep the three equal.
 */

/** The camp's tribe base id: Flash's tutorial camp id. */
export const PRACTICE_CAMP_BASEID = "1";

/** Drop centres allowed, yard units: east of the tower. */
export const PRACTICE_BOX = { minX: 300, maxX: 420, minY: -60, maxY: 60 } as const;

/** Whether a drop centre is inside the box. */
export const inPracticeBox = (point: { readonly x: number; readonly y: number }): boolean =>
  point.x >= PRACTICE_BOX.minX &&
  point.x <= PRACTICE_BOX.maxX &&
  point.y >= PRACTICE_BOX.minY &&
  point.y <= PRACTICE_BOX.maxY;

/** The box's four corners, yard units, clockwise from the top-left. */
export const practiceBoxCorners = (): { x: number; y: number }[] => [
  { x: PRACTICE_BOX.minX, y: PRACTICE_BOX.minY },
  { x: PRACTICE_BOX.maxX, y: PRACTICE_BOX.minY },
  { x: PRACTICE_BOX.maxX, y: PRACTICE_BOX.maxY },
  { x: PRACTICE_BOX.minX, y: PRACTICE_BOX.maxY },
];
