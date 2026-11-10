import type { MyAlliance } from "@/api/alliance";
import { confirmLeaveWorld, showHandOverFirst, type LeavingAlliance } from "@/ui/alliance/LeaveWorldWarning";

/**
 * Leaving the Map Room 2 world leaves the alliance (owner, 10 Nov 2026;
 * design v5 §2). Every flow that takes a player out of their world calls
 * {@link leaveWorldWithWarning} before it asks the server to move them.
 *
 * NOT reachable yet (beta 7): the web has no way to leave a Map Room 2 world
 * today, and the free overrun move is refused to alliance members (owner's
 * answer D), so nothing calls this. It is ready for the first such flow.
 */

/** What the warning needs of the player's alliance (`myalliance`). */
export type WorldLeaver = Pick<MyAlliance, "name" | "image" | "role" | "number_of_members">;

export interface LeaveWorldDeps {
  readonly confirm: (container: HTMLElement, alliance: LeavingAlliance, last: boolean) => Promise<boolean>;
  readonly handOverFirst: (container: HTMLElement, alliance: LeavingAlliance) => Promise<void>;
}

const DEFAULTS: LeaveWorldDeps = { confirm: confirmLeaveWorld, handOverFirst: showHandOverFirst };

/** How the player stands to leaving: free to go, asked first, or told to hand over leadership first. */
export type LeaveWorldStep = "go" | "confirm" | "confirmLast" | "handOver";

/**
 * The rule, as the server applies it (`leaveAllianceForWorldChange`): no
 * alliance, nothing to ask; a member or Officer is asked; a leader alone is
 * asked (the alliance closes); a leader with others must hand over first.
 */
export const leaveWorldStep = (alliance: WorldLeaver | null): LeaveWorldStep => {
  if (!alliance) return "go";
  if (alliance.role !== "leader") return "confirm";
  return (alliance.number_of_members ?? 1) > 1 ? "handOver" : "confirmLast";
};

/**
 * Runs `proceed` (the world move itself) once the player has agreed to leave
 * their alliance with the world: at once when they are in none. A leader with
 * other members is told to hand over first, and nothing moves.
 *
 * @returns Whether `proceed` ran.
 */
export const leaveWorldWithWarning = async (
  alliance: WorldLeaver | null,
  container: HTMLElement,
  proceed: () => void | Promise<void>,
  deps: LeaveWorldDeps = DEFAULTS,
): Promise<boolean> => {
  const step = leaveWorldStep(alliance);
  if (alliance && step === "handOver") {
    await deps.handOverFirst(container, alliance);
    return false;
  }
  if (alliance && step !== "go" && !(await deps.confirm(container, alliance, step === "confirmLast"))) return false;
  await proceed();
  return true;
};
