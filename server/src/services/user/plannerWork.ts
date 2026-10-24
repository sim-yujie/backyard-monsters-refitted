import { createHash } from "node:crypto";

import { redis } from "../../server.js";
import type { LayoutNode, StoredNode } from "../../schemas/YardPlannerSchemas.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { checkNodesOwned, parsePayload } from "../yardplanner/validateLayout.js";
import { breakStayStreak, plannerPlanKey, STAY_STREAK_TTL_SECONDS } from "./botPatterns.js";

/**
 * Work in the Yard Planner, as the "Stay protected?" tap shows it (beta.4).
 *
 * The planner writes nothing until Apply, so a player rearranging there for
 * a long time sends only the stay taps the web client makes for them
 * (`ProtectionWatch.active`), and six of those running is the bot check's
 * `stay` rule (`botPatterns.ts`). Such a tap carries the plan as it stands,
 * the `data` a slot save sends. It breaks the streak, as any other real
 * action between taps does, only when the plan names the player's own
 * buildings and has moved on since the last one heard (or, for the first,
 * from the yard itself): a tap with the same plan again, or none, is a plain
 * tap. So keeping the streak down takes a new, real arrangement of the
 * player's own yard each time, which is the work a player does, and no less
 * than any other real action a modified client could send instead.
 *
 * Main yard only: an outpost's buildings are not in the main save, so a plan
 * for one reads as not the player's and the tap stays plain.
 */

/** Where every node stands and which are in the drawer, as one string. */
const arrangementOf = (nodes: readonly Pick<LayoutNode, "id" | "x" | "y">[], stored: readonly StoredNode[]): string =>
  `${nodes
    .map((node) => `${node.id}:${node.x}:${node.y}`)
    .sort()
    .join(",")}|${stored
    .map((node) => node.id)
    .sort((a, b) => a - b)
    .join(",")}`;

const fingerprint = (arrangement: string): string => createHash("sha256").update(arrangement).digest("hex");

/**
 * Hears the plan a stay tap carries and, when it is new work on the
 * player's own yard, breaks the stay streak (the file comment). Never
 * throws: a plan that cannot be read or is not the player's leaves the tap
 * plain.
 *
 * @param raw - The tap's `plan` field, a version 2 layout payload as a JSON string.
 * @returns Whether the plan counted as work.
 */
export const hearPlannerWork = async (
  userid: number,
  raw: unknown,
  buildingdata: BuildingDataMap | null | undefined
): Promise<boolean> => {
  let nodes: LayoutNode[];
  let stored: StoredNode[];
  try {
    const payload = parsePayload(raw);
    nodes = payload.nodes;
    stored = payload.stored ?? [];
    checkNodesOwned([...nodes, ...stored], buildingdata);
  } catch {
    return false;
  }
  if (nodes.length + stored.length === 0) return false;

  const plan = fingerprint(arrangementOf(nodes, stored));
  const yard = (): string =>
    fingerprint(
      arrangementOf(
        nodes.map((node) => {
          const building = buildingdata?.[String(node.id)] as BuildingData | undefined;
          return { id: node.id, x: Number(building?.X), y: Number(building?.Y) };
        }),
        []
      )
    );
  const before = (await redis.get(plannerPlanKey(userid))) ?? yard();
  if (plan === before) return false;

  await redis.setex(plannerPlanKey(userid), STAY_STREAK_TTL_SECONDS, plan);
  await breakStayStreak(userid);
  return true;
};
