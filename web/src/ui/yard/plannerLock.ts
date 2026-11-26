import { lockArt } from "@/ui/lockArt";

/**
 * A Yard Planner tool locked until the yard has a built Yard Planner (owner,
 * beta 8; the rule is `game/yard/planner/access.ts`, `plannerToolBlock`).
 *
 * The control stays visible and stays pressable: a press is what says why,
 * through the game's notice (the planner checks the lock itself before doing
 * anything, so the bar only has to look the part). It is therefore marked
 * `aria-disabled`, never `disabled`, which would swallow the press. The
 * control's own content is muted and the game's gold padlock sits on it at
 * full colour (astra, design direction B, 19 Nov 2026):
 *
 * - `corner`: over an icon's lower-right quarter (Find, the yard picture,
 *   Upgrade walls);
 * - `lead`: before a word (Blueprint, the View rows, Compare).
 */
export type LockPlace = "corner" | "lead";

const LOCK_CLASS = "planner-lock";

/**
 * Locks `control` with `reason` as its tooltip, or unlocks it with null.
 *
 * Idempotent: locking twice keeps one padlock, and unlocking puts back the
 * tooltip the control had before it was locked.
 */
export const setControlLocked = (
  control: HTMLElement,
  reason: string | null,
  place: LockPlace,
  size: number,
): void => {
  const existing = control.querySelector<HTMLElement>(`:scope > .${LOCK_CLASS}`);
  if (reason === null) {
    if (!control.classList.contains("is-locked")) return;
    existing?.remove();
    control.classList.remove("is-locked", `is-locked--${place}`);
    control.removeAttribute("aria-disabled");
    const title = control.dataset["unlockedTitle"];
    if (title !== undefined) control.title = title;
    delete control.dataset["unlockedTitle"];
    delete control.dataset["lockReason"];
    return;
  }
  if (!control.classList.contains("is-locked")) control.dataset["unlockedTitle"] = control.title;
  control.classList.add("is-locked", `is-locked--${place}`);
  control.setAttribute("aria-disabled", "true");
  control.dataset["lockReason"] = reason;
  control.title = reason;
  if (existing) return;
  // Loose words get a box of their own, so the label fades like an icon does
  // while the padlock beside it stays at full colour.
  for (const node of [...control.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    const label = document.createElement("span");
    label.className = `${LOCK_CLASS}__label`;
    node.replaceWith(label);
    label.append(node);
  }
  const badge = document.createElement("span");
  badge.className = `${LOCK_CLASS} ${LOCK_CLASS}--${place}`;
  badge.style.setProperty("--lock-size", `${size}px`);
  badge.append(lockArt(size, "planner-lock__art"));
  if (place === "lead") control.prepend(badge);
  else control.append(badge);
};
